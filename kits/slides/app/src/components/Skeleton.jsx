/*
 * Skeletons — placeholders shaped like the content that is coming, so data arriving causes NO
 * layout shift. The pulsing block itself is the package's (.uic-skel, styles/library.css); what
 * is here is only the SHAPES this product's lists have.
 *
 * Nothing below guesses a quantity that will later turn out to be wrong: a row count is the
 * shape of a list, not a claim about how many decks you have.
 */
import React from 'react';

/** One pulsing block. `w`/`h`/`radius` accept a number (px) or any CSS length. */
export function Skeleton({ w, h, radius, className = '', style }) {
  const s = { ...(style || {}) };
  if (w != null) s.width = typeof w === 'number' ? `${w}px` : w;
  if (h != null) s.height = typeof h === 'number' ? `${h}px` : h;
  if (radius != null) s.borderRadius = typeof radius === 'number' ? `${radius}px` : radius;
  return <span className={`uic-skel${className ? ' ' + className : ''}`} style={s} aria-hidden="true" />;
}

// A card placeholder riding the real .uic-card box: 16:9 art, then a name bar.
function CardSkel() {
  return (
    <div className="uic-card is-skel" aria-hidden="true">
      <div className="uic-card-main">
        <span className="uic-card-art"><Skeleton w="100%" h="100%" radius={0} /></span>
        <span className="uic-card-foot"><Skeleton w="60%" h={12} /></span>
      </div>
    </div>
  );
}

export function SkeletonTemplateCards({ count = 6 }) {
  // The carousel's own markup, without the nav buttons: there is nothing to scroll to yet.
  return (
    <div className="uic-carousel-wrap">
      <div className="uic-carousel" aria-busy="true" aria-label="Loading templates">
        {Array.from({ length: count }).map((_, i) => <CardSkel key={i} />)}
      </div>
    </div>
  );
}

/** Rows shaped like the real table body: thumb + name, last viewed, actions. Widths vary per
 *  row so it reads as content rather than as a grid. */
export function SkeletonTableRows({ count = 6 }) {
  const names = ['62%', '48%', '70%', '54%', '44%', '66%'];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="sl-skel-row" aria-hidden="true">
          <td>
            <span className="uic-table-name">
              <span className="uic-table-thumb"><Skeleton w="100%" h="100%" radius={0} /></span>
              <Skeleton w={names[i % names.length]} h={12} />
            </span>
          </td>
          <td className="uic-col-last"><Skeleton w={64} h={11} /></td>
          <td className="uic-table-actions" />
        </tr>
      ))}
    </>
  );
}

/** The deck page while the agent is still writing deck.json.
 *
 *  Shaped like the thing that is coming — a filmstrip of slide thumbs beside a 16:9 stage — so the
 *  wait reads as "your deck is being built here" rather than as an empty pane with a sentence in
 *  it. The slide count is NOT guessed: four placeholders is the shape of the layout, not a claim
 *  about how many slides you will get, so nothing here can turn out to be wrong.
 */
export function SkeletonDeck({ note }) {
  return (
    <div className="sl-skel-deck" aria-busy="true" aria-live="polite">
      <div className="sl-skel-rail" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="sl-skel-thumb"><Skeleton w="100%" h="100%" radius={6} /></span>
        ))}
      </div>
      <div className="sl-skel-stage">
        <Skeleton className="sl-skel-slide" radius={10} />
        {note && <p className="sl-skel-note">{note}</p>}
      </div>
    </div>
  );
}
