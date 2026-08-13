// Copilot streaming client — Sheets's transport over the shared UI Core
// Responses parser. One POST returns an SSE stream of native Responses
// events; the broker relays the gateway stream verbatim from
// POST /v1/sh/sheets/{id}/chat/stream.
import { createResponsesDispatcher, readSSEStream } from 'reifyui';
import { authFetch } from './auth';
import { SH_API } from './sh';

/**
 * Run one streaming turn. handlers: onToolCall(name, args, callId),
 * onToolResult(callId, output), onTextDelta(text), onReasoningDelta(text),
 * onDone(status), onError(message).
 * Returns { unsupported: true } when the endpoint is missing,
 * { connecting: true } on 503, { ok: true } after the stream ends.
 */
export async function streamTurn(sheetId, message, h) {
  const res = await authFetch(
    `${SH_API}/v1/sh/sheets/${encodeURIComponent(sheetId)}/chat/stream`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
  if (res.status === 404) return { unsupported: true };
  if (res.status === 503) return { connecting: true };
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`chat stream failed: ${res.status} ${t.slice(0, 160)}`);
  }

  let sawError = false;
  const d = createResponsesDispatcher({
    ...h,
    onError: (msg) => { sawError = true; h.onError?.(msg); },
  });
  await readSSEStream(res.body, (data) => {
    try { d.dispatch(JSON.parse(data)); } catch { /* malformed frame */ }
  });
  return { ok: !sawError };
}
