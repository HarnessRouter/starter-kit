// The run's conversation: the goal the person gave, every decision the model made with the game's
// reply, and the closing sentence. The panel is reifyui's ChatPanel, the same one the other kits
// mount; what is left here is the two functions that reach the backend and the words on screen.
import { useCallback } from 'react';
import { Gamepad2 } from 'lucide-react';
import { ChatPanel } from 'reifyui';
import { streamTurn, turnsToMessages } from 'reifyui/harness';
import { isPending, sessionTurns } from '../lib/game';

const TOOL_LABELS = {
  run_right: 'Run right',
  jump_right: 'Jump right',
  jump: 'Jump',
  walk_left: 'Walk left',
  wait: 'Wait',
  observe: 'Look',
  reset: 'Open the game',
};

export function ChatColumn({ runId, seed, onSeedConsumed, handlers, externalBusy, onSessionStarted,
                             width, collapsed, onToggle }) {
  const runTurn = useCallback(({ sessionId, text, handlers: panel }) => streamTurn({
    sessionId: isPending(sessionId) ? '' : sessionId,
    input: text,
    // the page counts the run from the same events the panel renders
    handlers: {
      ...panel,
      onCreated: (rid) => { handlers.onCreated?.(rid); panel.onCreated?.(rid); },
      onToolCall: (name, args, callId) => { handlers.onToolCall?.(name, args, callId); panel.onToolCall?.(name, args, callId); },
      onToolResult: (callId, output) => { handlers.onToolResult?.(callId, output); panel.onToolResult?.(callId, output); },
      onDone: (status, response) => { handlers.onDone?.(status, response); panel.onDone?.(status, response); },
      onError: (message) => { handlers.onError?.(message); panel.onError?.(message); },
    },
  }), [handlers]);

  const loadHistory = useCallback((sessionId) => (
    isPending(sessionId) ? Promise.resolve([]) : sessionTurns(sessionId).then(turnsToMessages)
  ), []);

  return (
    <ChatPanel
      sessionId={runId}
      runTurn={runTurn}
      loadHistory={loadHistory}
      onSessionStarted={onSessionStarted}
      seed={seed}
      onSeedConsumed={onSeedConsumed}
      externalBusy={externalBusy}
      title="Run"
      collapsed={collapsed}
      onToggleCollapse={onToggle}
      width={width}
      placeholder="Tell Mario what to do…"
      workingLabel="Playing…"
      toolLabels={TOOL_LABELS}
      busyState={(
        <div className="uic-chat-empty">
          <span className="uic-chat-pulse" aria-hidden="true" />
          <div className="uic-chat-empty-t">Playing</div>
          <div>Every decision arrives here as it is made, with the game's reply.</div>
        </div>
      )}
      emptyState={(
        <div className="uic-chat-empty">
          <Gamepad2 size={26} />
          <div className="uic-chat-empty-t">Your run</div>
          <div>Press Play, or type a goal. Every decision the model makes shows here, with what the
            game said back, and the run ends with one sentence on how it went.</div>
        </div>
      )}
    />
  );
}
