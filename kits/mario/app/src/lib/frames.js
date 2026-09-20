// The frame, as a stream of reads.
//
// The environment writes frame.jpg about twenty times a second; the only way to it from here is
// the session's live workspace read, one request a frame. So this keeps a few requests in flight
// at once (the round trip to the deployment is what bounds the rate, not the file), shows each
// frame only once it has decoded, and drops any that arrives after a newer one. What the hook
// reports as the rate is the rate of frames it actually showed.
import { useEffect, useState } from 'react';
import { frameUrl } from './game.js';

const IN_FLIGHT = 3;
const GAP_MS = 70;
const AFTER_MS = 2500;      // keep reading this long after the run ends, for the last frames

export function useFrames(sessionId, active) {
  const [frame, setFrame] = useState(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!sessionId) { setFrame(null); setFps(0); return undefined; }
    let stopped = false;
    let inFlight = 0;
    let seq = 0;
    let shown = 0;
    let shownAt = 0;
    let missing = 0;
    let count = 0;
    let since = performance.now();
    const activeUntil = { t: active ? Infinity : performance.now() + AFTER_MS };
    const url = frameUrl(sessionId);

    const read = async () => {
      const n = ++seq;
      inFlight += 1;
      try {
        const r = await fetch(`${url}?n=${n}`, { cache: 'no-store' });
        if (stopped) return;
        if (!r.ok) { missing += 1; return; }
        missing = 0;
        if (n <= shown) return;
        const blob = await r.blob();
        const u = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => {
          if (stopped || n <= shown) { URL.revokeObjectURL(u); return; }
          shown = n; shownAt = performance.now(); count += 1;
          setFrame((old) => { if (old) URL.revokeObjectURL(old); return u; });
        };
        im.onerror = () => URL.revokeObjectURL(u);
        im.src = u;
      } catch { /* the next read is the retry */ } finally { inFlight -= 1; }
    };

    const timer = setInterval(() => {
      if (stopped || inFlight >= IN_FLIGHT) return;
      // before the first frame the browser is still starting: look, but gently
      if (shown === 0 && missing > 0 && inFlight > 0) return;
      if (performance.now() > activeUntil.t) return;
      read();
    }, GAP_MS);
    const meter = setInterval(() => {
      const dt = (performance.now() - since) / 1000;
      setFps(dt > 0 ? Math.round(count / dt) : 0);
      count = 0; since = performance.now();
      if (shownAt && performance.now() - shownAt > 3000) setFps(0);
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(meter);
    };
  }, [sessionId, active]);

  useEffect(() => () => { setFrame((old) => { if (old) URL.revokeObjectURL(old); return null; }); }, [sessionId]);

  return { frame, fps };
}
