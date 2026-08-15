// The Videos data layer.
//
// Everything about talking to HarnessRouter — routes, session semantics, the 409 on a busy
// workspace — lives in `reifyui/harness`. This file is only what "video" adds on top of it:
//
//   a video      = a session on this kit's Harness
//   its canvas   = a scene the media server holds for that session
//   its media    = files the media server holds beside the scene
//
// The canvas is NOT read out of the session's workspace, and this is the one place this kit
// differs from the other three. A workspace is written by the sandbox at the end of a turn, whole;
// the agent mutates this canvas DURING a turn, through tools, and a clip that lands after the turn
// has ended has to appear on the canvas with nobody's turn running at all. So the media server
// owns the scene and the workspace gets a copy of it for the console's file list. This app reads
// and writes the server's copy, which is the one that is true.
//
// The one thing this app deliberately CANNOT do is hold a provider key. It never sees one: the
// media server keeps it, and the app's requests are authenticated by the console session the
// browser already carries.
import {
  configureKit, deleteSession, hr, kitHarness, listSessions, patchSession, sessionDetail,
  sessionTurns,
} from 'reifyui/harness';
import { KIT_ID, MEDIA_ENTRY_ID } from './kit.js';

configureKit({ kitId: KIT_ID });

export { sessionTurns };

/** The Harness this kit launched, or null when it was never launched. */
export const videoHarness = kitHarness;

// ── videos (= sessions) ────────────────────────────────────────────────────
function toVideo(s) {
  return {
    id: s.id || s.session_id,
    name: s.title || s.name || 'Untitled video',
    updated_at: s.updated_at || s.created_at || null,
    status: s.status || '',
  };
}

export async function listVideos() {
  const { sessions } = await listSessions({ limit: 100 });
  return sessions.map(toVideo);
}

/** A pending id: a video that has been chosen but not yet created.
 *
 *  Nothing but a turn creates a session, so a new video has no id until its first message opens
 *  one. The id carries the template so the first turn knows what to make, and the page adopts the
 *  real id from the stream. */
export const PENDING = 'new:';
export const isPending = (id) => String(id || '').startsWith(PENDING);
export const pendingTemplate = (id) => (isPending(id) ? String(id).slice(PENDING.length) : '');
export const newVideoId = (template = 'blank') => `${PENDING}${template || 'blank'}`;

/** Rename. This also rewrites the trace manifest the video LIST renders from, and marks the title
 *  as chosen so the next turn stops regenerating it from the latest message. */
export const renameVideo = (id, name) => patchSession(id, { title: name });

/** Delete the video and the conversation underneath it. The media goes with it. */
export const deleteVideo = deleteSession;

/** Current turn state, so the canvas knows when the document is about to change under it. */
export async function videoStatus(id) {
  if (isPending(id)) return '';
  const d = await sessionDetail(id).catch(() => null);
  return d?.turn_status || d?.status || '';
}

// ── files picked before the video existed ──────────────────────────────────
// The landing prompt takes attachments, but the landing does not run the turn: it navigates to the
// pending video and the copilot sends the first message from there. A File cannot travel in a URL,
// and base64 of a 25 MB file does not fit in sessionStorage, so the prepared blocks wait here — in
// memory, keyed by the pending id they were staged for, so a file picked and then abandoned on the
// landing can never ride along into a DIFFERENT video the person opens instead. A hard reload
// loses them, which is honest: the picker is empty on that page too.
let handoff = null;

export function stageAttachments(id, files) {
  handoff = files.length ? { id, files } : null;
}

/** The staged blocks for this video, once. Empty for every other id. */
export function takeAttachments(id) {
  if (!handoff || handoff.id !== id) return [];
  const { files } = handoff;
  handoff = null;
  return files;
}

// ── the media server ───────────────────────────────────────────────────────
// Every route below is addressed by (harness, entry, session) because that is what the server
// checks: the harness says which entry binding is being used, the session says which document is
// being touched. A browser is not an MCP client and must never hold a turn credential, so the
// binding is named explicitly here instead.

const enc = encodeURIComponent;
const at = (harnessId, sessionId, tail = '') =>
  `/harnesses/${enc(harnessId)}/servers/${enc(MEDIA_ENTRY_ID)}/sessions/${enc(sessionId)}${tail}`;

/** The address the media routes and the media URLs are built from. */
export const mediaAddr = (harnessId, sessionId) =>
  ({ harnessId, entryId: MEDIA_ENTRY_ID, sessionId });

/** What this deployment can actually make, right now: which capability resolves to which model,
 *  and what is unavailable and why.
 *
 *  Read once when the editor opens and once on the landing. It costs no provider call — the server
 *  answers from its catalog and its connected integrations — so it is cheap enough to be the thing
 *  the UI blocks on rather than letting someone write a paragraph into a product that cannot make
 *  a video at all. */
export function mediaCapabilities(harnessId) {
  return hr(`/harnesses/${enc(harnessId)}/servers/${enc(MEDIA_ENTRY_ID)}`);
}

/** The canvas, with the revision it is at. `If-Match` on the way back is that revision. */
export function getScene(harnessId, sessionId) {
  return hr(at(harnessId, sessionId, '/scene'));
}

/** Write the canvas back.
 *
 *  Three refusals, and they are different situations:
 *    409  a turn is running and the agent owns the document — re-arm, never drop
 *    412  the revision moved — merge against the server's copy and try once more
 *    422  this write adds or removes a clip, which only a job may do
 *
 *  The caller's save queue is what tells them apart; this function only carries the status. */
export function putScene(harnessId, sessionId, rev, scene) {
  return hr(at(harnessId, sessionId, '/scene'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': String(rev) },
    // The document goes in `scene`, mirroring what GET answers with. Sending the bare document
    // instead is refused 422 "body.scene: Field required" — a validation error, NOT the store's
    // "only a job may place a clip" refusal it reads like, so every save this app made failed and
    // the queue re-armed on it forever. Nothing the person drew was ever written.
    body: JSON.stringify({ scene }),
  });
}

/** Generation jobs for this video.
 *
 *  With `ids`, exactly those — the poll the canvas runs while placeholders are on screen. Without,
 *  every job this session has ever run, which is what the spend figure is summed from: a job the
 *  agent submitted and never placed still cost money. */
export function listJobs(harnessId, sessionId, ids) {
  const q = ids?.length ? `?ids=${ids.map(enc).join(',')}` : '';
  return hr(at(harnessId, sessionId, `/jobs${q}`));
}

/** Start assembling the timeline into one file. Returns a job, like every other long thing here. */
export function startExport(harnessId, sessionId, filename) {
  return hr(at(harnessId, sessionId, '/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(filename ? { filename } : {}),
  });
}

// ── last viewed (local record) ─────────────────────────────────────────────
const LV_KEY = 'videos.lastViewed';

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
