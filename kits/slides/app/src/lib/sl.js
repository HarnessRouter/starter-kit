// The Slides data layer, backed by HarnessRouter.
//
// This is the ONLY file that differs from the hosted product in any interesting way. The pages and
// components are the same ones slides.wrapper.work runs; they call the functions below, and here a
// deck is a session on this kit's Harness rather than a row in a product database:
//
//   deck            = session          list -> GET /sessions?harness=…
//   deck content    = deck.json in that session's workspace
//   chat with agent = POST /responses with the session id
//   templates       = templates.json baked into the image next to this app
//
// There is no database, no per-product auth and no billing. The app is served by the console at
// /kits/slides, so it is same-origin with the console's API proxy: the browser sends the console
// session it already has and the proxy attaches the internal key server-side. That is the whole of
// "reuse harnessrouter login" — this app never sees a token and has no sign-in screen of its own.
const API = '/api/harness/v1';

async function readError(res) {
  try {
    const body = await res.json();
    const d = body?.error?.message ?? body?.detail;
    return typeof d === 'string' ? d : `request failed (${res.status})`;
  } catch {
    return `request failed (${res.status})`;
  }
}

async function hr(path, init = {}) {
  const res = await fetch(`${API}${path}`, { cache: 'no-store', ...init });
  if (!res.ok) {
    const err = new Error(await readError(res));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function jsonInit(method, body) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

// ── the Harness this kit launched ──────────────────────────────────────────
// Found by its kit id so the user never picks from a list. Cached: every deck operation needs it.
let _harness = null;
export async function slidesHarness() {
  if (_harness) return _harness;
  const { harnesses = [] } = await hr('/harnesses');
  _harness = harnesses.find((h) => h.kit === 'slides') || null;
  return _harness;
}

/** Idempotent in the hosted product; here the Harness is provisioned by Launch, so this just
 *  reports whether that happened. Landing uses it to tell the user what to do if it has not. */
export async function subscribe() {
  const h = await slidesHarness();
  if (!h) throw new Error('Slides has not been launched yet — open Starter Kits and launch it.');
  return { ok: true };
}

// ── templates ──────────────────────────────────────────────────────────────
// Baked next to the app in the image, so they work with no network and no service.
let _templates = null;
export async function listTemplates() {
  if (!_templates) {
    const raw = await fetch('/kits/slides/templates.json', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    _templates = (Array.isArray(raw) ? raw : raw.templates || []).map((t) => ({
      ...t,
      // The card renders the first slide for real rather than showing a stock icon.
      cover: t.cover || t.slides?.[0] || null,
      palette: t.palette || t.theme?.palette || null,
      fonts: t.fonts || t.theme?.fonts || null,
    }));
  }
  return _templates;
}

/** Each baked template carries its own theme and slides, so the preview needs no second fetch. */
export async function getTemplateDetail(id) {
  const t = (await listTemplates()).find((x) => x.id === id);
  if (!t) throw new Error('template not found');
  return t;
}

// ── decks (= sessions) ─────────────────────────────────────────────────────
function toDeck(s) {
  const id = s.id || s.session_id;
  return {
    id,
    deck_id: id,
    name: s.title || s.name || 'Untitled deck',
    updated_at: s.updated_at || s.created_at || null,
    status: s.status || '',
  };
}

export async function listDecks() {
  const h = await slidesHarness();
  if (!h) return [];
  // The filter is `harness`, not `harness_id` — with the wrong name the server ignores it and
  // answers with every session in the org, so the deck list quietly fills with other work.
  const body = await hr(`/sessions?harness=${encodeURIComponent(h.id)}&limit=100`);
  return (body.sessions ?? body.data ?? []).map(toDeck);
}

/** A deck is created by its first turn, so this records the intent and DeckPage's first message
 *  actually opens the session. The template (if any) rides along as the agent's starting point. */
export async function createDeck(name, template = 'blank') {
  const h = await slidesHarness();
  if (!h) throw new Error('Slides has not been launched yet.');
  const id = `new:${template}`;
  return { id, deck_id: id, name: name || 'Untitled deck', template };
}

export async function renameDeck(id, name) {
  return hr(`/sessions/${encodeURIComponent(id)}`, jsonInit('PATCH', { title: name }));
}

/** Delete the deck AND the conversation underneath it.
 *
 *  The route is /traces/{id}, not /sessions/{id} — there is no DELETE on the session path, so the
 *  obvious call silently did nothing and the deck came back on the next load. This one removes the
 *  trace, the durable workspace tarball (deck.json included) and tombstones the session, which is
 *  what "delete" has to mean here: a deck IS its session, so leaving the session behind would
 *  leave the deck recoverable and the storage held. */
export async function deleteDeck(id) {
  return hr(`/traces/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** The deck JSON: { deck_id, deck }. Null deck means the agent has not written one yet.
 *
 *  Read by path, which reads the LIVE workspace — so a deck appears as soon as the agent writes
 *  it, mid-turn. The file listing next to it answers from the checkpoint tarball, which is only
 *  written when a turn ends: polling that showed a spinner for a deck that was already on disk. */
export async function getDeck(id) {
  const r = await fetch(`${API}/sessions/${encodeURIComponent(id)}/files/deck.json`,
                        { cache: 'no-store' });
  if (!r.ok) return { deck_id: id, deck: null };
  return { deck_id: id, deck: await r.json().catch(() => null) };
}

/** Write deck.json back into the session workspace.
 *  Refused with 409 while a turn is running — the agent owns the file until it finishes. */
export async function saveDeck(id, deck) {
  return hr(`/sessions/${encodeURIComponent(id)}/files/deck.json`,
            jsonInit('PUT', { content: JSON.stringify(deck, null, 2) }));
}

/** Current turn state, so the canvas knows when to lock and when to re-read. */
export async function deckStatus(id) {
  const d = await hr(`/sessions/${encodeURIComponent(id)}`).catch(() => null);
  return d?.turn_status || d?.status || '';
}

// ── talking to the agent ───────────────────────────────────────────────────
// Running a turn lives in lib/copilot.js, with the rest of the copilot's transport. Only the
// history read is here, because the deck page reads it too — to explain a turn that ended
// without writing a deck.
//
// Attachments do NOT go through this file. They ride into the turn as input blocks
// (reifyui/harness fileToInputBlock): a workspace PUT needs a session a brand-new deck does not
// have, is refused 409 while a turn is running, and cannot carry bytes that are not text — the
// `await file.text()` version this replaces corrupted every PDF, PPTX and image it was handed.

/** The conversation so far: `{ turns }`, oldest first.
 *  The route is /turns; there is no /events, and calling one 404s history away silently.
 *  A deck with no session yet answers without a request, which is what lets the conversation
 *  panel treat the id as opaque. */
export async function chatHistory(id) {
  if (!id || String(id).startsWith('new:')) return { turns: [] };
  const body = await hr(`/sessions/${encodeURIComponent(id)}/turns`).catch(() => null);
  return { turns: body?.turns ?? [] };
}

// ── last viewed (local record) ─────────────────────────────────────────────
const LV_KEY = 'slides.lastViewed';
export function lastViewedMap() {
  try { return JSON.parse(window.localStorage.getItem(LV_KEY) || '{}'); } catch { return {}; }
}
export function markViewed(id) {
  const map = lastViewedMap();
  map[id] = Date.now();
  try { window.localStorage.setItem(LV_KEY, JSON.stringify(map)); } catch { /* private */ }
}
export function relativeTime(ts) {
  if (!ts) return null;
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (Number.isNaN(t)) return null;
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}

/** Workspace path -> a URL that serves it, for the images a deck references by path. */
export async function workspaceFileIndex(id) {
  const doc = await hr(`/sessions/${encodeURIComponent(id)}/files`).catch(() => null);
  const out = {};
  for (const f of doc?.files || []) {
    const path = f.path || f.filename;
    if (path && f.id) {
      out[path] = `${API}/containers/${encodeURIComponent(id)}/files/${encodeURIComponent(f.id)}/content`;
    }
  }
  return out;
}
