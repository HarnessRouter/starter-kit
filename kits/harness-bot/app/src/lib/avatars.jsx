// The faces: the Harness Bot mascot, animated, in the kit's six colours. Each is a 256px loop on
// white, drawn in a circle the way a profile photo is, so it reads on any background (the grey
// room list, the white room, a dark page around an embedded app) and is the same face at 20px in a
// menu and at 96px on the creation screen. Someone who asked their system for less motion gets the first frame, still.
import React from 'react';
import { COLOR_IDS, COLOR_LABELS, avatarOf, DEFAULT_AVATAR, RECRUITER_AVATAR } from './faces.js';
import amber from '../assets/faces/harness-bot-amber.gif';
import blue from '../assets/faces/harness-bot-blue.gif';
import coral from '../assets/faces/harness-bot-coral.gif';
import green from '../assets/faces/harness-bot-green.gif';
import teal from '../assets/faces/harness-bot-teal.gif';
import violet from '../assets/faces/harness-bot-violet.gif';
import amberStill from '../assets/faces/harness-bot-amber-still.png';
import blueStill from '../assets/faces/harness-bot-blue-still.png';
import coralStill from '../assets/faces/harness-bot-coral-still.png';
import greenStill from '../assets/faces/harness-bot-green-still.png';
import tealStill from '../assets/faces/harness-bot-teal-still.png';
import violetStill from '../assets/faces/harness-bot-violet-still.png';
export { COLOR_IDS, COLOR_LABELS, avatarOf, DEFAULT_AVATAR, RECRUITER_AVATAR };

const FACES = {
  amber: [amber, amberStill], blue: [blue, blueStill], coral: [coral, coralStill],
  green: [green, greenStill], teal: [teal, tealStill], violet: [violet, violetStill],
};

/** One face, in its circle. */
export function Face({ color = 'blue', size = 32 }) {
  const [moving, still] = FACES[color] || FACES.blue;
  return (
    <span className="wp-face" style={{ width: size, height: size }}>
      <picture>
        <source srcSet={still} media="(prefers-reduced-motion: reduce)" />
        <img src={moving} alt="" draggable={false} decoding="async" />
      </picture>
    </span>
  );
}

/** A teammate's face. `avatar` is {color}, anything stored before the six, or nothing (a stable
 *  pick by id). */
export function Avatar({ avatar, id, size = 32, className = '', title, working = false }) {
  const a = avatarOf(avatar, id || '');
  return (
    <span className={`wp-avatar${working ? ' is-working' : ''}${className ? ' ' + className : ''}`}
          style={{ width: size, height: size }} title={title} data-color={a.color}
          role={title ? 'img' : undefined} aria-label={title}>
      <Face color={a.color} size={size} />
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
          <Face color={avatarOf(t.avatar, t.id).color} size={small} />
        </span>
      ))}
    </span>
  );
}
