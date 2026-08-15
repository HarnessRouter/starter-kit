// Generation jobs, pinned.
//
// Two things here have cost real money elsewhere and both are one-line mistakes.
//
// The first is reading an empty poll as a failure. A provider that answers with an empty record
// has not failed — it has answered between finishing the job and writing the record — and a client
// that treats that as terminal marks a finished, paid-for clip as dead and invites a re-render.
//
// The second is inventing a cost. A spend counter is a number somebody budgets against, and the
// only honest source for it is what the provider actually reported.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FAILED, RUNNING, SUCCEEDED, UNKNOWN, anyOpen, failureText, indexJobs, isTerminal, normalizeJob,
  progressLabel, spendLabel, totalSpend,
} from './jobs.js';

const raw = (over = {}) => ({
  job_id: 'mjob_1', status: 'succeeded', capability: 'text_to_video', model: 'MiniMax-Hailuo-2.3',
  kind: 'video', media_id: 'med_1', element_id: 'el_1', seconds: 6, width: 1366, height: 768,
  bytes: 2118455, usd: 0.28, ...over,
});

// ── the four statuses ────────────────────────────────────────────────────────

test('an empty poll is unknown, and unknown is not terminal', () => {
  const j = normalizeJob({ job_id: 'mjob_1', status: 'unknown' });
  assert.equal(j.status, UNKNOWN);
  assert.equal(isTerminal(j.status), false);
  assert.equal(anyOpen([j]), true, 'so the poll asks again');
});

test('a status this version does not recognise becomes unknown, not failed', () => {
  // Asking again is the only response to an unfamiliar answer that cannot strand a finished clip
  // as permanently broken.
  assert.equal(normalizeJob(raw({ status: 'queued' })).status, UNKNOWN);
  assert.equal(normalizeJob({}).status, UNKNOWN);
});

test('succeeded and failed stop the poll; running does not', () => {
  assert.equal(isTerminal(SUCCEEDED), true);
  assert.equal(isTerminal(FAILED), true);
  assert.equal(isTerminal(RUNNING), false);
  assert.equal(anyOpen([normalizeJob(raw()), normalizeJob(raw({ status: 'failed' }))]), false);
});

test('what was measured off the file is carried; what was not is null', () => {
  const j = normalizeJob(raw({ seconds: undefined, width: undefined, bytes: undefined }));
  assert.equal(j.seconds, null);
  assert.equal(j.width, null);
  assert.equal(j.bytes, null);
  assert.equal(j.height, 768);
});

// ── money ────────────────────────────────────────────────────────────────────

test('a job whose cost was never reported has no cost, rather than a cost of zero', () => {
  assert.equal(normalizeJob(raw({ usd: undefined })).usd, null);
  assert.equal(normalizeJob(raw({ usd: 'free' })).usd, null);
});

test('nothing measured means no spend figure at all', () => {
  // null and 0 are different answers, and the difference is the whole point: 0 claims every job
  // reported a cost and they summed to nothing, which does not happen. The topbar renders null as
  // no counter, not as "$0.00".
  assert.equal(totalSpend([]), null);
  assert.equal(totalSpend([normalizeJob(raw({ usd: undefined }))]), null);
});

test('spend is the sum of what was measured, ignoring what was not', () => {
  const jobs = [raw({ usd: 0.28 }), raw({ usd: 1.68 }), raw({ usd: undefined })].map(normalizeJob);
  assert.equal(totalSpend(jobs), 1.96);
});

test('a cost under a cent keeps its digits instead of rounding to free', () => {
  // Several image models bill four decimal places. $0.00 on a counter reads as "this is free",
  // which is the one thing a spend figure must never say — so anything under a cent is shown at
  // the precision that makes it visible, and everything else rounds like money.
  assert.equal(spendLabel(0.0048), '$0.0048');
  assert.equal(spendLabel(0.048188), '$0.05');
  assert.equal(spendLabel(1.96), '$1.96');
  assert.equal(spendLabel(0), '$0.00', 'a genuine zero is a measurement, not an absence');
  assert.equal(spendLabel(null), '');
});

// ── what a person is told ────────────────────────────────────────────────────

test('progress is shown only when the server said something real about it', () => {
  // No elapsed-time arithmetic and no percentage of our own: a four-minute render with a bar
  // somebody computed sits at 95% for two minutes.
  assert.equal(progressLabel(normalizeJob(raw({ status: 'running', progress: '40%' }))), '40%');
  assert.equal(progressLabel(normalizeJob(raw({ status: 'running' }))), '');
  assert.equal(progressLabel(normalizeJob(raw({ status: 'succeeded', progress: '4/4 shots' }))), '');
});

test('a failure names every model that was tried and what each said', () => {
  // "No model that accepts an input image is working" reads as a product fault until you can see
  // that three were tried and why each declined.
  const j = normalizeJob(raw({
    status: 'failed',
    error: 'No model that accepts an input image is working right now.',
    attempts: [
      { model: 'dreamina-seedance-2-5-hc', error: "unknown model 'eva-video-2.5'" },
      { model: 'kling-v3', error: 'the render failed upstream' },
    ],
  }));
  const text = failureText(j);
  assert.match(text, /No model that accepts an input image/);
  assert.match(text, /dreamina-seedance-2-5-hc: unknown model/);
  assert.match(text, /kling-v3: the render failed upstream/);
});

test('a failure with no attempt list still says something', () => {
  assert.equal(failureText(normalizeJob(raw({ status: 'failed', error: '' }))), 'This render failed.');
  assert.equal(failureText(normalizeJob(raw())), '', 'a job that did not fail has no failure text');
});

test('jobs index by their id, which is what the canvas looks them up by', () => {
  const map = indexJobs([raw({ job_id: 'a' }), raw({ job_id: 'b' })].map(normalizeJob));
  assert.deepEqual([...map.keys()], ['a', 'b']);
});
