// The timeline contract, pinned.
//
// The timeline is the one place in this product where a number becomes a plan: somebody reads
// "0:24" and schedules a slot around it, or presses Export and waits. So the tests that matter
// most here are the ones about what happens when a length is not known yet — which is the normal
// state of a timeline, because a clip takes about four minutes to render and the strip is
// populated the moment it is submitted.
//
// The rule: a duration is measured off a finished file or it is unknown. There is no third value,
// and "unknown" never quietly becomes zero.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_FPS, DEFAULT_RESOLUTION, MAX_SHOTS, appendShot, durationLabel, moveShot, parseTimeline,
  readiness, removeShot, setFps, setResolution, shotSeconds, timelineView, toTimelineFile,
  totalSeconds, unusedClips,
} from './timeline.js';

const clip = (id, m = {}) => ({
  id, type: 'embeddable', x: 0, y: 0, width: 480, height: 270, version: 1,
  customData: {
    media: {
      v: 1, kind: 'video', status: 'ready', jobId: `mjob_${id}`, mediaId: `med_${id}`,
      model: 'kling-v3', seconds: 6, width: 1920, height: 1080, shot: `Shot ${id}`, ...m,
    },
  },
});

const sceneWith = (timeline) => ({ timeline });

// ── reading ──────────────────────────────────────────────────────────────────

test('a scene with no timeline reads as an empty one at the defaults', () => {
  const t = parseTimeline({});
  assert.deepEqual(t.shots, []);
  assert.equal(t.fps, DEFAULT_FPS);
  assert.equal(t.resolution, DEFAULT_RESOLUTION);
});

test('an fps or resolution this app cannot render falls back to one it can', () => {
  const t = parseTimeline(sceneWith({ fps: 60, resolution: '4096x2160', shots: [] }));
  assert.equal(t.fps, DEFAULT_FPS);
  assert.equal(t.resolution, DEFAULT_RESOLUTION);
});

test('a shot with no element id is not a shot', () => {
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }, {}, { inS: 1 }] }));
  assert.deepEqual(t.shots.map((s) => s.elementId), ['a']);
});

test('array order is cut order and is never re-sorted', () => {
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'c' }, { elementId: 'a' }, { elementId: 'b' }] }));
  assert.deepEqual(t.shots.map((s) => s.elementId), ['c', 'a', 'b']);
});

// ── durations ────────────────────────────────────────────────────────────────

test('a shot with no trim is the whole clip', () => {
  assert.equal(shotSeconds({ inS: null, outS: null }, { seconds: 6 }), 6);
});

test('a trim is applied, and an out point past the end is clamped to it', () => {
  assert.equal(shotSeconds({ inS: 1, outS: 4 }, { seconds: 6 }), 3);
  assert.equal(shotSeconds({ inS: 0, outS: 99 }, { seconds: 6 }), 6);
});

test('a clip that has not been measured has no length — not zero', () => {
  assert.equal(shotSeconds({ inS: 0, outS: null }, { seconds: null }), null);
  assert.equal(shotSeconds({ inS: 0, outS: null }, {}), null);
});

test('a film containing anything unmeasured has no length either', () => {
  // The failure this prevents: a strip that says 0:24 while three of its four shots are still
  // rendering, because the fourth was 24 seconds and the rest summed as zero.
  const elements = [clip('a'), clip('b', { status: 'running', seconds: undefined })];
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }, { elementId: 'b' }] }));
  const view = timelineView(t, elements);
  assert.equal(totalSeconds(view), null);
});

test('a film of measured clips is their sum', () => {
  const elements = [clip('a', { seconds: 6 }), clip('b', { seconds: 10.5 })];
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }, { elementId: 'b' }] }));
  assert.equal(totalSeconds(timelineView(t, elements)), 16.5);
});

test('an empty timeline is zero seconds long, which is a measurement and not a guess', () => {
  assert.equal(totalSeconds([]), 0);
});

test('an unknown duration renders as a dash, never as 0:00', () => {
  assert.equal(durationLabel(null), '—');
  assert.equal(durationLabel(undefined), '—');
  assert.equal(durationLabel(0), '0:00');
  assert.equal(durationLabel(6), '0:06');
  assert.equal(durationLabel(90), '1:30');
});

// ── the view ─────────────────────────────────────────────────────────────────

test('a shot pointing at a clip that is gone is kept and marked, not dropped', () => {
  // Dropping it renumbers every shot after it and makes the mistake invisible. The person has to
  // be able to see which row to remove.
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }, { elementId: 'gone' }] }));
  const view = timelineView(t, [clip('a')]);
  assert.equal(view.length, 2);
  assert.equal(view[1].missing, true);
  assert.equal(view[1].seconds, null);
});

test('a clip used twice is two shots, because that is a legitimate cut', () => {
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }, { elementId: 'a', inS: 2 }] }));
  assert.equal(timelineView(t, [clip('a')]).length, 2);
});

// ── readiness ────────────────────────────────────────────────────────────────

const ready = (shots, elements) => readiness(parseTimeline(sceneWith({ shots })), timelineView(parseTimeline(sceneWith({ shots })), elements));

test('a timeline of finished clips at the target size is ready and warns about nothing', () => {
  const r = ready([{ elementId: 'a' }], [clip('a')]);
  assert.equal(r.ready, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.total, 6);
});

test('a still-rendering shot blocks export, and the warning names it', () => {
  const r = ready([{ elementId: 'a' }], [clip('a', { status: 'running', seconds: undefined, shot: 'Shot 3' })]);
  assert.equal(r.ready, false);
  assert.match(r.warnings[0], /Shot 3 is still rendering/);
});

test('a failed shot blocks export and says it has nothing to contribute', () => {
  const r = ready([{ elementId: 'a' }], [clip('a', { status: 'failed', shot: 'Shot 2' })]);
  assert.equal(r.ready, false);
  assert.match(r.warnings.join(' '), /Shot 2 failed to render/);
});

test('framing is not a warning — every clip is a different shape and it is handled', () => {
  // This used to say "1366x768 and will be letterboxed into 1920x1080" and it fired for
  // practically every shot of every film, because that is what these models return. An amber
  // banner announcing that video gets scaled to fit is furniture, and two of them pushed the
  // warnings that MATTER off the top of the list. The letterboxing itself never changed.
  const wide = ready([{ elementId: 'a' }], [clip('a', { width: 1366, height: 768 })]);
  assert.equal(wide.ready, true);
  assert.deepEqual(wide.warnings, [], 'framing was reported as a problem');
  const tall = ready([{ elementId: 'a' }], [clip('a', { width: 1080, height: 1920 })]);
  assert.deepEqual(tall.warnings, [], 'a portrait clip was reported as a problem');
});

test('an empty timeline is not ready — there is no film to make', () => {
  assert.equal(ready([], []).ready, false);
});

test('a missing clip blocks export and says how to fix it', () => {
  const r = ready([{ elementId: 'gone' }], []);
  assert.equal(r.ready, false);
  assert.match(r.warnings[0], /no longer on the canvas/);
});

test('more shots than can be assembled is refused before the button, not by the server', () => {
  const many = Array.from({ length: MAX_SHOTS + 1 }, (_, i) => ({ elementId: `e${i}` }));
  const els = many.map((s) => clip(s.elementId));
  const r = ready(many, els);
  assert.equal(r.ready, false);
  assert.match(r.warnings.join(' '), new RegExp(`${MAX_SHOTS} is the most`));
});

// ── the person's edits ───────────────────────────────────────────────────────

const T = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }, { elementId: 'b' }, { elementId: 'c' }] }));

test('reordering moves one shot and leaves the rest in order', () => {
  assert.deepEqual(moveShot(T, 2, 0).shots.map((s) => s.elementId), ['c', 'a', 'b']);
  assert.deepEqual(moveShot(T, 0, 2).shots.map((s) => s.elementId), ['b', 'c', 'a']);
});

test('a move that goes nowhere returns the same timeline, so the save queue does not fire', () => {
  assert.equal(moveShot(T, 1, 1), T);
  assert.equal(moveShot(T, -1, 0), T);
  assert.equal(moveShot(T, 0, 9), T);
});

test('removing a shot removes exactly one row', () => {
  assert.deepEqual(removeShot(T, 1).shots.map((s) => s.elementId), ['a', 'c']);
  assert.equal(removeShot(T, 7), T);
});

test('the edits never mutate the timeline they were given', () => {
  // The strip is a controlled component over the document; an in-place mutation is a change the
  // save queue never sees, and a cut that is lost on reload.
  const before = JSON.stringify(T);
  moveShot(T, 0, 2); removeShot(T, 0); setFps(T, 24); appendShot(T, 'a', [clip('a')]);
  assert.equal(JSON.stringify(T), before);
});

test('only a clip that is on the canvas can be added to the cut', () => {
  const t = parseTimeline(sceneWith({ shots: [] }));
  assert.equal(appendShot(t, 'nope', [clip('a')]).shots.length, 0);
  assert.equal(appendShot(t, 'a', [clip('a')]).shots.length, 1);
});

test('fps and resolution take only values that can actually be rendered', () => {
  assert.equal(setFps(T, 24).fps, 24);
  assert.equal(setFps(T, 60).fps, DEFAULT_FPS);
  assert.equal(setResolution(T, '1080x1920').resolution, '1080x1920');
  assert.equal(setResolution(T, '640x480').resolution, DEFAULT_RESOLUTION);
});

test('the clips offered for adding are the ones not already in the cut', () => {
  const t = parseTimeline(sceneWith({ shots: [{ elementId: 'a' }] }));
  const els = [clip('a'), clip('b'), clip('c', { kind: 'audio' })];
  assert.deepEqual(unusedClips(t, els).map((m) => m.id), ['b'], 'audio is scored separately, not cut');
});

// ── writing ──────────────────────────────────────────────────────────────────

test('a timeline with nothing in it is not written at all', () => {
  assert.equal(toTimelineFile(parseTimeline({})), null);
});

test('a trim that was never set is not written as a zero', () => {
  const out = toTimelineFile(parseTimeline(sceneWith({ shots: [{ elementId: 'a' }] })));
  assert.deepEqual(out.shots[0], { elementId: 'a' });
});

test('a timeline survives a write and a read unchanged', () => {
  const t = parseTimeline(sceneWith({
    fps: 24, resolution: '1080x1080',
    shots: [{ elementId: 'a', inS: 1, outS: 4 }],
    audio: [{ elementId: 'au', startS: 2, gainDb: -6 }],
  }));
  const back = parseTimeline(sceneWith(toTimelineFile(t)));
  assert.deepEqual(back.shots, t.shots);
  assert.deepEqual(back.audio, t.audio);
  assert.equal(back.fps, 24);
  assert.equal(back.resolution, '1080x1080');
});

test('a failed or still-rendering shot is not also warned about its framing', () => {
  // Two sentences about a shot that has nothing to export buries the one that matters, and the
  // second is about a size the film will never see.
  const failed = ready([{ elementId: 'a' }], [clip('a', { status: 'failed', width: 1366, height: 768, shot: 'Shot 3' })]);
  assert.equal(failed.warnings.length, 1);
  assert.match(failed.warnings[0], /failed to render/);

  const running = ready([{ elementId: 'a' }], [clip('a', { status: 'running', seconds: undefined, width: 1366, height: 768 })]);
  assert.equal(running.warnings.length, 1);
  assert.match(running.warnings[0], /still rendering/);
});
