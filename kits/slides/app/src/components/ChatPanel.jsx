// Copilot chat column — the deck page's full-height right panel.
// Adapted from ContextualGraph's ChatPanel: the conversational surface is the
// shared UI Core package; the broker transport is Flowness's (lib/copilot.js
// streaming with the non-streaming /chat fallback). On mount it replays the
// member's prior conversation over this deck; the landing prompt's ?seed=
// fires exactly ONCE (stripped from the URL immediately, skipped when history
// already exists).
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Mic, PanelRight, Plus, Sparkles } from 'lucide-react';
import { ChatMessages, ChatMessagesSkeleton } from 'reifyui';
import { Composer } from 'reifyui';
import { withReasoning, withResult, withStep, withText } from 'reifyui';
import { chatHistory, sendChat, uploadRef } from '../lib/sl';
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

export function ChatColumn({ deckId, seed, title, copilotBuilding, collapsed, onToggle, onDeckMaybeChanged,
                             onSessionStarted, width }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState([]);   // names uploaded, awaiting next turn
  const fileRef = useRef(null);

  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAttaching(true);
    try {
      const r = await uploadRef(deckId, file);
      setAttached((l) => [...l, r.name]);
    } catch (err) {
      setAttached((l) => [...l, `(failed) ${file.name}`]);
    } finally { setAttaching(false); }
  }
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
      const res = await sendChat(deckId, text);
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
      onDeckMaybeChanged?.();
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
      const out = await streamTurn(deckId, text, {
        // A deck created from the landing page has no session until this turn makes one.
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
      onDeckMaybeChanged?.();
    } catch {
      dropRunningAsst();
      pendingRef.current = text;
      setConnecting(true);
    } finally {
      setBusy(false);
    }
  }

  function send(text) {
    if (attached.length) setAttached([]);
    const t = text.trim();
    if (!t || busy || histLoading) return;
    setMessages((m) => [...m, { role: 'user', text: t }]);
    setDraft('');
    deliver(t);
  }

  // Mount: strip ?seed FIRST, then replay history; seed fires only when empty.
  //
  // Keyed on deckId, and a pending deck CHANGES its id mid-stream: it starts as "new:<template>"
  // and adopts the real session id the moment the first turn opens one. Re-running then refetched
  // history and setMessages() over the blocks that were streaming in — the panel showed the user
  // bubble and nothing else while the console showed the whole turn. It is the same conversation,
  // so the resolve is not a reason to reload it.
  const prevDeckId = useRef(deckId);
  useEffect(() => {
    const resolved = String(prevDeckId.current || '').startsWith('new:')
      && !String(deckId || '').startsWith('new:');
    prevDeckId.current = deckId;
    if (resolved) return undefined;
    stripSeedFromHash();
    let dead = false;
    chatHistory(deckId).then(({ turns }) => {
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
  }, [deckId]);

  // While the broker is not live, retry the pending message on an interval.
  useEffect(() => {
    if (!connecting) return undefined;
    const iv = window.setInterval(() => {
      if (pendingRef.current && !busy) deliver(pendingRef.current);
    }, RETRY_MS);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, busy]);

  // Never miss the conversation, even across the parallel HarnessRouter turn.
  // The copilot may be running a turn started in ANOTHER tab (or before this
  // mount, during the very first turn when the session isn't persisted yet):
  // the realtime `copilotBuilding` flag is the truth. While it's on and we
  // have nothing local, poll history so the turn's messages appear the moment
  // the session is queryable; when it turns OFF (turn finished anywhere),
  // reload once to pick up the final answer + any edits. No drift, no dead-end.
  const prevBuildingRef = useRef(false);
  useEffect(() => {
    let dead = false;
    let poll;
    const reload = () => chatHistory(deckId).then(({ turns }) => {
      if (dead) return;
      const hist = turnsToMessages(turns);
      // don't clobber a locally-streaming turn in THIS tab
      if (hist.length && !busy && !pendingRef.current) setMessages(hist);
    });
    if (copilotBuilding && messages.length === 0 && !busy) {
      poll = window.setInterval(reload, 3000);   // first-turn / other-tab catch-up
    }
    if (prevBuildingRef.current && !copilotBuilding) {
      reload();   // turn just finished somewhere — sync the result in
      if (onDeckMaybeChanged) onDeckMaybeChanged();
    }
    prevBuildingRef.current = copilotBuilding;
    return () => { dead = true; if (poll) window.clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilotBuilding, messages.length, busy]);

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
        ) : empty && copilotBuilding ? (
          // A turn is running (this deck, possibly another tab / the first
          // pre-persist turn) — show WORKING, never the blank prompt.
          <div className="pane-empty">
            <span className="pulse-dot" />
            <div className="big">Copilot is building your deck…</div>
            <div>Working through the slides now — this can take a minute. Your conversation will appear here.</div>
          </div>
        ) : empty ? (
          <div className="pane-empty">
            <Sparkles size={26} />
            <div className="big">Your slides copilot</div>
            <div>Describe what this deck should do, and your copilot will build and refine it with you.</div>
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
          <>
            <input ref={fileRef} type="file" hidden accept=".pdf,.pptx,.docx,.md,.txt,.png,.jpg,.jpeg" onChange={onPickFile} />
            <button type="button" className="cmp-icon" aria-label="Attach a reference document"
                    title="Attach a document (PDF, PPTX...) — the copilot reads it as source material"
                    disabled={attaching} onClick={() => fileRef.current?.click()}>
              <Plus size={16} />
            </button>
            {attached.map((n, i) => (
              <span key={i} className="ctx-chip set" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n}>{n}</span>
            ))}
            {attaching && <span className="ctx-chip">uploading…</span>}
          </>
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
