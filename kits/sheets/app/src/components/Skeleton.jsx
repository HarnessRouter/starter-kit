/*
 * Skeleton — reusable pulsing placeholders shaped like the eventual content so
 * data arriving causes NO layout shift. Light theme, subtle opacity pulse on
 * var(--line) (matches the studio graph view's skeleton feel). Respects
 * prefers-reduced-motion (pulse disabled in CSS).
 *
 * Base primitive:
 *   <Skeleton variant="line|card|thumbnail|avatar|table-row" w h radius />
 * Composed helpers (mirror real layouts 1:1):
 *   <SkeletonGraphCards count/>   — .gcard grid placeholders
 *   <SkeletonTableRows count/>    — <tr> rows for the .gtable body
 *   <SkeletonTemplateCards count/>— carousel template cards
 */
import React from 'react';

export function Skeleton({ variant = 'line', w, h, radius, className = '', style }) {
  const cls = `sk sk-${variant}${className ? ' ' + className : ''}`;
  const s = { ...(style || {}) };
  if (w != null) s.width = typeof w === 'number' ? `${w}px` : w;
  if (h != null) s.height = typeof h === 'number' ? `${h}px` : h;
  if (radius != null) s.borderRadius = typeof radius === 'number' ? `${radius}px` : radius;
  return <span className={cls} style={s} aria-hidden="true" />;
}

// One graph card: thumbnail block + a name bar, matching .gcard / .gcard-foot.
function GraphCardSkel() {
  return (
    <div className="gcard" aria-hidden="true">
      <Skeleton variant="thumbnail" />
      <span className="gcard-foot">
        <Skeleton variant="line" w="60%" h={12} />
      </span>
    </div>
  );
}

export function SkeletonGraphCards({ count = 8 }) {
  return (
    <div className="ggrid" aria-busy="true" aria-label="Loading graphs">
      {Array.from({ length: count }).map((_, i) => <GraphCardSkel key={i} />)}
    </div>
  );
}

export function SkeletonTemplateCards({ count = 6 }) {
  return (
    <div className="carousel-wrap">
      <div className="carousel" aria-busy="true" aria-label="Loading templates">
        {Array.from({ length: count }).map((_, i) => <GraphCardSkel key={i} />)}
      </div>
    </div>
  );
}

// Chat history placeholder — a few message bubbles (assistant/user alternating)
// shaped like the real .msg rows so history loads without a jump.
export function SkeletonChatHistory() {
  const rows = [
    { who: 'assistant', lines: ['86%', '64%'] },
    { who: 'user', lines: ['52%'] },
    { who: 'assistant', lines: ['78%', '90%', '46%'] },
  ];
  return (
    <div className="chat-skel" aria-busy="true" aria-label="Loading conversation">
      {rows.map((r, i) => (
        <div key={i} className={'msg sk-msg ' + r.who} aria-hidden="true">
          {r.lines.map((w, j) => <Skeleton key={j} variant="line" w={w} h={11} />)}
        </div>
      ))}
    </div>
  );
}

// A quiet graph-canvas placeholder — a few faint node circles joined by lines,
// pulsing softly. Used while a graph's metadata loads (before the real explorer
// mounts and shows its own dual-pane skeleton).
export function SkeletonGraphCanvas() {
  return (
    <div className="sk-canvas" aria-busy="true" aria-label="Loading graph">
      <svg className="sk-canvas-glyph" width="200" height="120" viewBox="0 0 200 120" aria-hidden="true">
        <g className="sk-canvas-edges" stroke="var(--line)" strokeWidth="2" fill="none">
          <path d="M42 78 L100 30" />
          <path d="M100 30 L158 78" />
          <path d="M42 78 L158 78" />
        </g>
        <g className="sk-canvas-nodes" fill="var(--line)">
          <circle cx="42" cy="78" r="14" />
          <circle cx="100" cy="30" r="14" />
          <circle cx="158" cy="78" r="14" />
        </g>
      </svg>
    </div>
  );
}

// Table rows shaped like the real .gtable body: thumb + name, last-viewed,
// access stack, actions. Widths vary per row so it reads as content, not a grid.
export function SkeletonTableRows({ count = 6 }) {
  const names = ['62%', '48%', '70%', '54%', '44%', '66%'];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="gt-skel-row" aria-hidden="true">
          <td>
            <span className="gt-name">
              <span className="gt-thumb"><Skeleton variant="thumbnail" /></span>
              <Skeleton variant="line" w={names[i % names.length]} h={12} />
            </span>
          </td>
          <td className="gt-last col-last"><Skeleton variant="line" w={64} h={11} /></td>
          <td className="col-access">
            <span className="gt-skel-avs">
              <Skeleton variant="avatar" w={24} h={24} />
              <Skeleton variant="avatar" w={24} h={24} />
            </span>
          </td>
          <td className="gt-actions" />
        </tr>
      ))}
    </>
  );
}
