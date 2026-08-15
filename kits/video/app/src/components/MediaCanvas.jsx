// The canvas: Excalidraw, with our clips drawn inside it.
//
// Dragging, resizing, freehand drawing, multi-select, undo, zoom and the whole toolbar are
// Excalidraw's. What is here is only the three things that are about VIDEO.
//
//   1. Clips are `embeddable` elements and we replace what Excalidraw would put in them.
//      Excalidraw has no video element — its element union is generic|text|linear|arrow|freedraw|
//      image|frame|magicframe|iframe|embeddable and its image loader builds an HTMLImageElement —
//      so an embeddable with `renderEmbeddable` is the only way to get a real <video> onto the
//      board. It pans and zooms with the scene and keeps playing across scene updates, because it
//      is keyed by the element's id.
//
//      One element per clip, not two. A backing rectangle plus a captured first frame doubles
//      every move, every delete and every selection, and the two halves drift apart the first time
//      somebody drags one of them.
//
//   2. The link. Excalidraw decides whether an embeddable may be drawn by validating
//      `element.link` — once, cached by element id — and silently skips the ones that fail. So the
//      link is put on here, on the way in, and taken off before the document is written (lib/scene).
//
//   3. Telling our own updates apart from the person's. Excalidraw's onChange fires on every
//      componentDidUpdate, including pans, zooms and selections, with no throttle; and pushing the
//      server's copy in with updateScene fires it too. Both are gated on `changeKey`, or every
//      mouse move during a pan is a several-hundred-KB write.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { changeKey, contentKey, filesForScene, hydrateLinks, mediaOf, sanitizeAppState } from '../lib/scene';
import { embedLink, mediaUrl, posterUrl } from '../lib/media';
import { failureText, progressLabel } from '../lib/jobs';

export function MediaCanvas({ scene, rev, addr, editable, jobs, onChange, onRetry }) {
  const apiRef = useRef(null);
  // The key of whatever is currently in the canvas. Set both when WE push and when the person
  // edits, so a push never comes back out as a change of theirs.
  const keyRef = useRef('');
  // What the document said the last time it changed for real. See handleChange.
  const contentRef = useRef(null);
  const appliedRev = useRef(null);

  const urlFor = useCallback((mediaId) => mediaUrl({ ...addr, mediaId }), [addr]);
  const linkFor = useCallback((clip) => embedLink(addr, clip), [addr]);

  // What the canvas should be showing: the document's elements with their links on, and a files
  // map derived from the media ids rather than read out of the file.
  const view = useMemo(() => {
    const elements = hydrateLinks(scene?.elements || [], linkFor);
    return { elements, files: filesForScene(elements, urlFor), appState: sanitizeAppState(scene?.appState) };
  }, [scene, linkFor, urlFor]);

  const initialData = useRef({
    elements: view.elements,
    appState: { ...view.appState, collaborators: undefined },
    files: view.files,
    scrollToContent: true,
  }).current;
  if (contentRef.current === null) contentRef.current = contentKey(view.elements);

  // Push the document into the canvas whenever the revision moves — a job landing, the agent
  // placing a clip, another tab. `captureUpdate: NEVER` keeps it out of the person's undo stack:
  // a clip arriving is not something they did, and Ctrl-Z must not remove it.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || rev === undefined || rev === appliedRev.current) return;
    appliedRev.current = rev;
    const next = changeKey(view.elements, view.files);
    if (next === keyRef.current) return;
    keyRef.current = next;
    contentRef.current = contentKey(view.elements);
    // addFiles before updateScene: an image element whose file is not registered yet renders as a
    // broken box for one frame. A file id is a media id and media ids are never reused, so a
    // finished frame always arrives as a NEW file — addFiles will not update one it already has.
    api.addFiles(Object.values(view.files));
    api.updateScene({
      elements: view.elements,
      appState: view.appState,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [rev, view]);

  // Two gates, because there are two different non-edits to keep out of the document.
  //
  //   The cheap one: Excalidraw's onChange fires on every componentDidUpdate — every pan, every
  //   zoom, every selection, unthrottled — and none of those move an element's version. Comparing
  //   the version sum discards them without touching the elements at all, which matters when the
  //   alternative runs sixty times a second during a drag of the canvas.
  //
  //   The exact one: `restore()` bumps every element's version while normalising the scene on
  //   load, so the version sum moves once for a document nobody has touched. Writing on that made
  //   simply OPENING a video write to it — a new revision, racing the agent, for a change of
  //   nothing. So once the counter moves, what actually gets compared is the content.
  const handleChange = useCallback((elements, appState, files) => {
    const next = changeKey(elements, files);
    if (next === keyRef.current) return;
    keyRef.current = next;
    const content = contentKey(elements);
    if (content === contentRef.current) return;
    contentRef.current = content;
    onChange({ elements, appState });
  }, [onChange]);

  // Never off-origin. Our own player is rendered instead of the iframe, so nothing here is ever
  // actually loaded in a frame — but a scene is a file people can hand each other, and an
  // embeddable pointing somewhere else must not become a way to load it.
  const validateEmbeddable = useCallback(
    (link) => typeof link === 'string' && link.startsWith(window.location.origin), [],
  );

  const renderEmbeddable = useCallback((element) => {
    const clip = mediaOf(element);
    if (!clip) return null;               // a genuine embed — let Excalidraw handle it
    return (
      <ClipBody
        clip={clip}
        addr={addr}
        job={jobs.get(clip.jobId) || null}
        onRetry={onRetry}
      />
    );
  }, [addr, jobs, onRetry]);

  return (
    <Excalidraw
      excalidrawAPI={(api) => { apiRef.current = api; }}
      initialData={initialData}
      // Dragging while the agent is rewriting the document would produce a save that loses to a
      // 409 and then overwrites the agent's newer canvas when it retries.
      viewModeEnabled={!editable}
      onChange={handleChange}
      renderEmbeddable={renderEmbeddable}
      validateEmbeddable={validateEmbeddable}
      // The image tool is off: a clip on this board is something a job produced and paid for, and
      // a picture dropped in from a desktop would be a media element the server never placed —
      // which the store refuses anyway, as a save that silently stops working.
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
      name="canvas"
    />
  );
}

/** What sits inside a clip's box: the player, or the honest state of what is not one yet. */
function ClipBody({ clip, addr, job, onRetry }) {
  if (clip.status === 'running') {
    const progress = progressLabel(job);
    return (
      <div className="vd-clip is-running">
        <span className="vd-clip-shimmer" aria-hidden="true" />
        <div className="vd-clip-mid">
          <div className="vd-clip-label">{clip.label || 'Rendering'}</div>
          {/* The model that is actually running it, and the progress the server reported — never
              an ETA, and never a bar computed from elapsed time. A four-minute render whose bar is
              our arithmetic sits at 95% for two minutes. */}
          <div className="vd-clip-sub">
            {clip.model || 'Rendering'}{progress ? ` · ${progress}` : ''}
          </div>
        </div>
      </div>
    );
  }

  if (clip.status === 'failed') {
    return (
      <div className="vd-clip is-failed">
        <div className="vd-clip-mid">
          <AlertTriangle size={16} />
          <div className="vd-clip-label">{clip.label || 'This shot failed'}</div>
          <div className="vd-clip-err">{failureText(job) || clip.error || 'The render failed.'}</div>
          {onRetry && (
            <button type="button" className="btn" onClick={() => onRetry(clip)}>
              <RotateCcw size={13} /> Ask again
            </button>
          )}
        </div>
      </div>
    );
  }

  const src = mediaUrl({ ...addr, mediaId: clip.mediaId });
  if (!src) return <div className="vd-clip is-running"><span className="vd-clip-shimmer" aria-hidden="true" /></div>;

  if (clip.kind === 'audio') {
    return (
      <div className="vd-clip is-audio">
        <div className="vd-clip-label">{clip.label || 'Narration'}</div>
        <audio src={src} controls preload="metadata" />
      </div>
    );
  }

  return (
    <video
      className="vd-clip-video"
      src={src}
      poster={posterUrl(addr, clip) || undefined}
      controls
      // metadata, not auto: a board of ten clips would otherwise pull ten files the moment it
      // opened, and most of them are never played.
      preload="metadata"
      playsInline
    />
  );
}
