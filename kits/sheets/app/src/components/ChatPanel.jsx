// Copilot chat column — the workflow page's full-height right panel.
// Adapted from ContextualGraph's ChatPanel: the conversational surface is the
// shared UI Core package; the broker transport is Sheets's (lib/copilot.js
// streaming with the non-streaming /chat fallback). On mount it replays the
// member's prior conversation over this workflow; the landing prompt's ?seed=
// fires exactly ONCE (stripped from the URL immediately, skipped when history
// already exists).
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Mic, PanelRight, Plus, Sparkles } from 'lucide-react';
import { ChatMessages, ChatMessagesSkeleton } from 'reifyui';
import { Composer } from 'reifyui';
import { withReasoning, withResult, withStep, withText } from 'reifyui';
import { chatHistory, sendChat } from '../lib/sh';
import { streamTurn } from '../lib/copilot';

const RETRY_MS = 20000;

const STATUS_LABELS = {
  failed: 'This turn failed. Please try again.',
  cancelled: 'Stopped',
  incomplete: 'The turn hit its limit. Send a follow up to continue.',
};

/** Drop ?seed= from the hash in place so refresh/back/bookmark never resend it. */
function stripSeedFromHash() {
  const h = window.location.hash || '';
  if (!/[?&]seed=/.test(h)) return;
  const [path, query = ''] = h.split('?');
  const params = new URLSearchParams(query);
  params.delete('seed');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + window.location.search + path + (rest ? `?${rest}` : ''));
}

/** Broker history turns -> the shared component's message shape. */
function turnsToMessages(turns) {
  const m = [];
  for (const t of turns || []) {
    if (t.user) m.push({ role: 'user', text: t.user });
    const steps = (t.tools || []).map((x) => ({ name: x.name, args: x.arguments, result: x.result }));
    const blocks = [];
    if (steps.length) blocks.push({ kind: 'tools', reasoning: '', steps });
    if (t.assistant) blocks.push({ kind: 'text', text: t.assistant });
    const st = (t.status === 'failed' || t.status === 'error') ? 'failed'
      : t.status === 'cancelled' ? 'cancelled'
        : (t.status === 'incomplete' || t.status === 'max_turns' || t.status === 'timeout') ? 'incomplete'
          : 'done';
    if (blocks.length || st !== 'done') m.push({ role: 'assistant', blocks, status: st });
  }
  return m;
}

export function ChatColumn({ sheetId, seed, title, copilotBuilding, collapsed, onToggle, onSheetMaybeChanged, width }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [histLoading, setHistLoading] = useState(true);
  const pendingRef = useRef(null);
  const bodyRef = useRef(null);
  const seededRef = useRef(false);
  const streamOkRef = useRef(true);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, connecting]);

  function updateLastAsst(fn) {
    setMessages((m) => {
      const out = m.slice();
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'assistant') { out[i] = fn({ ...out[i] }); break; }
      }
      return out;
    });
  }

  function dropRunningAsst() {
    setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' && m[m.length - 1].status === 'running'
      ? m.slice(0, -1) : m));
  }

  async function legacyDeliver(text) {
    try {
      const res = await sendChat(sheetId, text);
      if (res.status === 404 || res.status === 503) {
        dropRunningAsst();
        pendingRef.current = text;
        setConnecting(true);
        return;
      }
      const body = await res.json().catch(() => null);
      const reply = (body && (body.reply || body.message)) || (res.ok ? '...' : `Something went wrong (${res.status}). Please try again.`);
      updateLastAsst((a) => ({ ...a, blocks: withText(a.blocks, reply), status: res.ok ? 'done' : 'failed' }));
      pendingRef.current = null;
      setConnecting(false);
      onSheetMaybeChanged?.();
    } catch {
      dropRunningAsst();
      pendingRef.current = text;
      setConnecting(true);
    }
  }

  async function deliver(text) {
    setBusy(true);
    setMessages((m) => [...m, { role: 'assistant', blocks: [], status: 'running' }]);
    try {
      if (!streamOkRef.current) {
        await legacyDeliver(text);
        return;
      }
      const out = await streamTurn(sheetId, text, {
        onReasoningDelta: (d) => updateLastAsst((a) => ({ ...a, blocks: withReasoning(a.blocks, d) })),
        onToolCall: (name, args, callId) => updateLastAsst((a) => ({ ...a, blocks: withStep(a.blocks, { name, args, callId }) })),
        onToolResult: (callId, output) => updateLastAsst((a) => ({ ...a, blocks: withResult(a.blocks, callId, output) })),
        onTextDelta: (d) => updateLastAsst((a) => ({ ...a, blocks: withText(a.blocks, d) })),
        onDone: (status) => updateLastAsst((a) => ({ ...a, status: status === 'completed' ? 'done' : status })),
        onError: () => updateLastAsst((a) => ({
          ...a,
          blocks: a.blocks.length ? a.blocks : withText([], 'Something went wrong. Please try again.'),
          status: 'failed',
        })),
      });
      if (out.unsupported) {
        streamOkRef.current = false;
        await legacyDeliver(text);
        return;
      }
      if (out.connecting) {
        dropRunningAsst();
        pendingRef.current = text;
        setConnecting(true);
        return;
      }
      pendingRef.current = null;
      setConnecting(false);
      updateLastAsst((a) => (a.status === 'running' ? { ...a, status: 'done' } : a));
      onSheetMaybeChanged?.();
    } catch {
      dropRunningAsst();
      pendingRef.current = text;
      setConnecting(true);
    } finally {
      setBusy(false);
    }
  }

  function send(text) {
    const t = text.trim();
    if (!t || busy || histLoading) return;
    setMessages((m) => [...m, { role: 'user', text: t }]);
    setDraft('');
    deliver(t);
  }

  // Mount: strip ?seed FIRST, then replay history; seed fires only when empty.
  useEffect(() => {
    stripSeedFromHash();
    let dead = false;
    chatHistory(sheetId).then(({ turns }) => {
      if (dead) return;
      const hist = turnsToMessages(turns);
      if (hist.length) setMessages(hist);
      setHistLoading(false);
      if (seed && !seededRef.current && hist.length === 0) {
        seededRef.current = true;
        setMessages([{ role: 'user', text: seed }]);
        deliver(seed);
      }
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  // While the broker is not live, retry the pending message on an interval.
  useEffect(() => {
    if (!connecting) return undefined;
    const iv = window.setInterval(() => {
      if (pendingRef.current && !busy) deliver(pendingRef.current);
    }, RETRY_MS);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, busy]);

  if (collapsed) {
    return (
      <aside className="gp-chat collapsed">
        <div className="gp-chat-h">
          <button className="top-side-toggle" type="button" onClick={onToggle}
                  title="Show copilot" aria-label="Show copilot">
            <PanelRight size={17} />
          </button>
        </div>
      </aside>
    );
  }

  const empty = messages.length === 0;

  return (
    <aside className="gp-chat" style={width ? { flex: `0 0 ${width}px` } : undefined}>
      <div className="gp-chat-h">
        <button className="top-side-toggle" type="button" onClick={onToggle}
                title="Hide copilot" aria-label="Hide copilot">
          <PanelRight size={17} />
        </button>
        <span className="gp-chat-title" title={title || undefined}>{title || 'Copilot'}</span>
        {/* Copilot status: pulses while a turn runs — fed by the realtime
            channel, so it also shows for turns started in another window. */}
        {copilotBuilding && (
          <span className="gp-chat-cop" title="Copilot is building">
            <Sparkles size={12} />
          </span>
        )}
        {connecting && <span className="stat-lbl">connecting</span>}
      </div>
      <div className="chat-body scroll" ref={bodyRef}>
        {histLoading ? (
          <ChatMessagesSkeleton />
        ) : empty ? (
          <div className="pane-empty">
            <Sparkles size={26} />
            <div className="big">Your sheet copilot</div>
            <div>Describe the sheet you want and your copilot will build it and fill it, row by row.</div>
          </div>
        ) : (
          <ChatMessages
            messages={messages}
            renderMarkdown={(t) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>}
            workingLabel="Working..."
            toolLabels={{ workingLabel: 'Working...' }}
            statusLabels={STATUS_LABELS}
          />
        )}
        {connecting && (
          <div className="chat-status">
            <span className="pulse" />
            Copilot is connecting. Your message will be delivered as soon as it is online.
          </div>
        )}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => send(draft)}
        disabled={histLoading}
        placeholder="What would you want to change?"
        rows={2}
        autoGrow={false}
        classNames={{ root: 'cmp', input: '', row: 'cmp-row' }}
        accessoriesLeft={(
          <span title="Attachments are coming soon">
            <button type="button" className="cmp-icon" disabled aria-label="Add an attachment"><Plus size={16} /></button>
          </span>
        )}
        accessoriesRight={(
          <span title="Voice input is coming soon">
            <button type="button" className="cmp-icon" disabled aria-label="Voice input"><Mic size={15} /></button>
          </span>
        )}
        renderSend={() => (
          <button type="button" className="cmp-send" onClick={() => send(draft)}
                  disabled={busy || histLoading || !draft.trim()} aria-label="Send message">
            <ArrowUp size={16} />
          </button>
        )}
      />
    </aside>
  );
}
