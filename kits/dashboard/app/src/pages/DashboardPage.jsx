// One dashboard: the board on the left, the copilot on the right.
//
// Two loops run here and they must not be confused with each other.
//
//   The DOCUMENT loop — dashboard.json. The agent writes it during a turn; the app reads it and
//   writes back the layout when someone drags a panel. Exactly the shape the sheets kit uses,
//   for the same reason: two writers, one file, and a 409 while the agent holds it.
//
//   The DATA loop — the queries in that document, run against the database. This one has no
//   agent in it at all. Opening the page runs every query once; the Refresh button runs them
//   again. There is no interval and no cache, because a number whose age is uncertain is worse
//   than a number you have to ask for.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useDialog, useResizablePane } from 'reifyui';
import {
  dashboardStatus, getDashboard, isPending, markViewed, renameDashboard, saveDashboard,
  sessionTurns,
} from '../lib/dash';
import { datasource, runQuery } from '../lib/query';
import { parseDashboard, toFile } from '../lib/dashboard';
import { freshness, refreshAll } from '../lib/refresh';
import { DashboardCanvas } from '../components/DashboardCanvas';
import { ChatColumn } from '../components/ChatColumn';
import { Topbar } from '../components/Topbar';

const SAVE_DEBOUNCE_MS = 600;
const STATUS_POLL_MS = 2000;
const STATUS_IDLE_MS = 8000;
const RELOAD_POLL_MS = 2500;

/** The last thing the agent said, for the case where a turn ended having written no file — its
 *  own words are the only honest explanation available. */
function lastAssistantText(turns) {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    const text = t?.assistant_text || t?.output_text || '';
    if (text) return String(text);
  }
  return '';
}

export function DashboardPage({ id: routeId, seed }) {
  // The session id lives in state, not in the route. A dashboard starts as "new:<template>" and
  // becomes a session when its first turn opens one — which arrives WHILE the copilot is
  // streaming. Re-keying this component off the URL at that moment unmounts it mid-stream and
  // throws the turn away.
  const [id, setId] = useState(routeId);
  useEffect(() => { setId(routeId); }, [routeId]);

  const [raw, setRaw] = useState(null);            // the file as written
  const [doc, setDoc] = useState(null);            // the parsed view of it
  const [docError, setDocError] = useState('');    // the file is there but unreadable
  const [noDoc, setNoDoc] = useState(null);        // no file yet, and why
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState('');  // '' | saving | saved | waiting | error
  const [agentBusy, setAgentBusy] = useState(false);
  const [conn, setConn] = useState(undefined);
  const [states, setStates] = useState(() => new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [ranAt, setRanAt] = useState(0);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 900);

  const dialog = useDialog();
  const chatPane = useResizablePane({
    initial: 380, min: 300, maxFraction: 0.6, fromRight: true, storageKey: 'dashboards.chat.w',
  });

  const rawRef = useRef(null); rawRef.current = raw;
  const idRef = useRef(id); idRef.current = id;
  const mirrored = useRef('');
  const save = useRef({ timer: null, inFlight: false, backoff: 0, wanted: null });
  const runRef = useRef(null);      // the AbortController of the refresh in flight

  // ── the one writer ────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    const q = save.current;
    if (q.inFlight || isPending(idRef.current)) return;
    const file = rawRef.current;
    if (!file || file === q.wanted) return;
    q.inFlight = true;
    const attempt = file;
    try {
      await saveDashboard(idRef.current, attempt);
      q.inFlight = false;
      q.backoff = 0;
      q.wanted = attempt;
      if (rawRef.current !== attempt) { flush(); return; }   // it changed while we wrote
      setSaveState('saved');
      window.setTimeout(() => setSaveState((v) => (v === 'saved' ? '' : v)), 1800);
    } catch (e) {
      q.inFlight = false;
      // 409 means the agent holds the file. That is the lock, and it is honest — but the write
      // is not dropped: it is re-armed with backoff and the newest whole document is written
      // when the turn ends.
      setSaveState(e?.status === 409 ? 'waiting' : 'error');
      q.backoff = Math.min(8000, q.backoff ? q.backoff * 2 : 1000);
      window.clearTimeout(q.timer);
      q.timer = window.setTimeout(flush, q.backoff);
    }
  }, []);

  const commit = useCallback((nextRaw) => {
    setRaw(nextRaw);
    rawRef.current = nextRaw;
    const parsed = parseDashboard(nextRaw);
    setDoc(parsed.doc || null);
    setDocError(parsed.error || '');
    if (isPending(idRef.current)) return;
    setSaveState('saving');
    window.clearTimeout(save.current.timer);
    save.current.timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // ── loading the document ──────────────────────────────────────────────────
  // "No dashboard" is three different situations and they must not look alike: the file is
  // there; a turn is still writing it; or a turn finished having written nothing, in which case
  // its own last words are the only honest explanation we have.
  const load = useCallback(async () => {
    try {
      const file = await getDashboard(idRef.current);
      if (file) {
        setNoDoc(null);
        const parsed = parseDashboard(file);
        setRaw(file); rawRef.current = file; save.current.wanted = file;
        setDoc(parsed.doc || null);
        setDocError(parsed.error || '');
        return parsed.doc || null;
      }
      const st = await dashboardStatus(idRef.current).catch(() => '');
      if (['running', 'starting'].includes(st)) {
        setNoDoc({ working: true, text: 'Building your dashboard…' });
        return null;
      }
      const turns = isPending(idRef.current) ? [] : await sessionTurns(idRef.current).catch(() => []);
      const last = turns[turns.length - 1];
      setNoDoc({
        working: false,
        text: last?.status && last.status !== 'completed'
          ? `The last turn ended as “${last.status}” without writing a dashboard.`
          : 'No dashboard has been built for this conversation yet.',
        detail: lastAssistantText(turns).slice(0, 400),
      });
      return null;
    } catch (e) {
      setErr(e?.message || 'Could not open this dashboard.');
      return null;
    }
  }, []);

  useEffect(() => { markViewed(id); load(); }, [id, load]);
  useEffect(() => { datasource().then(setConn).catch(() => setConn(null)); }, []);

  // Keep looking while the agent works: the file is written DURING the turn and reads hit the
  // live workspace, so panels appear as they are built. Without this the page shows "Building
  // your dashboard…" over a file already on disk — a reloaded tab has no stream.
  useEffect(() => {
    if (!noDoc?.working && doc && !agentBusy) return undefined;
    const t = window.setInterval(() => { void load(); }, RELOAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [noDoc?.working, doc, agentBusy, load]);

  // ── the agent's lock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPending(id)) return undefined;
    let dead = false;
    const tick = () => dashboardStatus(id)
      .then((st) => { if (!dead) setAgentBusy(['running', 'starting'].includes(st)); })
      .catch(() => {});
    tick();
    const iv = window.setInterval(tick, agentBusy ? STATUS_POLL_MS : STATUS_IDLE_MS);
    return () => { dead = true; window.clearInterval(iv); };
  }, [id, agentBusy]);

  // Once the turn ends, write whatever accumulated while the file was locked.
  const prevBusy = useRef(false);
  useEffect(() => {
    if (prevBusy.current && !agentBusy) {
      mirrored.current = '';          // the turn just renamed the session; re-assert the real name
      load().then(() => flush());
    }
    prevBusy.current = agentBusy;
  }, [agentBusy, load, flush]);

  // ── the data loop ─────────────────────────────────────────────────────────
  const refresh = useCallback(async (target) => {
    const board = target || doc;
    if (!board?.panels.length) return;
    runRef.current?.abort();                      // one refresh at a time; the newer one wins
    const ctl = new AbortController();
    runRef.current = ctl;
    setRefreshing(true);
    // A fresh Map per update, because React compares by reference and mutating the old one in
    // place is how a panel stays on its loading bars after its query has landed.
    setStates(new Map());
    await refreshAll(board, (sql) => runQuery(sql), {
      signal: ctl.signal,
      onUpdate: (qid, st) => setStates((prev) => new Map(prev).set(qid, st)),
    });
    if (ctl.signal.aborted) return;
    setRefreshing(false);
    setRanAt(Date.now());
  }, [doc]);

  // Opening the dashboard runs every query. Keyed on the SET of queries rather than on the
  // document object: the agent rewriting a title should not re-run the database, and a poll that
  // returns an equal-but-new object should not either.
  const querySig = useMemo(
    () => (doc ? [...doc.queries.values()].map((q) => `${q.id}:${q.sql}`).join(' ') : ''),
    [doc],
  );
  useEffect(() => {
    if (!doc || !querySig) return undefined;
    void refresh(doc);
    return () => runRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySig]);

  // Leaving the page stops the run rather than letting it finish into a page that is gone.
  useEffect(() => () => runRef.current?.abort(), []);

  // ── the person's layout ───────────────────────────────────────────────────
  const onLayoutChange = useCallback((next) => {
    if (!rawRef.current || !doc) return;
    commit(toFile(rawRef.current, doc, next));
  }, [commit, doc]);

  // ── rename ────────────────────────────────────────────────────────────────
  const rename = useCallback(async () => {
    const name = await dialog.prompt({
      title: 'Rename dashboard',
      defaultValue: doc?.title || '',
      confirmLabel: 'Rename',
    });
    const next = (name || '').trim();
    if (!next || !rawRef.current) return;
    commit({ ...rawRef.current, meta: { ...(rawRef.current.meta || {}), title: next } });
    renameDashboard(idRef.current, next).catch(() => {});
    mirrored.current = next;
  }, [dialog, doc, commit]);

  // ── rendering ─────────────────────────────────────────────────────────────
  if (err) {
    return (
      <div className="db-root"><div className="db-main">
        <Topbar connection={conn} />
        <div className="db-note">{err}</div>
      </div></div>
    );
  }

  const saveLabel = { saving: 'Saving…', saved: 'Saved', waiting: 'Waiting for the agent…',
                      error: 'Couldn’t save' }[saveState] || '';

  return (
    <div className="db-root">
      <div className="db-main">
        <Topbar connection={conn}>
          {doc && (
            <>
              <button type="button" className="db-title" onClick={isPending(id) ? undefined : rename}
                      title={isPending(id) ? undefined : 'Rename this dashboard'}>
                {doc.title}
              </button>
              {saveLabel && <span className="db-save">{saveLabel}</span>}
              <button type="button" className="btn" onClick={() => refresh()} disabled={refreshing}
                      title="Run every query again">
                <RefreshCw size={14} className={refreshing ? 'db-spin' : undefined} />
                <span className="lbl">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
              </button>
            </>
          )}
        </Topbar>

        {agentBusy && doc && (
          <div className="db-lock">The agent is editing this dashboard. Your layout will save when
            the turn ends.</div>
        )}
        {docError && (
          <div className="db-note is-err">
            {docError} Ask the copilot to rewrite it — the conversation is on the right.
          </div>
        )}
        {doc && conn === null && (
          <div className="db-note is-err">
            No database is connected, so these panels have nothing to read.
          </div>
        )}

        <div className="db-body">
          {!doc ? (
            <div className="db-empty">
              {(!noDoc || noDoc.working) ? (
                <>
                  <span className="pulse-dot" />
                  <div className="big">{noDoc?.text || 'Loading…'}</div>
                  <div>Panels appear as soon as the first one is written.</div>
                </>
              ) : (
                <>
                  <div className="big">{noDoc.text}</div>
                  {noDoc.detail && <pre className="db-empty-detail">{noDoc.detail}</pre>}
                  <div style={{ marginTop: 14 }}>
                    Ask again on the right — the conversation is still here.
                  </div>
                </>
              )}
            </div>
          ) : doc.panels.length === 0 ? (
            <div className="db-empty">
              <div className="big">This dashboard has no panels yet.</div>
              <div>Ask the copilot for the first thing you want to see.</div>
            </div>
          ) : (
            <>
              <DashboardCanvas
                doc={doc}
                states={states}
                // Dragging while the agent is rewriting the file would produce a save that loses
                // to a 409 and then overwrites the agent's newer layout when it retries.
                editable={!agentBusy}
                onLayoutChange={onLayoutChange}
              />
              {ranAt > 0 && (
                <p className="db-ran">
                  {/* The one honest claim this page makes about time. It is the moment the
                      queries ran, not "live", and it does not tick. */}
                  Data as of {freshness(ranAt)}.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <ChatColumn
        boardId={id}
        seed={seed}
        title={doc?.title}
        agentBusy={agentBusy}
        onDocMaybeChanged={load}
        onSessionStarted={(sid) => {
          setId(sid);
          idRef.current = sid;
          window.history.replaceState(null, '', `${window.location.pathname}#/d/${encodeURIComponent(sid)}`);
        }}
        width={chatPane.width}
        collapsed={!chatOpen}
        onToggle={() => setChatOpen((v) => !v)}
      />
    </div>
  );
}
