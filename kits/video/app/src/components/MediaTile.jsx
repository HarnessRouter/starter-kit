// A fixed-ratio tile with a poster, a duration and its state.
//
// ── TEMPORARY, AND DELIBERATELY SO ──────────────────────────────────────────────────────────────
// This belongs in reifyui, not here: slides, sheets and dashboards all want the same tile for an
// attached artifact, and nothing about it is specific to video. It is written to the exact prop
// contract that was agreed for `reifyui`'s `<MediaTile poster duration state label onClick />`, so
// replacing it is one import line in each of its two callers (TimelineStrip, Landing) and deleting
// this file. It is here only because this app has to render today and that package is being
// changed by someone else tonight.
// ────────────────────────────────────────────────────────────────────────────────────────────────
//
// Three real states and no fourth. `rendering` is a shape with no picture in it, because there IS
// no picture yet; it is never a stock frame or a blurred stand-in, both of which read as "your
// clip is here" to someone glancing at a board.
import { AlertTriangle, Film } from 'lucide-react';

const STATES = new Set(['rendering', 'ready', 'failed']);

export function MediaTile({ poster, video, duration, state = 'ready', label, onClick,
                            className = '' }) {
  const s = STATES.has(state) ? state : 'ready';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`vd-tile is-${s} ${className}`}
      onClick={onClick}
      aria-label={onClick ? label : undefined}
    >
      {/* THE FIRST FRAME IS A PICTURE OF THE FILM, and a <video> paints its own without anyone
          rendering a poster: metadata only, so this costs a range request rather than the clip.
          It is used when no separate poster exists, which is every clip these models return —
          which is why a list of finished films was a column of identical grey icons. */}
      {s === 'ready' && (poster || video)
        ? (poster
          ? <img className="vd-tile-img" src={poster} alt="" loading="lazy" />
          : <video className="vd-tile-img" src={video} preload="metadata" muted playsInline
                   tabIndex={-1} aria-hidden="true" />)
        : (
          <span className="vd-tile-blank" aria-hidden="true">
            {s === 'failed' ? <AlertTriangle size={15} /> : <Film size={15} />}
          </span>
        )}
      {s === 'rendering' && <span className="vd-tile-shimmer" aria-hidden="true" />}
      {/* A duration only when one has been measured — durationLabel gives '—' otherwise, and a
          dash is the honest thing to show while a clip is still being made. */}
      {duration && <span className="vd-tile-dur">{duration}</span>}
    </Tag>
  );
}
