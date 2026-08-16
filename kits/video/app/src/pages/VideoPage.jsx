// One video: the canvas on the left, the copilot on the right, the cut along the bottom.
//
// Three loops run here and they must not be confused with each other.
//
//   The DOCUMENT loop — the scene. Two writers: the agent, through its tools, during a turn; and
//   the person, dragging clips and editing the cut. One revision, `If-Match` on every write, 409
//   while the agent holds it and 412 when it moved underneath. The save queue is the sheets and
//   dashboard kits' queue with one addition — 412 merges before it re-arms — and every one of its
//   properties is load-bearing: it re-arms, it never drops, and it always writes the newest whole
//   document.
//
//   The JOB loop — the renders. It has no agent in it and no turn. A clip takes about four minutes
//   and the server keeps polling the provider long after the conversation moved on, so a
//   placeholder becomes a clip in a tab with nothing streaming into it. That is why this page
//   polls at all.
//
//   The CONVERSATION loop — one open stream, in ChatPanel, and nothing else on this page touches it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PaneResizer, useDialog, useResizablePane } from 'reifyui';
import { lastAssistantText } from 'reifyui/harness';
import {
  getScene, isPending, listJobs, markViewed, mediaAddr, mediaCapabilities, putScene, renameVideo,
  sessionTurns, startExport, videoHarness, videoStatus,
} from '../lib/video';
import {
  documentDiffers, mediaChange, mergeScene, parseScene, runningJobIds, stripLinks, toFile,
} from '../lib/scene';
import { overlayView, parseTimeline, readiness, timelineView, toTimelineFile } from '../lib/timeline';
import { exportAvailability, parseCapabilities } from '../lib/capabilities';
import { indexJobs, normalizeJob, spendLabel, totalSpend } from '../lib/jobs';
import { downloadName, mediaUrl } from '../lib/media';
import { MediaCanvas } from '../components/MediaCanvas';
import { TimelineStrip } from '../components/TimelineStrip';
import { PreviewPlayer } from '../components/PreviewPlayer';
import { HeightResizer, useHeightPane } from '../components/HeightResizer';
import { ChatColumn } from '../components/ChatColumn';
import { Topbar } from '../components/Topbar';

const SAVE_DEBOUNCE_MS = 600;
const STATUS_POLL_MS = 2000;
const STATUS_IDLE_MS = 8000;
const SCENE_POLL_MS = 2500;

export function VideoPage({ id: routeId, seed }) {
  // The session id lives in state, not in the route. A video starts as "new:<template>" and becomes
  // a session when its first turn opens one — which arrives WHILE the copilot is streaming.
  // Re-keying this component off the URL at that moment unmounts it mid-stream and throws the turn
  // away.
  const [id, setId] = useState(routeId);
  useEffect(() => { setId(routeId); }, [routeId]);

  const [harness, setHarness] = useState(undefined);  // undefined = unknown, null = not launched
  const [caps, setCaps] = useState(null);
  const [raw, setRaw] = useState(null);            // the document as written
  const [scene, setScene] = useState(null);        // the parsed view of it
  const [rev, setRev] = useState(undefined);
  const [sceneError, setSceneError] = useState('');
  const [noScene, setNoScene] = useState(null);
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState('');  // '' | saving | saved | waiting | error
  const [saveError, setSaveError] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [jobs, setJobs] = useState(() => new Map());
  const [chatOpen, setChatOpen] = useState(true);
  const [tlOpen, setTlOpen] = useState(true);
  const [exporting, setExporting] = useState('');
  // Where the preview is, shared so the timeline's playhead and the counter read one number.
  const [playAt, setPlayAt] = useState(0);
  const [seekTo, setSeekTo] = useState(null);
  // Which shot is selected, by index. Held here because Remove and the keyboard act on it.
  const [selShot, setSelShot] = useState(null);

  const dialog = useDialog();
  // The film column. Its own stored width, so moving the conversation does not move it.
  const stagePane = useResizablePane({
    initial: 420, min: 300, maxFraction: 0.55, fromRight: true, storageKey: 'video.stage.w',
  });
  // Whether what is selected on the board is one of our clips, which decides whether the shape
  // inspector is shown — see the rule in app.css.
  const [clipPicked, setClipPicked] = useState(false);

  // The timeline's height. Its top border is the handle; see HeightResizer.
  const tlPane = useHeightPane({ initial: 210, min: 96, storageKey: 'video.timeline.h' });
  const chatPane = useResizablePane({
    initial: 380, min: 300, maxFraction: 0.6, fromRight: true, storageKey: 'videos.chat.w',
  });

  const rawRef = useRef(null); rawRef.current = raw;
  const idRef = useRef(id); idRef.current = id;
  const revRef = useRef(undefined);
  const baseRef = useRef(null);       // what this tab last agreed with the server about
  const hidRef = useRef('');
  const save = useRef({ timer: null, inFlight: false, backoff: 0, wanted: null });

  const addr = useMemo(() => mediaAddr(harness?.id || '', isPending(id) ? '' : id), [harness, id]);

  // ── reconciling with the server ───────────────────────────────────────────
  /** Take the server's copy of the document and fold this tab's unsaved work into it.
   *
   *  Called on every poll while anything is in flight, and again whenever a write comes back 412.
   *  Two things keep it from becoming a write loop, and both are load-bearing:
   *
   *  The revision is the server's own statement about whether anything changed, so an unchanged
   *  revision means there is nothing to take and this returns without touching the document. It
   *  used to rebuild it anyway — a new object, equal in every field — and the save queue compares
   *  by identity, so every poll looked like an unsaved edit. That wrote the document back every
   *  2.5 seconds, forever, to a server that had just been asked what was in it.
   *
   *  And adopting the server's copy is not an edit. Unless this tab had unsaved work when the poll
   *  started, the adopted document becomes what the queue considers already written. */
  const reconcile = useCallback(async () => {
    if (!hidRef.current || isPending(idRef.current)) return;
    const dirty = rawRef.current !== save.current.wanted;
    const res = await getScene(hidRef.current, idRef.current).catch(() => null);
    if (!res?.scene) return;
    if (res.rev === revRef.current) return;
    const server = parseScene(res.scene).scene;
    if (!server) return;
    const local = parseScene(rawRef.current).scene;
    const merged = local ? mergeScene({ base: parseScene(baseRef.current).scene, local, server }) : server;
    const next = toFile(res.scene, {
      elements: stripLinks(merged.elements),
      appState: merged.appState,
      files: merged.files,
      timeline: merged.timeline,
      title: merged.title,
    });
    revRef.current = res.rev;
    setRev(res.rev);
    baseRef.current = res.scene;
    setRaw(next); rawRef.current = next;
    if (!dirty) save.current.wanted = next;
    const parsed = parseScene(next);
    setScene(parsed.scene || null);
    setSceneError(parsed.error || '');
  }, []);

  // ── the one writer ────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    const q = save.current;
    if (q.inFlight || isPending(idRef.current) || !hidRef.current) return;
    const file = rawRef.current;
    if (!file || file === q.wanted) return;

    // A new document object is not a changed document. The canvas hands one back whenever
    // Excalidraw re-measures its own text, which it does once per load as the fonts arrive, and
    // writing that costs a revision on a video nobody edited. Comparing what it SAYS against what
    // was last agreed is the difference between a save queue and a heartbeat.
    if (!documentDiffers(baseRef.current, file)) {
      q.wanted = file;
      setSaveState('');
      return;
    }

    // Refused before it is sent, not after. Only a job places or removes a clip, and the store
    // answers 422 for a write that does either — but a save that silently stops working is a worse
    // way to learn that than a sentence naming the element.
    const forbidden = mediaChange(baseRef.current, file);
    if (forbidden) {
      setSaveState('error');
      setSaveError(`This canvas can’t be saved because ${forbidden}. Reload to get the copilot’s version.`);
      return;
    }

    q.inFlight = true;
    const attempt = file;
    try {
      const res = await putScene(hidRef.current, idRef.current, revRef.current, attempt);
      q.inFlight = false;
      q.backoff = 0;
      q.wanted = attempt;
      baseRef.current = attempt;
      if (Number.isFinite(res?.rev)) { revRef.current = res.rev; setRev(res.rev); }
      if (rawRef.current !== attempt) { flush(); return; }   // it changed while we wrote
      setSaveState('saved');
      setSaveError('');
      window.setTimeout(() => setSaveState((v) => (v === 'saved' ? '' : v)), 1800);
    } catch (e) {
      q.inFlight = false;
      // 409 means the agent holds the document; 412 means it moved under us — almost always a
      // render landing while somebody was dragging. Neither drops the write: it is merged where
      // merging applies, re-armed with backoff, and the newest whole document is written when the
      // way is clear. The backoff cap is what keeps a 412 ping-pong from becoming a hot loop.
      if (e?.status === 412) await reconcile();
      const retryable = e?.status === 409 || e?.status === 412;
      setSaveState(retryable ? 'waiting' : 'error');
      setSaveError(retryable ? '' : e?.message || 'Could not save this canvas.');
      // Only 409 and 412 are worth trying again: one waits for a turn to end, the other for a
      // revision to settle, and both clear on their own. Anything else is this write being wrong,
      // and repeating a wrong write every few seconds forever does not make it right — it just
      // hides the reason. A malformed body looped here unnoticed until the console was read.
      if (!retryable) return;
      q.backoff = Math.min(8000, q.backoff ? q.backoff * 2 : 1000);
      window.clearTimeout(q.timer);
      q.timer = window.setTimeout(flush, q.backoff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback((nextRaw) => {
    setRaw(nextRaw);
    rawRef.current = nextRaw;
    const parsed = parseScene(nextRaw);
    setScene(parsed.scene || null);
    setSceneError(parsed.error || '');
    if (isPending(idRef.current)) return;
    setSaveState('saving');
    window.clearTimeout(save.current.timer);
    save.current.timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // ── loading ───────────────────────────────────────────────────────────────
  // "No canvas" is three different situations and they must not look alike: it is there; a turn is
  // still building it; or a turn finished having made nothing, in which case the agent's own last
  // words are the only honest explanation available.
  const load = useCallback(async () => {
    const hid = hidRef.current;
    if (!hid || isPending(idRef.current)) return;
    try {
      const res = await getScene(hid, idRef.current);
      if (res?.scene) {
        setNoScene(null);
        revRef.current = res.rev;
        setRev(res.rev);
        baseRef.current = res.scene;
        save.current.wanted = res.scene;
        setRaw(res.scene); rawRef.current = res.scene;
        const parsed = parseScene(res.scene);
        setScene(parsed.scene || null);
        setSceneError(parsed.error || '');
        return;
      }
      const st = await videoStatus(idRef.current).catch(() => '');
      if (['running', 'starting'].includes(st)) {
        setNoScene({ working: true, text: 'Planning your film…' });
        return;
      }
      const turns = await sessionTurns(idRef.current).catch(() => []);
      const last = turns[turns.length - 1];
      setNoScene({
        working: false,
        text: last?.status && last.status !== 'completed'
          ? `The last turn ended as “${last.status}” without making anything.`
          : 'Nothing has been made for this conversation yet.',
        detail: String(lastAssistantText(turns) || '').slice(0, 400),
      });
    } catch (e) {
      // A canvas this app cannot reach is not an empty canvas. Saying so beats an empty board that
      // looks like a video somebody lost.
      setErr(e?.message || 'Could not open this video.');
    }
  }, []);

  useEffect(() => {
    markViewed(id);
    videoHarness().then((h) => {
      setHarness(h || null);
      hidRef.current = h?.id || '';
      if (!h) return;
      mediaCapabilities(h.id).then((r) => setCaps(parseCapabilities(r))).catch(() => setCaps(null));
      load();
    }).catch(() => setHarness(null));
  }, [id, load]);

  // Below 900px the conversation is a full-height drawer (chat.css) that covers the canvas, so it
  // must start closed there. Deciding that from one `window.innerWidth` read at mount is a race:
  // during the first paint that read can still be the window's width rather than the viewport's,
  // and the drawer lands open over the film the person just asked for. matchMedia is an event, so
  // it cannot be read too early. Narrowing closes it; widening does not force it open, because by
  // then the choice is theirs.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => { if (mq.matches) { setChatOpen(false); setTlOpen(false); } };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ── the agent's lock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPending(id)) return undefined;
    let dead = false;
    const tick = () => videoStatus(id)
      .then((st) => { if (!dead) setAgentBusy(['running', 'starting'].includes(st)); })
      .catch(() => {});
    tick();
    const iv = window.setInterval(tick, agentBusy ? STATUS_POLL_MS : STATUS_IDLE_MS);
    return () => { dead = true; window.clearInterval(iv); };
  }, [id, agentBusy]);

  // Once the turn ends, write whatever accumulated while the document was locked.
  const prevBusy = useRef(false);
  useEffect(() => {
    if (prevBusy.current && !agentBusy) reconcile().then(() => flush());
    prevBusy.current = agentBusy;
  }, [agentBusy, reconcile, flush]);

  // ── the job loop ──────────────────────────────────────────────────────────
  const running = useMemo(() => runningJobIds(scene?.elements), [scene]);

  const pollJobs = useCallback(async () => {
    if (!hidRef.current || isPending(idRef.current)) return;
    // Every job in the session, not only the running ones: the spend figure is summed from all of
    // them, and a job the agent submitted and never placed still cost money.
    const res = await listJobs(hidRef.current, idRef.current).catch(() => null);
    if (!res?.jobs) return;
    setJobs(indexJobs(res.jobs.map(normalizeJob)));
  }, []);

  useEffect(() => { pollJobs(); }, [id, harness, pollJobs]);

  // Keep looking while anything is in flight: the document is changed by the SERVER when a render
  // lands, and a reopened tab has no stream. Stops on its own when the last placeholder becomes a
  // clip, which is what keeps an idle video from polling forever.
  useEffect(() => {
    if (!agentBusy && !running.length && !noScene?.working && !exporting) return undefined;
    const iv = window.setInterval(() => {
      if (save.current.inFlight) return;   // a poll mid-write would fight the write
      if (rawRef.current) reconcile(); else load();
      pollJobs();
    }, SCENE_POLL_MS);
    return () => window.clearInterval(iv);
  }, [agentBusy, running.length, noScene?.working, exporting, reconcile, load, pollJobs]);

  // ── the document, edited here ─────────────────────────────────────────────
  const timeline = useMemo(() => parseTimeline(scene), [scene]);

  const onCanvasChange = useCallback(({ elements, appState }) => {
    if (!rawRef.current) return;
    // The link is derived state that Excalidraw needs in order to draw a clip at all; it must not
    // reach the file, where a deployment's address would rot into it.
    commit(toFile(rawRef.current, { elements: stripLinks(elements), appState }));
  }, [commit]);

  const onTimelineChange = useCallback((next) => {
    if (!rawRef.current) return;
    commit(toFile(rawRef.current, { timeline: toTimelineFile(next) }));
  }, [commit]);

  const rename = useCallback(async () => {
    const name = await dialog.prompt({
      title: 'Rename video', defaultValue: scene?.title || '', confirmLabel: 'Rename',
    });
    const next = (name || '').trim();
    if (!next || !rawRef.current) return;
    commit(toFile(rawRef.current, { title: next }));
    renameVideo(idRef.current, next).catch(() => {});
  }, [dialog, scene, commit]);

  // ── export ────────────────────────────────────────────────────────────────
  const exportInfo = exportAvailability(caps);
  // THE LATEST EXPORT, not the first one the server listed. A session accumulates them — every
  // re-cut is another — and following the oldest meant the button sat on 'Starting…' through a
  // whole render and the player went on offering a film from two edits ago.
  const exports = useMemo(
    () => [...jobs.values()].filter((j) => j.capability === 'export')
      .sort((a, b) => a.createdAt - b.createdAt),
    [jobs]);
  const exportJob = exports.length ? exports[exports.length - 1] : null;
  const film = useMemo(
    () => [...exports].reverse().find((j) => j.status === 'succeeded' && j.mediaId) || null,
    [exports]);
  const filmUrl = film ? mediaUrl({ ...addr, mediaId: film.mediaId }) : '';

  useEffect(() => {
    // The button's label follows the real job, so a reopened tab shows an export that is still
    // running rather than an idle button.
    if (exportJob?.status === 'running') setExporting(exportJob.progress || 'Exporting…');
    else setExporting('');
  }, [exportJob?.status, exportJob?.progress]);

  const onExport = useCallback(async () => {
    if (!hidRef.current || isPending(idRef.current)) return;
    setExporting('Starting…');
    try {
      await startExport(hidRef.current, idRef.current, downloadName(scene?.title));
      pollJobs();
    } catch (e) {
      setExporting('');
      dialog.alert({ variant: 'error', title: 'Could not start the export', message: e?.message || '' });
    }
  }, [scene, dialog, pollJobs]);

  const onRetry = useCallback((clip) => {
    // The copilot decides whether to spend money again, with the cost in front of it. This page
    // never re-submits a generation on its own.
    setChatOpen(true);
    dialog.alert({
      title: 'Ask the copilot to try again',
      message: `${clip.label || 'That shot'} failed to render. Tell the copilot in the conversation — `
        + 'it will pick a model that is working and tell you what the retry costs. Nothing is '
        + 're-rendered automatically, because every attempt is charged.',
    });
  }, [dialog]);

  // ── rendering ─────────────────────────────────────────────────────────────
  // A video that will not open. This screen used to be the server's own sentence — "No session with
  // that id." — in a red bar above nothing at all, which is wrong twice over: the person got here
  // by clicking a row in their own list, so being told the thing does not exist reads as the list
  // lying, and a page with no canvas, no cut, no conversation and no way out is a dead end they can
  // only escape from with the back button.
  //
  // So: say which thing is broken (this one video, not the app and not the rest of the list), keep
  // the server's reason in small print because "it didn't work" is not something anyone can report,
  // and offer the two things that can actually help — try it again, in case the network blinked,
  // and go back to the list.
  if (err) {
    return (
      <div className="vd-root"><div className="vd-main">
        <Topbar caps={caps} />
        <div className="vd-body">
          <div className="vd-empty">
            <div className="big">This video can’t be opened</div>
            <div>It may have been deleted, or it may not be one of your videos. Everything else in
              your list is fine.</div>
            <p className="vd-empty-detail">{err}</p>
            <div className="vd-empty-acts">
              <button type="button" className="btn" onClick={() => { setErr(''); load(); }}>
                Try again
              </button>
              <a className="btn primary" href="#/">Back to my videos</a>
            </div>
          </div>
        </div>
      </div></div>
    );
  }

  const saveLabel = { saving: 'Saving…', saved: 'Saved', waiting: 'Waiting for the agent…',
                      error: 'Couldn’t save' }[saveState] || '';
  const spend = totalSpend([...jobs.values()]);

  return (
    <div className="vd-root">
      <div className="vd-main">
        <Topbar caps={caps}>
          {scene && (
            <>
              <button type="button" className="vd-title" onClick={isPending(id) ? undefined : rename}
                      title={isPending(id) ? undefined : 'Rename this video'}>
                {scene.title || 'Untitled video'}
              </button>
              {saveLabel && <span className="vd-save">{saveLabel}</span>}
              {/* Measured spend only. A session whose jobs reported no cost shows no counter at
                  all — never "$0.00", which reads as "this is free". */}
              {spend !== null && <span className="vd-spend" title="What this video has cost so far">{spendLabel(spend)}</span>}
            </>
          )}
        </Topbar>

        {agentBusy && scene && (
          <div className="vd-lock">The agent is working on this video. Your changes will save when
            the turn ends.</div>
        )}
        {saveError && <div className="vd-note is-err">{saveError}</div>}
        {sceneError && (
          <div className="vd-note is-err">
            {sceneError} Ask the copilot to rebuild it — the conversation is on the right.
          </div>
        )}
        {harness === null && (
          <div className="vd-note is-err">Videos hasn’t been launched yet — open Starter Kits and launch it.</div>
        )}

        <div className="vd-body">
          {!scene ? (
            <div className="vd-empty">
              {(!noScene || noScene.working) ? (
                <>
                  {/* A brand-new video is not loading — there is no session yet and nothing has
                      been asked for. Saying "Loading…" claims a request that is not in flight, and
                      it is the first thing anyone sees after pressing Make it. */}
                  {!isPending(id) && <span className="pulse-dot" />}
                  <div className="big">
                    {isPending(id) ? 'Your canvas appears here' : noScene?.text || 'Opening this video…'}
                  </div>
                  <div>The shot list is agreed in the conversation first. Nothing renders until you say yes.</div>
                </>
              ) : (
                <>
                  <div className="big">{noScene.text}</div>
                  {noScene.detail && <pre className="vd-empty-detail">{noScene.detail}</pre>}
                  <div style={{ marginTop: 14 }}>Ask again on the right — the conversation is still here.</div>
                </>
              )}
            </div>
          ) : (
            /* Canvas on the left, the film on the right, with a divider you can move. They are
               two different jobs — arranging the board, and watching the cut — and giving the
               second one a permanent home is what lets the timeline show tracks instead of a
               single row squeezed under a full-width canvas. */
            <div className="vd-work">
              <div className={'vd-canvas' + (clipPicked ? ' is-clip-selected' : '')}>
                <MediaCanvas
                  scene={scene}
                  rev={rev}
                  addr={addr}
                  editable={!agentBusy}
                  jobs={jobs}
                  onChange={onCanvasChange}
                  onRetry={onRetry}
                  onSelection={setClipPicked}
                />
              </div>

              <PaneResizer pane={stagePane} />

              <aside className="vd-stage" style={{ width: stagePane.width }} aria-label="Film">
                {/* The player sits in the middle of whatever room the timeline leaves it. */}
                <div className="vd-stage-view">
                  <PreviewPlayer
                    view={timelineView(timeline, scene.elements)}
                    layers={overlayView(timeline, scene.elements)}
                    addr={addr}
                    filmUrl={filmUrl}
                    total={readiness(timeline, timelineView(timeline, scene.elements)).total}
                    // How many playable clips exist at all, so the empty state can tell "nothing
                    // made yet" apart from "made, but not in the cut" — two different situations
                    // with two different things for a person to do next.
                    canvasClips={(scene.elements || []).filter((e) => e.media?.mediaId).length}
                    onTime={setPlayAt}
                    seekTo={seekTo}
                  />
                </div>

                <HeightResizer pane={tlPane} />

                <TimelineStrip
                  height={tlOpen ? tlPane.height : undefined}
                  onNeedHeight={tlPane.ensure}
                  currentTime={playAt}
                  onSeek={(t) => setSeekTo({ t, nonce: Date.now() })}
                  selectedId={selShot}
                  onSelect={setSelShot}
                  timeline={timeline}
                  elements={scene.elements}
                  addr={addr}
                  editable={!agentBusy}
                  open={tlOpen}
                  onToggle={() => setTlOpen((v) => !v)}
                  onChange={onTimelineChange}
                  exportState={exporting}
                  onExport={onExport}
                  exportUnavailable={exportInfo.available === false ? exportInfo.reason : ''}
                  filmUrl={filmUrl}
                />
              </aside>
            </div>
          )}
        </div>
      </div>

      {/* The grab handle between the canvas and the conversation. `useResizablePane` computes the
          width and stores it, but it draws nothing — without this the pane has a width that can
          only ever be its default, which is how the dashboard kit shipped once: the hook wired,
          the handle missing, and the column looking identical to the other kits until you tried to
          drag it. Same component, same place, as slides, sheets and dashboards. */}
      <PaneResizer pane={chatPane} />

      <ChatColumn
        videoId={id}
        seed={seed}
        title={scene?.title}
        agentBusy={agentBusy}
        onSceneMaybeChanged={() => { reconcile(); pollJobs(); }}
        onSessionStarted={(sid) => {
          setId(sid);
          idRef.current = sid;
          window.history.replaceState(null, '', `${window.location.pathname}#/v/${encodeURIComponent(sid)}`);
        }}
        width={chatPane.width}
        collapsed={!chatOpen}
        onToggle={() => setChatOpen((v) => !v)}
      />
    </div>
  );
}
