// Live events for turns this tab did not start.
//
// The gateway broadcasts every event of every session of a Harness on one stream, tagged with
// the session, and replays the turn in flight to a late subscriber. So a window that did not post
// the message (another machine, the same login) still sees the teammate's tools and text as they
// happen; the document and the turn list only carry finished replies. One stream per watched
// teammate, opened only while that teammate is working, closed when the turn ends.
import { createResponsesDispatcher, readSSEStream } from 'reifyui';
import { kitConfig } from 'reifyui/harness';

/** Subscribe to a Harness's event stream; reconnects until unsubscribed. */
export function subscribeHarness(harnessId, onFrame) {
  let stopped = false;
  let ctrl = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await fetch(`${kitConfig().base}/harnesses/${encodeURIComponent(harnessId)}/events`, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok || !res.body) { await wait(2000); continue; }
        await readSSEStream(res.body, (data) => {
          let m;
          try { m = JSON.parse(data); } catch { return; }
          if (!stopped && m && m.event) onFrame(m);
        });
      } catch { /* dropped or aborted: reconnect below */ }
      if (!stopped) await wait(1500);
    }
  })();
  return () => { stopped = true; ctrl?.abort(); };
}

/** Follow one teammate's running turn: `sessionId` when known, otherwise the first session of the
 *  Harness seen starting a turn. `onLive` gets {user, text, steps, status, session, rid} as it
 *  grows; `onDone` once with the terminal status. */
export function watchTurn({ harnessId, sessionId = '', onLive, onDone }) {
  let sid = sessionId, rid = '', d = null;
  const live = { user: '', text: '', steps: [], status: 'running', session: sid, rid: '' };
  const emit = () => onLive?.({ ...live, steps: live.steps.slice() });
  const fresh = () => {
    live.text = ''; live.steps = []; live.status = 'running';
    d = createResponsesDispatcher({
      onTextDelta: (t) => { live.text += t; emit(); },
      onToolCall: (name, args, callId) => { live.steps.push({ name, args, callId }); emit(); },
      onToolResult: (callId, output) => { const s = live.steps.find((x) => x.callId === callId); if (s) { s.result = output; emit(); } },
      onDone: (status) => { live.status = status || 'done'; emit(); onDone?.(live.status, { session: sid, rid }); },
    });
  };
  fresh();
  return subscribeHarness(harnessId, (m) => {
    if (sid && m.session_id !== sid) return;
    const ev = m.event;
    if (ev.type === 'harness.turn.started') {
      if (!sid) sid = m.session_id;
      rid = String(ev.response_id || m.response_id || '');
      fresh();
      live.session = sid; live.rid = rid; live.user = String(ev.user_text || '');
      emit();
      return;
    }
    if (!sid) return;   // without a session, only a turn's start says which one to follow
    if (m.response_id && rid && m.response_id !== rid) { rid = m.response_id; fresh(); live.rid = rid; }
    d.dispatch(ev);
  });
}
