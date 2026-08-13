// The Sheets data layer, backed by HarnessRouter.
//
// This is the only file that differs in any interesting way from the hosted product. The pages and
// components are the ones sheets.wrapper.work runs; they call the functions below, and here a
// sheet is a session on this kit's Harness rather than a row in a product database:
//
//   sheet           = session          list -> GET /sessions?harness=…
//   sheet content   = sheet.json in that session's workspace
//   chat with agent = POST /responses with the session id
//
// There is no database, no per-product auth and no billing. The app is served by the console at
// /kits/sheets, so it is same-origin with the console's API proxy: the browser sends the console
// session it already has and the proxy attaches the internal key server-side.
//
// Every route below is one the OSS gateway actually implements. The slides kit shipped five bugs
// that were all the same bug — a call kept from the hosted product to an endpoint that does not
// exist here — so the rule for this file is: no route goes in without checking gateway/app.py.
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
let _harness = null;
export async function sheetsHarness() {
  if (_harness) return _harness;
  const { harnesses = [] } = await hr('/harnesses');
  _harness = harnesses.find((h) => h.kit === 'sheets') || null;
  return _harness;
}

/** Every Harness a harness COLUMN may run.
 *
 *  Deliberately excludes this kit's own Harness. A sheet whose column runs the sheet's own agent
 *  would have that agent editing sheet.json while the app is driving a run over it — recursion
 *  with a file-write race inside it. Excluded at the source of the list rather than validated at
 *  run time, so the choice is never offered in the first place. */
export async function runnableHarnesses() {
  const [{ harnesses = [] }, mine] = await Promise.all([hr('/harnesses'), sheetsHarness()]);
  return harnesses
    .filter((h) => h.id !== mine?.id)
    .map((h) => ({ id: h.id, name: h.name, base: h.base, model: h.defaultModel, kit: h.kit || '' }));
}

export async function subscribe() {
  const h = await sheetsHarness();
  if (!h) throw new Error('Sheets has not been launched yet — open Starter Kits and launch it.');
  return { ok: true };
}

// ── sheets (= sessions) ────────────────────────────────────────────────────
function toSheet(s) {
  const id = s.id || s.session_id;
  return {
    id,
    sheet_id: id,
    name: s.title || s.name || 'Untitled sheet',
    updated_at: s.updated_at || s.created_at || null,
    status: s.status || '',
  };
}

export async function listSheets() {
  const h = await sheetsHarness();
  if (!h) return [];
  // The filter is `harness`, not `harness_id` — with the wrong name the server ignores it and
  // answers with every session in the org.
  const body = await hr(`/sessions?harness=${encodeURIComponent(h.id)}&limit=100`);
  return (body.sessions ?? body.data ?? []).map(toSheet);
}

/** A sheet is created by its first turn, so this records the intent; the first message opens the
 *  session and the app adopts the real id from the stream. */
export async function createSheet(name, template = 'blank') {
  const h = await sheetsHarness();
  if (!h) throw new Error('Sheets has not been launched yet.');
  const id = `new:${template}`;
  return { id, sheet_id: id, name: name || 'Untitled sheet', template };
}

/** Rename. PATCH /v1/sessions/{id} also rewrites the trace manifest the LIST renders from, and
 *  marks the title as chosen so the next turn does not regenerate it from your message. */
export async function renameSheet(id, name) {
  return hr(`/sessions/${encodeURIComponent(id)}`, jsonInit('PATCH', { title: name }));
}

/** Delete the sheet AND the conversation underneath it. The route is /traces/{id}: there is no
 *  DELETE on the session path, and this one removes the trace, the durable workspace tarball
 *  (sheet.json included) and tombstones the session. */
export async function deleteSheet(id) {
  return hr(`/traces/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** The sheet JSON: { sheet_id, sheet }. Null sheet means the agent has not written one yet.
 *
 *  Read by path, which reads the LIVE workspace, so a sheet appears as soon as it is written —
 *  mid-turn. The file LISTING answers from the checkpoint tarball, which only exists once a turn
 *  ends. */
export async function getSheet(id) {
  const r = await fetch(`${API}/sessions/${encodeURIComponent(id)}/files/sheet.json`,
                        { cache: 'no-store' });
  if (!r.ok) return { sheet_id: id, sheet: null };
  return { sheet_id: id, sheet: await r.json().catch(() => null) };
}

/** Write sheet.json back. Refused with 409 while a turn is running — the agent owns the file
 *  until it finishes, and a write that appears to succeed and is then overwritten by the agent's
 *  checkpoint is the worst of the three outcomes. */
export async function saveSheet(id, sheet) {
  return hr(`/sessions/${encodeURIComponent(id)}/files/sheet.json`,
            jsonInit('PUT', { content: JSON.stringify(sheet, null, 2) }));
}

/** Current turn state, so the grid knows when to lock and when to re-read. */
export async function sheetStatus(id) {
  const d = await hr(`/sessions/${encodeURIComponent(id)}`).catch(() => null);
  return d?.turn_status || d?.status || '';
}

// ── talking to the agent ───────────────────────────────────────────────────
export async function sendChat(id, message) {
  const h = await sheetsHarness();
  return hr('/responses', jsonInit('POST', {
    input: message,
    metadata: { harness_id: h?.id, ...(id && !String(id).startsWith('new:') ? { session_id: id } : {}) },
    stream: false,
  }));
}

/** The conversation so far: `{ turns }`, oldest first — the shape ChatPanel destructures. The
 *  route is /turns; there is no /events. */
export async function chatHistory(id) {
  if (!id || String(id).startsWith('new:')) return { turns: [] };
  const body = await hr(`/sessions/${encodeURIComponent(id)}/turns`).catch(() => null);
  return { turns: body?.turns ?? [] };
}

// ── workspace files (artifacts) ────────────────────────────────────────────
/** Workspace path -> a URL that serves it, for artifacts a cell references by path. */
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

/** One workspace file's bytes, by path, from the LIVE workspace. */
export async function readWorkspaceFile(id, path) {
  const r = await fetch(`${API}/sessions/${encodeURIComponent(id)}/files/${encodeURIComponent(path)}`,
                        { cache: 'no-store' });
  if (!r.ok) return null;
  return r.text();
}

/** Put a file into a session's workspace — how a harness cell hands an artifact to the agent. */
export async function writeWorkspaceFile(id, path, content) {
  return hr(`/sessions/${encodeURIComponent(id)}/files/${encodeURIComponent(path)}`,
            jsonInit('PUT', { content }));
}

// ── thumbnails ─────────────────────────────────────────────────────────────
// The hosted product caches a rendered PNG per sheet. Here the grid renders live, which is
// accurate and needs no capture pipeline or blob store — so these are inert rather than
// pretending to store something.
export function putThumbnail() { return Promise.resolve(null); }
export function fetchThumbUrl() { return Promise.resolve(null); }
export function sheetThumbPath() { return null; }

// ── last viewed (local record) ─────────────────────────────────────────────
const LV_KEY = 'sheets.lastViewed';
export function lastViewedMap() {
  try { return JSON.parse(window.localStorage.getItem(LV_KEY) || '{}'); } catch { return {}; }
}
export function markViewed(id) {
  const map = lastViewedMap();
  map[id] = Date.now();
  try { window.localStorage.setItem(LV_KEY, JSON.stringify(map)); } catch { /* private mode */ }
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
