// Template preview — the eye on a template card opens the deck this template would give you.
//
// The SHELL is the package's Modal (backdrop, Escape ordering, scroll lock, the three-pane
// rail · canvas · side arrangement every preview in these products converged on). What is left
// here is the only part that is genuinely Slides': the body is a real slide, rendered by the
// SAME SlideView the editor uses, in the template's own theme — so this is exactly how a new
// deck will look, not an illustration of it.
import { useEffect, useRef, useState } from 'react';
import { Modal } from 'reifyui';
import { SlideView } from 'reifyui/slides';
import { getTemplateDetail } from '../lib/sl';
import { sampleDeckFor } from '../lib/sampleDeck';

export function TemplatePreviewModal({ template, onClose, onUse }) {
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);

  useEffect(() => {
    let dead = false;
    getTemplateDetail(template.id)
      .then((d) => { if (!dead) setDetail(d); })
      .catch((e) => { if (!dead) setErr(e?.message || 'Could not load this preview.'); });
    return () => { dead = true; };
  }, [template.id]);

  const count = detail ? (detail.slides?.length || 4) : 0;
  // Arrows page through the samples. Escape is NOT handled here: the Modal owns it, through the
  // package's overlay stack, so the topmost overlay is the one that answers the key.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, count - 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  const railRef = useRef(null);
  useEffect(() => {
    railRef.current?.querySelectorAll('.sl-rail-item')?.[sel]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  // wheel over the canvas pages through the samples (throttled per gesture)
  const wheelLock = useRef(0);
  const onWheel = (e) => {
    const now = Date.now();
    if (now - wheelLock.current < 350 || Math.abs(e.deltaY) < 12) return;
    wheelLock.current = now;
    setSel((v) => Math.max(0, Math.min(count - 1, v + (e.deltaY > 0 ? 1 : -1))));
  };

  const deck = detail
    ? (detail.slides && detail.slides.length
        ? { meta: { title: detail.name }, theme: detail.theme, slides: detail.slides }
        : sampleDeckFor(detail))
    : null;
  const slide = deck?.slides[Math.min(sel, deck.slides.length - 1)];
  const palette = detail?.theme?.palette;

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title={template.name}
      description={template.description}
      actions={<button type="button" className="btn primary" onClick={onUse}>Use this template</button>}
    >
      {err ? (
        <div className="uic-note">{err}</div>
      ) : !deck ? (
        <div className="sl-prev-loading"><div className="uic-skel sl-prev-skel" /></div>
      ) : (
        <>
          <aside className="uic-modal-rail scroll" ref={railRef}>
            {deck.slides.map((s, i) => (
              <button key={s.id} className={'sl-rail-item' + (i === sel ? ' active' : '')}
                      onClick={() => setSel(i)} aria-label={`Sample slide ${i + 1}`}>
                <span className="sl-rail-thumb"><SlideView slide={s} theme={deck.theme} /></span>
              </button>
            ))}
          </aside>
          <div className="uic-modal-canvas sl-prev-canvas" onWheel={onWheel}>
            <SlideView slide={slide} theme={deck.theme} />
            <div className="uic-modal-canvas-note">{detail.slides ? "This template's starter slides — the copilot adapts them to your content." : "Sample slides in this template's style — the copilot builds your actual content."}</div>
          </div>
          <aside className="uic-modal-side scroll">
            {detail.category && <span className="sl-prev-cat">{detail.category}</span>}
            {palette && (
              <section className="sl-prev-sec">
                <h4>Palette</h4>
                <div className="sl-prev-strip" aria-label="Theme palette">
                  {['brand', 'accent', 'ink', 'mute', 'surface', 'bg'].map((k) => palette[k] && (
                    <span key={k} className="sl-prev-stop" style={{ background: palette[k] }} title={`${k} · ${palette[k]}`} />
                  ))}
                </div>
                <div className="sl-prev-legend">
                  <span><i style={{ background: palette.brand }} />brand</span>
                  <span><i style={{ background: palette.accent }} />accent</span>
                </div>
                {detail.theme?.fonts?.head && (
                  <div className="sl-prev-font" style={{ fontFamily: detail.theme.fonts.head }}>
                    Aa <em>{(detail.theme.fonts.head.split(',')[0] || '').replace(/['"]/g, '')}</em>
                  </div>
                )}
              </section>
            )}
            {detail.context && (
              <section className="sl-prev-sec">
                <h4>How the copilot builds it</h4>
                <p className="sl-prev-context">{detail.context}</p>
              </section>
            )}
          </aside>
        </>
      )}
    </Modal>
  );
}
