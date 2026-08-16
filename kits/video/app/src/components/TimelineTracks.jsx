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
import { AlertTriangle, Music, Plus, Video } from 'lucide-react';
import { Timeline } from 'reifyui';
import { durationLabel } from '../lib/timeline';
import { mediaUrl, posterUrl } from '../lib/media';

export function TimelineTracks({
  view, audio, elements, addr, editable, onMove, onRemove, onAdd, canAdd, addRef,
  currentTime = 0, onSeek, onTrim, onSplit, selectedId, onSelect,
}) {
  const shots = (view || []).map((row, i) => ({
    id: `${row.elementId}-${i}`,
    // `seconds` is undefined until the clip has been measured, and it is passed through as-is:
    // the library draws a placeholder for that rather than a length nobody knows.
    duration: Number.isFinite(row.seconds) ? row.seconds : null,
    label: row.label,
    title: `${row.label}${Number.isFinite(row.seconds)
      ? ` · ${durationLabel(row.seconds)}` : ' · still rendering'}`,
    poster: row.clip ? posterUrl(addr, row.clip) : '',
    // No poster on most renders. The clip's own file then shows its first frame — a real
    // frame of the real shot, which is the only preview worth putting on the block.
    video: row.clip?.mediaId && row.status === 'ready'
      ? mediaUrl({ ...addr, mediaId: row.clip.mediaId }) : '',
    badge: i + 1,
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
      onTrim={editable ? ((clip, edge, seconds) => {
        if (clip.index !== undefined) onTrim?.(clip.index, edge, seconds);
      }) : undefined}
      onSplit={editable ? ((clip, atSeconds) => {
        if (clip.index !== undefined) onSplit?.(clip.index, atSeconds);
      }) : undefined}
      onMoveClip={editable ? ((clip, toIndex) => {
        if (clip.index !== undefined && toIndex !== clip.index) onMove(clip.index, toIndex);
      }) : undefined}
      onDeleteClip={editable ? ((clip) => {
        if (clip.index !== undefined) onRemove(clip.index);
      }) : undefined}
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
