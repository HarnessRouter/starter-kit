// A teammate's face is the Harness Bot mascot in one of six colours. Plain data here, so the
// recruiter protocol and the tests never pull React in; the drawing is in avatars.jsx.
export const COLOR_IDS = ['blue', 'violet', 'teal', 'green', 'amber', 'coral'];
export const COLOR_LABELS = { blue: 'Blue', violet: 'Violet', teal: 'Teal', green: 'Green', amber: 'Amber', coral: 'Coral' };

// Every face a teammate could have been given before, to the nearest of the six, so a teammate
// hired then keeps one face: the blob set's ten colours (its shape no longer matters) and the
// animal names that came before the blobs.
const NEAREST = {
  brown: 'amber', red: 'coral', orange: 'coral', amber: 'amber', green: 'green',
  teal: 'teal', blue: 'blue', purple: 'violet', pink: 'coral', grey: 'blue',
};
const LEGACY = {
  fox: 'orange', owl: 'purple', cat: 'grey', bear: 'brown', panda: 'grey', robot: 'blue',
  koala: 'grey', penguin: 'grey', bunny: 'pink', frog: 'green', whale: 'blue', sloth: 'amber',
};

function hash(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const nearest = (c) => (COLOR_IDS.includes(c) ? c : NEAREST[c] || null);

/** A face as {color} from whatever was stored ({color}, the older {shape, color}, a colour or an
 *  animal name), or a stable one for the seed. */
export function avatarOf(v, seed = '') {
  const color = v && typeof v === 'object' ? nearest(v.color)
    : typeof v === 'string' ? nearest(v) || nearest(LEGACY[v]) : null;
  if (color) return { color };
  const h = hash(seed || (typeof v === 'string' ? v : ''));
  return { color: COLOR_IDS[(h >>> 3) % COLOR_IDS.length] };
}

export const DEFAULT_AVATAR = { color: 'blue' };
/** The recruiter's own face, the same everywhere it appears. */
export const RECRUITER_AVATAR = { color: 'violet' };
