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
  const overlays = (Array.isArray(t.overlays) ? t.overlays : [])
    .filter((o) => o && typeof o.elementId === 'string' && o.elementId)
    .map((o) => ({
      elementId: o.elementId,
      layer: Math.max(1, Math.round(num(o.layer) ?? 1)),
      startS: Math.max(0, num(o.startS) ?? 0),
      inS: num(o.inS),
      outS: num(o.outS),
      position: OVERLAY_POSITIONS.some((p) => p.id === o.position) ? o.position : 'full',
      scale: Math.min(1, Math.max(0.05, num(o.scale) ?? 1)),
    }));
  return {
    v: TIMELINE_V,
    fps: FPS_CHOICES.includes(t.fps) ? t.fps : DEFAULT_FPS,
    resolution: RESOLUTIONS.includes(t.resolution) ? t.resolution : DEFAULT_RESOLUTION,
    shots,
    audio,
    overlays,
    updatedAt: num(t.updatedAt) ?? 0,
  };
}

/** The timeline back in its on-disk shape, or null when there is nothing in it to write. */
export function toTimelineFile(timeline) {
  if (!timeline?.shots?.length && !timeline?.audio?.length && !timeline?.overlays?.length) return null;
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
    overlays: (timeline.overlays || []).map((o) => ({
      elementId: o.elementId, layer: o.layer, startS: o.startS,
      ...(o.inS === null ? {} : { inS: o.inS }),
      ...(o.outS === null ? {} : { outS: o.outS }),
      position: o.position, scale: o.scale,
    })),
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

/** How long a still is held when the cut has not said. Matches the gateway's STILL_HOLD_S:
 *  two defaults that disagree would make the preview and the exported film different films. */
export const STILL_HOLD_S = 3;

export function shotSeconds(shot, clip) {
  // A STILL HAS NO LENGTH OF ITS OWN. How long it is held is a property of the cut, so it reads
  // from the shot — and a still that has not been given one is held for STILL_HOLD_S, which is a
  // stated default rather than a measurement dressed up as one.
  if (clip && clip.kind === 'image') {
    const from = Math.max(0, shot.inS ?? 0);
    const to = shot.outS === null || shot.outS === undefined ? STILL_HOLD_S : shot.outS;
    return Math.max(0, to - from);
  }
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
  // The hold is written on the shot AT THE MOMENT IT JOINS THE CUT. Leaving it null puts the
  // decision in two places — this app's default and the server's — and the day they drift the
  // film is not the one the timeline drew.
  const clip = mediaById(elements).get(elementId);
  const still = clip?.kind === 'image';
  return { ...timeline,
           shots: [...timeline.shots,
                   { elementId, inS: null, outS: still ? STILL_HOLD_S : null }] };
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
  if (clip?.kind === 'image') {
    // No source to run out of: a still can be held for as long as the cut likes.
    const want = Math.max(MIN_SHOT_S, seconds);
    return { ...timeline,
             shots: timeline.shots.map((x, i) => (i === index ? { ...x, inS: 0, outS: want } : x)) };
  }
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

/** Put a clip into the cut at a given slot. `appendShot` is this with the slot at the end. */
export function insertShot(timeline, elementId, index, elements) {
  const clip = mediaById(elements).get(elementId);
  if (!clip || clip.kind === 'audio') return timeline;
  if (timeline.shots.length >= MAX_SHOTS) return timeline;
  const shot = { elementId, inS: null, outS: clip.kind === 'image' ? STILL_HOLD_S : null };
  const shots = [...timeline.shots];
  shots.splice(Math.max(0, Math.min(index, shots.length)), 0, shot);
  return { ...timeline, shots };
}

/* ── layers above the cut ──────────────────────────────────────────────────────────────────────
   A layer is PLACED: it names the second of the FILM where it appears, so adding one never moves
   the shots underneath it. That is the whole difference between a layer and another shot, and it
   is why an overlay carries `startS` and a shot does not — the same distinction the audio bed has
   had since the beginning.

   The film stays as long as its shots. A layer running past the end is trimmed at export, so the
   app never shows a total that counts one. */

/** Where a layer sits when it is not filling the frame. The same five the gateway composites and
 *  the preview draws — a sixth here would be an option that does nothing to the film. */
export const OVERLAY_POSITIONS = [
  { id: 'full', label: 'Fill the frame' },
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
  { id: 'center', label: 'Centred' },
];
/** How big a layer is when it stops filling the frame. A corner inset of the frame's width. */
export const OVERLAY_PIP_SCALE = 0.34;
export const OVERLAY_INSET = 0.03;
export const MAX_LAYERS = 8;

/** How long one layer is on screen, from the clip's measured length and its own window. */
export function overlaySeconds(ov, clip) {
  return shotSeconds({ inS: ov.inS, outS: ov.outS }, clip);
}

/** The layers resolved against the canvas, in compositing order: layer 1 first, drawn over the
 *  spine, and each one after it over that. Rows keep their index into `timeline.overlays` so an
 *  edit names the same item the document does. */
export function overlayView(timeline, elements) {
  const clips = mediaById(elements);
  return (timeline.overlays || [])
    .map((ov, index) => {
      const clip = clips.get(ov.elementId) || null;
      return {
        index,
        elementId: ov.elementId,
        layer: ov.layer,
        startS: ov.startS,
        inS: ov.inS,
        outS: ov.outS,
        position: ov.position,
        scale: ov.scale,
        clip,
        missing: !clip,
        label: clip?.label || `Layer ${ov.layer}`,
        status: clip ? clip.status : 'missing',
        seconds: clip ? overlaySeconds(ov, clip) : null,
      };
    })
    .sort((a, b) => a.layer - b.layer || a.startS - b.startS);
}

/** How many layers the cut has. Zero means the lane is not drawn: an empty lane with a label on
 *  it is a promise, not a feature. */
export function layerCount(timeline) {
  return (timeline.overlays || []).reduce((n, o) => Math.max(n, o.layer), 0);
}

/** Put a clip over the film, starting at the second it was dropped on. */
export function addOverlay(timeline, elementId, startS, layer, elements) {
  const clip = mediaById(elements).get(elementId);
  if (!clip || clip.kind === 'audio') return timeline;
  const lay = Math.max(1, Math.min(MAX_LAYERS, Math.round(layer || 1)));
  if (lay > layerCount(timeline) + 1) return timeline;    // no gaps: layer 3 over nothing
  const at = Math.max(0, Number(startS) || 0);
  const overlays = [...(timeline.overlays || []), {
    elementId, layer: lay, startS: at,
    inS: null, outS: clip.kind === 'image' ? STILL_HOLD_S : null,
    position: 'full', scale: 1,
  }];
  return { ...timeline, overlays };
}

/** Slide a layer along the film. Only when it moves — a click that lands where it started must
 *  not enter the undo history as an edit. */
export function moveOverlay(timeline, index, startS) {
  const ov = (timeline.overlays || [])[index];
  if (!ov) return timeline;
  const at = Math.max(0, Number(startS) || 0);
  if (Math.abs(at - ov.startS) < 1e-3) return timeline;
  return { ...timeline,
           overlays: timeline.overlays.map((o, i) => (i === index ? { ...o, startS: at } : o)) };
}

/** Trim a layer's own window. Dragging its LEFT edge moves where it starts on the film too:
 *  the frame under the pointer is the frame that stays there, which is what dragging an edge
 *  looks like it should do. */
export function trimOverlay(timeline, index, edge, seconds, elements) {
  const ov = (timeline.overlays || [])[index];
  if (!ov) return timeline;
  const clip = mediaById(elements).get(ov.elementId);
  const was = overlaySeconds(ov, clip);
  const shot = trimShot({ ...timeline, shots: [{ elementId: ov.elementId, inS: ov.inS, outS: ov.outS }] },
                        0, edge, seconds, elements).shots[0];
  if (!shot) return timeline;
  const now = overlaySeconds(shot, clip);
  const startS = edge === 'start' && Number.isFinite(was) && Number.isFinite(now)
    ? Math.max(0, ov.startS + (was - now)) : ov.startS;
  return { ...timeline,
           overlays: timeline.overlays.map((o, i) => (
             i === index ? { ...o, inS: shot.inS, outS: shot.outS, startS } : o)) };
}

export function removeOverlay(timeline, index) {
  if (!(timeline.overlays || [])[index]) return timeline;
  return { ...timeline, overlays: timeline.overlays.filter((_, i) => i !== index) };
}

/** How a layer is framed: filling the frame, or inset into one of the corners. */
export function setOverlayFraming(timeline, index, position) {
  const ov = (timeline.overlays || [])[index];
  if (!ov || !OVERLAY_POSITIONS.some((p) => p.id === position)) return timeline;
  const scale = position === 'full' ? 1 : OVERLAY_PIP_SCALE;
  return { ...timeline,
           overlays: timeline.overlays.map((o, i) => (
             i === index ? { ...o, position, scale } : o)) };
}

/** Lay a sound under the film, starting where it was dropped.
 *
 *  The audio layer is a set of PLACED items rather than a sequence: a bed starts at a moment you
 *  choose, and two of them may overlap. That is why it has `startS` and the shots do not. */
export function addAudio(timeline, elementId, startS, elements) {
  const clip = mediaById(elements).get(elementId);
  if (!clip || clip.kind !== 'audio') return timeline;
  const at = Math.max(0, Number(startS) || 0);
  if ((timeline.audio || []).some((a) => a.elementId === elementId
                                         && Math.abs((a.startS || 0) - at) < 0.05)) {
    return timeline;                     // already there, at that moment
  }
  return { ...timeline, audio: [...(timeline.audio || []), { elementId, startS: at, gainDb: 0 }] };
}
