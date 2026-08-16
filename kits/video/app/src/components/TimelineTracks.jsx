// The timeline, as layers.
//
// The document has had two layers since the beginning — `shots` and `audio`, and the export mixes
// both — but only `shots` was ever drawn. An audio bed the agent added was in the file, in the
// film, and invisible in the app: the one place a person would look to find out what is in their
// video was the one place it did not appear.
//
// WIDTH IS TIME, and only where time is known. A shot that has been measured is drawn to scale; a
// shot still rendering has no length yet, so it is drawn at a fixed minimum with a hatched fill
// and no number on it. Stretching an unmeasured clip to a guessed width would make the ruler above
// it lie, and the ruler is the whole reason to draw tracks instead of a row of cards.
import { AlertTriangle, GripVertical, Music, Plus, Video, X } from 'lucide-react';
import { durationLabel } from '../lib/timeline';
import { posterUrl } from '../lib/media';

// Pixels per second at rest. Small enough that a 30 s film fits a narrow panel, large enough that
// a 2 s shot is still a target you can hit — see the 20 px floor below.
const PX_PER_S = 26;
const MIN_W = 34;
const UNKNOWN_W = 44;

function clipWidth(seconds) {
  if (!Number.isFinite(seconds)) return UNKNOWN_W;
  return Math.max(MIN_W, Math.round(seconds * PX_PER_S));
}

/** Tick marks every 5 s across the measured part of the cut. Drawn from the same numbers the
 *  clips are, so a tick can never disagree with the block under it. */
function Ruler({ seconds }) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const step = seconds > 60 ? 15 : 5;
  const ticks = [];
  for (let t = 0; t <= seconds; t += step) ticks.push(t);
  return (
    <div className="vd-tk-ruler" aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} className="vd-tk-tick" style={{ left: t * PX_PER_S }}>
          <i />{durationLabel(t)}
        </span>
      ))}
    </div>
  );
}

export function TimelineTracks({
  view, audio, elements, addr, editable, onMove, onRemove, onAdd, canAdd, measuredTotal, addRef,
}) {
  const hasAudio = (audio || []).length > 0;

  return (
    <div className="vd-tk" role="group" aria-label="Timeline layers">
      <Ruler seconds={measuredTotal} />

      {/* ── the picture layer ───────────────────────────────────────────────────────────── */}
      <div className="vd-tk-row">
        <div className="vd-tk-label"><Video size={12} /><span>Video</span></div>
        <div className="vd-tk-lane">
          {view.length === 0 ? (
            <p className="vd-tk-empty">
              Nothing in the cut yet. Ask for a shot, or add a clip already on the canvas.
            </p>
          ) : view.map((row, i) => {
            const poster = row.clip ? posterUrl(addr, row.clip) : '';
            const known = Number.isFinite(row.seconds);
            const state = row.missing || row.status === 'failed' ? 'failed'
              : row.status === 'ready' ? 'ready' : 'rendering';
            return (
              <article
                key={`${row.elementId}-${i}`}
                className={`vd-tk-clip is-${state}` + (known ? '' : ' is-unmeasured')}
                style={{ width: clipWidth(row.seconds) }}
                title={`${row.label}${known ? ` · ${durationLabel(row.seconds)}` : ' · still rendering'}`}
              >
                {/* The clip's own frame, as the block. This is the "preview per clip": a real
                    poster when one was rendered, and an honest blank when there is none — never a
                    stock frame, which reads as "your shot is here". */}
                {state === 'ready' && poster
                  ? <img className="vd-tk-poster" src={poster} alt="" loading="lazy" />
                  : (
                    <span className="vd-tk-blank" aria-hidden="true">
                      {state === 'failed' ? <AlertTriangle size={13} /> : null}
                    </span>
                  )}
                <span className="vd-tk-n">{i + 1}</span>
                {known && <span className="vd-tk-dur">{durationLabel(row.seconds)}</span>}
                {editable && (
                  <span className="vd-tk-tools">
                    <button type="button" className="uic-iconbtn" disabled={i === 0}
                            aria-label={`Move ${row.label} earlier`}
                            onClick={() => onMove(i, i - 1)}>
                      <GripVertical size={11} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <button type="button" className="uic-iconbtn is-danger"
                            aria-label={`Remove ${row.label} from the cut`}
                            onClick={() => onRemove(i)}>
                      <X size={11} />
                    </button>
                  </span>
                )}
              </article>
            );
          })}
          {editable && canAdd && (
            <button ref={addRef} type="button" className="vd-tk-add" onClick={onAdd}
                    aria-label="Add a clip to the cut" title="Add a clip to the cut">
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── the sound layer, only when there is one ─────────────────────────────────────────
          An empty lane with a label on it is a promise of a feature. This row appears when the
          document has audio in it and not before. */}
      {hasAudio && (
        <div className="vd-tk-row">
          <div className="vd-tk-label"><Music size={12} /><span>Audio</span></div>
          <div className="vd-tk-lane">
            {audio.map((a, i) => {
              const el = (elements || []).find((e) => e.id === a.elementId);
              const secs = el?.media?.seconds;
              const known = Number.isFinite(secs);
              return (
                <article
                  key={`${a.elementId}-${i}`}
                  className={'vd-tk-clip is-audio' + (known ? '' : ' is-unmeasured')}
                  style={{ width: clipWidth(secs), marginLeft: (a.startS || 0) * PX_PER_S }}
                  title={`${el?.media?.label || 'Audio'} · starts at ${durationLabel(a.startS || 0)}`}
                >
                  <span className="vd-tk-wave" aria-hidden="true"><Music size={12} /></span>
                  {known && <span className="vd-tk-dur">{durationLabel(secs)}</span>}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
