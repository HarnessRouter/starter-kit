// The template library, pinned.
//
// Templates are data, and data with no test is data that rots: a timeline pointing at an element
// the scene does not contain, a shot with no length, a placeholder that claims a media id. All of
// it ships silently, because nothing fails to compile.
//
// The rule these tests exist to protect: a template's `sample` block belongs to the PREVIEW CARD
// and nowhere else. It is the one thing in this product a person is shown that was not made for
// them, and the boundary has to be mechanical rather than remembered — the copilot must have no
// path to it at all.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { cutSeconds, placeholderOf, templateShots, validateTemplate } from './templates.js';
import { templateInstructions } from './copilot.js';

const frame = (id, name) => ({ id, type: 'frame', name, x: 0, y: 0, width: 480, height: 270, version: 1 });

const shot = (id, frameId, over = {}) => ({
  id, type: 'rectangle', frameId, x: 0, y: 0, width: 480, height: 270, angle: 0, version: 1,
  customData: {
    placeholder: {
      v: 1, kind: 'video', label: 'Shot 1', seconds: 6,
      prompt: 'The box alone on a table, one light finding its edge.', cast: '[no character]',
      ...over,
    },
  },
});

const TPL = {
  id: 'launch',
  name: 'Product launch',
  description: 'Six shots that introduce a product.',
  prompt: 'A launch film for my product.',
  aspect: '16:9',
  shots: 2,
  seconds: 10,
  assumes: {
    subject: 'ONE object that photographs well.',
    character: 'A person appears in shot 2, which makes them a continuity problem.',
  },
  adapt: 'If they are launching software, replace the unboxing with a screen recording.',
  scene: {
    type: 'excalidraw',
    version: 2,
    elements: [
      frame('fr_1', 'Shot 1'), shot('el_1', 'fr_1', { label: 'Shot 1', seconds: 6 }),
      frame('fr_2', 'Shot 2'), shot('el_2', 'fr_2', { label: 'Shot 2', seconds: 4, prompt: 'Hands opening it.', cast: '[character: the owner]' }),
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
    timeline: {
      v: 1, fps: 30, resolution: '1920x1080',
      shots: [{ elementId: 'el_1', inS: 0, outS: 6 }, { elementId: 'el_2', inS: 0, outS: 4 }],
      audio: [],
    },
  },
  sample: {
    $comment: 'For the preview card ONLY.',
    caption: 'The shape of the storyboard. Not frames.',
    aspect: '16:9',
    shots: [{ label: 'Shot 1', seconds: 6, tone: '#14141c' }, { label: 'Shot 2', seconds: 4, tone: '#2a2a38' }],
  },
};

// ── the shot plan ────────────────────────────────────────────────────────────

test('the shot plan is read out of the scene, so it cannot disagree with what is drawn', () => {
  // A template that says six shots in its metadata and draws four is exactly the drift a second,
  // hand-written copy of the plan produces.
  assert.deepEqual(templateShots(TPL), [
    { id: 'el_1', name: 'Shot 1', kind: 'video', seconds: 6, prompt: 'The box alone on a table, one light finding its edge.', cast: '[no character]' },
    { id: 'el_2', name: 'Shot 2', kind: 'video', seconds: 4, prompt: 'Hands opening it.', cast: '[character: the owner]' },
  ]);
});

test('the timeline’s order is the plan’s order, not the drawing order', () => {
  const reversed = {
    ...TPL,
    scene: { ...TPL.scene, timeline: { ...TPL.scene.timeline, shots: [{ elementId: 'el_2', outS: 4 }, { elementId: 'el_1', outS: 6 }] } },
  };
  assert.deepEqual(templateShots(reversed).map((s) => s.name), ['Shot 2', 'Shot 1']);
});

test('a placeholder the cut never uses is still listed, after the ones that are in it', () => {
  const extra = {
    ...TPL,
    scene: { ...TPL.scene, elements: [...TPL.scene.elements, shot('el_3', null, { label: 'Alt take', seconds: 6 })] },
  };
  assert.deepEqual(templateShots(extra).map((s) => s.name), ['Shot 1', 'Shot 2', 'Alt take']);
});

test('a template with nothing drawn in it has no shots, which is what Blank is', () => {
  assert.deepEqual(templateShots({ scene: { elements: [] } }), []);
  assert.deepEqual(templateShots(null), []);
});

test('a frame is not a shot; the placeholder inside it is', () => {
  assert.equal(placeholderOf(frame('fr_1', 'Shot 1')), null);
  assert.equal(placeholderOf(shot('el_1', 'fr_1')).seconds, 6);
});

test('a shot the timeline leaves open has no cut length', () => {
  assert.equal(cutSeconds({ elementId: 'el_1' }), null);
  assert.equal(cutSeconds({ elementId: 'el_1', inS: 1, outS: 5 }), 4);
});

// ── the boundary ─────────────────────────────────────────────────────────────

test('the copilot is told the plan in words and never handed scene JSON', () => {
  // The agent changes the canvas through tools. Handing it a scene document is an invitation to
  // hand one back, and a scene an agent writes freehand is a scene an agent gets wrong.
  const text = templateInstructions(TPL);
  assert.equal(text.includes('excalidraw'), false);
  assert.equal(text.includes('"elements"'), false);
  assert.equal(text.includes('customData'), false);
  assert.equal(text.includes('el_1'), false);
  assert.equal(text.includes('fr_1'), false);
});

test('nothing from the preview card can reach the copilot', () => {
  // The whole safeguard, mechanically. `sample` sits beside `scene`, never inside it, and nothing
  // the copilot sends is built from it.
  const text = templateInstructions(TPL);
  assert.equal(text.includes('sample'), false);
  assert.equal(text.includes('#14141c'), false);
  assert.equal(text.includes('Not frames'), false);
});

test('the plan the copilot gets carries each shot’s name, length, cast tag and prompt', () => {
  const text = templateInstructions(TPL);
  assert.match(text, /Product launch/);
  assert.match(text, /16:9/);
  assert.match(text, /Shot 1 \(6s\) \[no character\] — The box alone on a table/);
  assert.match(text, /Shot 2 \(4s\) \[character: the owner\] — Hands opening it\./);
});

test('a named assumption map arrives as readable lines, not as [object Object]', () => {
  // This is a template's most load-bearing paragraph — what it was written for — and it is an
  // object in every template that ships.
  const text = templateInstructions(TPL);
  assert.equal(text.includes('[object Object]'), false);
  assert.match(text, /subject: ONE object that photographs well\./);
  assert.match(text, /character: A person appears in shot 2/);
});

test('what to do instead travels with what was assumed', () => {
  // A template written for one thing and applied to another without that reconciliation is six
  // shots of the wrong film.
  assert.match(templateInstructions(TPL), /replace the unboxing with a screen recording/);
});

test('the instructions end by requiring agreement before anything is spent', () => {
  assert.match(templateInstructions(TPL), /wait for a yes/);
  assert.match(templateInstructions(TPL), /Do not write a canvas file/);
});

// ── validation ───────────────────────────────────────────────────────────────

test('a well-formed template has nothing wrong with it', () => {
  assert.deepEqual(validateTemplate(TPL), []);
});

test('a template missing a field the app reads is named, with the field', () => {
  assert.match(validateTemplate({ ...TPL, aspect: '' }).join(' '), /missing aspect/);
  assert.match(validateTemplate({ ...TPL, description: '' }).join(' '), /missing description/);
});

test('a shot with no length is caught, because every generation needs one', () => {
  // A missing duration is the single most expensive mistake available here: one video model bills
  // 15 seconds by default, at six times the price of the six-second clip that was meant.
  const broken = {
    ...TPL,
    scene: { ...TPL.scene, elements: [frame('fr_1', 'Shot 1'), shot('el_1', 'fr_1', { seconds: undefined })], timeline: { ...TPL.scene.timeline, shots: [{ elementId: 'el_1' }] } },
    shots: 1, seconds: 0,
  };
  assert.match(validateTemplate(broken).join(' '), /has no length/);
});

test('a shot with nothing to generate from is caught', () => {
  const broken = { ...TPL, scene: { ...TPL.scene, elements: [shot('el_1', null, { prompt: '' })], timeline: { shots: [] } }, shots: 1, seconds: 6 };
  assert.match(validateTemplate(broken).join(' '), /nothing to generate from/);
});

test('a timeline pointing at an element the scene does not contain is caught', () => {
  // It previews as an empty board and the person picks a template that draws nothing.
  const broken = { ...TPL, scene: { ...TPL.scene, timeline: { ...TPL.scene.timeline, shots: [{ elementId: 'nope' }] } } };
  assert.match(validateTemplate(broken).join(' '), /timeline points at nope/);
});

test('a card that advertises more shots than the board draws is caught', () => {
  assert.match(validateTemplate({ ...TPL, shots: 6 }).join(' '), /says 6 shots and draws 2/);
  assert.match(validateTemplate({ ...TPL, seconds: 36 }).join(' '), /says 36s and its shots add up to 10s/);
});

test('a shot generated at one length and cut at another is caught', () => {
  // The film is silently trimmed to something nobody asked for, and only at export.
  const broken = { ...TPL, scene: { ...TPL.scene, timeline: { ...TPL.scene.timeline, shots: [{ elementId: 'el_1', inS: 0, outS: 3 }, { elementId: 'el_2', inS: 0, outS: 4 }] } }, seconds: 10 };
  assert.match(validateTemplate(broken).join(' '), /generated at 6s and cut at 3s/);
});

test('an element in a frame the scene does not contain is caught', () => {
  const broken = { ...TPL, scene: { ...TPL.scene, elements: [...TPL.scene.elements, shot('el_9', 'fr_missing')] }, shots: 3, seconds: 16 };
  assert.match(validateTemplate(broken).join(' '), /in frame fr_missing/);
});

test('a placeholder that claims a media id is caught', () => {
  // That id points at a file in somebody else's session. A template describes a shot; it never
  // already has one.
  const broken = {
    ...TPL,
    scene: {
      ...TPL.scene,
      elements: TPL.scene.elements.map((el) => (el.id === 'el_1'
        ? { ...el, customData: { ...el.customData, media: { v: 1, kind: 'video', mediaId: 'med_someone_else' } } } : el)),
    },
  };
  assert.match(validateTemplate(broken).join(' '), /claims a clip that does not exist/);
});

test('two elements sharing an id is caught, because the canvas keys on it', () => {
  const broken = { ...TPL, scene: { ...TPL.scene, elements: [...TPL.scene.elements, frame('fr_1', 'again')] } };
  assert.match(validateTemplate(broken).join(' '), /share an id/);
});

test('a scene that is not an Excalidraw scene is caught', () => {
  assert.match(validateTemplate({ ...TPL, scene: { elements: [] } }).join(' '), /not "excalidraw"/);
  assert.match(validateTemplate({ ...TPL, scene: { type: 'excalidraw' } }).join(' '), /no elements list/);
});

// ── the library that actually ships ──────────────────────────────────────────

const LIB_PATH = fileURLToPath(new URL('../../../templates/templates.json', import.meta.url));

test('every installed template is valid', (t) => {
  // The library belongs to the kit folder, not to this app. Until it lands, this reports that it
  // is not there rather than passing over nothing — a green test on an absent file is how a broken
  // library ships.
  if (!existsSync(LIB_PATH)) {
    t.skip(`no template library at ${LIB_PATH} yet — nothing to validate`);
    return;
  }
  const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
  assert.ok(Array.isArray(lib.templates) && lib.templates.length >= 1, 'the library is empty');
  assert.deepEqual(lib.templates.flatMap(validateTemplate), []);
});

test('nothing under `sample` reaches the copilot, whatever shape sample is in', (t) => {
  // Proved by mutation rather than by searching the output for sample's strings. Deliberately:
  // `sample` legitimately repeats labels the scene already carries ("Shot 1"), so a substring
  // search reports a leak on prose. Replacing the block wholesale and getting a byte-identical
  // result is the actual property — the instructions are a function of `scene` and nothing else —
  // and it survives the shape of `sample` changing, which it has done twice this evening.
  if (!existsSync(LIB_PATH)) { t.skip('no template library yet'); return; }
  const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
  for (const tpl of lib.templates) {
    const real = templateInstructions(tpl);
    assert.equal(templateInstructions({ ...tpl, sample: undefined }), real, `${tpl.id}: removing sample changed the instructions`);
    assert.equal(
      templateInstructions({ ...tpl, sample: { poisoned: 'LEAKED-SENTINEL', frames: ['LEAKED-SENTINEL'] } }),
      real,
      `${tpl.id}: rewriting sample changed the instructions`,
    );
  }
});

test('every installed template becomes instructions with nothing malformed in them', (t) => {
  if (!existsSync(LIB_PATH)) { t.skip('no template library yet'); return; }
  const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
  for (const tpl of lib.templates) {
    const text = templateInstructions(tpl);
    assert.equal(text.includes('[object Object]'), false, `${tpl.id}: an object rendered as [object Object]`);
    assert.equal(text.includes('excalidraw'), false, `${tpl.id}: scene JSON reached the copilot`);
    assert.equal(text.includes('customData'), false, `${tpl.id}: scene JSON reached the copilot`);
    assert.equal(text.includes('undefined'), false, `${tpl.id}: a missing field rendered as "undefined"`);
    assert.match(text, /wait for a yes/, `${tpl.id}: the spend gate is missing`);
  }
});

// ── the preview card ─────────────────────────────────────────────────────────
// One reader of `sample`, so the boundary is a function rather than a habit. Its shape has changed
// three times in one evening; what has not changed is that nothing in it was rendered for anybody.

test('the card’s tones are read per shot, in shot order', async () => {
  const { templatePreview } = await import('./templates.js');
  const { tones, caption } = templatePreview({
    sample: { caption: 'Not frames.', shots: [{ seconds: 6, tone: '#14141c' }, { seconds: 6, tone: '#2a2a38' }] },
  });
  assert.deepEqual(tones, ['#14141c', '#2a2a38']);
  assert.equal(caption, 'Not frames.');
});

test('a template with no preview block yields no tones and no caption, rather than throwing', async () => {
  const { templatePreview } = await import('./templates.js');
  assert.deepEqual(templatePreview({}), { tones: [], caption: '' });
  assert.deepEqual(templatePreview(null), { tones: [], caption: '' });
});

test('anything in the preview block that is not a colour is dropped, not rendered', async () => {
  // A bare string where a colour was expected becomes `background: "6"`, which paints nothing and
  // looks exactly like a card that failed to load.
  const { templatePreview } = await import('./templates.js');
  const { tones } = templatePreview({ sample: { shots: [{ tone: 'dark' }, { tone: '#fff' }, {}] } });
  assert.deepEqual(tones, ['', '#fff', '']);
});

test('every installed template supplies a tone for every shot it draws', async (t) => {
  // Not required by the app — a missing tone falls back to the brand tint — but a card that is
  // half coloured and half not is a card nobody meant to ship.
  if (!existsSync(LIB_PATH)) { t.skip('no template library yet'); return; }
  const { templatePreview } = await import('./templates.js');
  const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));
  for (const tpl of lib.templates) {
    const shots = templateShots(tpl);
    if (!shots.length) continue;
    const { tones } = templatePreview(tpl);
    assert.equal(tones.length, shots.length, `${tpl.id}: ${tones.length} tones for ${shots.length} shots`);
    assert.equal(tones.every(Boolean), true, `${tpl.id}: a shot has no tone`);
  }
});
