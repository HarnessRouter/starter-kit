// Trimming and splitting a cut. These edit the document, so the arithmetic is asserted rather
// than eyeballed through the UI: an off-by-one here silently shortens somebody's film.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STILL_HOLD_S, appendShot, shotSeconds, splitShot, trimShot } from './timeline.js';

// The real element shape: media hangs off customData, which is where mediaOf reads it. A fixture
// that invents a shape tests nothing — this one was wrong at first and every assertion still
// 'passed' the bail-out path, which is exactly the failure a fixture is supposed to prevent.
const el = (id, seconds) => ({ id, customData: { media: {
  kind: 'video', status: 'ready', mediaId: 'm-' + id, ...(seconds === null ? {} : { seconds }) } } });
const elements = [el('e1', 6)];
const tl = (shots) => ({ v: 1, fps: 30, resolution: '1920x1080', shots, audio: [] });
const clip = { seconds: 6 };

test('trimming the end moves the out point and leaves the in point alone', () => {
  const t = trimShot(tl([{ elementId: 'e1', inS: null, outS: null }]), 0, 'end', 2, elements);
  assert.deepEqual(t.shots[0], { elementId: 'e1', inS: 0, outS: 2 });
  assert.equal(shotSeconds(t.shots[0], clip), 2);
});

test('trimming the start moves the in point and keeps the END where it was', () => {
  const t = trimShot(tl([{ elementId: 'e1', inS: null, outS: null }]), 0, 'start', 2, elements);
  assert.deepEqual(t.shots[0], { elementId: 'e1', inS: 4, outS: 6 });
  assert.equal(shotSeconds(t.shots[0], clip), 2);
});

test('a trim cannot exceed the clip or collapse it to nothing', () => {
  const long = trimShot(tl([{ elementId: 'e1', inS: null, outS: null }]), 0, 'end', 99, elements);
  assert.equal(shotSeconds(long.shots[0], clip), 6, 'trimmed past the end of the file');
  const tiny = trimShot(tl([{ elementId: 'e1', inS: null, outS: null }]), 0, 'end', 0, elements);
  assert.ok(shotSeconds(tiny.shots[0], clip) >= 0.1, 'trimmed to nothing');
});

test('splitting adds a cut point and neither adds nor loses film', () => {
  const before = tl([{ elementId: 'e1', inS: null, outS: null }]);
  const after = splitShot(before, 0, 2, elements);
  assert.equal(after.shots.length, 2);
  assert.deepEqual(after.shots[0], { elementId: 'e1', inS: 0, outS: 2 });
  assert.deepEqual(after.shots[1], { elementId: 'e1', inS: 2, outS: 6 });
  const total = after.shots.reduce((n, s) => n + shotSeconds(s, clip), 0);
  assert.equal(total, shotSeconds(before.shots[0], clip), 'the split changed the total length');
});

test('splitting a shot that was already trimmed stays inside its window', () => {
  const after = splitShot(tl([{ elementId: 'e1', inS: 1, outS: 5 }]), 0, 2, elements);
  assert.deepEqual(after.shots[0], { elementId: 'e1', inS: 1, outS: 3 });
  assert.deepEqual(after.shots[1], { elementId: 'e1', inS: 3, outS: 5 });
});

test('a cut too close to an edge is refused, not silently clamped', () => {
  const before = tl([{ elementId: 'e1', inS: null, outS: null }]);
  assert.equal(splitShot(before, 0, 0.01, elements), before, 'made a zero-length shot');
  assert.equal(splitShot(before, 0, 5.999, elements), before, 'made a zero-length tail');
});

test('an unmeasured clip refuses both, rather than inventing a length', () => {
  const els = [el('e2', null)];   // rendered nothing yet: no measured length
  const before = tl([{ elementId: 'e2', inS: null, outS: null }]);
  assert.equal(trimShot(before, 0, 'end', 2, els), before);
  assert.equal(splitShot(before, 0, 1, els), before);
});

/* ── stills ───────────────────────────────────────────────────────────────────────────────────
   A still has no length of its own, so the CUT gives it one. These pin that down because the
   alternative — the app defaulting one way and the exporter another — makes the film you download
   a different film from the one the timeline drew, with nothing to say so. */

const still = (id) => ({ id, customData: { media: {
  kind: 'image', status: 'ready', mediaId: 'i-' + id } } });

test('a still added to the cut carries its hold, rather than leaving it to be guessed', () => {
  const els = [still('img1')];
  const t = appendShot(tl([]), 'img1', els);
  assert.equal(t.shots[0].outS, STILL_HOLD_S, 'the hold was not written on the shot');
  assert.equal(shotSeconds(t.shots[0], { kind: 'image' }), STILL_HOLD_S);
});

test('a still has a length even though its file does not', () => {
  assert.equal(shotSeconds({ elementId: 'img1', inS: null, outS: null }, { kind: 'image' }),
               STILL_HOLD_S, 'an unmeasured still must still be drawable');
});

test('a still can be held for longer than any file length, because there is no file length', () => {
  const els = [still('img1')];
  const t = trimShot(tl([{ elementId: 'img1', inS: 0, outS: 3 }]), 0, 'end', 12, els);
  assert.equal(shotSeconds(t.shots[0], { kind: 'image' }), 12);
});

test('a still cannot be trimmed to nothing', () => {
  const els = [still('img1')];
  const t = trimShot(tl([{ elementId: 'img1', inS: 0, outS: 3 }]), 0, 'end', 0, els);
  assert.ok(shotSeconds(t.shots[0], { kind: 'image' }) >= 0.1);
});
