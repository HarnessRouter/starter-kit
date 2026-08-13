// Print surface — every slide as a full 1920×1080 stage, stacked, no chrome.
// The export endpoint injects the deck as window.__DECK__ and prints this
// page headlessly; sl-print-ready on <body> signals charts/diagrams settled.
import { useEffect, useState } from 'react';
import { SlideStage } from 'reifyui/slides';

export function PrintPage() {
  const deck = window.__DECK__;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setReady(true); document.body.classList.add('sl-print-ready'); }, 2500);
    return () => clearTimeout(t);
  }, []);
  if (!deck) return <div style={{ padding: 40 }}>No deck loaded.</div>;
  return (
    <div className="sl-print-root" data-ready={ready ? '1' : ''}>
      {(deck.slides || []).map((s) => (
        <div key={s.id} style={{ width: 1920, height: 1080, overflow: 'hidden', pageBreakAfter: 'always', position: 'relative' }}>
          <SlideStage slide={s} theme={deck.theme} />
        </div>
      ))}
    </div>
  );
}
