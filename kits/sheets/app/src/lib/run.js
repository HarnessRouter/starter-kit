// Planning and running the agent columns of a sheet.
//
// There is no workflow engine in this deployment and no batch endpoint: the open tab IS the
// orchestrator. That is a real constraint and the UI says so before you press Run, rather than
// implying a background job that does not exist.
//
// Two pieces, both pure of the network:
//   plan()   decides what would run, and refuses the whole run if the sheet cannot run correctly
//   Runner   walks the plan with a concurrency limit, over an INJECTED dispatcher
//
// The dispatcher is injected so this file can be tested without a server — the rules below
// (a cell waits for its row, one failure costs only its own row, cancel clears the queue) are
// the feature, and they are worth pinning.
import { cellKey, cellText, derivedDeps, isHarnessColumn, refs, columnByName } from './model.js';

export const CONCURRENCY_CHOICES = [1, 2, 3, 5, 8];
export const DEFAULT_CONCURRENCY = 3;
const CONC_KEY = 'sheets.run.concurrency';

export function savedConcurrency() {
  const n = Number(window.localStorage?.getItem(CONC_KEY));
  return CONCURRENCY_CHOICES.includes(n) ? n : DEFAULT_CONCURRENCY;
}
export function saveConcurrency(n) {
  try { window.localStorage.setItem(CONC_KEY, String(n)); } catch { /* private mode */ }
}

export const runId = () => `run_${Math.random().toString(36).slice(2, 8)}`;

/** Which columns a scope covers. Three scopes, one planner: the Run button, the column header's
 *  ▶ and a single cell's ▶ differ only in what they select, never in how they execute. */
function scopeColumns(sheet, scope) {
  const cols = (sheet.columns || []).filter(isHarnessColumn);
  if (scope?.kind === 'column') return cols.filter((c) => c.id === scope.colId);
  if (scope?.kind === 'cell') return cols.filter((c) => c.id === scope.colId);
  return cols;
}

function scopeRows(sheet, scope) {
  const rows = sheet.rows || [];
  if (scope?.kind === 'cell') return rows.filter((r) => r.id === scope.rowId);
  return rows;
}

function passesFilter(cell, filter) {
  if (filter === 'unrun') return !cell || !cell.status || cell.status === 'skipped';
  if (filter === 'failed') return cell?.status === 'failed';
  return true;
}

/**
 * What this run would do, and every reason it cannot.
 *
 * `env` describes the world outside the document: {harnesses: Map id -> {name, unusable}, ownId}.
 * Refusals stop the whole run before a single turn is dispatched, because every one of them is a
 * configuration error that is identical for every row — discovering it forty turns in would cost
 * real money to learn nothing.
 */
export function plan(sheet, scope = { kind: 'sheet' }, filter = 'all', env = {}) {
  const columns = sheet.columns || [];
  const harnesses = env.harnesses || new Map();
  const cells = sheet.cells || {};
  const refusals = [];
  const cols = scopeColumns(sheet, scope);

  for (const c of cols) {
    const at = c.name || c.id;
    const h = c.harness || {};
    const i = columns.indexOf(c);

    if (!h.harness_id) {
      refusals.push({ colId: c.id, column: at, reason: 'no agent is chosen yet. Open the column menu and pick one.' });
    } else if (env.ownId && h.harness_id === env.ownId) {
      refusals.push({ colId: c.id, column: at, reason: 'is set to this sheet’s own agent, which would run the sheet on itself.' });
    } else if (!harnesses.has(h.harness_id)) {
      // An unknown id does not fail loudly at dispatch — the server accepts it and runs an ad-hoc
      // agent with no skills and no system prompt. A stale id silently running the wrong agent is
      // worse than a refusal, so it is checked here against the live list.
      refusals.push({ colId: c.id, column: at, reason: 'points at an agent that no longer exists. Pick another one.' });
    } else if (harnesses.get(h.harness_id)?.unusable) {
      refusals.push({ colId: c.id, column: at, reason: harnesses.get(h.harness_id).unusable + '.' });
    }

    if (!String(h.prompt || '').trim()) {
      refusals.push({ colId: c.id, column: at, reason: 'has no prompt, so there is nothing to run.' });
    }
    for (const name of refs(h.prompt)) {
      const hit = columnByName(columns, name);
      if (!hit) refusals.push({ colId: c.id, column: at, reason: `refers to {{${name}}}, which is not a column.` });
      else if (columns.indexOf(hit) >= i) {
        refusals.push({ colId: c.id, column: at, reason: `refers to {{${name}}}, which is not to its left.` });
      }
    }
    for (const a of h.attach || []) {
      const hit = columns.find((x) => x.id === a);
      if (!hit || columns.indexOf(hit) >= i || !isHarnessColumn(hit)) {
        refusals.push({ colId: c.id, column: at, reason: 'attaches files from a column that cannot provide them.' });
      }
    }
  }
  if (refusals.length) return { cells: [], columns: cols.map((c) => c.id), refusals };

  const wanted = new Set(cols.map((c) => c.id));
  const planned = [];
  for (const row of scopeRows(sheet, scope)) {
    for (const c of cols) {
      if (!passesFilter(cells[cellKey(row.id, c.id)], filter)) continue;
      // A dep is only waited on when this run owns it. A dep outside the plan is not re-run —
      // implicit upstream re-runs are surprising, expensive in real model spend, and they hide
      // that your inputs are stale.
      const deps = derivedDeps(c, columns)
        .filter((d) => wanted.has(d))
        .map((d) => cellKey(row.id, d))
        .filter((k) => planned.some((p) => cellKey(p.rowId, p.colId) === k));
      planned.push({ rowId: row.id, colId: c.id, key: cellKey(row.id, c.id), deps });
    }
  }
  return { cells: planned, columns: cols.map((c) => c.id), refusals: [] };
}

/** Is an upstream cell usable as this cell's input? */
function upstreamState(sheet, results, rowId, depColId) {
  const live = results.get(cellKey(rowId, depColId));
  if (live) return live.status;
  const col = (sheet.columns || []).find((c) => c.id === depColId);
  if (!isHarnessColumn(col)) return 'done';   // a plain column is always available; emptiness is
                                              // a per-cell matter and the dispatcher names it
  const cell = (sheet.cells || {})[cellKey(rowId, depColId)];
  return cell?.status === 'done' ? 'done' : 'missing';
}

/**
 * Walks a plan with at most `concurrency` turns in flight.
 *
 * dispatch(task, {signal}) -> Promise<cellRecord>. The Runner never knows what a turn is; that
 * is lib/cell.js. It only knows the shape of the answer: {status, value, artifacts, …}.
 *
 * onCell(key, record) fires on every state change, so the page can write it into the document
 * and the person watches the grid fill in.
 */
export class Runner {
  constructor({ sheet, plan: p, concurrency = DEFAULT_CONCURRENCY, dispatch, onCell, onProgress }) {
    this.sheet = sheet;
    this.plan = p;
    this.concurrency = Math.max(1, concurrency);
    this.dispatch = dispatch;
    this.onCell = onCell || (() => {});
    this.onProgress = onProgress || (() => {});
    this.results = new Map();     // key -> record, this run's own state
    this.inflight = new Map();    // key -> AbortController
    this.stopped = false;
    this.byKey = new Map(this.plan.cells.map((c) => [c.key, c]));
  }

  progress() {
    let done = 0; let failed = 0; let skipped = 0; let running = 0;
    for (const r of this.results.values()) {
      if (r.status === 'done') done += 1;
      else if (r.status === 'failed') failed += 1;
      else if (r.status === 'skipped') skipped += 1;
      else if (r.status === 'running') running += 1;
    }
    return { planned: this.plan.cells.length, done, failed, skipped, running,
             settled: done + failed + skipped };
  }

  _set(key, record) {
    this.results.set(key, record);
    this.onCell(key, record);
    this.onProgress(this.progress());
  }

  /** Everything downstream of `key` in ITS OWN ROW. A sheet run is N independent row-pipelines;
   *  one bad row must not cost the other ninety-nine. */
  _skipDownstream(key, reason) {
    const start = this.byKey.get(key);
    if (!start) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of this.plan.cells) {
        if (c.rowId !== start.rowId) continue;
        if (this.results.get(c.key)) continue;
        const blocked = c.deps.some((d) => {
          const r = this.results.get(d);
          return r && (r.status === 'failed' || r.status === 'skipped');
        });
        if (blocked) { this._set(c.key, { status: 'skipped', error: reason }); changed = true; }
      }
    }
  }

  _ready() {
    const out = [];
    for (const c of this.plan.cells) {
      if (this.results.get(c.key)) continue;
      const states = c.deps.map((d) => this.results.get(d)?.status || 'missing');
      if (states.every((s) => s === 'done')) out.push(c);
    }
    return out;
  }

  /** Deps this run does NOT own: they must already be usable, or this cell never starts. */
  _blockedByStale(c) {
    const col = (this.sheet.columns || []).find((x) => x.id === c.colId);
    for (const depId of derivedDeps(col, this.sheet.columns || [])) {
      if (this.byKey.has(cellKey(c.rowId, depId))) continue;   // owned by this run; handled above
      if (upstreamState(this.sheet, this.results, c.rowId, depId) !== 'done') {
        const dep = (this.sheet.columns || []).find((x) => x.id === depId);
        return `${dep?.name || 'An earlier column'} has not run in this row.`;
      }
    }
    return '';
  }

  async run() {
    if (!this.plan.cells.length) return this.progress();
    this.onProgress(this.progress());
    const pending = [];
    for (;;) {
      if (this.stopped) break;
      while (this.inflight.size < this.concurrency) {
        const next = this._ready().find((c) => !this.inflight.has(c.key));
        if (!next) break;
        const stale = this._blockedByStale(next);
        if (stale) { this._set(next.key, { status: 'skipped', error: stale }); continue; }
        pending.push(this._start(next));
      }
      if (!this.inflight.size) break;
      // One settle per loop: the walk advances as soon as ANY cell finishes, so row 5's second
      // column starts while row 12's first is still going. No column barrier.
      await Promise.race([...this.inflight.values()].map((c) => c.settled));
    }
    await Promise.allSettled(pending);
    return this.progress();
  }

  _start(c) {
    const ctrl = new AbortController();
    let resolveSettled;
    ctrl.settled = new Promise((r) => { resolveSettled = r; });
    this.inflight.set(c.key, ctrl);
    this._set(c.key, { status: 'running' });

    const task = {
      rowId: c.rowId,
      colId: c.colId,
      rowIndex: (this.sheet.rows || []).findIndex((r) => r.id === c.rowId),
      rowsTotal: (this.sheet.rows || []).length,
      column: (this.sheet.columns || []).find((x) => x.id === c.colId),
      values: this._rowValues(c.rowId),
      upstream: this._upstreamRecords(c),
    };

    const p = Promise.resolve()
      .then(() => this.dispatch(task, { signal: ctrl.signal }))
      .then((record) => {
        this._set(c.key, record);
        if (record.status === 'failed') {
          this._skipDownstream(c.key, `${task.column?.name || 'An earlier column'} failed in this row.`);
        }
      })
      .catch((e) => {
        this._set(c.key, { status: 'failed', error: e?.message || 'This cell could not run.' });
        this._skipDownstream(c.key, `${task.column?.name || 'An earlier column'} failed in this row.`);
      })
      .finally(() => { this.inflight.delete(c.key); resolveSettled(); });
    return p;
  }

  /** This row's cell text, by column id — what {{Name}} interpolates against. */
  _rowValues(rowId) {
    const out = {};
    for (const col of this.sheet.columns || []) {
      const live = this.results.get(cellKey(rowId, col.id));
      const cell = live && live.status === 'done' ? live : (this.sheet.cells || {})[cellKey(rowId, col.id)];
      out[col.id] = cellText(cell, col);
    }
    return out;
  }

  /** The finished agent cells this cell attaches files from. */
  _upstreamRecords(c) {
    const col = (this.sheet.columns || []).find((x) => x.id === c.colId);
    const out = [];
    for (const id of col?.harness?.attach || []) {
      const dep = (this.sheet.columns || []).find((x) => x.id === id);
      const rec = this.results.get(cellKey(c.rowId, id)) || (this.sheet.cells || {})[cellKey(c.rowId, id)];
      if (dep && rec) out.push({ column: dep, cell: rec });
    }
    return out;
  }

  /** Stop dispatching, cancel what is in flight, and clear what never started.
   *
   *  A queued cell is CLEARED rather than left queued: a permanent "queued" that will never move
   *  is a lie about what the app is doing. */
  stop() {
    this.stopped = true;
    for (const ctrl of this.inflight.values()) ctrl.abort();
    for (const c of this.plan.cells) {
      const r = this.results.get(c.key);
      if (!r) this._set(c.key, { status: null });     // null = absent; the page deletes the key
    }
  }
}
