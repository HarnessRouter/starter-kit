// The blob mascots: one family of glossy shapes, each with the same two white eye slits, in the
// kit's ten colours. Drawn here once so a face is the same at 20px in the sidebar and at 96px on
// the creation screen, and needs no network. The volume is paint, not geometry: a radial light
// from the upper left, a soft specular, a rim of reflected light along the bottom edge and a
// contact shadow, so a flat colour reads as a small rounded object.
import React from 'react';
import { COLORS, SHAPES, SHAPE_LABELS, COLOR_IDS, avatarOf, DEFAULT_AVATAR } from './faces.js';
export { COLORS, SHAPES, SHAPE_LABELS, COLOR_IDS, avatarOf, DEFAULT_AVATAR };

// Every shape fills roughly the same area of the 64 by 64 box, so a row of them sits level; every
// corner is round (the star's points and valleys are curves of their own).
const PATHS = {
  round: 'M32 4a28 28 0 1 1 0 56a28 28 0 1 1 0-56Z',
  tilt: 'M20.5 6.2 43.5 9.4a12 12 0 0 1 10.3 13.5l-3.2 23a12 12 0 0 1-13.5 10.3l-23-3.2A12 12 0 0 1 3.8 39.5l3.2-23A12 12 0 0 1 20.5 6.2Z',
  square: 'M18 6h28a12 12 0 0 1 12 12v28a12 12 0 0 1-12 12H18A12 12 0 0 1 6 46V18A12 12 0 0 1 18 6Z',
  wide: 'M32 10c17 0 30 9.8 30 22S49 54 32 54 2 44.2 2 32 15 10 32 10Z',
  triangle: 'M27.4 8.6a5.4 5.4 0 0 1 9.2 0l24 39.8A5.4 5.4 0 0 1 56 56.6H8a5.4 5.4 0 0 1-4.6-8.2Z',
  hex: 'M28.5 4.4a7 7 0 0 1 7 0l19.4 11.2a7 7 0 0 1 3.5 6.1v22.4a7 7 0 0 1-3.5 6.1L35.5 61.4a7 7 0 0 1-7 0L9.1 50.2a7 7 0 0 1-3.5-6.1V21.7a7 7 0 0 1 3.5-6.1Z',
  drop: 'M32 3c2 0 4 1.6 6.6 5.2C46.2 18.6 56 31 56 40a24 24 0 1 1-48 0c0-9 9.8-21.4 17.4-31.8C28 4.6 30 3 32 3Z',
  star: 'M28.8 10.2 Q32.0 4.0 35.2 10.2 L38.8 17.0 Q41.1 21.5 46.0 22.3 L53.6 23.6 Q60.5 24.7 55.6 29.7 L50.2 35.2 Q46.7 38.8 47.5 43.7 L48.6 51.3 Q49.6 58.3 43.4 55.2 L36.5 51.7 Q32.0 49.5 27.5 51.7 L20.6 55.2 Q14.4 58.3 15.4 51.3 L16.5 43.7 Q17.3 38.8 13.8 35.2 L8.4 29.7 Q3.5 24.7 10.4 23.6 L18.0 22.3 Q22.9 21.5 25.2 17.0Z',
};
// Where the eyes sit per shape: the visual centre, not the box centre.
const EYES = { round: [32, 32], tilt: [31, 31], square: [32, 32], wide: [32, 32], triangle: [32, 40], hex: [32, 33], cloud: [34, 39], drop: [32, 40], star: [32, 36] };
// Where the light lands per shape: the specular sits on the upper-left shoulder of the body.
const SHINE = { round: [23, 19], tilt: [25, 20], square: [22, 19], wide: [22, 21], triangle: [28, 30], hex: [24, 20], cloud: [30, 20], drop: [26, 30], star: [27, 25] };

/** The body of a shape: one path, or for the cloud the round parts it is made of (every edge of
 *  it a curve). Used twice per face, as the fill and as the clip. */
function body(shape, props = {}) {
  if (shape === 'cloud') {
    return (
      <g {...props}>
        <rect x="8" y="40" width="48" height="18" rx="9" />
        <circle cx="22" cy="34" r="13" />
        <circle cx="37" cy="27" r="17" />
        <circle cx="50" cy="38" r="11" />
      </g>
    );
  }
  return <path d={PATHS[shape] || PATHS.round} {...props} />;
}

function mix(hex, to, t) {
  const n = parseInt(hex.slice(1), 16); const m = parseInt(to.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - t) + ((m >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function Blob({ shape = 'round', color = 'blue', size = 32 }) {
  const [cx, cy] = EYES[shape] || [32, 32];
  const [sx, sy] = SHINE[shape] || [23, 19];
  const base = COLORS[color] || COLORS.blue;
  const light = mix(base, '#ffffff', 0.42);
  const deep = mix(base, '#000000', 0.3);
  // Ids by shape and colour, not by instance: two faces alike define the same paint, so a page
  // with many of them (or one rendered outside a React root) resolves every reference to an
  // identical definition, whichever came first.
  const uid = `${shape}-${color}`;
  const ids = { body: `wpb-${uid}`, rim: `wpr-${uid}`, clip: `wpc-${shape}`, blur: 'wp-blur', shadow: `wps-${uid}` };
  const eye = (dx) => (
    <g transform={`rotate(-12 ${cx + dx} ${cy})`}>
      <rect x={cx + dx - 3} y={cy - 6.2} width="6" height="14" rx="3" fill="#000" opacity="0.18" />
      <rect x={cx + dx - 3} y={cy - 7} width="6" height="14" rx="3" fill="#fff" />
    </g>
  );
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" overflow="visible">
      <defs>
        <radialGradient id={ids.body} gradientUnits="userSpaceOnUse" cx="22" cy="17" r="52">
          <stop offset="0" stopColor={light} />
          <stop offset="0.48" stopColor={base} />
          <stop offset="1" stopColor={deep} />
        </radialGradient>
        <linearGradient id={ids.rim} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="64">
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.28" />
        </linearGradient>
        <clipPath id={ids.clip}>{body(shape)}</clipPath>
        <filter id={ids.blur} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" /></filter>
        <filter id={ids.shadow} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor={deep} floodOpacity="0.35" />
        </filter>
      </defs>
      {body(shape, { fill: `url(#${ids.body})`, filter: `url(#${ids.shadow})` })}
      <g clipPath={`url(#${ids.clip})`}>
        <ellipse cx="32" cy="63" rx="30" ry="12" fill={deep} opacity="0.22" filter={`url(#${ids.blur})`} />
        {body(shape, { fill: `url(#${ids.rim})` })}
        <ellipse cx={sx} cy={sy} rx="10" ry="6.5" fill="#fff" opacity="0.55" filter={`url(#${ids.blur})`} />
        <ellipse cx={sx - 2} cy={sy - 2} rx="4" ry="2.4" fill="#fff" opacity="0.7" />
      </g>
      {eye(-8)}{eye(8)}
    </svg>
  );
}

/** A teammate's face. `avatar` is {shape, color}, a legacy name, or nothing (a stable pick by id). */
export function Avatar({ avatar, id, size = 32, className = '', title, working = false }) {
  const a = avatarOf(avatar, id || '');
  return (
    <span className={`wp-avatar${working ? ' is-working' : ''}${className ? ' ' + className : ''}`}
          style={{ width: size, height: size }} title={title} data-shape={a.shape} data-color={a.color}
          role={title ? 'img' : undefined} aria-label={title}>
      <Blob shape={a.shape} color={a.color} size={size} />
    </span>
  );
}

/** A person: their initials on a soft grey disc. */
export function MemberAvatar({ name, size = 32, className = '' }) {
  const parts = String(name || '?').replace(/@.*/, '').trim().split(/[\s._-]+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
  return (
    <span className={`wp-avatar is-member${className ? ' ' + className : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** A group: up to three member faces in a small cluster. */
export function ClusterAvatar({ members = [], size = 32 }) {
  const faces = members.slice(0, 3);
  if (!faces.length) return <span className="wp-avatar is-cluster is-empty" style={{ width: size, height: size }} aria-hidden="true">#</span>;
  const small = Math.round(size * 0.62);
  return (
    <span className="wp-avatar is-cluster" style={{ width: size, height: size }} aria-hidden="true">
      {faces.map((t, i) => (
        <span key={t.id || i} className={`wp-cluster-${faces.length}-${i}`} style={{ width: small, height: small }}>
          <Blob shape={avatarOf(t.avatar, t.id).shape} color={avatarOf(t.avatar, t.id).color} size={small} />
        </span>
      ))}
    </span>
  );
}
