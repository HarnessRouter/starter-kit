// A teammate's face is a blob: one of eight shapes in one of ten colours, with two white eye
// slits. Plain data here, so the recruiter protocol and the tests never pull React in; the
// drawing is in avatars.jsx. Eighty faces, all of one family, so a room full of teammates reads
// as one team and each one is still its own.
export const SHAPES = ['round', 'tilt', 'square', 'wide', 'triangle', 'hex', 'cloud', 'drop'];
export const SHAPE_LABELS = { round: 'Round', tilt: 'Tilted', square: 'Square', wide: 'Wide', triangle: 'Triangle', hex: 'Hexagon', cloud: 'Cloud', drop: 'Drop' };

export const COLORS = {
  brown: '#8E5B3C', red: '#E23D3A', orange: '#F0661A', amber: '#F5A21B', green: '#38C25D',
  teal: '#2FAF95', blue: '#2F7BF6', purple: '#8B5CF6', pink: '#EC4899', grey: '#6E6E73',
};
export const COLOR_IDS = Object.keys(COLORS);

// The faces teammates had before the blob set, so a teammate hired then keeps a stable look.
const LEGACY = {
  fox: ['drop', 'orange'], owl: ['hex', 'purple'], cat: ['tilt', 'grey'], bear: ['round', 'brown'],
  panda: ['square', 'grey'], robot: ['square', 'blue'], koala: ['wide', 'grey'], penguin: ['triangle', 'grey'],
  bunny: ['drop', 'pink'], frog: ['wide', 'green'], whale: ['cloud', 'blue'], sloth: ['round', 'amber'],
};

function hash(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A face as {shape, color} from whatever was stored, or a stable one for the seed. */
export function avatarOf(v, seed = '') {
  if (v && typeof v === 'object') {
    const shape = SHAPES.includes(v.shape) ? v.shape : null;
    const color = COLOR_IDS.includes(v.color) ? v.color : null;
    if (shape && color) return { shape, color };
  }
  if (typeof v === 'string' && LEGACY[v]) return { shape: LEGACY[v][0], color: LEGACY[v][1] };
  const h = hash(seed || (typeof v === 'string' ? v : ''));
  return { shape: SHAPES[h % SHAPES.length], color: COLOR_IDS[(h >>> 3) % COLOR_IDS.length] };
}

export const DEFAULT_AVATAR = { shape: 'round', color: 'blue' };
