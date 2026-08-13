// Template preview modal — the landing card's eye opens a near-fullscreen
// preview: LEFT a mini slide rail + the selected sample slide rendered by the
// SAME SlideView the editor uses (the template's real theme — this is exactly
// how a new deck will be styled), RIGHT the structure brief the copilot
// builds from. Mirrors ContextualGraph's TemplateDetailModal / Flowness's
// WorkflowPreviewModal: header = name + description + "Use this template".
// Templates are public showcase content — the preview works signed out.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
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
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, count - 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, count]);

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
    <div className="tdm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="tdm" role="dialog" aria-modal="true" aria-label={`${template.name} preview`}>
        <div className="tdm-h">
          <div className="tdm-title">
            <h3>{template.name}</h3>
            {template.description && <p>{template.description}</p>}
          </div>
          <button type="button" className="btn primary tdm-use" onClick={onUse}>Use this template</button>
          <button type="button" className="iconbtn tdm-x" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="tdm-body">
          {err ? (
            <div className="page-note">{err}</div>
          ) : !deck ? (
            <div className="tdm-loading"><div className="skeleton tdm-skel" /></div>
          ) : (
            <>
              <aside className="tdm-rail scroll" ref={railRef}>
                {deck.slides.map((s, i) => (
                  <button key={s.id} className={'sl-rail-item' + (i === sel ? ' active' : '')}
                          onClick={() => setSel(i)} aria-label={`Sample slide ${i + 1}`}>
                    <span className="sl-rail-thumb"><SlideView slide={s} theme={deck.theme} /></span>
                  </button>
                ))}
              </aside>
              <div className="tdm-canvas" onWheel={onWheel}>
                <SlideView slide={slide} theme={deck.theme} />
                <div className="tdm-canvas-note">{detail.slides ? "This template's starter slides — the copilot adapts them to your content." : "Sample slides in this template's style — the copilot builds your actual content."}</div>
              </div>
              <aside className="tdm-side scroll">
                {detail.category && <span className="tdm-cat">{detail.category}</span>}
                {palette && (
                  <section className="tdm-sec">
                    <h4>Palette</h4>
                    <div className="tdm-strip" aria-label="Theme palette">
                      {['brand', 'accent', 'ink', 'mute', 'surface', 'bg'].map((k) => palette[k] && (
                        <span key={k} className="tdm-stop" style={{ background: palette[k] }} title={`${k} · ${palette[k]}`} />
                      ))}
                    </div>
                    <div className="tdm-strip-legend">
                      <span><i style={{ background: palette.brand }} />brand</span>
                      <span><i style={{ background: palette.accent }} />accent</span>
                    </div>
                    {detail.theme?.fonts?.head && (
                      <div className="tdm-font" style={{ fontFamily: detail.theme.fonts.head }}>
                        Aa <em>{(detail.theme.fonts.head.split(',')[0] || '').replace(/['"]/g, '')}</em>
                      </div>
                    )}
                  </section>
                )}
                {detail.context && (
                  <section className="tdm-sec">
                    <h4>How the copilot builds it</h4>
                    <p className="tdm-context">{detail.context}</p>
                  </section>
                )}
              </aside>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
