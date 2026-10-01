// The few calls the shared transport does not already name, and the shapes it leaves to the app.
import { hr, containerFileUrl, sessionDetail, sessionTurns } from 'reifyui/harness';

export const jsonInit = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The session cards the sidebar, the presence dots, the direct-message lookup and the group
 *  list read: the newest cards of each Harness that matters (the recruiter and every teammate),
 *  one request per Harness. One org-wide list looked cheaper but is capped at its newest 200
 *  cards, and on an instance that runs other things a group's card fell out of it. */
export async function listCards(me, harnessIds = []) {
  const q = me && me.id !== '*' ? `&member=${encodeURIComponent(me.id)}` : '';
  const lists = await Promise.all([...new Set(harnessIds.filter(Boolean))].map((hid) =>
    hr(`/sessions?harness=${encodeURIComponent(hid)}&limit=30${q}`).then((b) => b?.sessions ?? b?.data ?? []).catch(() => [])));
  return lists.flat().map((c) => ({ ...c, id: c.session_id || c.id }));
}

const LIVE = new Set(['running', 'starting', 'in_progress']);
export const isLive = (c) => LIVE.has(String(c?.status || '')) || LIVE.has(String(c?.turn_status || ''));

/** The turn input for a text plus prepared file blocks (the transport's `input_file` shape). */
export function turnInput(text, files = []) {
  return files.length ? [{ role: 'user', content: [...files, { type: 'input_text', text }] }] : text;
}

/** Wait for a session's live turn to end (a tab attaching to a turn it cannot hear). */
export async function settled(sid, { timeoutMs = 15 * 60 * 1000, every = 3000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await sessionDetail(sid); } catch { /* not queryable yet */ }
    if (v && !isLive(v)) return v;
    if (Date.now() - t0 > timeoutMs) return v;
    await sleep(every);
  }
}

/** A session's last turn once it is over: what was asked, what was answered, its response id. */
export async function lastText(sid) {
  const turns = await sessionTurns(sid, { limit: 1 });
  const t = turns[turns.length - 1];
  return { id: String(t?.id || ''), user: String(t?.user || ''), text: String(t?.assistant || ''), status: String(t?.status || ''), files: t?.files || [] };
}

// ── files ──────────────────────────────────────────────────────────────────
function normFile(f, sid) {
  const container = f.container_id || sid;
  const file_id = f.file_id || f.id;
  return { path: f.path || f.filename || '', filename: f.filename || String(f.path || '').split('/').pop(),
           file_id, container_id: container, bytes: f.bytes ?? null, media_type: f.media_type || '',
           url: containerFileUrl(container, file_id) };
}

/** Everything in a session's workspace, from its last checkpoint, except the copies handed in from
 *  the room (`shared/`, see engine.js): those are another teammate's artifacts, listed once there. */
export async function sessionFiles(sid) {
  const d = await hr(`/sessions/${encodeURIComponent(sid)}/files`);
  return (d?.files || []).filter((f) => f && (f.file_id || f.id)).map((f) => normFile(f, sid)).filter((f) => !/^shared\//.test(f.path));
}

/** What the most recent turn created or changed. */
export async function changedFiles(sid) {
  try {
    const d = await hr(`/sessions/${encodeURIComponent(sid)}/files?changed=true`);
    return (d?.files || []).filter((f) => f && (f.file_id || f.id)).map((f) => normFile(f, sid));
  } catch { return []; }
}

export const isImage = (f) => /^image\//.test(f?.media_type || '') || /\.(png|jpe?g|gif|webp|svg)$/i.test(f?.filename || '');

// ── the browser a teammate is using ────────────────────────────────────────
export async function fetchBrowser(sid) {
  if (!sid) return null;
  try { return await hr(`/sessions/${encodeURIComponent(sid)}/browser`); } catch { return null; }
}
export async function setBrowserControl(sid, control) {
  try { await hr(`/sessions/${encodeURIComponent(sid)}/browser/control`, jsonInit('POST', { control })); return true; } catch { return false; }
}
/** The vendor's viewer without its own chrome: the card's row is the chrome. */
export function viewerUrl(liveUrl) {
  if (!liveUrl) return '';
  try { const u = new URL(liveUrl); u.searchParams.set('ui', 'false'); return u.toString(); } catch { return liveUrl; }
}
