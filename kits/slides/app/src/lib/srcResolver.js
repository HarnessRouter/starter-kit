// Turning a deck's image paths into fetchable URLs.
//
// A deck references images by their path in the session workspace, not by URL, so anything that
// RENDERS a deck — the editor, the print surface, the PowerPoint exporter — needs the same
// mapping. It lives here rather than inside DeckPage so the print route and the exporter cannot
// drift from what the canvas shows.
import { useCallback, useEffect, useState } from 'react';
import { workspaceFileIndex } from './sl';

/** Non-hook form: for code that already has the index (the print surface, the exporter). */
export function buildSrcResolver(index) {
  return (src) => {
    if (!src) return src;
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    return index?.[String(src).replace(/^\.?\//, '')] || src;
  };
}

/** Hook form: resolves against the session's live file list. Until it arrives, paths are left
 *  untouched rather than pointed at a guessed URL that would render as a broken image. */
export function useSrcResolver(id) {
  const [index, setIndex] = useState(null);
  useEffect(() => {
    if (!id || String(id).startsWith('new:')) { setIndex(null); return undefined; }
    let dead = false;
    workspaceFileIndex(id).then((m) => { if (!dead) setIndex(m); }).catch(() => {});
    return () => { dead = true; };
  }, [id]);
  return useCallback((src) => buildSrcResolver(index)(src), [index]);
}
