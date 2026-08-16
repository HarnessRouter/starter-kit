// The cut, as lanes — reifyui's Timeline with this kit's data poured into it.
//
// The drawing (ruler, playhead, zoom, sticky gutter, the rule that an unmeasured clip is never
// given a width) is the library's. What is here is the only part that is about VIDEO: which lanes
// exist, what a block looks like, and what the buttons on one do.
//
// The document has had two layers since the beginning — `shots` and `audio`, and the export mixes
// both — but only `shots` was ever drawn, so a music bed the agent added was in the film and
// invisible in the app. The audio lane appears when the document has audio in it and not before:
// an empty lane with a label on it is a promise, not a feature.
import { AlertTriangle, Layers, Music, Plus, Video } from 'lucide-react';
import { Timeline } from 'reifyui';
import { durationLabel } from '../lib/timeline';
import { mediaUrl, posterUrl } from '../lib/media';
import { CLIP_DRAG_TYPE } from './MediaCanvas';

/** Whether a gesture happened on one of the layer lanes rather than on the cut itself. */
const isLayer = (track) => String(track?.id || '').startsWith('layer:');

export function TimelineTracks({
  view, audio, layers, elements, addr, editable, onMove, onRemove, onAdd, canAdd, addRef,
  currentTime = 0, onSeek, onTrim, onSplit, selectedId, onSelect, onDrop,
  onLayerTrim, onLayerMove, onLayerRemove,
}) {
  const shots = (view || []).map((row, i) => ({
    id: `${row.elementId}-${i}`,
    // `seconds` is undefined until the clip has been measured, and it is passed through as-is:
    // the library draws a placeholder for that rather than a length nobody knows.
    duration: Number.isFinite(row.seconds) ? row.seconds : null,
    label: row.label,
    title: `${row.label}${Number.isFinite(row.seconds)
      ? ` · ${durationLabel(row.seconds)}` : ' · still rendering'}`,
    // AN IMAGE IS ITS OWN PICTURE. Handing a png to a <video> is what drew a black rectangle
    // where the ginkgo still should have been: the element loaded nothing and painted its
    // background. A still shows as a poster; only a VIDEO gets the first-frame treatment.
    poster: row.clip?.kind === 'image' && row.clip?.mediaId
      ? mediaUrl({ ...addr, mediaId: row.clip.mediaId })
      : (row.clip ? posterUrl(addr, row.clip) : ''),
    video: row.clip?.kind === 'video' && row.clip?.mediaId && row.status === 'ready'
      ? mediaUrl({ ...addr, mediaId: row.clip.mediaId }) : '',
    badge: i + 1,
    // What is left of the source outside this shot's window, so a trim can pull an edge back out
    // instead of only ever eating into the clip.
    // How far each edge can go back OUT. A still has no source to run out of, so its end is
    // open — you can hold it as long as you like — while a video is bounded by its own file.
    headroom: row.clip?.kind === 'image'
      ? { start: 0, end: 3600 }
      : (row.clip && Number.isFinite(row.clip.seconds) ? {
          start: Math.max(0, row.inS ?? 0),
          end: Math.max(0, row.clip.seconds - (row.outS ?? row.clip.seconds)),
        } : undefined),
    state: row.missing || row.status === 'failed' ? 'failed'
      : row.status === 'ready' ? 'ready' : 'rendering',
    glyph: row.missing || row.status === 'failed' ? <AlertTriangle size={13} /> : null,
    index: i,
  }));

  const sound = (audio || []).map((a, i) => {
    const el = (elements || []).find((e) => e.id === a.elementId);
    const secs = el?.media?.seconds;
    return {
      id: `${a.elementId}-audio-${i}`,
      start: a.startS || 0,
      duration: Number.isFinite(secs) ? secs : null,
      label: el?.media?.label || 'Audio',
      title: `${el?.media?.label || 'Audio'} · starts at ${durationLabel(a.startS || 0)}`,
      glyph: <Music size={12} />,
      accent: 'var(--brand-soft)',
    };
  });

  const tracks = [{
    id: 'video',
    label: 'Video',
    icon: <Video size={12} />,
    clips: shots,
    emptyLabel: 'Nothing in the cut yet. Ask for a shot, or add a clip from the canvas.',
  }];

  // One lane per layer, in the order they are composited: each lane is drawn over the one above
  // it, and the spine is above them all. Reading down the list is reading up through the film.
  // A lane exists because the document has something on it — never as an empty invitation.
  const byLayer = new Map();
  for (const row of layers || []) {
    if (!byLayer.has(row.layer)) byLayer.set(row.layer, []);
    byLayer.get(row.layer).push(row);
  }
  for (const n of [...byLayer.keys()].sort((a, b) => a - b)) {
    tracks.push({
      id: `layer:${n}`,
      // "L1", not "Layer 1": the gutter is one column wide and the long form truncated to
      // "LAYE…", which names nothing. The short form is what an editor calls a track anyway,
      // and the full name is on the lane's tooltip and on the control that frames it.
      label: `L${n}`,
      icon: <Layers size={12} />,
      sequential: false,      // placed: a layer sits at a moment, it is not queued behind anything
      title: n === 1 ? `Layer ${n} · drawn over the cut` : `Layer ${n} · drawn over Layer ${n - 1}`,
      clips: byLayer.get(n).map((row) => ({
        id: `${row.elementId}-ov-${row.index}`,
        start: row.startS,
        duration: Number.isFinite(row.seconds) ? row.seconds : null,
        label: row.label,
        title: `${row.label} · ${row.position === 'full' ? 'fills the frame' : 'inset'}`
             + `${Number.isFinite(row.seconds) ? ` · ${durationLabel(row.seconds)}` : ''}`,
        poster: row.clip?.kind === 'image' && row.clip?.mediaId
          ? mediaUrl({ ...addr, mediaId: row.clip.mediaId })
          : (row.clip ? posterUrl(addr, row.clip) : ''),
        video: row.clip?.kind === 'video' && row.clip?.mediaId && row.status === 'ready'
          ? mediaUrl({ ...addr, mediaId: row.clip.mediaId }) : '',
        headroom: row.clip?.kind === 'image'
          ? { start: 0, end: 3600 }
          : (row.clip && Number.isFinite(row.clip.seconds) ? {
              start: Math.max(0, row.inS ?? 0),
              end: Math.max(0, row.clip.seconds - (row.outS ?? row.clip.seconds)),
            } : undefined),
        state: row.missing || row.status === 'failed' ? 'failed'
          : row.status === 'ready' ? 'ready' : 'rendering',
        glyph: row.missing || row.status === 'failed' ? <AlertTriangle size={13} /> : null,
        index: row.index,
      })),
    });
  }

  // Placed, not sequential: an audio bed starts where the document says it starts.
  if (sound.length) {
    tracks.push({ id: 'audio', label: 'Audio', icon: <Music size={12} />, clips: sound,
                  sequential: false });
  }

  return (
    <Timeline
      tracks={tracks}
      currentTime={currentTime}
      onSeek={onSeek}
      selectedClipId={selectedId}
      onSelectClip={(clip) => onSelect?.(clip.id)}
      // The library speaks clips and seconds; the document speaks shot indexes and a window into
      // the source. This is the whole translation, and it lives here rather than in the library.
      //
      // WHICH LANE THE GESTURE HAPPENED ON DECIDES WHAT IT EDITS. The same drag means "reorder
      // the cut" on the spine and "slide along the film" on a layer, because on a placed lane
      // there is no order to change — and the library says which lane it was.
      onTrim={editable ? ((clip, edge, seconds, track) => {
        if (clip.index === undefined) return;
        if (isLayer(track)) onLayerTrim?.(clip.index, edge, seconds);
        else onTrim?.(clip.index, edge, seconds);
      }) : undefined}
      onSplit={editable ? ((clip, atSeconds, track) => {
        // Splitting a layer would need a second placed item at a computed offset — not wrong,
        // just not built, and offering the gesture where it does nothing is worse than not.
        if (clip.index !== undefined && !isLayer(track)) onSplit?.(clip.index, atSeconds);
      }) : undefined}
      onMoveClip={editable ? ((clip, to, track) => {
        if (clip.index === undefined) return;
        if (isLayer(track)) onLayerMove?.(clip.index, to);
        else if (to !== clip.index) onMove(clip.index, to);
      }) : undefined}
      onDeleteClip={editable ? ((clip, track) => {
        if (clip.index === undefined) return;
        if (isLayer(track)) onLayerRemove?.(clip.index);
        else onRemove(clip.index);
      }) : undefined}
      // Dropping a card from the canvas. The payload is an element id — a reference, never a copy
      // — and which lane it lands on decides what it becomes: a shot in the cut, or a bed under it.
      readDrop={editable ? ((dt) => (dt.types.includes(CLIP_DRAG_TYPE)
        ? dt.getData(CLIP_DRAG_TYPE) || true : null)) : undefined}
      onDropClip={editable ? ((payload, at) => onDrop?.(String(payload), at)) : undefined}
      newLaneLabel={editable ? 'Drop a clip here to add a layer' : undefined}
      snapStorageKey="video.timeline.snap"
      zoomStorageKey="video.timeline.pps"
      laneAppend={editable && canAdd
        ? (track) => (track.id === 'video' ? (
          <button ref={addRef} type="button" className="vd-tk-add" onClick={onAdd}
                  aria-label="Add a clip to the cut" title="Add a clip to the cut">
            <Plus size={14} />
          </button>
        ) : null)
        : undefined}
    />
  );
}
