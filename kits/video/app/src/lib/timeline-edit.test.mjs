// Trimming and splitting a cut. These edit the document, so the arithmetic is asserted rather
// than eyeballed through the UI: an off-by-one here silently shortens somebody's film.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STILL_HOLD_S, addOverlay, appendShot, moveOverlay, overlaySeconds, parseTimeline,
  setOverlayFraming, shotSeconds, splitShot, timelineView, toTimelineFile, totalSeconds,
  trimOverlay, trimShot,
} from './timeline.js';

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

// ── layers above the cut ───────────────────────────────────────────────────────────────────────
// A layer is placed, not queued. Every assertion below is about the one property that makes it a
// layer rather than a shot: editing it must never move anything underneath it.
const img = (id) => ({ id, customData: { media: {
  kind: 'image', status: 'ready', mediaId: 'm-' + id } } });
const withLayers = (shots, overlays) => ({ ...tl(shots), overlays });

test('a layer is placed at the second it was dropped on and does not move the cut', () => {
  const before = tl([{ elementId: 'e1', inS: null, outS: null }]);
  const after = addOverlay(before, 'e1', 2.5, 1, elements);
  assert.deepEqual(after.shots, before.shots, 'adding a layer re-cut the film');
  assert.equal(after.overlays.length, 1);
  assert.equal(after.overlays[0].startS, 2.5);
  assert.equal(after.overlays[0].layer, 1);
  assert.equal(after.overlays[0].position, 'full');
  assert.equal(totalSeconds(timelineView(after, elements)), 6, 'a layer lengthened the film');
});

test('a still on a layer is given the hold that a still in the cut gets', () => {
  const t = addOverlay(tl([]), 'p1', 0, 1, [...elements, img('p1')]);
  assert.equal(t.overlays[0].outS, STILL_HOLD_S);
  assert.equal(overlaySeconds(t.overlays[0], { kind: 'image' }), STILL_HOLD_S);
});

test('layers may not skip a level — layer 3 over nothing is not a cut', () => {
  const t = addOverlay(tl([]), 'e1', 0, 3, elements);
  assert.equal((t.overlays || []).length, 0);
  const one = addOverlay(tl([]), 'e1', 0, 1, elements);
  assert.equal(addOverlay(one, 'e1', 0, 2, elements).overlays.length, 2, 'the next layer up was refused');
});

test('trimming a layer from the left keeps the frame under the pointer where it is', () => {
  // A 6s clip laid at 2s, trimmed from the left to 4s: it now starts at 4s on the film, and the
  // frame that was at 4s before the drag is still at 4s after it.
  const t = addOverlay(tl([]), 'e1', 2, 1, elements);
  const after = trimOverlay(t, 0, 'start', 4, elements);
  assert.equal(after.overlays[0].startS, 4);
  assert.equal(overlaySeconds(after.overlays[0], clip), 4);
  // Trimming the right edge leaves the start alone.
  const right = trimOverlay(t, 0, 'end', 3, elements);
  assert.equal(right.overlays[0].startS, 2);
  assert.equal(overlaySeconds(right.overlays[0], clip), 3);
});

test('a layer slides along the film without changing what it shows', () => {
  const t = addOverlay(tl([]), 'e1', 1, 1, elements);
  const moved = moveOverlay(t, 0, 4.25);
  assert.equal(moved.overlays[0].startS, 4.25);
  assert.equal(moved.overlays[0].inS, t.overlays[0].inS);
  assert.equal(moved.overlays[0].outS, t.overlays[0].outS);
  assert.equal(moveOverlay(t, 0, 1), t, 'a move to where it already is counted as an edit');
});

test('framing a layer into a corner shrinks it; filling the frame restores it', () => {
  const t = addOverlay(tl([]), 'e1', 0, 1, elements);
  const pip = setOverlayFraming(t, 0, 'br');
  assert.equal(pip.overlays[0].position, 'br');
  assert.ok(pip.overlays[0].scale < 1 && pip.overlays[0].scale > 0);
  assert.equal(setOverlayFraming(pip, 0, 'full').overlays[0].scale, 1);
  assert.equal(setOverlayFraming(t, 0, 'nowhere'), t, 'an unknown place was accepted');
});

test('the layers survive a round trip through the file', () => {
  const t = addOverlay(tl([{ elementId: 'e1', inS: null, outS: null }]), 'e1', 2, 1, elements);
  const framed = setOverlayFraming(t, 0, 'tr');
  const back = parseTimeline({ timeline: toTimelineFile(framed) });
  assert.deepEqual(back.overlays, framed.overlays);
});

test('a layer alone is still a document worth writing', () => {
  // The film is not exportable without shots, but the layer must not be silently dropped on save.
  const only = addOverlay(tl([]), 'e1', 0, 1, elements);
  assert.ok(toTimelineFile(only), 'a timeline holding only a layer was written as null');
});

test('a still can be split — the Split button used to be enabled and do nothing', () => {
  // Shot 1 of a real film was a 3-second still. Split lit up, the click did nothing, and there
  // was no way to tell the difference between "refused" and "broken".
  const t = tl([{ elementId: 'p1', inS: null, outS: STILL_HOLD_S }]);
  const els = [img('p1')];
  const after = splitShot(t, 0, 1.2, els);
  assert.equal(after.shots.length, 2, 'the still was not split');
  assert.deepEqual(after.shots[0], { elementId: 'p1', inS: 0, outS: 1.2 });
  assert.deepEqual(after.shots[1], { elementId: 'p1', inS: 1.2, outS: STILL_HOLD_S });
  // The two halves together hold exactly as long as the one did — a split adds a cut point.
  const held = (s) => shotSeconds(s, { kind: 'image' });
  assert.equal(held(after.shots[0]) + held(after.shots[1]), STILL_HOLD_S);
  // And a cut too near an edge is still refused rather than making a sliver.
  assert.equal(splitShot(t, 0, 0.02, els), t);
});
