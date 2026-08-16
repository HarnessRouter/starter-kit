// The cut, played.
//
// TWO DIFFERENT THINGS CAN BE PLAYED HERE AND THEY ARE NOT INTERCHANGEABLE.
//
//   The exported film, when one exists. One file, the real thing, with the audio mixed in and
//   every layer already burnt into the picture. If it exists it is what plays, because it is the
//   artifact — anything else would be a simulation of a thing we already have.
//
//   Otherwise a PREVIEW of the cut, assembled live: each shot for exactly the window the cut
//   gives it, in order, with the layers drawn over it at the second they appear.
//
// THE PREVIEW'S CLOCK IS THE FILM'S CLOCK. That is the rule this file is built around, and it is
// the reason for everything awkward in it. A preview that silently skipped the stills ran ahead
// of the export, so its counter disagreed with the exported film and every layer would have been
// drawn at the wrong moment. A preview that ignored trims played six seconds of a shot the cut
// holds for two. Both were true here; both are what "0:13 in the strip, 0:10 in the file" looks
// like from the other end.
//
// What it still cannot show is the sound: audio beds are mixed at export. That is said out loud
// under the transport rather than approximated in the browser.
//
// Nothing here invents a duration. A shot still rendering has no measured length, so the counter
// shows what has actually played and the total is '—' until every shot has been measured. A
// progress bar that fills against a guessed total is the exact thing this project does not ship.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { OVERLAY_INSET, durationLabel } from '../lib/timeline';
import { mediaUrl, posterUrl } from '../lib/media';

/** One layer, drawn over the stage and kept in step with the film's clock.
 *
 *  It seeks rather than plays on its own: the spine decides what time it is, and a layer that ran
 *  on its own clock would drift out of sync the first time a shot took a moment to load. */
function OverlayLayer({ row, addr, at, playing }) {
  const ref = useRef(null);
  const want = (row.inS ?? 0) + (at - row.startS);
  const still = row.clip?.kind === 'image';

  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    // Only correct a real drift. Assigning currentTime every frame restarts the decoder and the
    // layer stutters instead of playing.
    if (Number.isFinite(want) && Math.abs(el.currentTime - want) > 0.2) el.currentTime = want;
    if (playing && el.paused) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [want, playing, still]);

  const src = mediaUrl({ ...addr, mediaId: row.clip.mediaId });
  const pct = `${Math.round(row.scale * 100)}%`;
  const inset = `${Math.round(OVERLAY_INSET * 100)}%`;
  const box = row.position === 'full'
    ? { inset: 0 }
    : {
        width: pct, height: pct,
        ...(row.position === 'center'
          ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
          : {
              ...(row.position.includes('l') ? { left: inset } : { right: inset }),
              ...(row.position.startsWith('t') ? { top: inset } : { bottom: inset }),
            }),
      };

  return (
    <div className="vd-prev-ov" style={box} aria-hidden="true">
      {still
        ? <img src={src} alt="" />
        : <video ref={ref} src={src} preload="metadata" muted playsInline />}
    </div>
  );
}

export function PreviewPlayer({ view, layers = [], addr, filmUrl, total, canvasClips = 0,
                               onTime, seekTo }) {
  const ref = useRef(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Everything the film will contain, in cut order — videos AND stills. A shot still rendering
  // is not silently skipped in the strip below (it is visible there) but it cannot be a source
  // here, and neither can one whose length nobody has measured.
  const segments = useMemo(
    () => (view || []).filter((r) => r.clip && !r.missing && r.status === 'ready'
                                     && Number.isFinite(r.seconds) && r.seconds > 0),
    [view]);

  const isFilm = Boolean(filmUrl);
  const seg = segments[i] || null;
  const still = seg?.clip?.kind === 'image';
  const src = isFilm ? filmUrl
    : (seg && !still ? mediaUrl({ ...addr, mediaId: seg.clip.mediaId }) : '');
  const poster = !isFilm && seg && !still ? posterUrl(addr, seg.clip) : '';

  // Seconds finished BEFORE the shot now playing, so the counter reads across the whole cut
  // rather than restarting at each cut point.
  const before = useMemo(
    () => (isFilm ? 0 : segments.slice(0, i).reduce((n, r) => n + r.seconds, 0)),
    [segments, i, isFilm]);
  const at = before + elapsed;

  const advance = useCallback(() => {
    if (i >= segments.length - 1) { setPlaying(false); return; }
    setI(i + 1);
    setElapsed(0);
  }, [i, segments.length]);

  // A still has no playback of its own, so the clock has to be run for it. Wall time, not a fixed
  // increment per frame: a tab that throttles rAF must not make a three-second still last twenty.
  useEffect(() => {
    if (isFilm || !playing || !still || !seg) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setElapsed((e) => Math.min(e + dt, seg.seconds));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isFilm, playing, still, seg]);

  // The still's hold is up. Kept out of the tick above so the advance is not a side effect
  // inside a state updater, which React is free to run twice.
  useEffect(() => {
    if (!isFilm && playing && still && seg && elapsed >= seg.seconds) advance();
  }, [isFilm, playing, still, seg, elapsed, advance]);

  useEffect(() => {                       // a new source while playing keeps playing
    const el = ref.current;
    if (el && playing && !still) el.play().catch(() => setPlaying(false));
  }, [src, playing, still]);

  // THE WINDOW, NOT THE FILE. A shot is a window onto its clip, so the preview starts where the
  // cut starts and stops where the cut stops — otherwise a trimmed shot plays its full length
  // here and its trimmed length in the film.
  const startAtIn = useCallback(() => {
    const el = ref.current;
    if (!el || isFilm || !seg) return;
    const from = Math.max(0, seg.inS ?? 0);
    if (Math.abs(el.currentTime - from) > 0.05) el.currentTime = from;
  }, [isFilm, seg]);

  const onTimeUpdate = useCallback((e) => {
    const el = e.currentTarget;
    if (isFilm) { setElapsed(el.currentTime || 0); return; }
    if (!seg) return;
    const from = Math.max(0, seg.inS ?? 0);
    setElapsed(Math.max(0, (el.currentTime || 0) - from));
    const to = Number.isFinite(seg.outS) ? seg.outS : null;
    if (to !== null && el.currentTime >= to - 0.02) advance();
  }, [isFilm, seg, advance]);

  const toggle = useCallback(() => {
    if (!isFilm && still) {                       // nothing to press play on but the clock
      if (playing) { setPlaying(false); return; }
      if (i >= segments.length - 1 && seg && elapsed >= seg.seconds) { setI(0); setElapsed(0); }
      setPlaying(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    if (i >= segments.length - 1 && el.ended) { setI(0); setElapsed(0); startAtIn(); }
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [playing, i, segments.length, isFilm, still, seg, elapsed, startAtIn]);

  const restart = useCallback(() => {
    setI(0); setElapsed(0);
    const el = ref.current;
    if (el) { el.currentTime = isFilm ? 0 : Math.max(0, segments[0]?.inS ?? 0); }
    if (playing && el && !(segments[0]?.clip?.kind === 'image')) el.play().catch(() => {});
  }, [playing, isFilm, segments]);

  // A seek from the timeline: find the shot that second falls in and jump inside it. The cut is
  // a sequence of separate files, so a time is a (shot, offset) pair rather than one position.
  useEffect(() => {
    if (!seekTo || !seekTo.nonce) return;
    const t = Math.max(0, seekTo.t || 0);
    if (isFilm) { if (ref.current) ref.current.currentTime = t; return; }
    let acc = 0;
    for (let n = 0; n < segments.length; n += 1) {
      const d = segments[n].seconds;
      if (t < acc + d || n === segments.length - 1) {
        const into = Math.max(0, Math.min(d, t - acc));
        setI(n);
        setElapsed(into);
        const el = ref.current;
        if (el && segments[n].clip.kind !== 'image') {
          el.currentTime = Math.max(0, segments[n].inS ?? 0) + into;
        }
        return;
      }
      acc += d;
    }
  }, [seekTo, isFilm, segments]);

  // Space is play/pause everywhere video is played. Bound on the section, not the window, so it
  // does not fight the canvas or the composer for the same key.
  const onKeyDown = useCallback((e) => {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
  }, [toggle]);

  useEffect(() => { onTime?.(at); }, [at, onTime]);
  const totalLabel = Number.isFinite(total) ? durationLabel(total) : '—';

  // The layers on screen right now. Never over the exported film: they are already in it, and
  // drawing them again would double every one of them.
  const showing = useMemo(
    () => (isFilm ? [] : (layers || []).filter(
      (l) => l.clip && !l.missing && l.status === 'ready' && Number.isFinite(l.seconds)
             && at >= l.startS && at < l.startS + l.seconds)),
    [layers, at, isFilm]);

  const hasClips = canvasClips > 0;

  if (!src && !still) {
    return (
      <section className="vd-prev is-empty" aria-label="Preview">
        {/* What plays here is THE CUT, so this says that. It used to promise a shot would appear
            "as soon as one has rendered", which is not true and is visibly not true in the one
            situation it was written for: a clip finishes, sits on the canvas, and this panel goes
            on saying nothing is here. The player is not lying about the cut being empty — the
            sentence was describing a different thing. */}
        <div className="vd-prev-blank">
          <span>{hasClips ? 'Nothing in the cut yet.' : 'Nothing to play yet.'}</span>
          <span className="vd-prev-hint">
            {hasClips
              ? 'There are clips on the canvas. Add one to the cut below and it plays here.'
              : 'The film plays here once a shot is in the cut.'}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="vd-prev" aria-label="Preview" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="vd-prev-stage">
        {/* A STILL IS A PICTURE. Handing its url to a <video> is what drew a black rectangle and
            left the transport showing 'Pause' over it forever. */}
        {!isFilm && still
          ? <img className="vd-prev-video" src={mediaUrl({ ...addr, mediaId: seg.clip.mediaId })}
                 alt={seg.label || 'Still'} />
          : (
            <video
              ref={ref}
              className="vd-prev-video"
              src={src}
              poster={poster || undefined}
              preload="metadata"
              playsInline
              onLoadedMetadata={startAtIn}
              onEnded={isFilm ? () => setPlaying(false) : advance}
              onTimeUpdate={onTimeUpdate}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
          )}
        {showing.map((l) => (
          <OverlayLayer key={`${l.elementId}-${l.index}`} row={l} addr={addr} at={at}
                        playing={playing} />
        ))}
      </div>
      <div className="vd-prev-bar">
        <button type="button" className="uic-iconbtn" onClick={toggle}
                aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play (Space)'}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button type="button" className="uic-iconbtn" onClick={restart}
                aria-label="Back to the start" title="Back to the start">
          <SkipBack size={13} />
        </button>
        {/* Tabular numerals: this updates in place and must not jitter. */}
        <span className="vd-prev-time">{durationLabel(at)} / {totalLabel}</span>
        <span className="vd-prev-what">
          {isFilm ? 'Exported film'
            : `Preview · shot ${Math.min(i + 1, segments.length)} of ${segments.length}`}
        </span>
      </div>
      {!isFilm && (
        <p className="vd-prev-note">
          The cut as it stands, layers included. Music is mixed in when you export.
        </p>
      )}
    </section>
  );
}
