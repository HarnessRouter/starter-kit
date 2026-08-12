// The deck renderer.
//
// A deck is JSON on a fixed 1920×1080 stage; every element carries an absolute
// frame{x,y,w,h,rotation} and a stable id. Rendering is therefore a direct transform of data to
// absolutely-positioned boxes, scaled to whatever space the page gives it — which is also what
// makes the same component usable for the editor, the thumbnail and the print view.
import { useEffect, useRef, useState } from 'react';

export const STAGE = { width: 1920, height: 1080 };

/** Scale the 1920×1080 stage to fit its container, measured rather than assumed. */
function useFitScale(ref) {
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) setScale(Math.min(width / STAGE.width, height / STAGE.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

function runsToNodes(runs) {
  return (runs || []).map((run, i) => {
    const marks = run.marks || [];
    let node = run.text ?? '';
    if (marks.includes('code')) node = <code key={`c${i}`}>{node}</code>;
    if (marks.includes('bold')) node = <strong key={`b${i}`}>{node}</strong>;
    if (marks.includes('italic')) node = <em key={`i${i}`}>{node}</em>;
    if (marks.includes('underline')) node = <u key={`u${i}`}>{node}</u>;
    const link = marks.find((m) => m && typeof m === 'object' && m.link);
    if (link) node = <a key={`a${i}`} href={link.link}>{node}</a>;
    return <span key={i}>{node}</span>;
  });
}

const ROLE_SIZE = { title: 96, subtitle: 48, body: 32, bullets: 32, caption: 22 };

function Element({ el, theme, selected, onPointerDown }) {
  const f = el.frame || {};
  const style = {
    position: 'absolute', left: f.x || 0, top: f.y || 0, width: f.w || 0, height: f.h || 0,
    transform: f.rotation ? `rotate(${f.rotation}deg)` : undefined,
    outline: selected ? '2px solid var(--sel)' : undefined,
    ...(el.style || {}),
  };
  const palette = theme?.palette || {};

  if (el.type === 'image') {
    const c = el.content || {};
    return (
      <div style={style} data-el={el.id} onPointerDown={onPointerDown}>
        {c.src
          ? <img src={c.src} alt={c.alt || ''} draggable={false}
                 style={{ width: '100%', height: '100%', objectFit: c.fit || 'cover' }} />
          : <div className="sl-img-empty">{c.alt || 'image'}</div>}
      </div>
    );
  }
  if (el.type === 'shape') {
    return <div style={{ ...style, background: el.style?.fill || palette.brand || '#ddd' }}
                data-el={el.id} onPointerDown={onPointerDown} />;
  }

  const c = el.content || {};
  const role = c.role || 'body';
  const text = {
    fontFamily: role === 'title' || role === 'subtitle'
      ? (theme?.fonts?.head || 'inherit') : (theme?.fonts?.body || 'inherit'),
    fontSize: el.style?.fontSize || ROLE_SIZE[role] || 32,
    fontWeight: role === 'title' ? 700 : role === 'subtitle' ? 500 : 400,
    lineHeight: role === 'title' ? 1.05 : 1.35,
    color: el.style?.color || (role === 'caption' ? palette.mute : palette.ink) || '#111',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  };
  if (role === 'bullets') {
    return (
      <div style={style} data-el={el.id} onPointerDown={onPointerDown}>
        <ul className="sl-bullets" style={text}>
          {(c.runs || []).map((r, i) => <li key={i}>{runsToNodes([r])}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <div style={style} data-el={el.id} onPointerDown={onPointerDown}>
      <div style={text}>{runsToNodes(c.runs)}</div>
    </div>
  );
}

/** One slide, unscaled, at stage coordinates. */
export function Slide({ slide, theme, selectedId, onPointerDownEl }) {
  const bg = slide?.background || {};
  const palette = theme?.palette || {};
  return (
    <div className="sl-slide" style={{
      width: STAGE.width, height: STAGE.height,
      background: bg.color || palette.bg || '#fff',
      backgroundImage: bg.image ? `url(${bg.image})` : undefined,
      backgroundSize: 'cover', backgroundPosition: 'center',
    }}>
      {(slide?.elements || []).map((el) => (
        <Element key={el.id} el={el} theme={theme} selected={el.id === selectedId}
                 onPointerDown={onPointerDownEl ? (e) => onPointerDownEl(e, el) : undefined} />
      ))}
    </div>
  );
}

/** A slide scaled to fit the space it is given. */
export function Stage({ slide, theme, selectedId, onPointerDownEl, className = '' }) {
  const box = useRef(null);
  const scale = useFitScale(box);
  return (
    <div ref={box} className={`sl-stage ${className}`}>
      <div style={{
        width: STAGE.width, height: STAGE.height, transform: `scale(${scale})`,
        transformOrigin: 'top left',
        position: 'absolute', left: '50%', top: '50%',
        marginLeft: -(STAGE.width * scale) / 2, marginTop: -(STAGE.height * scale) / 2,
      }}>
        <Slide slide={slide} theme={theme} selectedId={selectedId} onPointerDownEl={onPointerDownEl} />
      </div>
    </div>
  );
}
