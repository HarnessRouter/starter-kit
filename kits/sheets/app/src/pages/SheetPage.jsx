// The sheet: the grid, the copilot, and the run.
//
// Three things own this page and they are kept apart on purpose:
//   the DOCUMENT  — one writer, one save queue (commit / flush below)
//   the AGENT     — the copilot's turn, during which the file belongs to it and the grid is read-only
//   the RUN       — the Runner walking agent columns, whose results flow back through commit
//
// The run happens in this tab. There is no workflow engine and no batch endpoint in this
// deployment, so the browser is the orchestrator; the UI says that before you press Run and says
// exactly what happened if you leave.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, HelpCircle, Home } from 'lucide-react';
import { PaneResizer, useResizablePane, useDialog } from 'reifyui';
import { SheetGrid, FilePreview, fitRowHeights } from 'reifyui';
import { containerFileUrl, getResponse, lastAssistantText, sessionTurns } from 'reifyui/harness';
import {
  getSheet, isPending, markViewed, renameSheet, runnableHarnesses, saveSheet, sheetStatus,
  sheetsHarness,
} from '../lib/sh';
import {
  GRID_TYPES, cellKey, derivedDeps, isHarnessColumn, validate,
} from '../lib/model';
import { Runner, plan, runId, saveConcurrency, savedConcurrency } from '../lib/run';
import { makeCellDispatcher } from '../lib/cell';
import { exportSheet } from '../lib/exportSheet';
import { ChatColumn } from '../components/ChatPanel';
import { AvatarMenu, LINKS, Wordmark } from '../components/Topbar';
import { HarnessCell } from '../components/HarnessCell';
import { HarnessConfig } from '../components/HarnessConfig';
import { RunControl } from '../components/RunControl';

const SAVE_DEBOUNCE_MS = 400;
const STATUS_POLL_MS = 2000;      // while a turn is live: the grid fills in as it is written
const STATUS_IDLE_MS = 10000;     // while nothing is: still notices a turn started elsewhere
const RELOAD_POLL_MS = 4000;
const now = () => Math.floor(Date.now() / 1000);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A workbook, as tabs of rows, for the file preview.
 *
 *  The spreadsheet library is loaded here rather than inside the package: a kit that has never
 *  heard of a spreadsheet must not have to resolve one to build, and this kit already ships xlsx
 *  for its exports. Lazy, so it is not in the first bundle either — nobody pays 430 KB until
 *  they open a .xlsx.
 *
 *  sheet_to_json THROWS on a sheet with no '!ref' — an empty one — and letting that escape threw
 *  away the whole workbook rather than one tab. Tools routinely leave an empty default Sheet1 in
 *  front of the real data, so that was most spreadsheets. */
async function parseWorkbook(buffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames.map((n) => {
    const ws = wb.Sheets[n] || {};
    const filled = Boolean(ws['!ref']);
    return { name: n, filled, rows: filled ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) : [] };
  });
}

/** The first agent column that reads something to its right, if any. */
function firstBrokenDep(sheet) {
  const columns = sheet.columns || [];
  for (let i = 0; i < columns.length; i += 1) {
    if (!isHarnessColumn(columns[i])) continue;
    for (const depId of derivedDeps(columns[i], columns)) {
      const j = columns.findIndex((c) => c.id === depId);
      if (j >= i) return { column: columns[i], dep: columns[j] || null };
    }
  }
  return null;
}

export function SheetPage({ id: routeId, seed }) {
  // The session id lives in state, not in the route. A sheet starts as "new:<template>" and
  // becomes a session when its first turn opens one — which arrives WHILE the copilot is
  // streaming. Re-keying this component off the URL at that moment unmounts it mid-stream and
  // throws the turn away.
  const [id, setId] = useState(routeId);
  useEffect(() => { setId(routeId); }, [routeId]);

  const [sheet, setSheet] = useState(null);
  const [noSheet, setNoSheet] = useState(null);
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState('');     // '' | saving | saved | waiting | error
  const [agentBusy, setAgentBusy] = useState(false);
  const [preview, setPreview] = useState(null);       // {url, name} of a file being read
  const [exportOpen, setExportOpen] = useState(false);
  const [env, setEnv] = useState(null);               // {harnesses: Map, ownId}
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [notice, setNotice] = useState('');
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth > 900);

  const dialog = useDialog();
  const chatPane = useResizablePane({ initial: 380, min: 300, maxFraction: 0.6, fromRight: true, storageKey: 'sheets.chat.w' });
  const sheetRef = useRef(null);
  sheetRef.current = sheet;
  const idRef = useRef(id);
  idRef.current = id;
  const runnerRef = useRef(null);
  const exportRef = useRef(null);
  const gridRef = useRef(null);
  const mirrored = useRef('');      // the session title we last asserted
  const save = useRef({ timer: null, inFlight: false, backoff: 0, wanted: null });

  // ── the one writer ────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    const q = save.current;
    if (q.inFlight || isPending(idRef.current)) return;
    const doc = sheetRef.current;
    if (!doc || doc === q.wanted) return;
    q.inFlight = true;
    const attempt = doc;
    try {
      await saveSheet(idRef.current, attempt);
      q.inFlight = false;
      q.backoff = 0;
      q.wanted = attempt;
      if (sheetRef.current !== attempt) { flush(); return; }   // it changed while we wrote
      setSaveState('saved');
      window.setTimeout(() => setSaveState((v) => (v === 'saved' ? '' : v)), 1800);
    } catch (e) {
      q.inFlight = false;
      // 409 means the agent holds the file. That is the lock, and it is honest — but the write
      // is not dropped: it is re-armed with backoff and the newest whole document is written
      // when the turn ends.
      const busy = e?.status === 409;
      setSaveState(busy ? 'waiting' : 'error');
      q.backoff = Math.min(8000, q.backoff ? q.backoff * 2 : 1000);
      window.clearTimeout(q.timer);
      q.timer = window.setTimeout(flush, q.backoff);
    }
  }, []);

  const commit = useCallback((next) => {
    setSheet(next);
    sheetRef.current = next;
    if (isPending(idRef.current)) return;
    setSaveState('saving');
    window.clearTimeout(save.current.timer);
    save.current.timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // ── loading ───────────────────────────────────────────────────────────────
  // "No sheet" is three different situations and they must not look alike: the file is there;
  // a turn is still writing it; or a turn finished having written nothing, in which case its own
  // last words are the only honest explanation we have.
  const load = useCallback(async () => {
    try {
      const doc = await getSheet(idRef.current);
      if (doc) {
        setNoSheet(null);
        // The file is the truth. A copilot turn may have restructured it, and re-merging
        // remembered run refs onto the agent's document would show a result that no longer
        // corresponds to the configuration beside it.
        setSheet(doc);
        sheetRef.current = doc;
        save.current.wanted = doc;
        return doc;
      }
      const st = await sheetStatus(idRef.current).catch(() => '');
      if (['running', 'starting'].includes(st)) {
        setNoSheet({ working: true, text: 'Setting up your sheet…' });
        return null;
      }
      const turns = isPending(idRef.current) ? [] : await sessionTurns(idRef.current).catch(() => []);
      const last = turns[turns.length - 1];
      setNoSheet({
        working: false,
        text: last?.status && last.status !== 'completed'
          ? `The last turn ended as “${last.status}” without writing a sheet.`
          : 'No sheet has been written for this conversation yet.',
        detail: lastAssistantText(turns).slice(0, 400),
      });
      return null;
    } catch (e) {
      setErr(e?.message || 'Could not open this sheet.');
      return null;
    }
  }, []);

  useEffect(() => { markViewed(id); load(); }, [id, load]);

  // Keep looking while the agent works: the sheet is a file it writes DURING the turn, and reads
  // hit the live workspace, so the grid fills in as it is built. Without this the page shows
  // "Setting up your sheet…" over a file already on disk — a reloaded tab has no stream.
  useEffect(() => {
    if (!noSheet?.working && sheet && !agentBusy) return undefined;
    const t = window.setInterval(() => { void load(); }, RELOAD_POLL_MS);
    return () => window.clearInterval(t);
  }, [noSheet?.working, sheet, agentBusy, load]);

  // ── the agent's lock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPending(id)) return undefined;
    let dead = false;
    const tick = () => sheetStatus(id)
      .then((st) => { if (!dead) setAgentBusy(['running', 'starting'].includes(st)); })
      .catch(() => {});
    tick();
    const iv = window.setInterval(tick, agentBusy || running ? STATUS_POLL_MS : STATUS_IDLE_MS);
    return () => { dead = true; window.clearInterval(iv); };
  }, [id, agentBusy, running]);

  // Once the turn ends, write whatever accumulated while the file was locked.
  const prevAgentBusy = useRef(false);
  useEffect(() => {
    if (prevAgentBusy.current && !agentBusy) {
      mirrored.current = '';          // the turn just renamed the session; re-assert the real name
      load().then(() => flush());
    }
    prevAgentBusy.current = agentBusy;
  }, [agentBusy, load, flush]);

  // ── the workspace's agents ────────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    Promise.all([runnableHarnesses(), sheetsHarness()])
      .then(([list, mine]) => {
        if (dead) return;
        setEnv({ harnesses: new Map(list.map((h) => [h.id, h])), ownId: mine?.id || '' });
      })
      .catch(() => { if (!dead) setEnv({ harnesses: new Map(), ownId: '' }); });
    return () => { dead = true; };
  }, []);

  const adoptSession = useCallback((sid) => {
    if (!sid || sid === idRef.current) return;
    const [, query = ''] = (window.location.hash || '').split('?');
    // replaceState does not fire hashchange, so App never re-keys and the live stream survives.
    // The pending id addresses nothing, so it must not become a Back target either.
    window.history.replaceState({}, '', `#/s/${sid}${query ? `?${query}` : ''}`);
    setId(sid);
    idRef.current = sid;
  }, []);

  // ── reconciling a run this tab did not finish ─────────────────────────────
  const reconciled = useRef('');
  useEffect(() => {
    if (!sheet?.run || sheet.run.status !== 'running' || running) return;
    if (reconciled.current === sheet.run.id) return;
    reconciled.current = sheet.run.id;
    (async () => {
      const doc = JSON.parse(JSON.stringify(sheetRef.current));
      let stillRunning = false;
      for (const [key, cell] of Object.entries(doc.cells || {})) {
        if (cell?.run_id !== doc.run.id) continue;
        if (cell.status === 'queued' && !cell.response_id) { delete doc.cells[key]; continue; }
        if (cell.status !== 'running' || !cell.response_id) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await getResponse(cell.response_id).catch(() => null);
        const st = res?.status;
        if (!st || st === 'queued' || st === 'in_progress' || st === 'running') { stillRunning = true; continue; }
        if (st === 'completed') {
          const text = (res.output || [])
            .filter((o) => o.type === 'message')
            .flatMap((o) => (o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text))
            .join('\n').trim();
          doc.cells[key] = { ...cell, status: text ? 'done' : 'failed', ended_at: now(),
                             value: text || null,
                             error: text ? null : 'The agent finished without answering.' };
        } else {
          doc.cells[key] = { ...cell, status: 'failed', ended_at: now(),
                             error: res?.error?.message || `The turn ${st}.` };
        }
      }
      if (!stillRunning) {
        // ended_at is left null: we do not know when the walk stopped and will not invent it.
        doc.run = { ...doc.run, status: 'abandoned' };
      }
      commit(doc);
    })();
  }, [sheet?.run, running, commit]);

  // ── the run ───────────────────────────────────────────────────────────────
  const [concurrency, setConcurrency] = useState(savedConcurrency);
  const pickConcurrency = (n) => { setConcurrency(n); saveConcurrency(n); };

  const startRun = useCallback(async (filter, scope = { kind: 'sheet' }) => {
    const doc = sheetRef.current;
    if (!doc || !env) return;
    const p = plan(doc, scope, filter, env);
    if (p.refusals.length) {
      await dialog.alert({
        variant: 'warning',
        title: 'This sheet can’t run yet',
        message: p.refusals.map((r) => `${r.column} ${r.reason}`).join('\n'),
      });
      return;
    }
    if (!p.cells.length) {
      await dialog.alert({ title: 'Nothing to run', message: filter === 'failed'
        ? 'No cells failed in the last run.'
        : 'Every cell in this scope already has a result.' });
      return;
    }
    if (scope.kind === 'sheet') {
      const ok = await dialog.confirm({
        title: `Run ${p.cells.length} cell${p.cells.length === 1 ? '' : 's'}?`,
        message: 'Running replaces the results in these columns. The conversations stay in your history.\n\n'
            + 'The run happens in this tab. If you close it, cells already started will finish; nothing new starts.',
        confirmLabel: 'Run',
      });
      if (!ok) return;
    }

    const rid = runId();
    const next = JSON.parse(JSON.stringify(doc));
    // Only the last run is retained: the cells this run owns are cleared before it starts, so a
    // half-old, half-new column can never be read as one result.
    for (const c of p.cells) delete next.cells[c.key];
    next.run = {
      id: rid, status: 'running', started_at: now(), ended_at: null,
      scope, filter, columns: p.columns, concurrency,
      planned: p.cells.length, done: 0, failed: 0, skipped: 0,
    };
    commit(next);
    setRunning(true);
    setProgress({ planned: p.cells.length, settled: 0, done: 0, failed: 0, skipped: 0 });

    const applyCell = (key, record) => {
      const cur = JSON.parse(JSON.stringify(sheetRef.current));
      cur.cells = cur.cells || {};
      if (record.status === null) delete cur.cells[key];
      else cur.cells[key] = { ...(cur.cells[key] || {}), ...record, run_id: rid };
      // Counters are recomputed from the cells rather than incremented, and written on every
      // change rather than only at the end: a tab reopened mid-run reads this file, and a run
      // header that says 0 done over four finished cells is a lie the file told.
      if (cur.run?.id === rid) {
        const mine = Object.values(cur.cells).filter((c) => c.run_id === rid);
        cur.run = {
          ...cur.run,
          done: mine.filter((c) => c.status === 'done').length,
          failed: mine.filter((c) => c.status === 'failed').length,
          skipped: mine.filter((c) => c.status === 'skipped').length,
        };
      }
      commit(cur);
    };

    const runner = new Runner({
      sheet: next,
      plan: p,
      concurrency,
      dispatch: makeCellDispatcher({
        sheetId: idRef.current, runId: rid, sheetTitle: next.meta?.title,
        columns: next.columns, onCell: applyCell,
      }),
      onCell: applyCell,
      onProgress: setProgress,
    });
    runnerRef.current = runner;
    const final = await runner.run();
    runnerRef.current = null;
    setRunning(false);

    // The answers are on screen now, so their real height is measurable. Rows the run touched
    // grow to fit what is in them — the text and the file cards — rather than staying at the
    // height they had when they were empty.
    const touched = [...new Set(p.cells.map((c) => c.rowId))];
    const heights = fitRowHeights(gridRef.current, { rowIds: touched });

    const done = JSON.parse(JSON.stringify(sheetRef.current));
    for (const r of done.rows || []) if (heights[r.id]) r.height = heights[r.id];
    if (done.run?.id === rid) {
      done.run = {
        ...done.run,
        status: runner.stopped ? 'cancelled' : 'done',
        ended_at: now(),
        done: final.done, failed: final.failed, skipped: final.skipped,
      };
      commit(done);
    }
  }, [env, concurrency, commit, dialog]);

  const stopRun = useCallback(() => { runnerRef.current?.stop(); }, []);

  // Leaving mid-run stops the walk. Say so with the platform's own guard rather than inventing a
  // second one — and never with a browser popup of our own.
  useEffect(() => {
    if (!running) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [running]);

  // ── grid edits ────────────────────────────────────────────────────────────
  const onGridChange = useCallback((next) => {
    const prev = sheetRef.current;
    if (!prev) return;

    // A column rename must follow into the prompts that address it by name; otherwise renaming a
    // column silently breaks every agent column that reads it, and the break only shows at run
    // time.
    const renames = [];
    for (const c of next.columns || []) {
      const before = (prev.columns || []).find((x) => x.id === c.id);
      if (before && before.name !== c.name) renames.push([before.name, c.name]);
    }
    if (renames.length) {
      for (const col of next.columns) {
        if (!col.harness?.prompt) continue;
        let p = col.harness.prompt;
        for (const [from, to] of renames) {
          p = p.replace(new RegExp(`\\{\\{\\s*${escapeRe(from)}\\s*\\}\\}`, 'g'), `{{${to}}}`);
        }
        col.harness = { ...col.harness, prompt: p };
      }
    }

    // A reorder that puts an agent column left of something it reads is refused, not accepted and
    // marked invalid: refusing keeps a reversible drag reversible, where accepting it turns a
    // drag into a sheet that cannot run and says so minutes later.
    const order = (next.columns || []).map((c) => c.id).join(',');
    if (order !== (prev.columns || []).map((c) => c.id).join(',')) {
      const broken = firstBrokenDep(next);
      if (broken) {
        setNotice(`${broken.column.name} reads ${broken.dep?.name || 'a later column'}, `
                + `so it has to stay to the right of it.`);
        window.setTimeout(() => setNotice(''), 5000);
        return;
      }
    }

    commit(next);
  }, [commit]);

  // ── rename ────────────────────────────────────────────────────────────────
  const rename = useCallback(async () => {
    const doc = sheetRef.current;
    const name = await dialog.prompt({
      title: 'Rename this sheet',
      defaultValue: doc?.meta?.title || '',
      confirmLabel: 'Rename',
    });
    if (!name || !name.trim() || isPending(idRef.current)) return;
    // The session title first — it is what the sheet LIST renders, because that list cannot read
    // the file. Then the document, which is what this page renders.
    await renameSheet(idRef.current, name.trim()).catch(() => {});
    commit({ ...doc, meta: { ...doc.meta, title: name.trim() } });
  }, [dialog, commit]);

  // meta.title is the truth and the session title is its mirror — the sheet LIST renders the
  // session title, because it cannot read the file.
  //
  // The mirror has to be re-asserted after every turn, not just when meta.title changes. A turn
  // regenerates the session title from the latest user message, so a sheet called "Competitor
  // scan" appeared in the list as "Add a plain text column called Owner at the end." — the name
  // was right in the document and wrong everywhere the person looks for it. Re-asserting once per
  // turn is exactly as often as something can undo it.
  useEffect(() => {
    const title = sheet?.meta?.title;
    if (!title || isPending(id) || mirrored.current === title) return;
    mirrored.current = title;
    renameSheet(id, title).catch(() => {});
  }, [sheet?.meta?.title, id]);

  // ── the export menu ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!exportOpen) return undefined;
    const onDown = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  const doExport = async (kind) => {
    setExportOpen(false);
    try {
      await exportSheet(kind, sheetRef.current);
    } catch (e) {
      dialog.alert({ variant: 'error', title: 'Export didn’t finish', message: e?.message || 'Please try again.' });
    }
  };

  // ── rendering ─────────────────────────────────────────────────────────────
  const readOnly = agentBusy;
  const columns = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const problems = useMemo(() => (sheet ? validate(sheet).errors : []), [sheet]);


  const renderCell = useCallback((ctx) => {
    if (!isHarnessColumn(ctx.column)) return undefined;
    return (
      <HarnessCell
        cell={ctx.cell}
        readOnly={ctx.readOnly}
        onRun={ctx.runCell}
        onPreviewFile={(a) => setPreview({ url: containerFileUrl(a.container_id, a.file_id), name: a.filename })}
      />
    );
  }, []);

  const renderColumnConfig = useCallback((ctx) => (
    ctx.type === 'harness' ? <HarnessConfig {...ctx} /> : undefined
  ), []);

  if (err) {
    return (
      <div className="gp-root"><div className="gp-main">
        <Banner sheet={null} />
        <div className="page-note">{err}</div>
      </div></div>
    );
  }

  return (
    <div className="gp-root">
      <div className="gp-main">
        <Banner
          sheet={sheet}
          saveState={saveState}
          agentBusy={agentBusy}
          onRename={sheet && !isPending(id) ? rename : null}
          right={sheet && (
            <>
              <div className="sl-export-wrap" ref={exportRef}>
                <button className="btn" aria-label="Export" title="Export this sheet"
                        onClick={(e) => { e.stopPropagation(); setExportOpen((v) => !v); }}>
                  <Download size={14} /> <span className="lbl">Export</span>
                </button>
                {exportOpen && (
                  <div className="sl-export-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => doExport('csv')}>CSV (.csv)</button>
                    <button onClick={() => doExport('tsv')}>Tab separated (.tsv)</button>
                    <button onClick={() => doExport('xlsx')}>Excel (.xlsx)</button>
                    <button onClick={() => doExport('json')}>Run result (.json)</button>
                  </div>
                )}
              </div>
              <RunControl
                running={running}
                progress={progress}
                concurrency={concurrency}
                onConcurrency={pickConcurrency}
                onRun={(filter) => startRun(filter)}
                onStop={stopRun}
                disabled={readOnly || !env || !columns.some(isHarnessColumn)}
              />
            </>
          )}
        />

        {notice && <div className="sh-notice">{notice}</div>}
        {agentBusy && sheet && (
          <div className="sh-lock">The agent is editing this sheet. It will unlock when the turn ends.</div>
        )}
        {problems.length > 0 && (
          <div className="sh-notice warn">
            {problems[0].where}: {problems[0].what}. {problems[0].fix}
            {problems.length > 1 && ` (and ${problems.length - 1} more)`}
          </div>
        )}

        <div className="sh-body">
          {!sheet ? (
            <div className="sh-empty">
              {(!noSheet || noSheet.working) ? (
                <>
                  <span className="pulse-dot" />
                  <div className="big">{noSheet?.text || 'Loading…'}</div>
                  <div>The grid appears as soon as the first column is written.</div>
                </>
              ) : (
                <>
                  <div className="big">{noSheet.text}</div>
                  {noSheet.detail && <pre className="sh-empty-detail">{noSheet.detail}</pre>}
                  <div style={{ marginTop: 14 }}>
                    Ask again on the right — the conversation is still here.
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="sh-grid" ref={gridRef}>
              <SheetGrid
                sheet={sheet}
                onChange={onGridChange}
                readOnly={readOnly}
                columnTypes={GRID_TYPES}
                renderCell={renderCell}
                renderColumnConfig={renderColumnConfig}
                onRunCell={(rowId, colId) => startRun('all', { kind: 'cell', rowId, colId })}
                onRunColumn={(colId) => startRun('all', { kind: 'column', colId })}
              />
            </div>
          )}
          {preview && (
            <div className="sh-preview-pane">
              <FilePreview
                file={preview}
                onClose={() => setPreview(null)}
                officePdfUrl={(u) => u.replace(/\/content(\?|$)/, '/pdf$1')}
                renderMarkdown={(t) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>}
                parseWorkbook={parseWorkbook}
              />
            </div>
          )}
        </div>
      </div>

      <PaneResizer pane={chatPane} />
      <ChatColumn
        sheetId={id}
        seed={seed}
        title={sheet?.meta?.title || 'Copilot'}
        agentBusy={agentBusy}
        onSheetMaybeChanged={load}
        onSessionStarted={adoptSession}
        width={chatPane.width}
        collapsed={!chatOpen}
        onToggle={() => setChatOpen((v) => !v)}
      />


    </div>
  );
}

function Banner({ sheet, saveState, agentBusy, onRename, right }) {
  const chip = {
    saving: 'Saving…', saved: 'Saved',
    waiting: 'Waiting for the agent…', error: 'Not saved — retrying',
  }[saveState];
  return (
    <header className="gp-banner">
      <a className="uic-wordmark" href="#/"><Wordmark size={15} /></a>
      <a className="uic-iconbtn gp-home" href="#/" title="Home" aria-label="Home"><Home size={16} /></a>
      {sheet && (
        <span className="crumb-name sh-title" onDoubleClick={onRename || undefined}
              title={onRename ? 'Double-click to rename' : undefined}>
          {sheet.meta?.title || 'Untitled sheet'}
        </span>
      )}
      {chip && <span className={'sl-save-chip ' + saveState}>{chip}</span>}
      {agentBusy && <span className="sl-save-chip copilot"><span className="pulse" /> Agent is editing…</span>}
      <div className="uic-topbar-spacer" />
      <div className="sh-banner-actions">{right}</div>
      <a className="uic-iconbtn gp-help" href={LINKS.docs} target="_blank" rel="noreferrer"
         title="Documentation"><HelpCircle size={16} /></a>
      <AvatarMenu />
    </header>
  );
}
