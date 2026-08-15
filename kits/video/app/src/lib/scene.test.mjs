// The canvas document contract, pinned.
//
// Two writers touch this file — a person dragging clips and a server placing them — and they touch
// it at the same time, because a render lands four minutes after it was asked for and nobody stops
// working in the meantime. Every case here is one that actually happens in that window, and the
// rule under all of them is the same: the server decides which clips exist, the person decides
// where they sit, and neither is allowed to silently discard the other's work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_STATE_KEYS, changeKey, contentBounds, filesForScene, mediaChange, mediaElements, mediaOf,
  mergeScene, parseScene, runningJobIds, sanitizeAppState, toFile,
} from './scene.js';

const media = (over = {}) => ({
  v: 1, kind: 'video', status: 'ready', jobId: 'mjob_1', mediaId: 'med_1',
  model: 'MiniMax-Hailuo-2.3', capability: 'text_to_video', seconds: 6, width: 1366, height: 768,
  prompt: 'rain on a window', createdAt: 1765792800000, ...over,
});

const clip = (id, over = {}, m = {}) => ({
  id, type: 'embeddable', x: 40, y: 40, width: 480, height: 270, angle: 0, version: 3,
  link: null, customData: { media: media(m) }, ...over,
});

const drawing = (id, over = {}) => ({
  id, type: 'rectangle', x: 0, y: 0, width: 100, height: 100, angle: 0, version: 1, ...over,
});

const SCENE = {
  type: 'excalidraw',
  version: 2,
  source: 'harnessrouter/kits/video',
  elements: [clip('el_1'), drawing('el_2')],
  appState: { viewBackgroundColor: '#fff', scrollX: 10, scrollY: 20, zoom: { value: 1 } },
  files: {},
  timeline: { v: 1, fps: 30, resolution: '1920x1080', shots: [{ elementId: 'el_1' }], audio: [] },
  meta: { title: 'Rain', rev: 18 },
};

// ── reading the file ─────────────────────────────────────────────────────────

test('a well-formed scene parses to its elements, its timeline and its title', () => {
  const { scene, error } = parseScene(structuredClone(SCENE));
  assert.equal(error, undefined);
  assert.equal(scene.elements.length, 2);
  assert.equal(scene.title, 'Rain');
  assert.equal(scene.timeline.shots.length, 1);
});

test('an empty document is refused by name rather than rendered as an empty canvas', () => {
  assert.match(parseScene(null).error, /no canvas yet/);
  assert.match(parseScene({ meta: {} }).error, /no elements list/);
});

test('a scene from a newer media format says so instead of half-rendering it', () => {
  // Half-reading it would draw the clips it recognises and quietly drop the ones it does not,
  // which looks exactly like a project that lost work.
  const raw = { ...SCENE, elements: [clip('el_1', {}, { v: 2 })] };
  assert.match(parseScene(raw).error, /media format 2/);
});

test('an element with no id is dropped, because the canvas keys on it', () => {
  const { scene } = parseScene({ ...SCENE, elements: [clip('el_1'), { type: 'rectangle' }] });
  assert.equal(scene.elements.length, 1);
});

// ── appState ─────────────────────────────────────────────────────────────────

test('collaborators never survives a round trip', () => {
  // Excalidraw holds it as a Map; JSON makes it {}, and the next collaborators.forEach throws
  // inside the canvas. It has to be dropped on the way in as well as on the way out.
  const out = sanitizeAppState({ collaborators: {}, viewBackgroundColor: '#fff' });
  assert.equal('collaborators' in out, false);
  assert.equal(out.viewBackgroundColor, '#fff');
});

test('only the five persisted keys are kept — a selection is not shared state', () => {
  const out = sanitizeAppState({
    ...Object.fromEntries(APP_STATE_KEYS.map((k) => [k, 1])),
    selectedElementIds: { el_1: true }, activeTool: { type: 'freedraw' }, cursorButton: 'down',
  });
  assert.deepEqual(Object.keys(out).sort(), [...APP_STATE_KEYS].sort());
});

// ── writing the file ─────────────────────────────────────────────────────────

test('an unknown top-level key survives being written back', () => {
  // serializeAsJSON keeps the keys it knows about and drops the rest. The timeline IS the rest,
  // and so is anything a future version of the server adds.
  const raw = { ...SCENE, somethingNew: { a: 1 } };
  const out = toFile(raw, { elements: raw.elements, appState: raw.appState, files: {} });
  assert.deepEqual(out.somethingNew, { a: 1 });
  assert.deepEqual(out.timeline, SCENE.timeline);
});

test('the timeline is written when there is one and absent when there is not', () => {
  const withT = toFile(SCENE, { timeline: { v: 1, shots: [{ elementId: 'el_1' }] } });
  assert.equal(withT.timeline.shots.length, 1);
  const withoutT = toFile(SCENE, { timeline: null });
  assert.equal('timeline' in withoutT, false);
});

test('a renamed video keeps every other meta field the server put there', () => {
  const out = toFile(SCENE, { title: 'Storm' });
  assert.equal(out.meta.title, 'Storm');
  assert.equal(out.meta.rev, 18);
});

test('what is written back is still an Excalidraw scene', () => {
  const out = toFile({}, { elements: [clip('el_1')] });
  assert.equal(out.type, 'excalidraw');
  assert.equal(out.version, 2);
  assert.ok(Array.isArray(out.elements));
  assert.equal(typeof out.files, 'object');
});

// ── media elements ───────────────────────────────────────────────────────────

test('a clip that is still rendering has no duration, not the duration that was asked for', () => {
  // The requested length and the delivered length are different numbers — models round, clip and
  // occasionally ignore the request — and only one of them can be put on a timeline.
  const [m] = mediaElements([clip('el_1', {}, {
    status: 'running', mediaId: null, seconds: undefined, width: undefined, height: undefined,
  })]);
  assert.equal(m.status, 'running');
  assert.equal(m.seconds, null);
  assert.equal(m.width, null);
});

test('customData that is not a media record is not a clip', () => {
  assert.equal(mediaOf({ customData: { note: 'hi' } }), null);
  assert.equal(mediaOf({ customData: { media: { kind: 'spreadsheet' } } }), null);
  assert.equal(mediaElements([drawing('el_2')]).length, 0);
});

test('a deleted element is off the canvas even though it is still in the file', () => {
  assert.equal(mediaElements([clip('el_1', { isDeleted: true })]).length, 0);
});

test('only the jobs that are still running are polled, and each of them once', () => {
  const els = [
    clip('a', {}, { status: 'running', jobId: 'mjob_1' }),
    clip('b', {}, { status: 'running', jobId: 'mjob_1' }),
    clip('c', {}, { status: 'ready', jobId: 'mjob_2' }),
  ];
  assert.deepEqual(runningJobIds(els), ['mjob_1']);
  assert.deepEqual(runningJobIds([clip('c', {}, { status: 'ready' })]), []);
});

// ── the files map ────────────────────────────────────────────────────────────

test('an image renders from a URL derived now, and the document holds no URL at all', () => {
  // A stored address rots twice over: the deployment's base changes when a self-hosted install
  // moves, and a provider's signed URL expires within hours.
  const els = [clip('el_i', {}, { kind: 'image', mediaId: 'med_9' })];
  const files = filesForScene(els, (id) => `/api/harness/v1/…/media/${id}`);
  assert.equal(files.med_9.dataURL, '/api/harness/v1/…/media/med_9');
  assert.equal(JSON.stringify(els).includes('http'), false);
});

test('a file id is the media id, so a placeholder that becomes a frame is a NEW file', () => {
  // addFiles will not update a fileId it already has. Reusing the id is how a finished frame
  // stays a grey box.
  const before = filesForScene([clip('el_i', {}, { kind: 'image', mediaId: 'med_a' })], (id) => `/m/${id}`);
  const after = filesForScene([clip('el_i', {}, { kind: 'image', mediaId: 'med_b' })], (id) => `/m/${id}`);
  assert.deepEqual(Object.keys(before), ['med_a']);
  assert.deepEqual(Object.keys(after), ['med_b']);
});

test('a clip with no media id yet contributes no file', () => {
  const files = filesForScene([clip('el_i', {}, { kind: 'image', mediaId: null })], (id) => `/m/${id}`);
  assert.deepEqual(files, {});
});

// ── change detection ─────────────────────────────────────────────────────────

test('panning and zooming is not a change to the document', () => {
  // Excalidraw's onChange fires on every componentDidUpdate, unthrottled. Gating on this is the
  // difference between one write per edit and a several-hundred-KB PUT per mouse move.
  const els = [clip('el_1'), drawing('el_2')];
  assert.equal(changeKey(els, {}), changeKey(els, {}));
});

test('moving an element is a change, and so is a file arriving', () => {
  const before = [clip('el_1')];
  const after = [clip('el_1', { x: 500, version: 4 })];
  assert.notEqual(changeKey(before, {}), changeKey(after, {}));
  assert.notEqual(changeKey(before, {}), changeKey(before, { med_1: {} }));
});

// ── the media boundary ───────────────────────────────────────────────────────

test('this app may not add a clip', () => {
  // Only a job produces a clip. A browser that can add one can put a picture on a canvas that
  // nothing generated and nothing paid for.
  const base = { elements: [clip('el_1')] };
  const next = { elements: [clip('el_1'), clip('el_2')] };
  assert.match(mediaChange(base, next), /gained a clip \(el_2\)/);
});

test('this app may not delete a clip either', () => {
  const base = { elements: [clip('el_1'), clip('el_2')] };
  const next = { elements: [clip('el_1')] };
  assert.match(mediaChange(base, next), /lost a clip \(el_2\)/);
});

test('moving a clip and drawing beside it is not a media change', () => {
  const base = { elements: [clip('el_1')] };
  const next = { elements: [clip('el_1', { x: 900 }), drawing('el_new')] };
  assert.equal(mediaChange(base, next), '');
});

// ── the merge ────────────────────────────────────────────────────────────────
// The situation, every time: a render landed while somebody was dragging.

const base = { elements: [clip('el_1', {}, { status: 'running', mediaId: null, seconds: undefined })], timeline: null, title: 'Rain' };

test('a clip the server finished stays finished, where the person just put it', () => {
  const local = { elements: [clip('el_1', { x: 900, y: 300 }, { status: 'running', mediaId: null, seconds: undefined })], timeline: null, title: 'Rain' };
  const server = { elements: [clip('el_1', {}, { status: 'ready', mediaId: 'med_1', seconds: 6 })], timeline: null, title: 'Rain' };
  const out = mergeScene({ base, local, server });
  assert.equal(out.elements.length, 1);
  assert.equal(mediaOf(out.elements[0]).status, 'ready');
  assert.equal(mediaOf(out.elements[0]).mediaId, 'med_1');
  assert.equal(out.elements[0].x, 900);
  assert.equal(out.elements[0].y, 300);
});

test('a clip nobody moved takes the server’s position, not this tab’s stale copy', () => {
  const local = { elements: [clip('el_1', {}, { status: 'running', mediaId: null, seconds: undefined })] };
  const server = { elements: [clip('el_1', { x: 1200 }, { status: 'ready', mediaId: 'med_1' })] };
  const out = mergeScene({ base, local, server });
  assert.equal(out.elements[0].x, 1200);
});

test('a clip the server removed does not come back', () => {
  const local = { elements: [clip('el_1', { x: 900 })] };
  const server = { elements: [] };
  assert.deepEqual(mergeScene({ base, local, server }).elements, []);
});

test('a clip only this tab has is a ghost and is dropped', () => {
  const local = { elements: [clip('el_1'), clip('el_ghost')] };
  const server = { elements: [clip('el_1')] };
  const out = mergeScene({ base, local, server });
  assert.deepEqual(out.elements.map((e) => e.id), ['el_1']);
});

test('something the person drew since the last agreement is kept', () => {
  const local = { elements: [clip('el_1'), drawing('el_note')] };
  const server = { elements: [clip('el_1')] };
  const out = mergeScene({ base, local, server });
  assert.deepEqual(out.elements.map((e) => e.id), ['el_1', 'el_note']);
});

test('a caption the copilot removed does not come back', () => {
  // Observed on the VM: the agent replaced a stale caption, and this tab put the old one back on
  // every merge — so two captions drew on the same coordinates and the text rendered as garbage.
  // A non-media element missing from the server has two causes and they need opposite answers;
  // `base` is what tells "the person just drew it" from "the agent deleted it".
  const b = { elements: [clip('el_1'), drawing('el_cap')] };
  const local = { elements: [clip('el_1'), drawing('el_cap')] };
  const server = { elements: [clip('el_1')] };
  const out = mergeScene({ base: b, local, server });
  assert.deepEqual(out.elements.map((e) => e.id), ['el_1']);
});

test('a drawing the person edited wins; one they never touched takes the server’s copy', () => {
  const b = { elements: [drawing('r'), drawing('s')] };
  const local = { elements: [drawing('r', { x: 50, version: 2 }), drawing('s')] };
  const server = { elements: [drawing('r', { x: 999 }), drawing('s', { x: 777 })] };
  const out = mergeScene({ base: b, local, server });
  assert.equal(out.elements.find((e) => e.id === 'r').x, 50);
  assert.equal(out.elements.find((e) => e.id === 's').x, 777);
});

test('the timeline is the person’s only when they changed it', () => {
  const t = { v: 1, fps: 24, resolution: '1920x1080', shots: [{ elementId: 'el_1' }], audio: [] };
  const serverT = { v: 1, fps: 30, resolution: '1080x1920', shots: [], audio: [] };

  const untouched = mergeScene({
    base: { ...base, timeline: null }, local: { elements: [], timeline: null }, server: { elements: [], timeline: serverT },
  });
  assert.deepEqual(untouched.timeline, serverT, 'nobody edited it here, so the server’s is newer');

  const edited = mergeScene({
    base: { ...base, timeline: null }, local: { elements: [], timeline: t }, server: { elements: [], timeline: serverT },
  });
  assert.deepEqual(edited.timeline, t, 'the person just set this; losing it loses their cut');
});

test('appState is always this tab’s — a viewport is not shared state', () => {
  const out = mergeScene({
    base, server: { elements: [], appState: { scrollX: 0 } },
    local: { elements: [], appState: { scrollX: 400, collaborators: {} } },
  });
  assert.equal(out.appState.scrollX, 400);
  assert.equal('collaborators' in out.appState, false);
});

test('a merged document never adds or removes a clip relative to the server', () => {
  // The property that makes the retry after a 412 safe: whatever the merge produces, the store's
  // 422 rule cannot fire on it.
  const local = { elements: [clip('el_1', { x: 900 }), clip('el_ghost'), drawing('el_note')] };
  const server = { elements: [clip('el_1'), clip('el_2')] };
  const out = mergeScene({ base, local, server });
  assert.equal(mediaChange(server, out), '');
});

// ── bounds ───────────────────────────────────────────────────────────────────

test('an empty canvas has no bounds, rather than a zero-sized box at the origin', () => {
  assert.equal(contentBounds([]), null);
  assert.equal(contentBounds([drawing('d', { isDeleted: true })]), null);
});

test('bounds cover every live element', () => {
  const b = contentBounds([clip('a', { x: 0, y: 0, width: 100, height: 50 }),
    clip('b', { x: 200, y: 100, width: 100, height: 50 })]);
  assert.deepEqual(b, { x: 0, y: 0, w: 300, h: 150 });
});

// ── the embed link ───────────────────────────────────────────────────────────
// Excalidraw decides whether an embeddable is drawable by validating element.link, once, and
// caches the answer. No link means renderEmbeddable is never called and the clip is an empty box.
// So the link goes on at load and comes off before every write, and the file never holds an
// address that could rot.

test('a clip is given a link on the way in, and it is the derived one', async () => {
  const { hydrateLinks } = await import('./scene.js');
  const [el] = hydrateLinks([clip('el_1')], (m) => `https://console.example/media/${m.mediaId}`);
  assert.equal(el.link, 'https://console.example/media/med_1');
});

test('nothing but a media embeddable is given a link', async () => {
  // An image renders from files[fileId].dataURL and a drawing renders itself; giving either a link
  // would put a clickable address on something that is not a clip.
  const { hydrateLinks } = await import('./scene.js');
  const input = [drawing('el_2'), clip('el_3', { type: 'image' })];
  const out = hydrateLinks(input, () => 'https://x/y');
  assert.equal(out[0], input[0]);
  assert.equal(out[1], input[1]);
});

test('the link comes off before the document is written', async () => {
  const { hydrateLinks, stripLinks } = await import('./scene.js');
  const hydrated = hydrateLinks([clip('el_1'), drawing('el_2')], () => 'https://console.example/m/1');
  const out = stripLinks(hydrated);
  assert.equal(out[0].link, null);
  assert.equal(JSON.stringify(out).includes('console.example'), false);
});

test('a link that has not changed does not produce a new element object', async () => {
  // A new object every render is a new identity for React and for the save queue's diff.
  const { hydrateLinks } = await import('./scene.js');
  const once = hydrateLinks([clip('el_1')], () => 'https://x/m');
  const twice = hydrateLinks(once, () => 'https://x/m');
  assert.equal(once[0], twice[0]);
});

test('hydrating and stripping leaves the document byte-identical', async () => {
  const { hydrateLinks, stripLinks } = await import('./scene.js');
  const original = [clip('el_1', { link: null }), drawing('el_2')];
  const round = stripLinks(hydrateLinks(original, () => 'https://x/m'));
  assert.equal(JSON.stringify(round), JSON.stringify(original));
});

// ── the content key ──────────────────────────────────────────────────────────
// `changeKey` answers "did Excalidraw's counter move" — the cheap gate that keeps a pan out of the
// save queue. This answers the question underneath it: did the DOCUMENT change? They are not the
// same question, and assuming they were made opening a video write to it.

test('Excalidraw bumping its own bookkeeping is not a change to the document', async () => {
  // restore() bumps every element's version as it normalises a scene on load. The version sum
  // moves for a document nobody has touched; the content does not.
  const { contentKey } = await import('./scene.js');
  const before = [clip('el_1', { version: 3 }), drawing('el_2', { version: 1 })];
  const after = [clip('el_1', { version: 4, versionNonce: 99, updated: 12345, index: 'a0' }),
    drawing('el_2', { version: 2, seed: 777, index: 'a1' })];
  assert.notEqual(changeKey(before, {}), changeKey(after, {}), 'the counter moved');
  assert.equal(contentKey(before), contentKey(after), 'the document did not');
});

test('the link is bookkeeping too, because this app puts it on and takes it off', async () => {
  const { contentKey, hydrateLinks } = await import('./scene.js');
  const els = [clip('el_1')];
  assert.equal(contentKey(hydrateLinks(els, () => 'https://x/m')), contentKey(els));
});

test('reordering the board IS a change, even though the z-order key is ignored', async () => {
  // `index` is excluded because restore() assigns one to every element that arrives without it.
  // What it encodes — the order of the array — is compared directly, so bringing a clip to the
  // front still reads as a change rather than being silently dropped with the key.
  const { contentKey } = await import('./scene.js');
  const a = clip('el_1');
  const b = drawing('el_2');
  assert.notEqual(contentKey([a, b]), contentKey([b, a]));
});

test('moving, restyling, retyping or deleting IS a change to the document', async () => {
  const { contentKey } = await import('./scene.js');
  const base = [clip('el_1'), drawing('el_2')];
  const key = contentKey(base);
  assert.notEqual(contentKey([clip('el_1', { x: 900 }), drawing('el_2')]), key, 'moved');
  assert.notEqual(contentKey([clip('el_1', { width: 640 }), drawing('el_2')]), key, 'resized');
  assert.notEqual(contentKey([clip('el_1'), drawing('el_2', { strokeColor: '#f00' })]), key, 'restyled');
  assert.notEqual(contentKey([clip('el_1'), drawing('el_2', { isDeleted: true })]), key, 'deleted');
  assert.notEqual(contentKey([clip('el_1')]), key, 'removed');
});

test('a clip whose render landed IS a change to the document', async () => {
  // customData is content: it is where a placeholder becoming a clip is recorded.
  const { contentKey } = await import('./scene.js');
  const running = [clip('el_1', {}, { status: 'running', mediaId: null })];
  const ready = [clip('el_1', {}, { status: 'ready', mediaId: 'med_1' })];
  assert.notEqual(contentKey(running), contentKey(ready));
});

test('key order within an element does not make two identical documents differ', async () => {
  // Elements arrive from Excalidraw, from a template and from the server, all built differently.
  const { contentKey } = await import('./scene.js');
  const a = { id: 'x', type: 'rectangle', x: 1, y: 2, version: 1 };
  const b = { y: 2, version: 9, x: 1, type: 'rectangle', id: 'x' };
  assert.equal(contentKey([a]), contentKey([b]));
});

// ── the last gate before a write ─────────────────────────────────────────────

test('a document that says the same thing is not written, however new the object is', async () => {
  // Excalidraw lays text out with a fallback face on first paint and re-measures when its own font
  // loads — two changes, ending exactly where it started. Without this the round trip costs a
  // revision on a video somebody only opened.
  const { documentDiffers } = await import('./scene.js');
  const a = { elements: [clip('el_1'), drawing('el_2')], timeline: null, meta: { title: 'Rain' } };
  const b = { elements: [clip('el_1', { version: 9 }), drawing('el_2', { version: 4 })], timeline: null, meta: { title: 'Rain' } };
  assert.equal(documentDiffers(a, b), false);
});

test('a moved clip, a re-cut timeline and a rename each count as different', async () => {
  const { documentDiffers } = await import('./scene.js');
  const base = { elements: [clip('el_1')], timeline: null, meta: { title: 'Rain' } };
  assert.equal(documentDiffers(base, { ...base, elements: [clip('el_1', { x: 900 })] }), true);
  assert.equal(documentDiffers(base, { ...base, timeline: { v: 1, shots: [{ elementId: 'el_1' }] } }), true);
  assert.equal(documentDiffers(base, { ...base, meta: { title: 'Storm' } }), true);
});

test('with nothing to compare against, a write goes ahead', async () => {
  // Never silently drop the first write of a document this tab has no baseline for.
  const { documentDiffers } = await import('./scene.js');
  assert.equal(documentDiffers(null, { elements: [] }), true);
});
