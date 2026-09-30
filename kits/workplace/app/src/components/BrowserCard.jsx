// The browser a teammate is using, live, in the rail: who has it, take over or hand back, and the
// vendor's live view. The live URL is a credential (whoever holds it controls the browser): it is
// read through the session's own route, kept in this component, and never written anywhere else.
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { fetchBrowser, setBrowserControl, viewerUrl } from '../lib/api.js';

const POLL_MS = 3000;
const LINGER_MS = 30000;   // keep the card after the turn ends, so the last page can be read

export function BrowserCard({ sid, busy, name }) {
  const [info, setInfo] = useState(null);
  const [pending, setPending] = useState(false);
  const [full, setFull] = useState(false);
  const frameRef = useRef(null);
  const endedAt = useRef(0);

  useEffect(() => {
    if (!sid) { setInfo(null); return undefined; }
    let alive = true;
    const tick = async () => {
      if (!busy && endedAt.current && Date.now() - endedAt.current > LINGER_MS) { if (alive) setInfo(null); return; }
      const i = await fetchBrowser(sid);
      if (alive) setInfo(i && i.open ? i : null);
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [sid, busy]);
  useEffect(() => { if (!busy) endedAt.current = Date.now(); else endedAt.current = 0; }, [busy]);

  if (!info) return null;
  const control = info.control === 'user' ? 'user' : 'agent';
  const src = viewerUrl(info.live_url || '');
  const vp = info.viewport && info.viewport.w > 0 ? info.viewport : { w: 16, h: 10 };
  const takeOver = async () => { if (pending || control === 'user') return; setPending(true); await setBrowserControl(sid, 'user'); setPending(false); window.setTimeout(() => frameRef.current?.focus(), 50); };
  const handBack = async () => { if (pending) return; setPending(true); await setBrowserControl(sid, 'agent'); setPending(false); };
  return (
    <section className={`wp-browser${full ? ' is-full' : ''}${control === 'agent' && busy ? ' is-acting' : ''}`} aria-label="Browser">
      <div className="wp-browser-head">
        <span className="wp-browser-who">{control === 'user' ? 'You have the browser' : `${name || 'Teammate'} is browsing`}{info.last_tool && control === 'agent' ? ` · ${info.last_tool}` : ''}</span>
        {control === 'user'
          ? <button type="button" className="uic-btn is-default is-sm" onClick={handBack} disabled={pending}>Hand back</button>
          : <button type="button" className="uic-btn is-primary is-sm" onClick={takeOver} disabled={pending}>Take over</button>}
        <button type="button" className="wp-iconbtn" onClick={() => setFull((f) => !f)} aria-label={full ? 'Smaller' : 'Larger'}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
      <div className="wp-browser-screen" style={{ aspectRatio: `${vp.w} / ${vp.h}` }} onClick={control === 'agent' ? takeOver : undefined}>
        {src ? <iframe ref={frameRef} src={src} title="Live browser" allow="clipboard-read; clipboard-write" /> : null}
        {control === 'agent' ? <div className="wp-browser-veil" aria-hidden="true" /> : null}
      </div>
    </section>
  );
}
