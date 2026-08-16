// The cut, played.
//
// TWO DIFFERENT THINGS CAN BE PLAYED HERE AND THEY ARE NOT INTERCHANGEABLE.
//
//   The exported film, when one exists. One file, the real thing, with the audio track mixed in
//   and every transition the server applied. If it exists it is what plays, because it is the
//   artifact — anything else would be a simulation of a thing we already have.
//
//   Otherwise a PREVIEW of the cut: each shot's own clip, played in order, swapping src on
//   `ended`. That is an honest approximation and it is labelled as one. It has no audio layer and
//   no transitions, because those exist only in the export; claiming otherwise by silently mixing
//   something in the browser would make this player disagree with the file you download.
//
// Nothing here invents a duration. A shot still rendering has no measured length, so the counter
// shows what has actually played and the total is '—' until every shot has been measured. A
// progress bar that fills against a guessed total is the exact thing this project does not ship.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { durationLabel } from '../lib/timeline';
import { mediaUrl, posterUrl } from '../lib/media';

export function PreviewPlayer({ view, addr, filmUrl, total }) {
  const ref = useRef(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Only shots we can actually play. A rendering or failed shot is not silently skipped in the
  // strip below — it is visible there — but it cannot be a source here.
  const playable = useMemo(
    () => (view || []).filter((r) => r.clip && !r.missing && r.status === 'ready'),
    [view]);

  const isFilm = Boolean(filmUrl);
  const src = isFilm ? filmUrl
    : (playable[i]?.clip ? mediaUrl({ ...addr, mediaId: playable[i].clip.mediaId }) : '');
  const poster = !isFilm && playable[i]?.clip ? posterUrl(addr, playable[i].clip) : '';

  // Seconds finished BEFORE the shot now playing, so the counter reads across the whole cut
  // rather than restarting at each cut point.
  const before = useMemo(() => {
    if (isFilm) return 0;
    return playable.slice(0, i).reduce(
      (n, r) => n + (Number.isFinite(r.seconds) ? r.seconds : 0), 0);
  }, [playable, i, isFilm]);

  useEffect(() => {                       // a new source while playing keeps playing
    const el = ref.current;
    if (el && playing) el.play().catch(() => setPlaying(false));
  }, [src, playing]);

  const onEnded = useCallback(() => {
    if (isFilm || i >= playable.length - 1) { setPlaying(false); return; }
    setI((n) => n + 1);
  }, [isFilm, i, playable.length]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    if (i >= playable.length - 1 && el.ended) { setI(0); el.currentTime = 0; }
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [playing, i, playable.length]);

  const restart = useCallback(() => {
    setI(0); setElapsed(0);
    const el = ref.current;
    if (el) { el.currentTime = 0; if (playing) el.play().catch(() => {}); }
  }, [playing]);

  // Space is play/pause everywhere video is played. Bound on the section, not the window, so it
  // does not fight the canvas or the composer for the same key.
  const onKeyDown = useCallback((e) => {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
  }, [toggle]);

  const at = before + elapsed;
  const totalLabel = Number.isFinite(total) ? durationLabel(total) : '—';

  if (!src) {
    return (
      <section className="vd-prev is-empty" aria-label="Preview">
        <div className="vd-prev-blank">
          <span>Nothing to play yet.</span>
          <span className="vd-prev-hint">A shot appears here as soon as one has rendered.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="vd-prev" aria-label="Preview" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="vd-prev-stage">
        <video
          ref={ref}
          className="vd-prev-video"
          src={src}
          poster={poster || undefined}
          preload="metadata"
          playsInline
          onEnded={onEnded}
          onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime || 0)}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
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
            : `Preview · shot ${Math.min(i + 1, playable.length)} of ${playable.length}`}
        </span>
      </div>
      {!isFilm && (
        <p className="vd-prev-note">
          Shots played back to back. Music and transitions are added when you export.
        </p>
      )}
    </section>
  );
}
