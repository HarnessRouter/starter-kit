// The Sheets data layer.
//
// Everything about talking to HarnessRouter — routes, session semantics, the 409 on a busy
// workspace — lives in `reifyui/harness`. This file is only what "sheet" adds on top of it:
//
//   a sheet          = a session on this kit's Harness
//   its content      = ./sheet.json in that session's workspace
//   an agent column  = a turn on a DIFFERENT harness, one per row
//
// There is no database, no per-product auth and no billing. The app is served by the console at
// /kits/sheets, so it is same-origin with the console's API proxy: the browser sends the console
// session it already has and the proxy attaches the internal key server-side.
import {
  configureKit, kitHarness, listHarnesses, listSessions, sessionDetail, patchSession,
  deleteSession, readJsonFile, writeFile, sessionTurns, containerFileUrl,
} from 'reifyui/harness';

configureKit({ kitId: 'sheets' });

export const SHEET_FILE = 'sheet.json';

export { containerFileUrl, sessionTurns };

/** The Harness this kit launched, or null when it was never launched. */
export const sheetsHarness = kitHarness;

/** Every Harness an agent COLUMN may run.
 *
 *  Deliberately excludes this kit's own Harness. A sheet whose column runs the sheet's own agent
 *  would have that agent editing sheet.json while the app is driving a run over it — recursion
 *  with a file-write race inside it. Excluded at the source of the list rather than validated at
 *  run time, so the choice is never offered in the first place.
 *
 *  Also excludes harnesses that require request headers: their turns are refused without those
 *  headers, and this app has nowhere to hold them. They are returned marked rather than dropped,
 *  so the picker can say why instead of silently having fewer entries than the console shows. */
export async function runnableHarnesses() {
  const [harnesses, mine] = await Promise.all([listHarnesses(), sheetsHarness()]);
  return harnesses
    .filter((h) => h.id !== mine?.id)
    .map((h) => ({
      id: h.id,
      name: h.name,
      base: h.base,
      model: h.defaultModel,
      unusable: Object.keys(h.additionalHeaders || {}).length
        ? 'needs request headers this app can’t send'
        : '',
    }));
}

// ── sheets (= sessions) ────────────────────────────────────────────────────
function toSheet(s) {
  const id = s.id || s.session_id;
  return {
    id,
    name: s.title || s.name || 'Untitled sheet',
    updated_at: s.updated_at || s.created_at || null,
    status: s.status || '',
  };
}

export async function listSheets() {
  const { sessions } = await listSessions({ limit: 100 });
  return sessions.map(toSheet);
}

/** A pending id: a sheet that has been chosen but not yet created.
 *
 *  Nothing but a turn creates a session, so a new sheet has no id until its first message opens
 *  one. The id carries the template so the first turn knows what to build, and the page adopts
 *  the real id from the stream. */
export const PENDING = 'new:';
export const isPending = (id) => String(id || '').startsWith(PENDING);
export const pendingTemplate = (id) => (isPending(id) ? String(id).slice(PENDING.length) : '');
export const newSheetId = (template = 'blank') => `${PENDING}${template || 'blank'}`;

/** Rename. This also rewrites the trace manifest the sheet LIST renders from, and marks the title
 *  as chosen so the next turn stops regenerating it from the latest message. */
export const renameSheet = (id, name) => patchSession(id, { title: name });

/** Delete the sheet and the conversation underneath it. */
export const deleteSheet = deleteSession;

/** The sheet document, or null when the agent has not written one yet.
 *
 *  Read by path, which reads the LIVE workspace, so a sheet appears as soon as it is written —
 *  mid-turn. The file LISTING answers from the checkpoint tarball, which only exists once a turn
 *  ends, and would show a spinner over a file already on disk. */
export async function getSheet(id) {
  if (isPending(id)) return null;
  return readJsonFile(id, SHEET_FILE);
}

/** Write the document back. Refused 409 while a turn is running: the agent owns the file until
 *  it finishes. The caller must re-arm rather than drop the write — see SheetPage's save queue. */
export function saveSheet(id, sheet) {
  return writeFile(id, SHEET_FILE, JSON.stringify(sheet, null, 2));
}

/** Current turn state, so the grid knows when to lock and when to re-read. */
export async function sheetStatus(id) {
  if (isPending(id)) return '';
  const d = await sessionDetail(id).catch(() => null);
  return d?.turn_status || d?.status || '';
}

/** The console's deep link to one conversation — where "open the full conversation" goes. */
export const consoleSessionUrl = (harnessId, sessionId) =>
  `/tasks?h=${encodeURIComponent(harnessId || '')}&sid=${encodeURIComponent(sessionId || '')}`;

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
