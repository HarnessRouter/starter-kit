// The faces. Twelve characters drawn here, once, as SVG: a teammate's face is part of the kit,
// not a picture fetched from somewhere, so it is the same on every instance, needs no network,
// and scales from the 22px sidebar dot to the 96px reveal. The recruiter picks one by name; the
// person can change it before the teammate joins.
//
// One visual grammar for all twelve — a tinted disc, a big soft head, white eyes with a dark
// pupil and a highlight, a small smile — so a room full of them reads as one team.
import React from 'react';
import { AVATAR_IDS, avatarOf } from './faces.js';
export { AVATAR_IDS, avatarOf };

const Eye = ({ x, y, r = 5 }) => (
  <>
    <circle cx={x} cy={y} r={r} fill="#fff" />
    <circle cx={x + r * 0.15} cy={y + r * 0.12} r={r * 0.48} fill="#1F1B2E" />
    <circle cx={x - r * 0.15} cy={y - r * 0.25} r={r * 0.18} fill="#fff" />
  </>
);
const Blush = ({ y = 42, dx = 13 }) => (
  <>
    <ellipse cx={32 - dx} cy={y} rx="3.5" ry="2" fill="#F87171" opacity=".45" />
    <ellipse cx={32 + dx} cy={y} rx="3.5" ry="2" fill="#F87171" opacity=".45" />
  </>
);
const Smile = ({ y = 44, w = 5, ink = '#1F1B2E' }) => (
  <path d={`M${32 - w} ${y} Q32 ${y + w * 0.9} ${32 + w} ${y}`} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
);

export const AVATARS = {
  fox: { label: 'Fox', tint: '#FFEDD5', draw: () => (
    <>
      <path d="M14 24 L21 11 L30 22 L34 22 L43 11 L50 24 C52 40 43 53 32 53 C21 53 12 40 14 24Z" fill="#F97316" />
      <path d="M18 24 L22 16 L27 23Z" fill="#C2410C" /><path d="M46 24 L42 16 L37 23Z" fill="#C2410C" />
      <path d="M19 36 C22 48 42 48 45 36 C40 41 24 41 19 36Z" fill="#FFF7ED" />
      <Eye x={25} y={33} /><Eye x={39} y={33} />
      <circle cx="32" cy="42" r="2.4" fill="#1F1B2E" /><Smile y={45} w={3} />
    </>
  ) },
  owl: { label: 'Owl', tint: '#EDE9FE', draw: () => (
    <>
      <path d="M17 22 L14 9 L25 17Z" fill="#7C3AED" /><path d="M47 22 L50 9 L39 17Z" fill="#7C3AED" />
      <ellipse cx="32" cy="35" rx="19" ry="20" fill="#8B5CF6" />
      <ellipse cx="32" cy="46" rx="9" ry="6" fill="#C4B5FD" />
      <circle cx="24" cy="31" r="8.5" fill="#EDE9FE" /><circle cx="40" cy="31" r="8.5" fill="#EDE9FE" />
      <Eye x={24} y={31} r={5.5} /><Eye x={40} y={31} r={5.5} />
      <path d="M32 37 L28.5 41.5 L35.5 41.5Z" fill="#F59E0B" />
    </>
  ) },
  cat: { label: 'Cat', tint: '#E2E8F0', draw: () => (
    <>
      <path d="M15 27 L16 9 L30 19Z" fill="#64748B" /><path d="M49 27 L48 9 L34 19Z" fill="#64748B" />
      <path d="M18 24 L19 14 L27 20Z" fill="#F9A8D4" /><path d="M46 24 L45 14 L37 20Z" fill="#F9A8D4" />
      <circle cx="32" cy="35" r="19" fill="#64748B" />
      <Eye x={25} y={33} /><Eye x={39} y={33} />
      <path d="M29.5 40 L34.5 40 L32 43Z" fill="#F9A8D4" />
      <path d="M32 43 Q29 47 26 45 M32 43 Q35 47 38 45" fill="none" stroke="#1F1B2E" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 38 L22 40 M12 44 L22 43 M52 38 L42 40 M52 44 L42 43" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ) },
  bear: { label: 'Bear', tint: '#FEF3C7', draw: () => (
    <>
      <circle cx="16" cy="20" r="7.5" fill="#A16207" /><circle cx="48" cy="20" r="7.5" fill="#A16207" />
      <circle cx="16" cy="20" r="3.5" fill="#D97706" /><circle cx="48" cy="20" r="3.5" fill="#D97706" />
      <circle cx="32" cy="36" r="19" fill="#A16207" />
      <ellipse cx="32" cy="43" rx="9.5" ry="7" fill="#FDE68A" />
      <Eye x={25} y={32} /><Eye x={39} y={32} />
      <ellipse cx="32" cy="41" rx="3.5" ry="2.5" fill="#1F1B2E" /><Smile y={46} w={3} />
    </>
  ) },
  panda: { label: 'Panda', tint: '#F1F5F9', draw: () => (
    <>
      <circle cx="17" cy="19" r="7.5" fill="#1F1B2E" /><circle cx="47" cy="19" r="7.5" fill="#1F1B2E" />
      <circle cx="32" cy="36" r="19" fill="#fff" />
      <ellipse cx="24.5" cy="34" rx="6.5" ry="7.5" fill="#1F1B2E" transform="rotate(-15 24.5 34)" />
      <ellipse cx="39.5" cy="34" rx="6.5" ry="7.5" fill="#1F1B2E" transform="rotate(15 39.5 34)" />
      <Eye x={25} y={34} r={3.2} /><Eye x={39} y={34} r={3.2} />
      <ellipse cx="32" cy="43" rx="3.2" ry="2.2" fill="#1F1B2E" /><Smile y={47} w={3} />
    </>
  ) },
  robot: { label: 'Robot', tint: '#E0F2FE', draw: () => (
    <>
      <line x1="32" y1="18" x2="32" y2="11" stroke="#0F172A" strokeWidth="2" /><circle cx="32" cy="9" r="3" fill="#F59E0B" />
      <rect x="13" y="18" width="38" height="33" rx="9" fill="#38BDF8" />
      <rect x="9" y="30" width="5" height="9" rx="2" fill="#0EA5E9" /><rect x="50" y="30" width="5" height="9" rx="2" fill="#0EA5E9" />
      <rect x="18" y="24" width="28" height="15" rx="5" fill="#0F172A" />
      <circle cx="26" cy="31.5" r="3.2" fill="#7DD3FC" /><circle cx="38" cy="31.5" r="3.2" fill="#7DD3FC" />
      <rect x="24" y="43" width="16" height="3.5" rx="1.75" fill="#0F172A" />
      <rect x="27" y="43" width="2" height="3.5" fill="#38BDF8" /><rect x="35" y="43" width="2" height="3.5" fill="#38BDF8" />
    </>
  ) },
  koala: { label: 'Koala', tint: '#F3F4F6', draw: () => (
    <>
      <circle cx="13" cy="27" r="10" fill="#9CA3AF" /><circle cx="51" cy="27" r="10" fill="#9CA3AF" />
      <circle cx="13" cy="27" r="5.5" fill="#E5E7EB" /><circle cx="51" cy="27" r="5.5" fill="#E5E7EB" />
      <circle cx="32" cy="36" r="18" fill="#9CA3AF" />
      <Eye x={25} y={32} r={4.5} /><Eye x={39} y={32} r={4.5} />
      <ellipse cx="32" cy="41" rx="6" ry="4.5" fill="#1F1B2E" /><Smile y={49} w={3} />
    </>
  ) },
  penguin: { label: 'Penguin', tint: '#E2E8F0', draw: () => (
    <>
      <ellipse cx="32" cy="35" rx="18" ry="21" fill="#1E293B" />
      <ellipse cx="12" cy="40" rx="4" ry="9" fill="#1E293B" transform="rotate(20 12 40)" /><ellipse cx="52" cy="40" rx="4" ry="9" fill="#1E293B" transform="rotate(-20 52 40)" />
      <ellipse cx="32" cy="40" rx="12" ry="14" fill="#F8FAFC" />
      <Eye x={26} y={30} r={4.5} /><Eye x={38} y={30} r={4.5} />
      <path d="M32 35 L27 38.5 L37 38.5Z" fill="#F59E0B" />
      <ellipse cx="26" cy="56" rx="5" ry="2.5" fill="#F59E0B" /><ellipse cx="38" cy="56" rx="5" ry="2.5" fill="#F59E0B" />
    </>
  ) },
  bunny: { label: 'Bunny', tint: '#FCE7F3', draw: () => (
    <>
      <ellipse cx="23" cy="15" rx="5.5" ry="13" fill="#F9A8D4" /><ellipse cx="41" cy="15" rx="5.5" ry="13" fill="#F9A8D4" />
      <ellipse cx="23" cy="15" rx="2.5" ry="9" fill="#FBCFE8" /><ellipse cx="41" cy="15" rx="2.5" ry="9" fill="#FBCFE8" />
      <circle cx="32" cy="37" r="18" fill="#F9A8D4" />
      <Eye x={25} y={34} /><Eye x={39} y={34} />
      <ellipse cx="32" cy="41" rx="2.5" ry="1.8" fill="#BE185D" />
      <rect x="29" y="43" width="2.8" height="4" rx="1" fill="#fff" /><rect x="32.2" y="43" width="2.8" height="4" rx="1" fill="#fff" />
      <Blush y={44} dx={12} />
    </>
  ) },
  frog: { label: 'Frog', tint: '#DCFCE7', draw: () => (
    <>
      <circle cx="21" cy="23" r="8" fill="#22C55E" /><circle cx="43" cy="23" r="8" fill="#22C55E" />
      <ellipse cx="32" cy="39" rx="20" ry="15" fill="#22C55E" />
      <Eye x={21} y={23} r={5} /><Eye x={43} y={23} r={5} />
      <path d="M22 41 Q32 50 42 41" fill="none" stroke="#14532D" strokeWidth="2.2" strokeLinecap="round" />
      <Blush y={40} dx={15} />
    </>
  ) },
  whale: { label: 'Whale', tint: '#DBEAFE', draw: () => (
    <>
      <path d="M29 20 C27 13 23 11 20 9 M35 20 C37 13 41 11 44 9" fill="none" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M10 37 C10 24 20 19 32 19 C46 19 54 27 54 37 C54 47 44 53 32 53 C20 53 10 47 10 37Z" fill="#3B82F6" />
      <path d="M50 42 C56 38 60 42 58 48 C54 46 50 46 50 42Z" fill="#3B82F6" />
      <path d="M15 42 C21 50 43 50 49 42 C43 46 21 46 15 42Z" fill="#BFDBFE" />
      <Eye x={24} y={35} r={4.5} /><Eye x={40} y={35} r={4.5} />
      <Smile y={43} w={3} ink="#1E3A8A" />
    </>
  ) },
  sloth: { label: 'Sloth', tint: '#F5EBE0', draw: () => (
    <>
      <circle cx="32" cy="36" r="19" fill="#B08968" />
      <ellipse cx="32" cy="38" rx="14" ry="12" fill="#E7D3BD" />
      <path d="M17 31 C22 26 28 30 31 36 C27 38 20 37 17 31Z" fill="#6B4F3A" /><path d="M47 31 C42 26 36 30 33 36 C37 38 44 37 47 31Z" fill="#6B4F3A" />
      <Eye x={24} y={33} r={3.5} /><Eye x={40} y={33} r={3.5} />
      <ellipse cx="32" cy="41" rx="3" ry="2" fill="#1F1B2E" />
      <path d="M25 45 Q32 50 39 45" fill="none" stroke="#1F1B2E" strokeWidth="2" strokeLinecap="round" />
    </>
  ) },
};

export function Avatar({ id, size = 32, className = '', title, working = false }) {
  const key = avatarOf(id, id);
  const a = AVATARS[key];
  return (
    <span className={`wp-avatar${working ? ' is-working' : ''}${className ? ' ' + className : ''}`}
          style={{ width: size, height: size }} title={title} data-avatar={key} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-label={title}>
        <circle cx="32" cy="32" r="32" fill={a.tint} />
        {a.draw()}
      </svg>
    </span>
  );
}

/** A person: their initials on the brand colour. */
export function MemberAvatar({ name, size = 32, className = '' }) {
  const parts = String(name || '?').replace(/@.*/, '').trim().split(/[\s._-]+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
  return (
    <span className={`wp-avatar is-member${className ? ' ' + className : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {initials}
    </span>
  );
}
