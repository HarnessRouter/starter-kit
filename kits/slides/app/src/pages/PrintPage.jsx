// The print surface: every slide at true 1920×1080, one per page, no chrome.
//
// Printed by the browser, so the PDF comes out of the same components the canvas uses — text
// stays selectable, charts and diagrams stay vector. The only real engineering here is knowing
// WHEN to print: charts and diagrams mount lazily, and a fixed timer either prints empty boxes or
// makes everyone wait for the slowest imaginable deck.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SlideStage } from 'reifyui/slides';
import { getDeck, workspaceFileIndex } from '../lib/sl';
import { buildSrcResolver } from '../lib/srcResolver';

/** How many SVG roots and highlighted code blocks this deck MUST produce before printing is safe.
 *
 *  Derived from the deck itself, so "nothing to wait for" and "hasn't started yet" stop looking
 *  identical — which is exactly why a fixed timer prints empty chart boxes. */
function expectations(deck) {
  const els = (deck?.slides || []).flatMap((s) => s.elements || []);
  return {
    svg: els.filter((e) => e.type === 'chart' || e.type === 'flowchart'
      || (e.type === 'shape' && ['line', 'arrow'].includes(e.content?.kind))
      || (e.type === 'embed' && /<svg/i.test(e.content?.html || ''))).length,
    code: els.filter((e) => e.type === 'code').length,
  };
}

async function settle(root, want, onProgress, ceiling = 20000) {
  const deadline = Date.now() + ceiling;
  try { await document.fonts?.ready; } catch { /* no font faces */ }
  await Promise.all([...root.querySelectorAll('img')].map((im) => (im.complete ? null
    : new Promise((r) => {
      im.addEventListener('load', r, { once: true });
      im.addEventListener('error', r, { once: true });
    }))));

  let last = -1;
  let stable = Date.now();
  for (;;) {
    const svg = root.querySelectorAll('.sl-stage svg').length;
    const code = root.querySelectorAll('.sl-stage code.hljs').length;
    onProgress({ svg, code });
    const n = svg + code;
    if (n !== last) { last = n; stable = Date.now(); }
    // The count AND ~600ms of quiet: echarts mounts its <svg> before it has finished drawing into
    // it, so "the element exists" is not "the element is done".
    else if (svg >= want.svg && code >= want.code && Date.now() - stable > 600) return true;
    if (Date.now() > deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function PrintPage({ handoff, id }) {
  const [deck, setDeck] = useState(null);
  const [resolveSrc, setResolveSrc] = useState(() => (s) => s);
  const [state, setState] = useState('loading');   // loading | waiting | ready | incomplete | error
  const [seen, setSeen] = useState({ svg: 0, code: 0 });
  const [msg, setMsg] = useState('');
  const rootRef = useRef(null);
  const want = useMemo(() => expectations(deck), [deck]);

  useEffect(() => {
    let dead = false;
    (async () => {
      // window.__DECK__ keeps this route drivable by a headless renderer, should one ever exist.
      let d = window.__DECK__ || null;
      let sid = id;
      if (!d && handoff) {
        const raw = window.localStorage.getItem(handoff);
        window.localStorage.removeItem(handoff);
        if (raw) { const p = JSON.parse(raw); d = p.deck; sid = p.id || sid; }
      }
      if (!d && sid) d = (await getDeck(sid)).deck;
      if (dead) return;
      if (!d?.slides?.length) { setState('error'); setMsg('There is no deck to print.'); return; }
      if (sid && !String(sid).startsWith('new:')) {
        const idx = await workspaceFileIndex(sid).catch(() => null);
        if (!dead && idx) setResolveSrc(() => buildSrcResolver(idx));
      }
      if (!dead) { setDeck(d); setState('waiting'); }
    })().catch((e) => {
      if (!dead) { setState('error'); setMsg(e.message || 'Could not load this deck.'); }
    });
    return () => { dead = true; };
  }, [handoff, id]);

  useEffect(() => {
    if (state !== 'waiting' || !rootRef.current) return undefined;
    let dead = false;
    settle(rootRef.current, want, (s) => { if (!dead) setSeen(s); }).then((ok) => {
      if (dead) return;
      if (ok) { setState('ready'); window.print(); } else setState('incomplete');
      // Not settled means DO NOT print. Quietly printing empty chart boxes is the failure this
      // detector exists to prevent.
    });
    return () => { dead = true; };
  }, [state, want]);

  // Fit the 1920px page to the window on screen; inert in print.
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      if (el) el.style.setProperty('--sl-print-scale', String(Math.min(1, (window.innerWidth - 48) / 1920)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [deck]);

  const total = want.svg + want.code;
  const pending = Math.max(0, total - (seen.svg + seen.code));

  return (
    <>
      <div className="sl-print-bar">
        {state === 'loading' && <span>Loading deck…</span>}
        {state === 'waiting' && (
          <span>{pending ? `Rendering — ${pending} of ${total} charts and diagrams left` : 'Preparing…'}</span>
        )}
        {state === 'ready' && (
          <>
            <span>Print dialog open — choose “Save as PDF” as the destination.
              Keep Margins on Default; changing it rescales the slides to paper size.</span>
            <button className="btn" onClick={() => window.print()}>Print again</button>
          </>
        )}
        {state === 'incomplete' && (
          <>
            <span>{pending} chart{pending === 1 ? '' : 's'} or diagram{pending === 1 ? '' : 's'} didn’t
              finish rendering, so this was not sent to the printer.</span>
            <button className="btn" onClick={() => window.print()}>Print anyway</button>
          </>
        )}
        {state === 'error' && <span>{msg}</span>}
      </div>
      {deck && (
        <div className="sl-print-root" ref={rootRef}>
          {deck.slides.map((s, i) => (
            <div key={s.id || i} className="sl-print-page">
              <SlideStage slide={s} theme={deck.theme} resolveSrc={resolveSrc} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
