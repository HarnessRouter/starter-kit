// The Dashboards data layer.
//
// Everything about talking to HarnessRouter — routes, session semantics, the 409 on a busy
// workspace — lives in `reifyui/harness`. This file is only what "dashboard" adds on top of it:
//
//   a dashboard     = a session on this kit's Harness
//   its content     = ./dashboard.json in that session's workspace
//   its data        = a connection the person configured at launch, held server-side
//
// The one thing this app deliberately CANNOT do is read the connection string. The agent writes
// SQL, the server runs it, and both of them see rows without either seeing the credential. See
// lib/query.js for that half; nothing in this file has a database in it.
import {
  configureKit, kitHarness, listSessions, sessionDetail, patchSession,
  deleteSession, readJsonFile, writeFile, sessionTurns, containerFileUrl,
} from 'reifyui/harness';

configureKit({ kitId: 'dashboard' });

export const DASHBOARD_FILE = 'dashboard.json';

export { containerFileUrl, sessionTurns };

/** The Harness this kit launched, or null when it was never launched. */
export const dashboardHarness = kitHarness;

// ── dashboards (= sessions) ────────────────────────────────────────────────
function toDashboard(s) {
  const id = s.id || s.session_id;
  return {
    id,
    name: s.title || s.name || 'Untitled dashboard',
    updated_at: s.updated_at || s.created_at || null,
    status: s.status || '',
  };
}

export async function listDashboards() {
  const { sessions } = await listSessions({ limit: 100 });
  return sessions.map(toDashboard);
}

/** A pending id: a dashboard that has been chosen but not yet created.
 *
 *  Nothing but a turn creates a session, so a new dashboard has no id until its first message
 *  opens one. The id carries the template so the first turn knows what to build, and the page
 *  adopts the real id from the stream. */
export const PENDING = 'new:';
export const isPending = (id) => String(id || '').startsWith(PENDING);
export const pendingTemplate = (id) => (isPending(id) ? String(id).slice(PENDING.length) : '');
export const newDashboardId = (template = 'blank') => `${PENDING}${template || 'blank'}`;

// ── files picked before the dashboard existed ──────────────────────────────
// The landing prompt takes attachments, but the landing does not run the turn: it navigates to
// the pending dashboard and the copilot sends the first message from there. A File cannot travel
// in a URL, and base64 of a 25 MB file does not fit in sessionStorage, so the prepared blocks
// wait here — in memory, keyed by the pending id they were staged for, so a file picked and then
// abandoned on the landing can never ride along into a DIFFERENT dashboard the person opens
// instead. A hard reload loses them, which is honest: the picker is empty on that page too.
let handoff = null;

export function stageAttachments(id, files) {
  handoff = files.length ? { id, files } : null;
}

/** The staged blocks for this dashboard, once. Empty for every other id. */
export function takeAttachments(id) {
  if (!handoff || handoff.id !== id) return [];
  const { files } = handoff;
  handoff = null;
  return files;
}

/** Rename. This also rewrites the trace manifest the dashboard LIST renders from, and marks the
 *  title as chosen so the next turn stops regenerating it from the latest message. */
export const renameDashboard = (id, name) => patchSession(id, { title: name });

/** Delete the dashboard and the conversation underneath it. */
export const deleteDashboard = deleteSession;

/** The dashboard document, or null when the agent has not written one yet.
 *
 *  Read by path, which reads the LIVE workspace, so a dashboard appears as soon as it is written
 *  — mid-turn. The file LISTING answers from the checkpoint tarball, which only exists once a
 *  turn ends, and would show a spinner over a file already on disk. */
export async function getDashboard(id) {
  if (isPending(id)) return null;
  return readJsonFile(id, DASHBOARD_FILE);
}

/** Write the document back. Refused 409 while a turn is running: the agent owns the file until
 *  it finishes. The caller must re-arm rather than drop the write — see DashboardPage's save
 *  queue, which is the same shape as the sheets kit's for the same reason. */
export function saveDashboard(id, doc) {
  return writeFile(id, DASHBOARD_FILE, JSON.stringify(doc, null, 2));
}

/** Current turn state, so the canvas knows when the document is about to change under it. */
export async function dashboardStatus(id) {
  if (isPending(id)) return '';
  const d = await sessionDetail(id).catch(() => null);
  return d?.turn_status || d?.status || '';
}

/** The console's deep link to one conversation. */
export const consoleSessionUrl = (harnessId, sessionId) =>
  `/tasks?h=${encodeURIComponent(harnessId || '')}&sid=${encodeURIComponent(sessionId || '')}`;

// ── last viewed (local record) ─────────────────────────────────────────────
const LV_KEY = 'dashboards.lastViewed';
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
