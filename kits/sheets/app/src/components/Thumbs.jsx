// Card / table thumbnails for workflows and templates, plus the self-heal
// worker that regenerates a missing workflow thumbnail in place — the CG
// Thumbs.jsx pattern with one twist: Sheets's renderer is a PURE
// dsl -> SVG -> PNG function (lib/thumb.js), so healing needs no offscreen
// canvas at all — fetch the DSL, rasterize, upload.
import { useEffect, useRef, useState } from 'react';
import { fetchThumbUrl, getSheet, putThumbnail } from '../lib/sh';
import { sheetToPngBlob } from '../lib/thumb';

/** Neutral placeholder: a small connected flow drawing — every edge ends at
 *  a card (cards paint over the line endpoints), nothing dangling. */
export function ThumbPlaceholder() {
  return (
    <svg viewBox="0 0 320 180" className="thumb-ph" aria-hidden="true">
      <path d="M160 50v30M160 80l-60 30M160 80l60 30" stroke="#D7DBE3" strokeWidth="2" fill="none" />
      <rect x="120" y="28" width="80" height="24" rx="6" fill="#E3E7EE" />
      <rect x="62" y="104" width="76" height="24" rx="6" fill="#E3E7EE" />
      <rect x="182" y="104" width="76" height="24" rx="6" fill="#E3E7EE" />
    </svg>
  );
}

/** Blob-backed thumbnail image. `refreshKey` re-runs the fetch (bump it after
 *  a heal or a fresh capture); `onMiss` fires once per fetch that came back
 *  empty, so the owner can queue a heal. */
export function Thumb({ path, alt, refreshKey = 0, onMiss }) {
  const [url, setUrl] = useState(null);
  const [missing, setMissing] = useState(false);
  const onMissRef = useRef(onMiss);
  onMissRef.current = onMiss;
  useEffect(() => {
    let dead = false;
    let objectUrl = null;
    setUrl(null); setMissing(false);
    if (!path) { setMissing(true); return undefined; }
    fetchThumbUrl(path).then((u) => {
      if (dead) { if (u) URL.revokeObjectURL(u); return; }
      objectUrl = u;
      if (u) setUrl(u);
      else { setMissing(true); onMissRef.current?.(); }
    });
    return () => { dead = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, refreshKey]);
  if (missing || !url) return <div className="thumb">{missing ? <ThumbPlaceholder /> : null}</div>;
  return <div className="thumb"><img src={url} alt={alt || ''} loading="lazy" /></div>;
}

/** Static SVG art (template cards): a pre-rendered data URI, always present. */
export function ArtThumb({ uri, alt }) {
  if (!uri) return <div className="thumb"><ThumbPlaceholder /></div>;
  return <div className="thumb"><img src={uri} alt={alt || ''} loading="lazy" /></div>;
}

/** Invisible worker: fetch the workflow DSL, render + upload its thumbnail.
 *  Calls onDone(ok) exactly once; run one at a time. Workflows whose flow is
 *  empty (or only the starter note) report ok=false — nothing honest to draw. */
export function ThumbHealer({ sheetId, onDone }) {
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    let dead = false;
    const finish = (ok) => {
      if (doneRef.current || dead) return;
      doneRef.current = true;
      onDoneRef.current?.(ok);
    };
    (async () => {
      try {
        const r = await getSheet(sheetId);
        const drawable = ((r?.sheet?.tabs ? r.sheet.tabs[0] : r?.sheet)?.columns || []);
        if (!drawable.length) { finish(false); return; }
        const png = await sheetToPngBlob(r.sheet.tabs ? r.sheet.tabs[0] : r.sheet);
        if (!png || png.size === 0) { finish(false); return; }
        const res = await putThumbnail(sheetId, png);
        finish(res.ok);
      } catch {
        finish(false);
      }
    })();
    return () => { dead = true; };
  }, [sheetId]);
  return null;
}
