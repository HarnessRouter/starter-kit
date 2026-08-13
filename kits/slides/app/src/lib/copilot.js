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
import { getTemplateDetail, slidesHarness } from './sl';

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
  const pending = String(deckId || '').startsWith('new:');
  const existing = deckId && !pending ? String(deckId) : '';

  // The template the person picked only exists client-side, so the first turn is where it becomes
  // real. It rides in `instructions`, NOT in the message: the gateway records the raw user text
  // for the transcript, so the chat keeps showing the sentence they typed instead of a wall of
  // theme JSON. Scaffolding should be invisible.
  let instructions = '';
  if (pending) {
    const templateId = String(deckId).slice(4);
    if (templateId && templateId !== 'blank') {
      const t = await getTemplateDetail(templateId).catch(() => null);
      if (t) {
        // The style brief and the theme, and nothing else. Embedding two full template slides as
        // schema exemplars added ~10KB to the FIRST request and pushed deepseek-v4-pro past the
        // runner's 90s no-first-token watchdog — the turn died having written nothing. The schema
        // those exemplars were teaching now lives in the slide-design skill, where it costs
        // nothing per turn and applies to every turn rather than only the first.
        instructions = [
          `Design this deck in the "${t.name}" style.`,
          t.context || t.description || '',
          '',
          'Use exactly this theme in deck.json:',
          JSON.stringify(t.theme || {}, null, 2),
        ].filter(Boolean).join('\n');
      }
    }
  }

  const res = await authFetch(`${API}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      input: message,
      ...(instructions ? { instructions } : {}),
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
