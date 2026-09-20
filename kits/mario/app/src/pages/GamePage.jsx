// One run: the stage on the left, the conversation on the right.
//
// Two loops run here. The CONVERSATION loop is one open stream, in ChatPanel; this page listens
// to its events to count the run. The FRAME loop reads frame.jpg from the session's live
// workspace while a turn is in flight (see lib/frames.js). Nothing else on this page polls.
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { PaneResizer, useResizablePane } from 'reifyui';
import { cancelResponse, gameHarness, isPending, readObservation, sessionDetail, turnRunning } from '../lib/game';
import { DEFAULT_GOAL } from '../lib/kit';
import { useFrames } from '../lib/frames';
import { Stage } from '../components/Stage';
import { ChatColumn } from '../components/ChatColumn';
import { Topbar } from '../components/Topbar';

const FRESH = { actions: 0, firstAt: 0, lastAt: 0, deaths: 0, lives: null, startedAt: 0, endedAt: 0 };

function count(stats, ev) {
  switch (ev.type) {
    case 'start': return { ...FRESH, startedAt: Date.now() };
    case 'call': {
      const now = Date.now();
      return { ...stats, actions: stats.actions + 1, firstAt: stats.firstAt || now, lastAt: now };
    }
    case 'result': {
      const obs = ev.obs;
      if (!obs || obs.lives == null) return stats;
      const died = stats.lives != null && obs.lives < stats.lives;
      return { ...stats, lives: obs.lives, deaths: stats.deaths + (died ? 1 : 0) };
    }
    case 'end': return { ...stats, endedAt: Date.now() };
    default: return stats;
  }
}

export function GamePage({ id: routeId, onNewRun }) {
  // The session id lives in state, not in the route: a run starts pending and becomes a session
  // when its first turn opens one, which arrives while the stream is open.
  const [id, setId] = useState(routeId);
  useEffect(() => { setId(routeId); }, [routeId]);

  const [harness, setHarness] = useState(undefined);   // undefined = unknown, null = not launched
  // Play hands the panel a first message. The panel sends a seed only as it opens on a session,
  // so Play also remounts it (nothing is lost: the conversation is empty until then).
  const [seed, setSeed] = useState('');
  const [runKey, setRunKey] = useState(0);
  const [status, setStatus] = useState('');
  const [rid, setRid] = useState('');
  const [externalBusy, setExternalBusy] = useState(false);
  const [stats, dispatch] = useReducer(count, FRESH);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 900);
  const chatPane = useResizablePane({
    initial: 400, min: 320, maxFraction: 0.5, fromRight: true, storageKey: 'mario.chat.w',
  });

  useEffect(() => {
    gameHarness().then((h) => setHarness(h || null)).catch(() => setHarness(null));
  }, []);

  // A run opened from its link while its turn is still going: the panel polls history while
  // this is true, and the frames keep coming.
  useEffect(() => {
    if (isPending(id)) return undefined;
    let on = true;
    const look = async () => {
      const d = await sessionDetail(id).catch(() => null);
      if (!on) return;
      const busy = turnRunning(d);
      setExternalBusy(busy);
      if (busy) setTimeout(look, 2000);
    };
    look();
    return () => { on = false; };
  }, [id]);

  const running = status === 'running';
  const { frame, fps } = useFrames(isPending(id) ? '' : id, running || externalBusy);

  const handlers = useMemo(() => ({
    onCreated: (r) => { setRid(r); setStatus('running'); dispatch({ type: 'start' }); },
    onToolCall: () => dispatch({ type: 'call' }),
    onToolResult: (_, output) => dispatch({ type: 'result', obs: readObservation(output) }),
    onDone: (s) => { setStatus(s); dispatch({ type: 'end' }); },
    onError: () => { setStatus('failed'); dispatch({ type: 'end' }); },
  }), []);

  const onStop = useCallback(() => { if (rid) cancelResponse(rid).catch(() => {}); }, [rid]);

  return (
    <div className="mk-root">
      <Topbar model={harness?.defaultModel || ''} status={status} running={running} onNewRun={onNewRun} />
      <div className="mk-body">
        <main className="mk-main scroll">
          <Stage
            frame={frame}
            fps={fps}
            harness={harness}
            status={status}
            running={running || externalBusy}
            stats={stats}
            onPlay={() => { setSeed(DEFAULT_GOAL); setRunKey((k) => k + 1); }}
            onStop={onStop}
          />
        </main>

        <PaneResizer pane={chatPane} />

        {/* Keyed on the Play count only: the run's id arrives WHILE the stream is open, and a key
            that carried it remounted the panel at that moment and dropped the live steps. */}
        <ChatColumn
          key={runKey}
          runId={id}
          seed={seed}
          onSeedConsumed={() => setSeed('')}
          handlers={handlers}
          externalBusy={externalBusy}
          onSessionStarted={(sid) => {
            setId(sid);
            window.history.replaceState(null, '', `${window.location.pathname}#/r/${encodeURIComponent(sid)}`);
          }}
          width={chatPane.width}
          collapsed={!chatOpen}
          onToggle={() => setChatOpen((v) => !v)}
        />
      </div>
    </div>
  );
}
