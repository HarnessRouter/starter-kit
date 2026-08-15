// The cut: which clips, in what order, become one film.
//
// The strip is the person's half of the timeline — the agent's half is set_timeline, and both
// write the same key in the same document under the same revision. Order here is EXPLICIT: this
// list is the cut, and nothing about where a card sits on the canvas changes it. Reordering the
// board by dragging must not silently re-edit the film.
//
// Every number on this strip is measured. A shot still rendering shows no length, and a film with
// one of those in it shows no total — "—", not "0:00". The one place that rule would be tempting
// to break is exactly the place someone reads a duration and plans around it.
import { ChevronDown, ChevronUp, Download, Film, GripVertical, Plus, X } from 'lucide-react';
import { Popover } from 'reifyui';
import { useRef, useState } from 'react';
import {
  FPS_CHOICES, RESOLUTIONS, appendShot, durationLabel, moveShot, readiness, removeShot, setFps,
  setResolution, timelineView, unusedClips,
} from '../lib/timeline';
import { MediaTile } from './MediaTile';
import { posterUrl } from '../lib/media';

export function TimelineStrip({
  timeline, elements, addr, editable, open, onToggle, onChange,
  exportState, onExport, exportUnavailable, filmUrl,
}) {
  const view = timelineView(timeline, elements);
  const { ready, warnings, total } = readiness(timeline, view);
  const spare = unusedClips(timeline, elements);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef(null);

  const edit = (next) => { if (next !== timeline) onChange(next); };

  return (
    <section className={'vd-tl' + (open ? '' : ' is-closed')} aria-label="Timeline">
      <header className="vd-tl-head">
        <button type="button" className="vd-tl-toggle" onClick={onToggle}
                aria-expanded={open} aria-label={open ? 'Hide the timeline' : 'Show the timeline'}>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <Film size={14} />
          <span className="vd-tl-title">Timeline</span>
        </button>
        <span className="vd-tl-count">
          {view.length === 0 ? 'No shots yet'
            : `${view.length} shot${view.length === 1 ? '' : 's'} · ${durationLabel(total)}`}
        </span>
        <div className="vd-tl-spacer" />
        {open && (
          <>
            <label className="vd-tl-field">
              <span>Size</span>
              <select className="input sm" value={timeline.resolution} disabled={!editable}
                      onChange={(e) => edit(setResolution(timeline, e.target.value))}>
                {RESOLUTIONS.map((r) => <option key={r} value={r}>{r.replace('x', '×')}</option>)}
              </select>
            </label>
            <label className="vd-tl-field">
              <span>fps</span>
              <select className="input sm" value={timeline.fps} disabled={!editable}
                      onChange={(e) => edit(setFps(timeline, Number(e.target.value)))}>
                {FPS_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          </>
        )}
        {filmUrl && (
          <a className="btn" href={filmUrl} download>
            <Download size={13} /><span className="lbl">Download</span>
          </a>
        )}
        <button type="button" className="btn primary" onClick={onExport}
                disabled={!ready || !!exportState || !!exportUnavailable}
                title={exportUnavailable || undefined}>
          {exportState || 'Export'}
        </button>
      </header>

      {open && (
        <>
          {/* The reasons the button is off, in the server's words and the timeline's. Under the
              control they explain, not in a banner at the top of the page. */}
          {exportUnavailable && <p className="vd-tl-note is-err">{exportUnavailable}</p>}
          {warnings.map((w) => <p key={w} className="vd-tl-note">{w}</p>)}

          <div className="vd-tl-rail">
            {view.length === 0 ? (
              <p className="vd-tl-empty">
                Nothing is in the cut yet. Ask the copilot for a shot, or add a clip that is already
                on the canvas.
              </p>
            ) : view.map((row, i) => (
              <article key={`${row.elementId}-${i}`} className={'vd-shot is-' + row.status}>
                <MediaTile
                  poster={row.clip ? posterUrl(addr, row.clip) : ''}
                  // A pill only when there is a length to put in it. `durationLabel` answers '—'
                  // for an unmeasured clip, and a pill containing a dash is a badge that says
                  // nothing — the honest place for the dash is the table column that promised a
                  // value, not a chip floating over a thumbnail.
                  duration={Number.isFinite(row.seconds) ? durationLabel(row.seconds) : ''}
                  state={row.missing ? 'failed' : row.status === 'ready' ? 'ready' : row.status === 'failed' ? 'failed' : 'rendering'}
                  label={row.label}
                />
                <div className="vd-shot-meta">
                  <span className="vd-shot-n">{i + 1}</span>
                  <span className="vd-shot-name" title={row.clip?.prompt || row.label}>{row.label}</span>
                </div>
                {editable && (
                  <div className="vd-shot-tools">
                    <button type="button" className="uic-iconbtn" aria-label={`Move ${row.label} earlier`}
                            disabled={i === 0} onClick={() => edit(moveShot(timeline, i, i - 1))}>
                      <GripVertical size={12} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <button type="button" className="uic-iconbtn is-danger" aria-label={`Remove ${row.label} from the cut`}
                            onClick={() => edit(removeShot(timeline, i))}>
                      <X size={12} />
                    </button>
                  </div>
                )}
              </article>
            ))}

            {/* Only when there is something to add. A control that opens an empty list is a
                control that should not be there. */}
            {editable && spare.length > 0 && (
              <>
                <button ref={addRef} type="button" className="vd-shot vd-shot-add"
                        onClick={() => setAddOpen((v) => !v)} aria-expanded={addOpen}>
                  <Plus size={16} />
                  <span>Add a clip</span>
                </button>
                <Popover open={addOpen} anchorRef={addRef} onClose={() => setAddOpen(false)}
                         width={260} minHeight={120} label="Clips not in the cut">
                  {spare.map((m) => (
                    <button key={m.id} type="button" className="uic-pop-item"
                            onClick={() => { edit(appendShot(timeline, m.id, elements)); setAddOpen(false); }}>
                      {m.label || m.kind}
                      <span className="vd-pop-meta">{durationLabel(m.seconds)}</span>
                    </button>
                  ))}
                </Popover>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
