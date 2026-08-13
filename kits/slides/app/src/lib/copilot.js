// Copilot streaming client.
//
// The hosted product posts to a broker that relays the gateway's stream verbatim. Here there is no
// broker to relay anything: the app talks to the gateway directly, and POST /responses with
// stream:true already answers with native Responses SSE events — the exact shape ReifyUI's
// dispatcher parses. So this file is the same idea with one less hop.
//
// The one thing it must do beyond dispatching: a brand-new deck has no session until its first
// turn creates one. The session id arrives in the stream, so every frame is inspected for it and
// reported through onSession before being handed to the dispatcher.
import { createResponsesDispatcher, readSSEStream } from 'reifyui';
import { authFetch } from './auth';
import { slidesHarness } from './sl';

const API = '/api/harness/v1';

/** Pull a session id out of whatever frame carries it, without caring which one that is. */
function sessionIdOf(evt) {
  return evt?.metadata?.session_id || evt?.response?.metadata?.session_id
      || evt?.session_id || evt?.response?.session_id || null;
}

/**
 * Run one streaming turn. handlers: onToolCall(name, args, callId),
 * onToolResult(callId, output), onTextDelta(text), onReasoningDelta(text),
 * onDone(status), onError(message), onSession(sessionId).
 * Returns { ok } after the stream ends, or { connecting: true } on 503.
 */
export async function streamTurn(deckId, message, h) {
  const harness = await slidesHarness();
  if (!harness) throw new Error('Slides has not been launched yet.');
  // A pending deck id ("new:<template>") is not a session — omit it and let the turn create one.
  const existing = deckId && !String(deckId).startsWith('new:') ? String(deckId) : '';

  const res = await authFetch(`${API}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      input: message,
      metadata: { harness_id: harness.id, ...(existing ? { session_id: existing } : {}) },
      stream: true,
    }),
  });
  if (res.status === 503) return { connecting: true };
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`chat stream failed: ${res.status} ${t.slice(0, 160)}`);
  }

  let sawError = false;
  let sid = existing;
  const d = createResponsesDispatcher({
    ...h,
    onError: (msg) => { sawError = true; h.onError?.(msg); },
  });
  await readSSEStream(res.body, (data) => {
    let evt;
    try { evt = JSON.parse(data); } catch { return; }   // malformed frame
    const found = sessionIdOf(evt);
    if (found && found !== sid) { sid = found; h.onSession?.(found); }
    d.dispatch(evt);
  });
  return { ok: !sawError, sessionId: sid };
}
