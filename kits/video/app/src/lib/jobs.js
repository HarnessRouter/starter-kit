// Generation jobs, as this app reads them.
//
// A job is submitted by the agent and outlives the turn that submitted it: the server keeps
// polling the provider after the conversation moves on, so a clip lands in a tab that has no
// stream open and no agent running. That is why the editor polls jobs at all, and why this module
// exists on the app side of a story whose whole state lives on the server.
//
// Four statuses, and one of them is a trap:
//
//   running     the provider has it
//   succeeded   the file exists and has been measured
//   failed      terminal, with the models that were tried and what each said
//   unknown     the provider answered with an empty record
//
// `unknown` is NOT terminal. It is the known background-response race — a poll that arrives
// between "the job finished" and "the record was written" comes back empty — and reading it as
// failure is how a finished clip gets reported as a dead one. It is asked again.
//
// The second rule here is about money. `usd` appears only where the provider reported a measured
// cost. There is no estimate, no per-second rate table, and no zero standing in for "not
// measured": an invented figure on a spend counter is a number someone budgets against.

export const RUNNING = 'running';
export const SUCCEEDED = 'succeeded';
export const FAILED = 'failed';
export const UNKNOWN = 'unknown';

const STATUSES = new Set([RUNNING, SUCCEEDED, FAILED, UNKNOWN]);

/** Terminal means "stop asking". `unknown` is missing from this on purpose. */
export const isTerminal = (status) => status === SUCCEEDED || status === FAILED;

/** One job record from the server, in the shape the app renders.
 *
 *  An unrecognised status becomes `unknown` rather than being passed through: the app polls again,
 *  which is the right response to a server saying something this version does not know, and is
 *  the only one that cannot strand a clip as permanently broken. */
export function normalizeJob(raw) {
  const status = STATUSES.has(raw?.status) ? raw.status : UNKNOWN;
  return {
    jobId: raw?.job_id || '',
    // When it was submitted, so several jobs of the same kind can be told apart by age. A page
    // that cannot do that follows whichever one the server happened to list first.
    createdAt: Number.isFinite(raw?.created_at) ? raw.created_at : 0,
    status,
    capability: raw?.capability || '',
    model: raw?.model || '',
    kind: raw?.kind || '',
    mediaId: raw?.media_id || '',
    elementId: raw?.element_id || '',
    seconds: Number.isFinite(raw?.seconds) ? raw.seconds : null,
    width: Number.isFinite(raw?.width) ? raw.width : null,
    height: Number.isFinite(raw?.height) ? raw.height : null,
    bytes: Number.isFinite(raw?.bytes) ? raw.bytes : null,
    // Only ever what the provider measured. Absent is absent.
    usd: Number.isFinite(raw?.usd) ? raw.usd : null,
    progress: typeof raw?.progress === 'string' ? raw.progress : '',
    error: raw?.error || '',
    note: raw?.note || '',
    attempts: Array.isArray(raw?.attempts)
      ? raw.attempts.map((a) => ({ model: a?.model || '', error: a?.error || '' }))
      : [],
  };
}

export const indexJobs = (jobs) => new Map((jobs || []).map((j) => [j.jobId, j]));

/** What a running job is doing, when the server said something real about it.
 *
 *  '' when it did not. There is no elapsed-time estimate and no percentage derived from how long
 *  it has been going: a four-minute render whose bar is somebody's arithmetic is a bar that says
 *  95% for two minutes. */
export const progressLabel = (job) => (job?.status === RUNNING ? job.progress || '' : '');

/** Why a job failed, in one sentence, naming every model that was tried.
 *
 *  The chain is the thing worth surfacing: "no model that accepts an input image is working" reads
 *  as a product fault until you can see that three were tried and what each of them said. */
export function failureText(job) {
  if (job?.status !== FAILED) return '';
  const head = job.error || 'This render failed.';
  if (!job.attempts.length) return head;
  const tried = job.attempts.map((a) => `${a.model}: ${a.error || 'failed'}`).join('; ');
  return `${head} (tried ${tried})`;
}

/** What this video has cost so far, or null when nothing measured has come back.
 *
 *  null and 0 are different answers and the difference is the whole point: 0 means every job
 *  reported a cost and they summed to nothing, which does not happen; null means no job reported
 *  one, and the honest render of that is no counter at all rather than "$0.00". */
export function totalSpend(jobs) {
  const measured = (jobs || []).filter((j) => j.usd !== null);
  if (!measured.length) return null;
  return Math.round(measured.reduce((sum, j) => sum + j.usd, 0) * 10000) / 10000;
}

/** A cost as money. Small numbers keep their cents: several models bill under five cents a call
 *  and rounding those to $0.00 makes a spend counter read as free. */
export function spendLabel(usd) {
  if (!Number.isFinite(usd)) return '';
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** True when any of these jobs is worth asking about again. Drives the poll, and stops it. */
export const anyOpen = (jobs) => (jobs || []).some((j) => !isTerminal(j.status));
