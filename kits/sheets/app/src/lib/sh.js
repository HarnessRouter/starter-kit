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
  configureKit, hr, kitHarness, listHarnesses, listSessions, sessionDetail, patchSession,
  deleteSession, readJsonFile, writeFile, sessionTurns, containerFileUrl,
} from 'reifyui/harness';

configureKit({ kitId: 'sheets' });

export const SHEET_FILE = 'sheet.json';

export { containerFileUrl, sessionTurns };

/** The Harness this kit launched, or null when it was never launched. */
export const sheetsHarness = kitHarness;

/** Every agent an agent COLUMN may run: the person's own agents, and the BASE agents.
 *
 *  A base is a first-class choice, not a fallback. Its id IS its base name ("codex", "opencode"),
 *  which the server accepts as a harness id directly, so a column can run one without anybody
 *  having configured a thing first. That is what lets a brand new sheet be runnable the moment it
 *  is created — before, every agent column arrived blank and the person had to go and make an
 *  agent before the Run button meant anything.
 *
 *  Deliberately excludes this kit's own Harness. A sheet whose column runs the sheet's own agent
 *  would have that agent editing sheet.json while the app is driving a run over it — recursion
 *  with a file-write race inside it. Excluded at the source of the list rather than validated at
 *  run time, so the choice is never offered in the first place. The base it happens to sit on is
 *  NOT excluded: that is a different agent with its own session and no interest in sheet.json.
 *
 *  Also excludes harnesses that require request headers: their turns are refused without those
 *  headers, and this app has nowhere to hold them. They are returned marked rather than dropped,
 *  so the picker can say why instead of silently having fewer entries than the console shows. */
export async function runnableHarnesses() {
  const [harnesses, bases, mine] = await Promise.all([listHarnesses(), listBases(), sheetsHarness()]);
  const own = harnesses
    .filter((h) => h.id !== mine?.id)
    .map((h) => ({
      kind: 'agent',
      id: h.id,
      name: h.name,
      base: h.base,
      model: h.defaultModel,
      unusable: Object.keys(h.additionalHeaders || {}).length
        ? 'needs request headers this app can’t send'
        : '',
    }));
  return [...own, ...bases];
}

/** The base agents this deployment can actually run.
 *
 *  Filtered on what the server reports, never on a list written down here: which bases are
 *  installed differs per deployment, and offering one that is not would produce a sheet that looks
 *  configured and fails on the first row. A base with no available model is dropped for the same
 *  reason — the choice would dispatch and then fail. */
async function listBases() {
  let bases = [];
  try {
    ({ bases = [] } = await hr('/bases'));
  } catch {
    return [];                 // the person's own agents still list; bases just are not offered
  }
  return bases
    .filter((b) => b.status === 'ready' && (b.models || []).some((m) => m.available))
    .map((b) => ({
      kind: 'base',
      id: b.id,                // the base id IS the harness id the server accepts
      name: b.label || b.id,
      base: b.id,
      model: b.defaultModel || '',
      unusable: '',
    }));
}

/** The agent an unbound column should get, or '' when this deployment can run none.
 *
 *  Prefers the base this kit's own Harness runs on. That one is installed and has working
 *  credentials by construction — the sheet in front of you was written by it — so it is the
 *  choice least likely to fail on the first row. */
export function defaultAgentId(list, mine) {
  const bases = (list || []).filter((a) => a.kind === 'base' && !a.unusable);
  if (!bases.length) return '';
  const ownBase = String(mine?.base || '').toLowerCase();
  const alias = ownBase === 'claude' ? 'claude-code' : ownBase;
  return (bases.find((b) => b.id === alias) || bases[0]).id;
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

// ── files picked before the sheet existed ──────────────────────────────────
// The landing prompt takes attachments, but the landing does not run the turn: it navigates to
// the pending sheet and the copilot sends the first message from there. A File cannot travel in a
// URL, and base64 of a 25 MB file does not fit in sessionStorage, so the prepared blocks wait
// here — in memory, keyed by the pending id they were staged for, so a file picked and then
// abandoned on the landing can never ride along into a DIFFERENT sheet the person opens instead.
// A hard reload loses them, which is honest: the picker is empty on that page too.
let handoff = null;

export function stageAttachments(id, files) {
  handoff = files.length ? { id, files } : null;
}

/** The staged blocks for this sheet, once. Empty for every other id. */
export function takeAttachments(id) {
  if (!handoff || handoff.id !== id) return [];
  const { files } = handoff;
  handoff = null;
  return files;
}

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
