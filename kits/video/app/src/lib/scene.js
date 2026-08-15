// The scene document, and what this app is allowed to do with it.
//
// The file is a real Excalidraw scene with two keys of ours on the end:
//
//   { type:'excalidraw', version, source, elements, appState, files,
//     timeline: {…},                 // ours — see lib/timeline.js
//     meta: { title, rev } }         // ours
//
// Excalidraw's own restore() reads elements/appState/files and ignores everything else, so the
// file still opens in excalidraw.com. That only stays true if WE never drop the extra keys, which
// is why toFile() spreads the raw document first and why serializeAsJSON is never used here — it
// keeps the keys it knows about and silently discards the rest, and the timeline is the rest.
//
// Two rules run through the whole module.
//
// The first: the app is not the authority on media. A clip on this canvas exists because a
// generation job produced it, and it is placed, replaced and removed by the server. The app moves
// and resizes; it never adds a media element and never deletes one. `mediaChange()` is that rule
// made mechanical rather than remembered — a browser bug must not be able to orphan a rendered
// clip or resurrect a deleted one.
//
// The second: nothing here invents a value. A clip whose duration has not been measured has no
// duration, not a zero and not the number that was asked for. Callers get `null` and render the
// absence.

/** What this app writes into `source`, so a scene's origin is legible in the file. */
export const SOURCE = 'harnessrouter/kits/video';

/** The `customData.media.v` this app reads. A newer document says so rather than half-rendering. */
export const MEDIA_V = 1;

/** The parts of appState worth persisting. Everything else is per-tab UI state — a selection, a
 *  tool, a cursor — and writing it would make one person's pointer a change the other has to
 *  merge.
 *
 *  `collaborators` is excluded for a harder reason: Excalidraw holds it as a Map, JSON turns a Map
 *  into `{}`, and the next `collaborators.forEach` throws inside the canvas. It has to be dropped
 *  on the way in as well as on the way out — see sanitizeAppState. */
export const APP_STATE_KEYS = ['viewBackgroundColor', 'gridModeEnabled', 'scrollX', 'scrollY', 'zoom'];

const MEDIA_KINDS = new Set(['video', 'image', 'audio', 'film']);

/** Read the document into the shape the app renders, or explain why it cannot.
 *
 *  Returns `{scene}` or `{error}`. Everything downstream may then assume `elements` is an array
 *  and `files` is an object, which is the only reason the render path has no defensive checks. */
export function parseScene(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'This video has no canvas yet.' };
  }
  if (!Array.isArray(raw.elements)) {
    return { error: 'This canvas file has no elements list, so it can’t be opened as a canvas.' };
  }
  const bad = raw.elements.find((el) => el && mediaOf(el) && mediaOf(el).v > MEDIA_V);
  if (bad) {
    return { error: `This canvas was written by a newer version of Videos (media format ${mediaOf(bad).v}); this app reads ${MEDIA_V}.` };
  }
  return {
    scene: {
      elements: raw.elements.filter((el) => el && typeof el.id === 'string' && el.id),
      appState: sanitizeAppState(raw.appState),
      files: raw.files && typeof raw.files === 'object' ? raw.files : {},
      timeline: raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : null,
      title: typeof raw.meta?.title === 'string' && raw.meta.title ? raw.meta.title : '',
    },
  };
}

/** Only the keys worth keeping, and never `collaborators`. */
export function sanitizeAppState(appState) {
  const out = {};
  if (!appState || typeof appState !== 'object') return out;
  for (const k of APP_STATE_KEYS) if (appState[k] !== undefined) out[k] = appState[k];
  return out;
}

/** The document, back in the on-disk shape.
 *
 *  `raw` is spread FIRST and deliberately: an unknown top-level key is something another writer
 *  put there, and this app must not be the reason it disappears. Everything after the spread is a
 *  key this app owns. */
export function toFile(raw, { elements, appState, files, timeline, title } = {}) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const out = {
    ...base,
    type: 'excalidraw',
    version: base.version || 2,
    source: base.source || SOURCE,
    elements: elements ?? base.elements ?? [],
    appState: sanitizeAppState(appState ?? base.appState),
    files: files ?? base.files ?? {},
  };
  // Written only when there is one. An empty `timeline: null` on every scene would be a key that
  // means "no timeline" in a file where the absence already means that.
  const t = timeline === undefined ? base.timeline : timeline;
  if (t) out.timeline = t; else delete out.timeline;
  const name = title === undefined ? base.meta?.title : title;
  out.meta = { ...(base.meta || {}), ...(name ? { title: name } : {}) };
  return out;
}

// ── media elements ─────────────────────────────────────────────────────────

/** The media record on an element, or null. The one place `customData.media` is read. */
export function mediaOf(el) {
  const m = el?.customData?.media;
  if (!m || typeof m !== 'object') return null;
  if (!MEDIA_KINDS.has(m.kind)) return null;
  return m;
}

export const isMedia = (el) => mediaOf(el) !== null;

/** Elements the person can see, in document order. Excalidraw soft-deletes, so `isDeleted` is
 *  how an element leaves a scene without leaving the file. */
export const liveElements = (elements) => (elements || []).filter((el) => el && !el.isDeleted);

/** Every media element on the canvas, as the app's own view of it.
 *
 *  `seconds`, `width` and `height` are whatever was MEASURED off the finished file. A clip still
 *  rendering has none of them, and this returns null for each rather than the number that was
 *  requested — a placeholder that claims 6.0 s before anything has been rendered is a number
 *  someone will read off the timeline and believe. */
export function mediaElements(elements) {
  return liveElements(elements).flatMap((el) => {
    const m = mediaOf(el);
    if (!m) return [];
    return [{
      id: el.id,
      kind: m.kind,
      status: m.status === 'ready' || m.status === 'failed' ? m.status : 'running',
      jobId: m.jobId || '',
      mediaId: m.mediaId || '',
      posterMediaId: m.posterMediaId || '',
      model: m.model || '',
      capability: m.capability || '',
      prompt: m.prompt || '',
      label: m.shot || el.customData?.label || '',
      seconds: Number.isFinite(m.seconds) ? m.seconds : null,
      width: Number.isFinite(m.width) ? m.width : null,
      height: Number.isFinite(m.height) ? m.height : null,
      error: m.error || '',
      x: el.x, y: el.y, w: el.width, h: el.height,
    }];
  });
}

/** Index by element id, for the render path and the timeline. */
export const mediaById = (elements) => new Map(mediaElements(elements).map((m) => [m.id, m]));

/** The job ids of everything still rendering. This is the poll set — and it is empty the moment
 *  the last clip lands, which is what stops the editor polling forever. */
export function runningJobIds(elements) {
  return [...new Set(mediaElements(elements)
    .filter((m) => m.status === 'running' && m.jobId)
    .map((m) => m.jobId))];
}

/** Excalidraw's `files` map, derived from the scene rather than stored in it.
 *
 *  An image element renders from `files[fileId].dataURL`, and a URL is allowed there — which is
 *  what keeps this document small. The URL is DERIVED at render time from the media id and never
 *  written to disk: a stored absolute URL is wrong the moment the deployment's address changes,
 *  and a stored provider URL is wrong the moment it expires (hours, for most of them). */
export function filesForScene(elements, urlFor) {
  const files = {};
  for (const m of mediaElements(elements)) {
    if (m.kind !== 'image' || !m.mediaId) continue;
    const url = urlFor(m.mediaId);
    if (!url) continue;
    files[m.mediaId] = {
      id: m.mediaId,
      mimeType: 'image/png',
      dataURL: url,
      created: Date.now(),
      lastRetrieved: Date.now(),
    };
  }
  return files;
}

/** Put the derived `link` on every media embeddable, on the way into the canvas.
 *
 *  Excalidraw will not render an embeddable whose link does not validate, and it decides that
 *  once, from `element.link`. So the link has to be there — and it has to be gone again before the
 *  document is written, which is `stripLinks`. Between the two, the file never contains an address
 *  and the canvas always has one. */
export function hydrateLinks(elements, linkFor) {
  return (elements || []).map((el) => {
    const m = mediaOf(el);
    if (!m || el.type !== 'embeddable') return el;
    const link = linkFor(m);
    return link && el.link !== link ? { ...el, link } : el;
  });
}

/** The inverse, on the way back out. */
export function stripLinks(elements) {
  return (elements || []).map((el) => (isMedia(el) && el.link ? { ...el, link: null } : el));
}

// ── change detection ───────────────────────────────────────────────────────

/** A number that changes when the SCENE changes and not when the view does.
 *
 *  Excalidraw's onChange fires on every componentDidUpdate — every pan, every zoom, every
 *  selection, unthrottled. Gating the save queue on this instead of on onChange firing is the
 *  difference between one write per edit and a multi-hundred-KB PUT per mouse move during a drag
 *  of the canvas.
 *
 *  The element half is Excalidraw's own versioning (its getSceneVersion is this sum); the files
 *  half is here because swapping a placeholder for a finished frame adds a file id without
 *  touching any element's version. */
export function changeKey(elements, files) {
  let sum = 0;
  for (const el of elements || []) sum += Number(el?.version) || 0;
  const ids = Object.keys(files || {}).sort().join(',');
  return `${(elements || []).length}:${sum}:${ids}`;
}

/** The fields that are Excalidraw's bookkeeping rather than the document's content.
 *
 *  `link` is ours: derived, put on at load and taken off before every write, so a document that
 *  differs only by a link does not differ.
 *
 *  `index` is Excalidraw's fractional z-order key, and it is derived too — `restore()` assigns one
 *  to every element that arrives without it, which made opening a video write to it. Leaving it out
 *  loses nothing, because the thing it encodes is the order of the elements array, and that array
 *  is compared in order below. Bringing a clip to the front still reads as a change. */
const VOLATILE = new Set(['version', 'versionNonce', 'updated', 'seed', 'link', 'index']);

/** What the document actually says, with the bookkeeping left out.
 *
 *  `changeKey` answers "did Excalidraw's version counter move", which is the cheap gate that keeps
 *  a pan from becoming a write. This answers the harder question underneath it: did anything a
 *  person would recognise as their document change?
 *
 *  They are not the same question, and assuming they were cost an afternoon. `restore()` bumps
 *  every element's version as it normalises a scene on load, so the counter moves once for a
 *  document nobody has touched — and a client that writes on that writes the document back every
 *  time it is opened, bumping the revision and racing the agent for a change of nothing. */
export function contentKey(elements) {
  return JSON.stringify((elements || []).map((el) => {
    const out = {};
    for (const k of Object.keys(el).sort()) if (!VOLATILE.has(k)) out[k] = el[k];
    return out;
  }));
}

/** Whether two documents say anything different. The last gate before a write.
 *
 *  A change arriving at the canvas is not the same thing as a document that differs, and the gap
 *  between them is measured in fonts: Excalidraw lays text out with a fallback face on first paint,
 *  reports a change, then re-measures when Excalifont loads and reports another — back to exactly
 *  the sizes it started with. The debounce means the write that follows carries the settled
 *  document, which is identical to the stored one. Comparing before sending is what turns that
 *  round trip into nothing at all, instead of a new revision on a video somebody only opened. */
export function documentDiffers(base, next) {
  if (!base || !next) return true;
  if ((base.meta?.title || '') !== (next.meta?.title || '')) return true;
  if (JSON.stringify(base.timeline ?? null) !== JSON.stringify(next.timeline ?? null)) return true;
  return contentKey(base.elements) !== contentKey(next.elements);
}

const GEOM = ['x', 'y', 'width', 'height', 'angle'];
const geomOf = (el) => Object.fromEntries(GEOM.map((k) => [k, el?.[k]]));
const sameGeom = (a, b) => GEOM.every((k) => a?.[k] === b?.[k]);

/** Which media elements this document adds or removes relative to `base`.
 *
 *  Returns '' when it adds and removes none, or a sentence naming the first offender. The store
 *  refuses such a write with 422; refusing to SEND it is how the person gets a specific complaint
 *  instead of a save that silently stops working. */
export function mediaChange(base, next) {
  const before = new Set(mediaElements(base?.elements).map((m) => m.id));
  const after = new Set(mediaElements(next?.elements).map((m) => m.id));
  for (const id of after) if (!before.has(id)) return `this canvas gained a clip (${id}) that no job produced`;
  for (const id of before) if (!after.has(id)) return `this canvas lost a clip (${id}) that is still in the project`;
  return '';
}

/** Three-way merge, for the case where the document moved under a write in flight.
 *
 *  `base` is what this tab last agreed with the server about; `local` is what it has now; `server`
 *  is what the server has now. Almost every occurrence is one cause: a render landed while the
 *  person was dragging, and the server's copy of that clip is newer (status, media id, measured
 *  size) while the person's copy of where it sits is newer. So:
 *
 *    media elements   the server decides they exist and what they are; the person decides where
 *                     they are, but only for the ones they actually moved
 *    other elements   the person's, whenever they touched them — that is their drawing
 *    timeline         the person's only if they edited it, otherwise the server's
 *    appState         always the person's: it is this tab's viewport, not shared state
 *
 *  Everything reduces to "whoever changed it since `base` wins, and the server wins ties", which
 *  is the only rule that never loses work in the common case. */
export function mergeScene({ base, local, server }) {
  const baseById = new Map((base?.elements || []).map((el) => [el.id, el]));
  const localById = new Map((local?.elements || []).map((el) => [el.id, el]));
  const serverIds = new Set((server?.elements || []).map((el) => el.id));

  const elements = (server?.elements || []).map((s) => {
    const l = localById.get(s.id);
    const b = baseById.get(s.id);
    if (!l) return s;
    if (isMedia(s)) {
      // The person moved it since we last agreed: keep where they put it, take everything else.
      return b && !sameGeom(l, b) ? { ...s, ...geomOf(l), version: s.version } : s;
    }
    // Their own drawing. Untouched since base means the server's copy is at least as new.
    return b && JSON.stringify(l) === JSON.stringify(b) ? s : l;
  });

  // Elements drawn in this tab since `base`. Media the server does not have is dropped, not kept:
  // the server is the authority on which clips exist and a local one it has never heard of is a
  // ghost from a placement that did not land.
  //
  // "Not on the server" has two causes and they need opposite answers: the person just drew it
  // (keep), or the agent REMOVED it since we last agreed (drop). `base` is what tells them apart —
  // an element we once agreed existed and no longer see is a deletion, and re-adding it undoes a
  // tidy-up the person watched happen. That is the same "whoever changed it since base wins" rule
  // the rest of this function follows.
  for (const l of local?.elements || []) {
    if (serverIds.has(l.id) || isMedia(l)) continue;
    if (baseById.has(l.id)) continue;
    elements.push(l);
  }

  const touchedTimeline = JSON.stringify(local?.timeline ?? null) !== JSON.stringify(base?.timeline ?? null);
  const touchedTitle = (local?.title || '') !== (base?.title || '');
  return {
    elements,
    appState: sanitizeAppState(local?.appState),
    files: server?.files && Object.keys(server.files).length ? server.files : local?.files || {},
    timeline: touchedTimeline ? local?.timeline ?? null : server?.timeline ?? null,
    title: touchedTitle ? local.title : server?.title || '',
  };
}

/** Where the next thing dropped on this canvas would go, so the app can scroll there without
 *  doing arithmetic in a component. Null on an empty canvas — there is no "next" yet. */
export function contentBounds(elements) {
  const live = liveElements(elements);
  if (!live.length) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const el of live) {
    x0 = Math.min(x0, el.x); y0 = Math.min(y0, el.y);
    x1 = Math.max(x1, el.x + (el.width || 0)); y1 = Math.max(y1, el.y + (el.height || 0));
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
