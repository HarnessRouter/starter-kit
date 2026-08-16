// A divider you drag UP and DOWN, for the timeline's top edge.
//
// reifyui's PaneResizer is the vertical one — it splits left from right and tracks clientX. The
// film column splits top from bottom, so it needs the other axis. Same contract as the shared
// one (a hook that owns the size, a component that draws the handle), so if reifyui grows an
// `axis` option this becomes one import line and a deleted file.
//
// The handle IS the timeline's top border rather than a strip floating above it: there is one
// line between the two panes, and it is the thing you grab.
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_FRACTION = 0.72;

function read(key, fallback) {
  if (!key || typeof window === 'undefined') return fallback;
  const n = parseInt(window.localStorage.getItem(key) || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function useHeightPane({ initial = 210, min = 96, storageKey = null } = {}) {
  const [height, setHeight] = useState(() => read(storageKey, initial));
  const drag = useRef(null);

  const clamp = useCallback((h) => {
    const hi = typeof window === 'undefined' ? Infinity
      : Math.round(window.innerHeight * MAX_FRACTION);
    return Math.min(hi, Math.max(min, Math.round(h)));
  }, [min]);

  const commit = useCallback((h) => {
    setHeight(h);
    if (storageKey && typeof window !== 'undefined') {
      try { window.localStorage.setItem(storageKey, String(h)); } catch { /* private mode */ }
    }
  }, [storageKey]);

  // Grow to fit something that has just appeared — never shrink, and never overwrite what the
  // person last dragged to: this is "reveal the result of an edit", not a second opinion about
  // how tall they want their timeline. Not persisted, so a reload returns to their own size and
  // the measurement runs again from there.
  const ensure = useCallback((h) => {
    const want = clamp(h);
    setHeight((cur) => (want > cur ? want : cur));
  }, [clamp]);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    drag.current = { y: e.clientY, h: height };
    const move = (ev) => {
      const d = drag.current;
      if (d) setHeight(clamp(d.h + (d.y - ev.clientY)));   // pull the border UP to grow it
    };
    const up = (ev) => {
      const d = drag.current;
      drag.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (d) commit(clamp(d.h + (d.y - ev.clientY)));
    };
    // The cursor and the text-selection lock belong to the DRAG, not to the handle: without them
    // the pointer flickers back to an I-beam the moment it leaves the 5 px border, and dragging
    // over the transcript selects it.
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [height, clamp, commit]);

  // Keyboard, because a drag handle that only answers a mouse is a control some people cannot use.
  const onKeyDown = useCallback((e) => {
    const step = e.shiftKey ? 48 : 12;
    if (e.key === 'ArrowUp') { e.preventDefault(); commit(clamp(height + step)); }
    if (e.key === 'ArrowDown') { e.preventDefault(); commit(clamp(height - step)); }
  }, [height, clamp, commit]);

  const reset = useCallback(() => commit(initial), [commit, initial]);

  // A window that shrank below the stored height leaves the preview with nothing.
  useEffect(() => {
    const onResize = () => setHeight((h) => clamp(h));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  return { height, onMouseDown, onKeyDown, reset, ensure };
}

export function HeightResizer({ pane, label = 'Drag to resize the timeline' }) {
  return (
    <div
      className="vd-hresize"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={`${label} (double-click to reset)`}
      tabIndex={0}
      onMouseDown={pane.onMouseDown}
      onKeyDown={pane.onKeyDown}
      onDoubleClick={pane.reset}
    />
  );
}
