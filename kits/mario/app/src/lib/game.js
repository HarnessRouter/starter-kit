// The data layer. Everything about talking to HarnessRouter lives in `reifyui/harness`; this file
// is only what a game run adds on top of it:
//
//   a run        = a session on this kit's harness
//   its frame    = frame.jpg in that session's workspace, written by the environment as the
//                  browser draws (the live workspace, so the file is read as it is written)
//   its figures  = what the environment states at the end of every observation
import {
  cancelResponse, configureKit, hr, kitConfig, kitHarness, sessionDetail, sessionTurns,
} from 'reifyui/harness';
import plugin from '../../../plugin/plugin.json';
import { FRAME_FILE, KIT_ID } from './kit.js';

configureKit({ kitId: KIT_ID });

export { cancelResponse, sessionDetail, sessionTurns };

/** The harness this kit launched, or null when it was never launched.
 *
 *  A launch captures the kit's package onto the harness; a kit updated afterwards (a new image)
 *  leaves the harness on the old package until something launches it again. The version the
 *  page was built with is the kit's, so a harness holding another version is relaunched here,
 *  which the launch route does in place: the same harness, the package replaced. */
export async function gameHarness() {
  const h = await kitHarness();
  if (!h) return null;
  const have = (h.plugins || []).find((p) => p.name === plugin.name)?.manifest?.version;
  if (have === plugin.version) return h;
  await hr(`/kits/${KIT_ID}/launch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  configureKit({ kitId: KIT_ID });     // drops the cached harness
  return kitHarness();
}

/** A run that has been opened but not started: no session exists until the first message. */
export const PENDING = 'new';
export const isPending = (id) => !id || id === PENDING;

export function frameUrl(sessionId) {
  return `${kitConfig().base}/sessions/${encodeURIComponent(sessionId)}/files/${FRAME_FILE}`;
}

/** Whether a session's turn is in flight, from the session record. */
export function turnRunning(detail) {
  const s = String(detail?.turn_status || detail?.status || '');
  return s === 'running' || s === 'in_progress' || s === 'queued' || s === 'starting';
}

/** The figures the environment states at the end of every observation, or null when the text is
 *  not one of its observations. */
export function readObservation(text) {
  const t = String(text || '');
  const m = /Lives (\d+), coins (\d+), time (\d+), score (\d+)\./.exec(t);
  if (m) return { lives: +m[1], coins: +m[2], time: +m[3], score: +m[4] };
  const d = /Mario has just died\. Lives left: (\d+)/.exec(t);
  return d ? { lives: +d[1] } : null;
}

/** The turn's terminal status, in the person's terms. */
export function statusLabel(status) {
  switch (status) {
    case 'running': return 'Playing';
    case 'completed': return 'Finished';
    case 'incomplete': return 'Reached the limit';
    case 'cancelled': return 'Stopped';
    case 'failed': return 'Failed';
    default: return 'Ready';
  }
}
