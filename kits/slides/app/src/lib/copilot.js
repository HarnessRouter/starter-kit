// The copilot's transport — the two functions ChatPanel asks for, and nothing else.
//
// The conversation column itself is the package's (reifyui ChatPanel): history, the live turn,
// the retry while the gateway comes up, attachments, dictation, the composer. It knows nothing
// about a gateway. It asks this file for exactly two things:
//
//   runTurn      run one turn, reporting progress through `handlers`
//   loadHistory  the conversation so far, already as messages
//
// Everything Slides-specific stays here: the template brief that frames a brand-new deck, and
// the reference document a person attached before the deck existed.
//
// The hosted product posts to a broker that relays the gateway's stream verbatim. Here there is
// no broker to relay anything: POST /responses with stream:true already answers with native
// Responses SSE events — the exact shape the package's dispatcher parses. Same idea, one less hop.
import { createResponsesDispatcher, readSSEStream, turnsToMessages } from 'reifyui';
import { authFetch } from './auth';
import { chatHistory, getTemplateDetail, slidesHarness } from './sl';

const API = '/api/harness/v1';

/** Pull a session id out of whatever frame carries it, without caring which one that is. */
function sessionIdOf(evt) {
  return evt?.metadata?.session_id || evt?.response?.metadata?.session_id
      || evt?.session_id || evt?.response?.session_id || null;
}

// ── the document a deck starts from ────────────────────────────────────────
// Someone can attach a PDF on the landing page, before the deck — and therefore its session —
// exists. There is nowhere to put it yet, so the prepared block waits here and rides the very
// turn that creates the deck, which is the only place it was ever going to be useful.
//
// A one-shot slot rather than a queue: the landing sets it (or clears it) on every create, so it
// can never be inherited by the next deck someone makes.
let _openingFile = null;

/** Called by the landing on every create — with the prepared file, or null when there is none. */
export function stageOpeningFile(entry) { _openingFile = entry || null; }

function takeOpeningFile() {
  const f = _openingFile;
  _openingFile = null;
  return f ? [f] : [];
}

/** The style brief for a deck created from a template.
 *
 *  It rides in `instructions`, NOT in the message: the gateway records the raw user text for the
 *  transcript, so the chat keeps showing the sentence they typed instead of a wall of theme JSON.
 *  Scaffolding should be invisible. */
async function templateBrief(templateId) {
  if (!templateId || templateId === 'blank') return '';
  const t = await getTemplateDetail(templateId).catch(() => null);
  if (!t) return '';
  // The style brief and the theme, and nothing else. Embedding two full template slides as schema
  // exemplars added ~10KB to the FIRST request and pushed deepseek-v4-pro past the runner's 90s
  // no-first-token watchdog — the turn died having written nothing. The schema those exemplars
  // were teaching now lives in the slide-design skill, where it costs nothing per turn and
  // applies to every turn rather than only the first.
  return [
    `Design this deck in the "${t.name}" style.`,
    t.context || t.description || '',
    '',
    'Use exactly this theme in deck.json:',
    JSON.stringify(t.theme || {}, null, 2),
  ].filter(Boolean).join('\n');
}

/** Run one streaming turn against this kit's Harness.
 *
 *  `sessionId` is "new:<template>" for a deck that does not exist yet: nothing but a turn creates
 *  a session, so the id arrives in the stream and is reported through handlers.onSession before
 *  the frame is dispatched. The panel adopts it from there.
 *
 *  Resolves { connecting: true } when the gateway is still coming up (503) — the panel then holds
 *  the message, with its files, and retries rather than showing a failed turn.
 */
export async function runTurn({ sessionId, text, attachments = [], handlers = {} }) {
  const harness = await slidesHarness();
  if (!harness) throw new Error('Slides has not been launched yet.');
  const pending = String(sessionId || '').startsWith('new:');
  const existing = sessionId && !pending ? String(sessionId) : '';

  const files = pending ? [...takeOpeningFile(), ...attachments] : attachments;
  // Plain text stays plain text — a bare string is what the transcript records verbatim. Files
  // force the block form, and each one is already the `input_file` block fileToInputBlock built.
  const input = files.length
    ? [{ role: 'user', content: [{ type: 'input_text', text }, ...files.map((f) => f.payload)] }]
    : text;
  const instructions = pending ? await templateBrief(String(sessionId).slice(4)) : '';

  const res = await authFetch(`${API}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      input,
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

  let sid = existing;
  const d = createResponsesDispatcher(handlers);
  await readSSEStream(res.body, (data) => {
    let evt;
    try { evt = JSON.parse(data); } catch { return; }   // malformed frame
    const found = sessionIdOf(evt);
    if (found && found !== sid) { sid = found; handlers.onSession?.(found); }
    d.dispatch(evt);
  });
  return {};
}

/** The conversation so far, in the shape the panel renders. A deck that has no session yet
 *  answers [] without a request (chatHistory short-circuits), which is why the panel can treat
 *  the id as opaque and never parse it. */
export function loadHistory(sessionId) {
  return chatHistory(sessionId).then(({ turns }) => turnsToMessages(turns));
}
