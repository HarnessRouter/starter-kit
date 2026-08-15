// The template library.
//
// Kit data, not app data: it lives at kits/<kit>/templates/ and is staged into public/ at build
// time (see vite.config.js), so there is one copy of it and it is reachable at
// /kits/<kit>/templates.json.
//
// A template carries a real, valid Excalidraw scene — placeholder frames, captions and a populated
// timeline whose shots point at clips that do not exist yet. That scene is what the app previews.
// It is NOT what goes to the agent: the agent is told the shot plan in words (see lib/copilot.js),
// because a canvas is something it changes through tools and handing it scene JSON is an
// invitation to write scene JSON, which is the one thing it must never do.
//
// `sample` is the other half of the boundary. It holds poster frames for the preview and nothing
// else, and it sits BESIDE the scene rather than inside it, so the frames a person is shown as an
// illustration cannot travel into a document as though they were theirs.
// Resolved when it is asked for, not when this module loads: the pure half of this file —
// templateShots and validateTemplate — is what the tests exercise, and they run in node, where
// there is no bundler to substitute a base URL.
function templatesUrl() {
  const env = import.meta.env;
  return `${env ? env.BASE_URL : '/'}templates.json`;
}

let cache = null;

export async function listTemplates() {
  if (cache) return cache;
  const res = await fetch(templatesUrl(), { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  cache = Array.isArray(body?.templates) ? body.templates : [];
  return cache;
}

export async function getTemplate(id) {
  if (!id || id === 'blank') return null;
  return (await listTemplates()).find((t) => t.id === id) || null;
}

/** The shot record a template's placeholder carries: what to make, how long, and whether the shot
 *  has a character in it — which is the tag that decides whether the next shot has to be built
 *  from the previous one's frame or may be generated fresh. */
export const placeholderOf = (el) => {
  const p = el?.customData?.placeholder;
  return p && typeof p === 'object' ? p : null;
};

/** A placeholder, as the plan reads it. */
function planned(el, index) {
  const p = placeholderOf(el);
  if (!p) return null;
  return {
    id: el.id,
    name: p.label || `Shot ${index + 1}`,
    kind: p.kind || 'video',
    // The length to ASK a model for. It is required on every generation, and taking it from the
    // template is how the first turn avoids having to ask.
    seconds: Number.isFinite(p.seconds) ? p.seconds : null,
    prompt: String(p.prompt || p.text || '').trim(),
    cast: String(p.cast || '').trim(),
  };
}

/** Ordered by a timeline track first, then whatever the track never mentioned.
 *
 *  A placeholder that is on the board but not in the cut is a real thing — an alternate take — and
 *  it belongs after the cut rather than woven into it. */
function ordered(elements, track, keep) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const out = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || seen.has(el.id)) return;
    const row = planned(el, out.length);
    if (!row || !keep(row)) return;
    seen.add(el.id);
    out.push(row);
  };
  for (const entry of track) push(byId.get(entry?.elementId));
  for (const el of elements) push(el);
  return out;
}

const VISUAL = new Set(['video', 'image']);

/** The template's shot plan — the pictures, in cut order.
 *
 *  The scene is the one copy of the plan: each placeholder carries what the shot is, and the
 *  timeline gives the order. Deriving from it means a template cannot say six shots in its
 *  metadata and draw four — which is exactly the drift a second, hand-written copy of the plan
 *  produces, and it is what `validateTemplate` checks the declared counts against.
 *
 *  Narration is NOT here. A voice line runs UNDER a shot rather than being one, so counting it as
 *  a shot doubles the length of every explainer. */
export function templateShots(template) {
  return ordered(template?.scene?.elements || [], template?.scene?.timeline?.shots || [],
    (row) => VISUAL.has(row.kind));
}

/** The voice track: lines that play under the shots, in the order they start. */
export function templateNarration(template) {
  return ordered(template?.scene?.elements || [], template?.scene?.timeline?.audio || [],
    (row) => row.kind === 'audio');
}

/** How long a shot runs in the cut, from the timeline rather than from the placeholder. Null when
 *  the timeline leaves it open. */
export function cutSeconds(shot) {
  const inS = Number.isFinite(shot?.inS) ? shot.inS : 0;
  const outS = Number.isFinite(shot?.outS) ? shot.outS : null;
  return outS === null ? null : Math.max(0, outS - inS);
}

/** The preview card's tones, one per shot, and the sentence that goes under them.
 *
 *  This is the ONLY reader of `sample` in the app, deliberately. The block is preview material —
 *  it never reaches a document and never reaches the agent — and keeping every access to it in one
 *  named function is what makes that boundary something a test can prove rather than something
 *  each caller has to remember.
 *
 *  A tone is a colour standing in for a shot, not a frame from one. Nothing here has been
 *  rendered, and a preview that looked like footage would sell the template on a picture no model
 *  has been asked to make yet. */
export function templatePreview(template) {
  const sample = template?.sample;
  const shots = Array.isArray(sample?.shots) ? sample.shots : [];
  return {
    tones: shots.map((s) => (typeof s?.tone === 'string' && s.tone.startsWith('#') ? s.tone : '')),
    caption: typeof sample?.caption === 'string' ? sample.caption : '',
  };
}

/** Everything wrong with a template, as sentences. Empty means it is usable.
 *
 *  Templates are data, and data with no check is data that rots: a scene whose timeline points at
 *  an element it does not contain previews as an empty board, a template with no prompt starts a
 *  turn with nothing in it, and a sample frame that leaks into the scene puts a picture nobody
 *  generated into somebody's project. None of that fails to compile. */
export function validateTemplate(t) {
  const problems = [];
  const id = t?.id || '(no id)';
  for (const k of ['id', 'name', 'description', 'aspect', 'scene']) {
    if (!t?.[k]) problems.push(`${id}: missing ${k}`);
  }
  if (!t?.scene) return problems;

  const elements = Array.isArray(t.scene.elements) ? t.scene.elements : null;
  if (!elements) { problems.push(`${id}: scene has no elements list`); return problems; }
  if (t.scene.type !== 'excalidraw') problems.push(`${id}: scene.type is not "excalidraw"`);

  const ids = new Set(elements.map((el) => el?.id));
  if (ids.size !== elements.length) problems.push(`${id}: two elements share an id`);

  for (const el of elements) {
    if (el?.frameId && !ids.has(el.frameId)) problems.push(`${id}: ${el.id} is in frame ${el.frameId}, which is not in the scene`);
    // A template ships placeholders. A media id in one would point at a file in somebody else's
    // session — the template must describe the shot, never claim to already have it.
    if (el?.customData?.media?.mediaId) problems.push(`${id}: ${el.id} carries a media id, so it claims a clip that does not exist`);
  }

  const shots = templateShots(t);
  // A template has to be startable: a duration is required on every generation, so a shot with no
  // length is a shot the first turn has to stop and ask about, and one with no prompt is a shot
  // nobody can make.
  for (const s of [...shots, ...templateNarration(t)]) {
    if (!Number.isFinite(s.seconds)) problems.push(`${id}: "${s.name}" has no length, and every generation needs one`);
    if (!s.prompt) problems.push(`${id}: "${s.name}" has nothing to generate from`);
  }

  const cut = t.scene.timeline?.shots || [];
  for (const shot of cut) {
    if (!ids.has(shot?.elementId)) problems.push(`${id}: the timeline points at ${shot?.elementId}, which is not in the scene`);
  }

  // The declared counts and the drawn ones have to agree, or the card advertises a film the board
  // does not describe.
  if (Number.isFinite(t.shots) && t.shots !== shots.length) {
    problems.push(`${id}: says ${t.shots} shots and draws ${shots.length}`);
  }
  const drawn = shots.reduce((sum, s) => sum + (s.seconds || 0), 0);
  if (Number.isFinite(t.seconds) && t.seconds !== drawn) {
    problems.push(`${id}: says ${t.seconds}s and its shots add up to ${drawn}s`);
  }
  // The cut's own lengths must match what each shot will be generated at, or the film is trimmed
  // to something nobody asked for the moment it is exported.
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const shot of cut) {
    const p = placeholderOf(byId.get(shot?.elementId));
    const inCut = cutSeconds(shot);
    if (p && Number.isFinite(p.seconds) && inCut !== null && inCut !== p.seconds) {
      problems.push(`${id}: ${shot.elementId} is generated at ${p.seconds}s and cut at ${inCut}s`);
    }
  }

  // `sample` is the preview's, and the preview's only. Inside the scene it would travel wherever
  // the scene travels.
  if (JSON.stringify(t.scene).includes('"sample"')) problems.push(`${id}: the scene contains a sample key`);
  return problems;
}
