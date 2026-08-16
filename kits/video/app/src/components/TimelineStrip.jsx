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
import { ChevronDown, ChevronUp, Download, Film } from 'lucide-react';
import { Popover } from 'reifyui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FPS_CHOICES, OVERLAY_POSITIONS, RESOLUTIONS, addOverlay, appendShot, durationLabel, layerCount,
  moveOverlay, moveShot, overlayView, readiness, removeOverlay, removeShot, setFps,
  setOverlayFraming, addAudio, insertShot, setResolution, splitShot, timelineView, trimOverlay,
  trimShot, unusedClips,
} from '../lib/timeline';
import { TimelineTracks } from './TimelineTracks';

export function TimelineStrip({
  timeline, elements, addr, editable, open, onToggle, onChange,
  exportState, onExport, exportUnavailable, filmUrl, height, onNeedHeight, currentTime, onSeek,
  selectedId, onSelect,
}) {
  const view = timelineView(timeline, elements);
  const layers = overlayView(timeline, elements);
  const { ready, warnings, total } = readiness(timeline, view);
  // The selected clip, when it is one of the layers — the framing control acts on that and on
  // nothing else, so it is only rendered when there is something for it to act on.
  const picked = layers.find((l) => `${l.elementId}-ov-${l.index}` === selectedId) || null;
  const spare = unusedClips(timeline, elements);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef(null);

  const edit = (next) => { if (next !== timeline) onChange(next); };

  // A LANE YOU CANNOT SEE IS A LANE YOU DID NOT ADD, as far as the person who just dropped
  // something is concerned. When the lanes no longer fit, ask for exactly the shortfall —
  // measured off the DOM, not computed from a lane height this file would have to keep in step
  // with the library's.
  const bodyRef = useRef(null);
  const laneCount = 1 + new Set(layers.map((l) => l.layer)).size + (timeline.audio?.length ? 1 : 0);
  useLayoutEffect(() => {
    if (!open || !onNeedHeight) return;
    const el = bodyRef.current?.querySelector('.rui-tl-scroll');
    if (!el) return;
    const short = el.scrollHeight - el.clientHeight;
    if (short > 2) onNeedHeight((height || 0) + short);
  }, [laneCount, open, height, onNeedHeight]);

  return (
    // Closed, it is just its own header, so the height is only applied when it is open.
    <section className={'vd-tl' + (open ? '' : ' is-closed')} aria-label="Timeline"
             style={open && height ? { height } : undefined}>
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
            {picked && (
              <label className="vd-tl-field">
                <span>Layer {picked.layer}</span>
                <select className="input sm" value={picked.position} disabled={!editable}
                        aria-label={`How ${picked.label} is framed`}
                        onChange={(e) => edit(setOverlayFraming(timeline, picked.index, e.target.value))}>
                  {OVERLAY_POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
            )}
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

          <div ref={bodyRef} className="vd-tl-body">
          <TimelineTracks
            view={view}
            audio={timeline.audio}
            layers={layers}
            elements={elements}
            addr={addr}
            editable={editable}
            addRef={addRef}
            canAdd={spare.length > 0}
            onAdd={() => setAddOpen((v) => !v)}
            onMove={(from, to) => edit(moveShot(timeline, from, to))}
            onRemove={(i) => edit(removeShot(timeline, i))}
            // The ruler is drawn over MEASURED time only. `total` is null the moment one shot is
            // still rendering, so this sums what is known rather than passing that null through
            // and losing the ruler entirely while a single clip is in flight.
            currentTime={currentTime}
            onSeek={onSeek}
            selectedId={selectedId}
            onSelect={onSelect}
            onTrim={(i, edge, seconds) => edit(trimShot(timeline, i, edge, seconds, elements))}
            onSplit={(i, atS) => edit(splitShot(timeline, i, atS, elements))}
            onLayerTrim={(i, edge, seconds) => edit(trimOverlay(timeline, i, edge, seconds, elements))}
            onLayerMove={(i, atS) => edit(moveOverlay(timeline, i, atS))}
            onLayerRemove={(i) => edit(removeOverlay(timeline, i))}
            onDrop={(elementId, at) => {
              const clip = (elements || []).find((e) => e.id === elementId);
              const kind = clip?.customData?.media?.kind;
              // WHERE IT LANDED DECIDES WHAT IT BECOMES. A sound on the new-lane strip starts the
              // audio layer; anything else joins the cut at the slot it was dropped into. Dropping
              // a sound into the picture lane is refused rather than quietly reinterpreted — a
              // drop that does something other than what it looked like is worse than one that
              // does nothing.
              if (at.trackId === null) {
                // The new-lane strip: a sound starts the audio bed, a picture starts the next
                // layer up. Both are "add a lane", and which lane depends on what was dropped.
                if (kind === 'audio') edit(addAudio(timeline, elementId, at.seconds, elements));
                else edit(addOverlay(timeline, elementId, at.seconds, layerCount(timeline) + 1, elements));
                return;
              }
              if (at.trackId === 'audio') { edit(addAudio(timeline, elementId, at.seconds, elements)); return; }
              if (kind === 'audio') return;
              if (String(at.trackId).startsWith('layer:')) {
                edit(addOverlay(timeline, elementId, at.seconds,
                                Number(String(at.trackId).slice(6)), elements));
                return;
              }
              edit(insertShot(timeline, elementId, at.index, elements));
            }}
          />
          </div>

          {/* Only when there is something to add. A control that opens an empty list is a
              control that should not be there. */}
          {editable && spare.length > 0 && (
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
          )}
        </>
      )}
    </section>
  );
}
