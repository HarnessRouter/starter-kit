// The data layer. Everything about talking to HarnessRouter lives in `reifyui/harness`; this file
// is only what a game run adds on top of it:
//
//   a run        = a session on this kit's harness
//   its frame    = frame.jpg in that session's workspace, written by the environment as the
//                  browser draws (the live workspace, so the file is read as it is written)
//   its figures  = what the environment states at the end of every observation
import {
  cancelResponse, configureKit, kitConfig, kitHarness, sessionDetail, sessionTurns,
} from 'reifyui/harness';
import { FRAME_FILE, KIT_ID } from './kit.js';

configureKit({ kitId: KIT_ID });

export { cancelResponse, sessionDetail, sessionTurns };

/** The harness this kit launched, or null when it was never launched. */
export const gameHarness = kitHarness;

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
  const m = /Lives (\d+), time (\d+), score (\d+)\./.exec(t);
  if (m) return { lives: +m[1], time: +m[2], score: +m[3] };
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
