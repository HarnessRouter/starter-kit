// The blob mascots. One family of shapes, each with the same two white eye slits, in the kit's
// ten colours. Drawn here once so a face is the same at 20px in the sidebar and at 96px on the
// creation screen, and needs no network.
import React from 'react';
import { COLORS, SHAPES, SHAPE_LABELS, COLOR_IDS, avatarOf, DEFAULT_AVATAR } from './faces.js';
export { COLORS, SHAPES, SHAPE_LABELS, COLOR_IDS, avatarOf, DEFAULT_AVATAR };

// Every shape fills roughly the same area of the 64 by 64 box, so a row of them sits level.
const PATHS = {
  round: 'M32 4a28 28 0 1 1 0 56a28 28 0 1 1 0-56Z',
  tilt: 'M20.5 6.2 43.5 9.4a12 12 0 0 1 10.3 13.5l-3.2 23a12 12 0 0 1-13.5 10.3l-23-3.2A12 12 0 0 1 3.8 39.5l3.2-23A12 12 0 0 1 20.5 6.2Z',
  square: 'M18 6h28a12 12 0 0 1 12 12v28a12 12 0 0 1-12 12H18A12 12 0 0 1 6 46V18A12 12 0 0 1 18 6Z',
  wide: 'M32 10c17 0 30 9.8 30 22S49 54 32 54 2 44.2 2 32 15 10 32 10Z',
  triangle: 'M27.4 8.6a5.4 5.4 0 0 1 9.2 0l24 39.8A5.4 5.4 0 0 1 56 56.6H8a5.4 5.4 0 0 1-4.6-8.2Z',
  hex: 'M28.5 4.4a7 7 0 0 1 7 0l19.4 11.2a7 7 0 0 1 3.5 6.1v22.4a7 7 0 0 1-3.5 6.1L35.5 61.4a7 7 0 0 1-7 0L9.1 50.2a7 7 0 0 1-3.5-6.1V21.7a7 7 0 0 1 3.5-6.1Z',
  cloud: 'M20 54a14 14 0 0 1-3.2-27.6A17 17 0 0 1 49 22.2 12 12 0 0 1 47 46a12 12 0 0 1-2 0H20Z',
  drop: 'M32 3c2 0 4 1.6 6.6 5.2C46.2 18.6 56 31 56 40a24 24 0 1 1-48 0c0-9 9.8-21.4 17.4-31.8C28 4.6 30 3 32 3Z',
};
// Where the eyes sit per shape: the visual centre, not the box centre.
const EYES = { round: [32, 32], tilt: [31, 31], square: [32, 32], wide: [32, 32], triangle: [32, 40], hex: [32, 33], cloud: [33, 37], drop: [32, 40] };

export function Blob({ shape = 'round', color = 'blue', size = 32 }) {
  const [cx, cy] = EYES[shape] || [32, 32];
  const fill = COLORS[color] || COLORS.blue;
  const eye = (dx) => (
    <rect x={cx + dx - 3} y={cy - 7} width="6" height="14" rx="3" fill="#fff" opacity="0.95"
          transform={`rotate(-12 ${cx + dx} ${cy})`} />
  );
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path d={PATHS[shape] || PATHS.round} fill={fill} />
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
