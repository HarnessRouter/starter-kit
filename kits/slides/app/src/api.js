// Talking to HarnessRouter.
//
// The kit app is served by the HarnessRouter console at /kits/slides, so it is SAME-ORIGIN with
// the console's BFF at /api/harness. That settles authentication with no work: the browser sends
// the console session it already has, and the BFF attaches the internal key server-side. The app
// never holds an API key, and there is no login of its own to build.
//
// One session is one deck. The deck list is this Harness's session list; a deck's content is
// deck.json in that session's workspace. There is no database.
const API = '/api/harness/v1';

async function req(path, init = {}) {
  const r = await fetch(`${API}${path}`, { cache: 'no-store', ...init });
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.error?.message || detail?.detail || `${r.status}`);
  }
  return r.status === 204 ? null : r.json();
}

/** The Harness this kit launched. Found by its kit id, so the user never picks from a list. */
export async function slidesHarness() {
  const { harnesses = [] } = await req('/harnesses');
  return harnesses.find((h) => h.kit === 'slides') || null;
}

/** Every deck: one per session on this Harness, newest first. */
export async function listDecks(harnessId) {
  const doc = await req(`/sessions?harness_id=${encodeURIComponent(harnessId)}&limit=100`);
  const rows = doc.sessions || doc.data || [];
  return rows.map((s) => ({
    id: s.id || s.session_id,
    title: s.title || s.name || 'Untitled deck',
    updatedAt: s.updated_at || s.created_at || 0,
    status: s.status || '',
  }));
}

/** A deck's JSON, or null when the agent has not written one yet (a brand-new conversation). */
export async function loadDeck(sessionId) {
  const doc = await req(`/sessions/${encodeURIComponent(sessionId)}/files`).catch(() => null);
  const file = (doc?.files || []).find((f) => f.filename === 'deck.json' || f.path === 'deck.json');
  if (!file) return null;
  const r = await fetch(`${API}/containers/${encodeURIComponent(sessionId)}/files/${file.id}/content`,
                        { cache: 'no-store' });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

/** Ask the agent for something. Returns when the turn ends; the deck is re-read after. */
export async function ask(harnessId, sessionId, input) {
  return req('/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input,
      metadata: { harness_id: harnessId, ...(sessionId ? { session_id: sessionId } : {}) },
      stream: false,
    }),
  });
}

export const templates = () => fetch('/kits/slides/templates.json', { cache: 'force-cache' })
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => []);
