// The timeline: which clips, in what order, become one film.
//
//   { v:1, fps, resolution, shots:[{elementId, inS, outS}], audio:[{elementId, startS, gainDb}] }
//
// It lives INSIDE the scene file, top-level, beside `elements`. One document, one conflict story,
// one write — a second file would need a second rev, a second 409 and a second merge, and the two
// would drift the first time someone deleted a clip.
//
// Array order IS cut order. It is never inferred from where a card sits on the canvas: trim
// points, audio alignment and transitions are not scene geometry, and ordering by position means
// dragging a card to make room silently re-cuts the film.
//
// The rule that shapes every function here: a duration is measured or it is unknown. `totalSeconds`
// returns null while any shot is still rendering rather than summing the lengths that were asked
// for — an export that says "24.0 s" before anything has been measured is a number someone plans
// around, and it is wrong about as often as a model clips its own output.
import { mediaById } from './scene.js';

export const TIMELINE_V = 1;
export const FPS_CHOICES = [24, 25, 30];
export const RESOLUTIONS = ['1920x1080', '1080x1920', '1080x1080'];
export const DEFAULT_FPS = 30;
export const DEFAULT_RESOLUTION = '1920x1080';
export const MAX_SHOTS = 40;
export const MAX_TOTAL_S = 600;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Read the timeline out of a scene into the shape the app renders. Always returns a timeline —
 *  an empty one for a scene that has none, because "no shots yet" and "no timeline key" are the
 *  same situation to everything downstream. */
export function parseTimeline(scene) {
  const t = scene?.timeline && typeof scene.timeline === 'object' ? scene.timeline : {};
  const shots = (Array.isArray(t.shots) ? t.shots : [])
    .filter((s) => s && typeof s.elementId === 'string' && s.elementId)
    .map((s) => ({ elementId: s.elementId, inS: num(s.inS), outS: num(s.outS) }));
  const audio = (Array.isArray(t.audio) ? t.audio : [])
    .filter((a) => a && typeof a.elementId === 'string' && a.elementId)
    .map((a) => ({ elementId: a.elementId, startS: num(a.startS) ?? 0, gainDb: num(a.gainDb) ?? 0 }));
  return {
    v: TIMELINE_V,
    fps: FPS_CHOICES.includes(t.fps) ? t.fps : DEFAULT_FPS,
    resolution: RESOLUTIONS.includes(t.resolution) ? t.resolution : DEFAULT_RESOLUTION,
    shots,
    audio,
    updatedAt: num(t.updatedAt) ?? 0,
  };
}

/** The timeline back in its on-disk shape, or null when there is nothing in it to write. */
export function toTimelineFile(timeline) {
  if (!timeline?.shots?.length && !timeline?.audio?.length) return null;
  return {
    v: TIMELINE_V,
    fps: timeline.fps,
    resolution: timeline.resolution,
    shots: timeline.shots.map((s) => ({
      elementId: s.elementId,
      ...(s.inS === null ? {} : { inS: s.inS }),
      ...(s.outS === null ? {} : { outS: s.outS }),
    })),
    audio: timeline.audio.map((a) => ({ elementId: a.elementId, startS: a.startS, gainDb: a.gainDb })),
    updatedAt: Date.now(),
  };
}

/** How long one shot contributes, from the clip's MEASURED length and this shot's trim.
 *
 *  Null when the clip has not been measured — which is every clip that has not finished
 *  rendering. Null propagates; it does not become zero. */
/** The shortest a shot may be trimmed to. Matches reifyui's TL_MIN_CLIP_S: the UI must not
 *  offer a drag the document will refuse. */
export const MIN_SHOT_S = 0.1;

export function shotSeconds(shot, clip) {
  const len = clip?.seconds;
  if (!Number.isFinite(len)) return null;
  const from = Math.max(0, shot.inS ?? 0);
  const to = shot.outS === null || shot.outS === undefined ? len : Math.min(len, shot.outS);
  return Math.max(0, to - from);
}

/** The timeline resolved against the canvas: one row per shot, in cut order, each carrying the
 *  clip it points at.
 *
 *  A shot whose element is gone is kept and marked `missing`. Dropping it would renumber every
 *  shot after it and make the mistake invisible; the person needs to see which one to remove. */
export function timelineView(timeline, elements) {
  const clips = mediaById(elements);
  return timeline.shots.map((shot, i) => {
    const clip = clips.get(shot.elementId) || null;
    return {
      index: i,
      elementId: shot.elementId,
      inS: shot.inS,
      outS: shot.outS,
      clip,
      missing: !clip,
      label: clip?.label || `Shot ${i + 1}`,
      status: clip ? clip.status : 'missing',
      seconds: clip ? shotSeconds(shot, clip) : null,
    };
  });
}

/** The film's length, or null while any shot's length is still unknown.
 *
 *  Null is the honest answer and it is rendered as one — "—", not "0:00". The only number this
 *  product ever shows for duration is the sum of lengths that were actually measured off files. */
export function totalSeconds(view) {
  if (!view.length) return 0;
  let total = 0;
  for (const row of view) {
    if (row.seconds === null) return null;
    total += row.seconds;
  }
  return Math.round(total * 100) / 100;
}

/** mm:ss for a duration, or '—' for one that is not known. */
export function durationLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Whether this timeline could be exported, and everything true about it that is worth saying
 *  first.
 *
 *  Every warning names the shot, because "a clip is still rendering" in a six-shot film is not
 *  actionable and "Shot 3 is still rendering" is. */
export function readiness(timeline, view) {
  const warnings = [];
  const [W, H] = timeline.resolution.split('x').map(Number);

  for (const row of view) {
    if (row.missing) {
      warnings.push(`${row.label} points at a clip that is no longer on the canvas — remove it or place the clip again.`);
      continue;
    }
    if (row.status === 'running') { warnings.push(`${row.label} is still rendering — export will refuse until it lands.`); continue; }
    if (row.status === 'failed') { warnings.push(`${row.label} failed to render, so it has nothing to export.`); continue; }
    // Framing is only worth mentioning for a shot that will actually be in the film. Telling
    // someone a failed shot would have been letterboxed is a second sentence about a shot that
    // does not exist, and it buries the one that matters.
    const { width, height } = row.clip;
    if (Number.isFinite(width) && Number.isFinite(height) && (width !== W || height !== H)) {
      const fit = width / height > W / H ? 'letterboxed' : 'pillarboxed';
      warnings.push(`${row.label} is ${width}×${height} and will be ${fit} into ${timeline.resolution}.`);
    }
  }

  const total = totalSeconds(view);
  if (view.length > MAX_SHOTS) warnings.push(`This timeline has ${view.length} shots; ${MAX_SHOTS} is the most that can be assembled at once.`);
  if (total !== null && total > MAX_TOTAL_S) warnings.push(`This film is ${durationLabel(total)}; ${durationLabel(MAX_TOTAL_S)} is the most that can be assembled at once.`);

  const ready = view.length > 0
    && view.length <= MAX_SHOTS
    && view.every((r) => !r.missing && r.status === 'ready')
    && total !== null
    && total <= MAX_TOTAL_S;

  return { ready, warnings, total };
}

// ── the person's edits ─────────────────────────────────────────────────────
// Each returns a NEW timeline. The strip is a controlled component over the document, so a
// mutation in place would be a change the save queue never sees.

export function moveShot(timeline, from, to) {
  const shots = [...timeline.shots];
  if (from < 0 || from >= shots.length || to < 0 || to >= shots.length || from === to) return timeline;
  const [row] = shots.splice(from, 1);
  shots.splice(to, 0, row);
  return { ...timeline, shots };
}

export function removeShot(timeline, index) {
  if (index < 0 || index >= timeline.shots.length) return timeline;
  return { ...timeline, shots: timeline.shots.filter((_, i) => i !== index) };
}

/** Put a clip that is on the canvas into the cut, at the end. Already-in-the-cut is not an error
 *  and not a duplicate: a shot used twice is a legitimate cut, so this only refuses what it
 *  cannot express — a clip that is not on the canvas. */
export function appendShot(timeline, elementId, elements) {
  if (!mediaById(elements).has(elementId)) return timeline;
  if (timeline.shots.length >= MAX_SHOTS) return timeline;
  return { ...timeline, shots: [...timeline.shots, { elementId, inS: null, outS: null }] };
}

export function setFps(timeline, fps) {
  return FPS_CHOICES.includes(fps) ? { ...timeline, fps } : timeline;
}

export function setResolution(timeline, resolution) {
  return RESOLUTIONS.includes(resolution) ? { ...timeline, resolution } : timeline;
}

/** Every clip on the canvas that the cut does not use. This is what the "add a shot" control
 *  offers, and an empty list is why that control is not rendered. */
export function unusedClips(timeline, elements) {
  const used = new Set(timeline.shots.map((s) => s.elementId));
  return [...mediaById(elements).values()]
    .filter((m) => (m.kind === 'video' || m.kind === 'image') && !used.has(m.id));
}

/* ── trimming and splitting ────────────────────────────────────────────────────────────────────
   A shot is a WINDOW onto its clip — [inS, outS] in the clip's own seconds — so trimming moves an
   edge of that window and splitting cuts it in two. Neither touches the clip: the same 6 second
   render can appear twice in a cut at two different lengths, and nothing is re-rendered to make
   that true. That is the whole reason the window lives on the shot rather than the media. */

/** The window as concrete numbers, with the nulls that mean "the whole clip" resolved. */
function window_(shot, clip) {
  const len = clip?.seconds;
  const from = Math.max(0, shot.inS ?? 0);
  const to = shot.outS === null || shot.outS === undefined
    ? (Number.isFinite(len) ? len : null) : shot.outS;
  return { from, to, len };
}

/** Move one edge so the shot lasts `seconds`. The opposite edge does not move.
 *
 *  Refuses rather than guesses when the clip has not been measured: a window needs a length to be
 *  clamped against, and inventing one here is how a cut comes to claim a duration the file cannot
 *  provide. */
export function trimShot(timeline, index, edge, seconds, elements) {
  const shot = timeline.shots[index];
  if (!shot) return timeline;
  const clip = mediaById(elements).get(shot.elementId);
  const { from, to, len } = window_(shot, clip);
  if (!Number.isFinite(len) || to === null) return timeline;
  const want = Math.max(MIN_SHOT_S, Math.min(seconds, len));
  const next = edge === 'end'
    ? { ...shot, inS: from, outS: Math.min(len, from + want) }
    : { ...shot, inS: Math.max(0, to - want), outS: to };
  if (next.inS === shot.inS && next.outS === shot.outS) return timeline;
  return { ...timeline, shots: timeline.shots.map((s, i) => (i === index ? next : s)) };
}

/** Cut a shot in two at `atS` measured from the shot's own start. The two halves together occupy
 *  exactly the window the one shot did — a split adds a cut point, it does not add or lose film. */
export function splitShot(timeline, index, atS, elements) {
  const shot = timeline.shots[index];
  if (!shot) return timeline;
  if (timeline.shots.length >= MAX_SHOTS) return timeline;
  const clip = mediaById(elements).get(shot.elementId);
  const { from, to, len } = window_(shot, clip);
  if (!Number.isFinite(len) || to === null) return timeline;
  const cut = from + atS;
  if (cut <= from + MIN_SHOT_S || cut >= to - MIN_SHOT_S) return timeline;
  const a = { ...shot, inS: from, outS: cut };
  const b = { ...shot, inS: cut, outS: to };
  const shots = [...timeline.shots];
  shots.splice(index, 1, a, b);
  return { ...timeline, shots };
}
