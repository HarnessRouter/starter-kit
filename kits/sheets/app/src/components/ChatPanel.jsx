// The copilot column — the sheet page's full-height right panel.
//
// On mount it replays the conversation so far; the landing prompt's ?seed= fires exactly once,
// stripped from the URL immediately and skipped when there is already history.
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, PanelRight, Sparkles } from 'lucide-react';
import { ChatMessages, ChatMessagesSkeleton, Composer, withReasoning, withResult, withStep, withText } from 'reifyui';
import { sessionTurns, turnsToMessages } from 'reifyui/harness';
import { isPending } from '../lib/sh';
import { runCopilotTurn } from '../lib/copilot';

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
  window.history.replaceState(null, '', window.location.pathname + window.location.search
    + path + (rest ? `?${rest}` : ''));
}

const history = (id) => (isPending(id) ? Promise.resolve([]) : sessionTurns(id));

export function ChatColumn({ sheetId, seed, title, agentBusy, onSheetMaybeChanged, onSessionStarted,
                             width, collapsed, onToggle }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [histLoading, setHistLoading] = useState(true);
  const pendingRef = useRef(null);
  const bodyRef = useRef(null);
  const seededRef = useRef(false);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, connecting]);

  function updateLastAsst(fn) {
    setMessages((m) => {
      const out = m.slice();
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (out[i].role === 'assistant') { out[i] = fn({ ...out[i] }); break; }
      }
      return out;
    });
  }

  function dropRunningAsst() {
    setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' && m[m.length - 1].status === 'running'
      ? m.slice(0, -1) : m));
  }

  async function deliver(text) {
    setBusy(true);
    setMessages((m) => [...m, { role: 'assistant', blocks: [], status: 'running' }]);
    try {
      const out = await runCopilotTurn(sheetId, text, {
        // A sheet created from the landing page has no session until this turn makes one.
        onSession: (sid) => onSessionStarted?.(sid),
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

  // Mount: strip ?seed FIRST, then replay history; the seed fires only when there is none.
  //
  // Keyed on sheetId, and a pending sheet CHANGES its id mid-stream: it starts as
  // "new:<template>" and adopts the real session id the moment the first turn opens one.
  // Re-running then refetches history and setMessages() over the blocks streaming in — the panel
  // shows the user bubble and nothing else while the agent is visibly working. It is the same
  // conversation, so the resolve is not a reason to reload it.
  const prevId = useRef(sheetId);
  useEffect(() => {
    const resolved = isPending(prevId.current) && !isPending(sheetId);
    prevId.current = sheetId;
    if (resolved) return undefined;
    stripSeedFromHash();
    let dead = false;
    history(sheetId).then((turns) => {
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

  // Retry a message the gateway was not up to receive.
  useEffect(() => {
    if (!connecting) return undefined;
    const iv = window.setInterval(() => {
      if (pendingRef.current && !busy) deliver(pendingRef.current);
    }, RETRY_MS);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, busy]);

  // A turn may be running that this tab did not start — reopened mid-turn, or another window.
  // Poll history while that is true and nothing local is streaming, then reload once when it
  // ends so the final answer and its edits land here without a refresh.
  const prevBusyRef = useRef(false);
  useEffect(() => {
    let dead = false;
    let poll;
    const reload = () => history(sheetId).then((turns) => {
      if (dead) return;
      const hist = turnsToMessages(turns);
      if (hist.length && !busy && !pendingRef.current) setMessages(hist);
    });
    if (agentBusy && messages.length === 0 && !busy) poll = window.setInterval(reload, 3000);
    if (prevBusyRef.current && !agentBusy) {
      reload();
      onSheetMaybeChanged?.();
    }
    prevBusyRef.current = agentBusy;
    return () => { dead = true; if (poll) window.clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBusy, messages.length, busy]);

  if (collapsed) {
    return (
      <aside className="gp-chat collapsed">
        <div className="gp-chat-h">
          <button className="top-side-toggle" type="button" onClick={onToggle}
                  title="Show the copilot" aria-label="Show the copilot">
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
                title="Hide the copilot" aria-label="Hide the copilot">
          <PanelRight size={17} />
        </button>
        <span className="gp-chat-title" title={title || undefined}>{title || 'Copilot'}</span>
        {agentBusy && <span className="gp-chat-cop" title="The agent is working"><Sparkles size={12} /></span>}
        {connecting && <span className="stat-lbl">connecting</span>}
      </div>
      <div className="chat-body scroll" ref={bodyRef}>
        {histLoading ? (
          <ChatMessagesSkeleton />
        ) : empty && agentBusy ? (
          <div className="pane-empty">
            <span className="pulse-dot" />
            <div className="big">Building your sheet…</div>
            <div>Working through the columns now. Your conversation will appear here.</div>
          </div>
        ) : empty ? (
          <div className="pane-empty">
            <Sparkles size={26} />
            <div className="big">Your sheet copilot</div>
            <div>Describe the columns you want, and it will build and refine the sheet with you.</div>
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
            Still connecting. Your message will be sent as soon as it is online.
          </div>
        )}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => send(draft)}
        disabled={histLoading}
        placeholder="What should this sheet do?"
        rows={2}
        autoGrow={false}
        classNames={{ root: 'cmp', input: '', row: 'cmp-row' }}
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
