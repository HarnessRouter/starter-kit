// The orchestration rules, pinned against a fake dispatcher.
//
// This is the part of the kit that spends the person's money, so its behaviour under failure
// matters more than its behaviour when everything works: one bad row must not cost the other
// ninety-nine, a stopped run must not leave cells claiming to be queued forever, and the
// concurrency the person chose must actually be the ceiling.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellKey } from './model.js';
import { plan, Runner } from './run.js';

const HARNESSES = new Map([
  ['chrn_' + 'a'.repeat(32), { name: 'Researcher', unusable: '' }],
  ['chrn_' + 'b'.repeat(32), { name: 'Judge', unusable: '' }],
]);
const HID_A = 'chrn_' + 'a'.repeat(32);
const HID_B = 'chrn_' + 'b'.repeat(32);
const ENV = { harnesses: HARNESSES, ownId: 'chrn_' + 'f'.repeat(32) };

const col = (id, name, type = 'text') => ({ id, name, type });
const agent = (id, name, prompt, attach = [], harness_id = HID_A) =>
  ({ id, name, type: 'harness', harness: { harness_id, prompt, attach } });

function sheetOf(columns, rowCount = 2, cells = {}) {
  return {
    meta: { schema: 1, title: 'T' },
    columns,
    rows: Array.from({ length: rowCount }, (_, i) => ({ id: `row_${i + 1}` })),
    cells,
  };
}

/** A dispatcher that records what it was asked and answers however the test wants. */
function fakeDispatcher({ answer, gate } = {}) {
  const seen = [];
  let peak = 0;
  let live = 0;
  const dispatch = async (task, { signal }) => {
    seen.push(task);
    live += 1; peak = Math.max(peak, live);
    try {
      if (gate) await gate(task, signal);
      const r = answer ? answer(task) : { status: 'done', value: `${task.column.name}/${task.rowId}` };
      if (signal.aborted) return { status: 'failed', error: 'Stopped.' };
      return r;
    } finally { live -= 1; }
  };
  return { dispatch, seen, peak: () => peak };
}

test('plan refuses the whole run when a column has no agent chosen', () => {
  const s = sheetOf([col('c1', 'Company'), agent('c2', 'Brief', 'about {{Company}}', [], '')]);
  const p = plan(s, { kind: 'sheet' }, 'all', ENV);
  assert.equal(p.cells.length, 0, 'nothing is dispatched');
  assert.equal(p.refusals.length, 1);
  assert.match(p.refusals[0].reason, /no agent is chosen/);
  assert.equal(p.refusals[0].column, 'Brief', 'the refusal names the column');
});

test('plan refuses this sheet’s own agent — a sheet may not run itself', () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}', [], ENV.ownId)]);
  assert.match(plan(s, { kind: 'sheet' }, 'all', ENV).refusals[0].reason, /own agent/);
});

test('plan refuses an agent id the workspace no longer has', () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}', [], 'chrn_' + '9'.repeat(32))]);
  assert.match(plan(s, { kind: 'sheet' }, 'all', ENV).refusals[0].reason, /no longer exists/);
});

test('plan refuses an agent that needs request headers, quoting the reason', () => {
  const harnesses = new Map(HARNESSES);
  harnesses.set(HID_A, { name: 'Locked', unusable: 'needs request headers this app can’t send' });
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}')]);
  assert.match(plan(s, { kind: 'sheet' }, 'all', { ...ENV, harnesses }).refusals[0].reason, /request headers/);
});

test('plan refuses a forward reference before anything is dispatched', () => {
  const s = sheetOf([agent('c1', 'Fit', 'score {{Brief}}'), agent('c2', 'Brief', 'write')]);
  const p = plan(s, { kind: 'sheet' }, 'all', ENV);
  assert.equal(p.cells.length, 0);
  assert.ok(p.refusals.some((r) => /not to its left/.test(r.reason)));
});

test('plan builds same-row, left-going dependencies and nothing else', () => {
  const s = sheetOf([col('c1', 'Company'), agent('c2', 'Brief', 'about {{Company}}'),
                     agent('c3', 'Fit', 'judge {{Brief}}', ['c2'])], 2);
  const p = plan(s, { kind: 'sheet' }, 'all', ENV);
  assert.equal(p.cells.length, 4, 'two agent columns over two rows');
  const fit1 = p.cells.find((c) => c.key === cellKey('row_1', 'c3'));
  assert.deepEqual(fit1.deps, [cellKey('row_1', 'c2')], 'depends on its own row only');
  const brief1 = p.cells.find((c) => c.key === cellKey('row_1', 'c2'));
  assert.deepEqual(brief1.deps, [], 'a plain column is not a planned dependency');
});

test('a column-scoped run covers that column only and does not re-run upstream', () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}'), agent('c3', 'C', 'y {{B}}')], 2);
  const p = plan(s, { kind: 'column', colId: 'c3' }, 'all', ENV);
  assert.deepEqual(p.cells.map((c) => c.colId), ['c3', 'c3']);
  assert.deepEqual(p.cells[0].deps, [], 'the upstream cell is not owned by this run');
});

test('a cell-scoped run is exactly one cell', () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}')], 3);
  const p = plan(s, { kind: 'cell', rowId: 'row_2', colId: 'c2' }, 'all', ENV);
  assert.deepEqual(p.cells.map((c) => c.key), [cellKey('row_2', 'c2')]);
});

test('filter unrun skips cells that already have a result; failed picks only failures', () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}')], 3, {
    'row_1:c2': { status: 'done', value: 'v' },
    'row_2:c2': { status: 'failed', error: 'boom' },
  });
  assert.deepEqual(plan(s, { kind: 'sheet' }, 'unrun', ENV).cells.map((c) => c.rowId), ['row_3']);
  assert.deepEqual(plan(s, { kind: 'sheet' }, 'failed', ENV).cells.map((c) => c.rowId), ['row_2']);
  assert.equal(plan(s, { kind: 'sheet' }, 'all', ENV).cells.length, 3);
});

test('a cell waits for its row: Fit never starts before Brief finishes', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'Brief', 'x {{A}}'), agent('c3', 'Fit', 'y {{Brief}}')], 1);
  const order = [];
  const f = fakeDispatcher({
    gate: async (task) => {
      order.push(`start:${task.column.name}`);
      await new Promise((r) => setTimeout(r, task.column.name === 'Brief' ? 20 : 0));
      order.push(`end:${task.column.name}`);
    },
  });
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch });
  await r.run();
  assert.deepEqual(order, ['start:Brief', 'end:Brief', 'start:Fit', 'end:Fit']);
});

test('a downstream cell receives its upstream cell’s text as an interpolation value', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'Brief', 'x {{A}}'), agent('c3', 'Fit', 'y {{Brief}}')], 1,
                    { 'row_1:c1': { value: 'seed' } });
  const f = fakeDispatcher({ answer: (t) => ({ status: 'done', value: `${t.column.name}-out` }) });
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch });
  await r.run();
  const fit = f.seen.find((t) => t.column.name === 'Fit');
  assert.equal(fit.values.c1, 'seed');
  assert.equal(fit.values.c2, 'Brief-out', 'this run’s own result, not the stale document');
});

test('rows run in parallel: there is no column barrier', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}'), agent('c3', 'C', 'y {{B}}')], 3);
  const seenPairs = [];
  const f = fakeDispatcher({
    gate: async (task) => {
      seenPairs.push(`${task.column.name}${task.rowId}`);
      await new Promise((r) => setTimeout(r, 5));
    },
  });
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch, concurrency: 3 });
  await r.run();
  // Crow_1 must have started before Brow_3 finished — that is what "no barrier" means.
  assert.ok(seenPairs.indexOf('Crow_1') < seenPairs.length - 1);
  assert.equal(f.seen.length, 6);
});

test('concurrency is a ceiling that is never exceeded', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}')], 12);
  const f = fakeDispatcher({ gate: () => new Promise((r) => setTimeout(r, 5)) });
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch, concurrency: 3 });
  await r.run();
  assert.equal(f.seen.length, 12);
  assert.ok(f.peak() <= 3, `peak was ${f.peak()}`);
  assert.equal(f.peak(), 3, 'and it is actually used');
});

test('one failure skips only its own row', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'Brief', 'x {{A}}'), agent('c3', 'Fit', 'y {{Brief}}')], 3);
  const f = fakeDispatcher({
    answer: (t) => (t.column.name === 'Brief' && t.rowId === 'row_2'
      ? { status: 'failed', error: 'the model refused' }
      : { status: 'done', value: 'ok' }),
  });
  const states = new Map();
  const r = new Runner({
    sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch, concurrency: 4,
    onCell: (k, rec) => states.set(k, rec),
  });
  const prog = await r.run();

  assert.equal(states.get('row_2:c2').status, 'failed');
  assert.equal(states.get('row_2:c3').status, 'skipped');
  assert.equal(states.get('row_2:c3').error, 'Brief failed in this row.');
  assert.equal(states.get('row_1:c3').status, 'done', 'row 1 is untouched');
  assert.equal(states.get('row_3:c3').status, 'done', 'row 3 is untouched');
  assert.deepEqual(
    { planned: prog.planned, done: prog.done, failed: prog.failed, skipped: prog.skipped },
    { planned: 6, done: 4, failed: 1, skipped: 1 },
  );
  assert.ok(!f.seen.some((t) => t.column.name === 'Fit' && t.rowId === 'row_2'),
            'the skipped cell was never dispatched, so it cost nothing');
});

test('a skip cascades the whole way down a row', async () => {
  const s = sheetOf([agent('c1', 'A', 'go'), agent('c2', 'B', 'x {{A}}'), agent('c3', 'C', 'y {{B}}')], 1);
  const f = fakeDispatcher({ answer: (t) => (t.column.name === 'A' ? { status: 'failed', error: 'no' } : { status: 'done' }) });
  const states = new Map();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch,
                         onCell: (k, rec) => states.set(k, rec) });
  await r.run();
  assert.equal(states.get('row_1:c2').status, 'skipped');
  assert.equal(states.get('row_1:c3').status, 'skipped', 'two hops down is still skipped');
});

test('a cell whose upstream this run does NOT own is skipped when that upstream never ran', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'Brief', 'x {{A}}'), agent('c3', 'Fit', 'y {{Brief}}')], 1);
  const f = fakeDispatcher();
  const states = new Map();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'column', colId: 'c3' }, 'all', ENV),
                         dispatch: f.dispatch, onCell: (k, rec) => states.set(k, rec) });
  await r.run();
  assert.equal(states.get('row_1:c3').status, 'skipped');
  assert.match(states.get('row_1:c3').error, /Brief has not run in this row/);
  assert.equal(f.seen.length, 0, 'and no turn was spent finding that out');
});

test('a column-scoped run proceeds when the upstream already succeeded', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'Brief', 'x {{A}}'), agent('c3', 'Fit', 'y {{Brief}}')], 1,
                    { 'row_1:c2': { status: 'done', value: 'earlier answer' } });
  const f = fakeDispatcher();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'column', colId: 'c3' }, 'all', ENV), dispatch: f.dispatch });
  await r.run();
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].values.c2, 'earlier answer');
});

test('stop cancels what is running and CLEARS what never started', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}')], 8);
  let started = 0;
  const f = fakeDispatcher({
    gate: (task, signal) => new Promise((resolve) => {
      started += 1;
      signal.addEventListener('abort', resolve, { once: true });
      setTimeout(resolve, 500);
    }),
  });
  const states = new Map();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch,
                         concurrency: 2, onCell: (k, rec) => states.set(k, rec) });
  const done = r.run();
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(started, 2, 'only the concurrency limit had started');
  r.stop();
  await done;

  const cleared = [...states.entries()].filter(([, rec]) => rec.status === null);
  assert.equal(cleared.length, 6, 'the six that never started are cleared, not left "queued" forever');
  const stopped = [...states.values()].filter((rec) => rec.error === 'Stopped.');
  assert.equal(stopped.length, 2, 'the two in flight are marked stopped');
});

test('attached upstream records reach the dispatcher', async () => {
  const s = sheetOf([agent('c1', 'Brief', 'go'), agent('c2', 'Fit', 'judge {{Brief}}', ['c1'])], 1);
  const f = fakeDispatcher({
    answer: (t) => ({ status: 'done', value: 'v',
                      artifacts: t.column.name === 'Brief' ? [{ filename: 'notes.md', file_id: 'f1', container_id: 'x' }] : [] }),
  });
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch });
  await r.run();
  const fit = f.seen.find((t) => t.column.name === 'Fit');
  assert.equal(fit.upstream.length, 1);
  assert.equal(fit.upstream[0].column.name, 'Brief');
  assert.equal(fit.upstream[0].cell.artifacts[0].filename, 'notes.md');
});

test('an empty plan settles immediately rather than spinning', async () => {
  const s = sheetOf([col('c1', 'A')], 3);
  const f = fakeDispatcher();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch });
  const prog = await r.run();
  assert.deepEqual({ planned: prog.planned, settled: prog.settled }, { planned: 0, settled: 0 });
});

test('a dispatcher that throws fails that cell and nothing else', async () => {
  const s = sheetOf([col('c1', 'A'), agent('c2', 'B', 'x {{A}}')], 3);
  const f = fakeDispatcher({
    gate: (t) => { if (t.rowId === 'row_2') throw new Error('network died'); },
  });
  const states = new Map();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch,
                         onCell: (k, rec) => states.set(k, rec) });
  const prog = await r.run();
  assert.equal(states.get('row_2:c2').error, 'network died');
  assert.deepEqual({ done: prog.done, failed: prog.failed }, { done: 2, failed: 1 });
});

test('a skipped upstream cascades too, and every planned cell ends with a state', async () => {
  // The empty-input case: the dispatcher itself returns 'skipped' rather than failing. Its
  // downstream cell has nothing to read either, and must not be left blank in a run that claims
  // to have planned it.
  const s = sheetOf([col('c1', 'A'), agent('c2', 'Brief', 'x {{A}}'), agent('c3', 'Fit', 'y {{Brief}}')], 2);
  const f = fakeDispatcher({
    answer: (t) => (t.column.name === 'Brief' && t.rowId === 'row_1'
      ? { status: 'skipped', error: 'A is empty in this row.' }
      : { status: 'done', value: 'ok' }),
  });
  const states = new Map();
  const r = new Runner({ sheet: s, plan: plan(s, { kind: 'sheet' }, 'all', ENV), dispatch: f.dispatch,
                         onCell: (k, rec) => states.set(k, rec) });
  const prog = await r.run();

  assert.equal(states.get('row_1:c3').status, 'skipped');
  assert.equal(states.get('row_1:c3').error, 'Brief was skipped in this row.');
  assert.equal(states.get('row_2:c3').status, 'done', 'the other row is untouched');
  assert.equal(prog.settled, prog.planned, 'planned and settled must agree when the run ends');
});
