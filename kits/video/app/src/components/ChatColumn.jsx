// The copilot column — the editor's full-height right panel.
//
// The conversation itself (history, the live turn, retry, attachments, dictation, the composer) is
// reifyui's ChatPanel. What is left here is the only part that is about VIDEO: the two functions
// that reach the backend, and the words on the screen.
//
//   runTurn      one turn, through lib/copilot.js — which is where the template's shot plan for a
//                brand-new video lives, out of the transcript.
//   loadHistory  the session's turns as messages; a pending video has no session, so it answers []
//                without a request.
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clapperboard } from 'lucide-react';
import { ChatPanel, createDictation } from 'reifyui';
import { fileToInputBlock, sessionTurns, turnsToMessages } from 'reifyui/harness';
import {
  importMedia, isPending, takeAttachments, takeReference, videoHarness,
} from '../lib/video';
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

export function ChatColumn({ videoId, harnessId, seed, title, agentBusy, onSceneMaybeChanged,
                             onSessionStarted, width, collapsed, onToggle }) {
  // Built once: a fresh recogniser object every render would stop dictation on every keystroke.
  // It is null where the browser has none, and then the panel renders no microphone at all.
  const [dictation] = useState(() => createDictation());

  const runTurn = useCallback(async ({ sessionId, text, attachments, handlers }) => {
    // A file picked on the landing page belongs to this video's FIRST message: the panel sends the
    // landing prompt as a seed, which carries no attachments of its own.
    const files = [...takeAttachments(sessionId), ...attachments.map((f) => f.payload)];

    // A TEMPLATE'S REFERENCE FRAME IS A REAL PICTURE AND IT GOES IN THE SESSION, not on the card
    // only. It is imported here, on the first turn, because that is the moment the session first
    // exists — and the agent is told its media id, which is all it needs to place it and to
    // render the opening shot FROM it. If the import fails the film still starts; the reference
    // is a help, not a precondition, and a broken one must not block anybody's first message.
    let message = text;
    const ref = takeReference(sessionId);
    if (ref?.src) {
      try {
        // The harness id is resolved HERE rather than taken from a prop. The first turn fires
        // while the page is still fetching it, so the prop was empty exactly when this runs —
        // the import was skipped and the reference consumed, every single time.
        const hid = harnessId || (await videoHarness())?.id || '';
        const res = hid ? await fetch(ref.src) : null;
        const rec = res?.ok ? await importMedia(hid, sessionId, await res.blob(),
                                                ref.alt || 'Reference') : null;
        if (rec?.media_id) {
          message += `\n\n(Reference frame for this look is already in this video as `
            + `${rec.media_id} — ${ref.alt || 'the template reference'}. Place it on the canvas `
            + `so I can see it, and use it as from_image for the opening shot so the film starts `
            + `on that look rather than a fresh guess at it.)`;
        }
      } catch { /* the film starts without it */ }
    }
    return runCopilotTurn(sessionId, message, handlers, files);
  }, [harnessId]);

  const loadHistory = useCallback((sessionId) => (
    isPending(sessionId) ? Promise.resolve([]) : sessionTurns(sessionId).then(turnsToMessages)
  ), []);

  return (
    <ChatPanel
      sessionId={videoId}
      runTurn={runTurn}
      loadHistory={loadHistory}
      onSessionStarted={onSessionStarted}
      onChanged={onSceneMaybeChanged}
      seed={seed}
      onSeedConsumed={stripSeedFromHash}
      externalBusy={agentBusy}
      attachments={{ prepare: fileToInputBlock }}
      dictation={dictation}
      title={title || 'Copilot'}
      headerRight={agentBusy
        ? <span className="vd-chat-mark" title="The agent is working"><Clapperboard size={12} /></span>
        : null}
      collapsed={collapsed}
      onToggleCollapse={onToggle}
      width={width}
      placeholder="What should this film show?"
      renderMarkdown={(t) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>}
      busyState={(
        <div className="uic-chat-empty">
          <span className="uic-chat-pulse" aria-hidden="true" />
          <div className="uic-chat-empty-t">Planning your film…</div>
          <div>The shot list arrives here first, before anything is rendered.</div>
        </div>
      )}
      emptyState={(
        <div className="uic-chat-empty">
          <Clapperboard size={26} />
          <div className="uic-chat-empty-t">Your video copilot</div>
          <div>Describe the film. It writes the shot list here and waits for your yes before it
            renders anything — every clip costs money.</div>
        </div>
      )}
    />
  );
}
