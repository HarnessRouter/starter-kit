// The copilot column — the dashboard page's full-height right panel.
//
// The conversation itself (history, the live turn, retry, attachments, dictation, the composer)
// is reifyui's ChatPanel. What is left here is the only part that is about DASHBOARDS: the two
// functions that reach the backend, and the words on the screen.
//
//   runTurn      one turn, through lib/copilot.js — which is where the template scaffolding for
//                a brand-new dashboard lives, out of the transcript.
//   loadHistory  the session's turns as messages; a pending dashboard has no session, so it
//                answers [] without a request.
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import { ChatPanel, createDictation } from 'reifyui';
import { fileToInputBlock, sessionTurns, turnsToMessages } from 'reifyui/harness';
import { isPending, takeAttachments } from '../lib/dash';
import { runCopilotTurn } from '../lib/copilot';

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

export function ChatColumn({ boardId, seed, title, agentBusy, onDocMaybeChanged, onSessionStarted,
                             width, collapsed, onToggle }) {
  // Built once: a fresh recogniser object every render would stop dictation on every keystroke.
  // It is null where the browser has none, and then the panel renders no microphone at all.
  const [dictation] = useState(() => createDictation());

  const runTurn = useCallback(({ sessionId, text, attachments, handlers }) => {
    // A file picked on the landing page belongs to this dashboard's FIRST message: the panel
    // sends the landing prompt as a seed, which carries no attachments of its own.
    const files = [...takeAttachments(sessionId), ...attachments.map((f) => f.payload)];
    return runCopilotTurn(sessionId, text, handlers, files);
  }, []);

  const loadHistory = useCallback((sessionId) => (
    isPending(sessionId) ? Promise.resolve([]) : sessionTurns(sessionId).then(turnsToMessages)
  ), []);

  return (
    <ChatPanel
      sessionId={boardId}
      runTurn={runTurn}
      loadHistory={loadHistory}
      onSessionStarted={onSessionStarted}
      onChanged={onDocMaybeChanged}
      seed={seed}
      onSeedConsumed={stripSeedFromHash}
      externalBusy={agentBusy}
      attachments={{ prepare: fileToInputBlock }}
      dictation={dictation}
      title={title || 'Copilot'}
      headerRight={agentBusy
        ? <span className="db-chat-mark" title="The agent is working"><Sparkles size={12} /></span>
        : null}
      collapsed={collapsed}
      onToggleCollapse={onToggle}
      width={width}
      placeholder="What should this dashboard show?"
      renderMarkdown={(t) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>}
      busyState={(
        <div className="uic-chat-empty">
          <span className="uic-chat-pulse" aria-hidden="true" />
          <div className="uic-chat-empty-t">Building your dashboard…</div>
          <div>Reading your schema and testing queries. Your conversation will appear here.</div>
        </div>
      )}
      emptyState={(
        <div className="uic-chat-empty">
          <Sparkles size={26} />
          <div className="uic-chat-empty-t">Your dashboard copilot</div>
          <div>Ask for a metric, a breakdown or a trend, and it will query your database and add
            the panel.</div>
        </div>
      )}
    />
  );
}
