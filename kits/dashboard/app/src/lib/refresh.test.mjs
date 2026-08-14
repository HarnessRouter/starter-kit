// The refresh, pinned.
//
// These are the four ways a page of live panels goes wrong: one query takes the others down with
// it, twelve panels open twelve connections at once, a run keeps going after the person left, and
// a panel shows a stale number as though it were current.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDashboard } from './dashboard.js';
import { CONCURRENCY, freshness, panelState, refreshAll } from './refresh.js';

function docWith(queries, panels) {
  return parseDashboard({ meta: { schema: 1, title: 't' }, queries, panels }).doc;
}

const THREE_OVER_ONE = docWith(
  [{ id: 'q1', sql: 'SELECT a, b, c' }],
  ['p1', 'p2', 'p3'].map((id, i) => ({
    id, query: 'q1', layout: { x: i * 3, y: 0, w: 3, h: 2 },
    viz: { kind: 'stat', column: 'a', format: 'int' },
  })),
);

test('three panels over one query run it once', async () => {
  const calls = [];
  await refreshAll(THREE_OVER_ONE, async (sql) => { calls.push(sql); return { columns: ['a'], rows: [[1]] }; });
  assert.equal(calls.length, 1);
});

test('every panel over that query gets the one result', async () => {
  const states = await refreshAll(THREE_OVER_ONE, async () => ({ columns: ['a'], rows: [[7]] }));
  for (const p of THREE_OVER_ONE.panels) {
    assert.equal(panelState(p, states).status, 'ok');
  }
});

test('a query that fails does not take the others with it', async () => {
  const doc = docWith(
    [{ id: 'ok', sql: 'SELECT 1' }, { id: 'bad', sql: 'SELECT nope' }],
    [
      { id: 'p1', query: 'ok', layout: { x: 0, y: 0, w: 6, h: 2 }, viz: { kind: 'stat', column: 'a' } },
      { id: 'p2', query: 'bad', layout: { x: 6, y: 0, w: 6, h: 2 }, viz: { kind: 'stat', column: 'a' } },
    ],
  );
  const states = await refreshAll(doc, async (sql) => {
    if (sql.includes('nope')) throw new Error('column "nope" does not exist');
    return { columns: ['a'], rows: [[1]] };
  });
  assert.equal(states.get('ok').status, 'ok');
  assert.equal(states.get('bad').status, 'error');
  // The database's own words reach the panel — that sentence is what fixes the query.
  assert.match(states.get('bad').error, /column "nope" does not exist/);
});

test('a failed query shows its error and never a zero', async () => {
  const doc = docWith(
    [{ id: 'bad', sql: 'x' }],
    [{ id: 'p1', query: 'bad', layout: { x: 0, y: 0, w: 4, h: 2 }, viz: { kind: 'stat', column: 'a' } }],
  );
  const states = await refreshAll(doc, async () => { throw new Error('timeout'); });
  const st = panelState(doc.panels[0], states);
  assert.equal(st.status, 'error');
  assert.equal('result' in st, false);
});

test('concurrency is bounded, so a wide dashboard cannot storm the database', async () => {
  const queries = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, sql: `SELECT ${i}` }));
  const panels = queries.map((q, i) => ({
    id: `p${i}`, query: q.id, layout: { x: (i % 3) * 4, y: Math.floor(i / 3) * 2, w: 4, h: 2 },
    viz: { kind: 'stat', column: 'a' },
  }));
  let inFlight = 0;
  let peak = 0;
  await refreshAll(docWith(queries, panels), async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { columns: ['a'], rows: [[1]] };
  });
  assert.ok(peak <= CONCURRENCY, `peak ${peak} exceeded ${CONCURRENCY}`);
  assert.ok(peak > 1, 'queries must still overlap — a serial refresh is a slow page');
});

test('navigating away stops the run instead of finishing into a page that is gone', async () => {
  // The abort is fired from inside the run rather than after a delay: a wall-clock abort races
  // the workers, and the first version of this test aborted after every query had already
  // started, which proved nothing while passing for the wrong reason.
  const queries = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, sql: `SELECT ${i}` }));
  const panels = queries.map((q, i) => ({
    id: `p${i}`, query: q.id, layout: { x: 0, y: i, w: 4, h: 1 }, viz: { kind: 'stat', column: 'a' },
  }));
  const ctl = new AbortController();
  let ran = 0;
  let gone = false;
  const late = [];
  await refreshAll(docWith(queries, panels), async () => {
    ran += 1;
    if (ran === 5) { ctl.abort(); gone = true; }   // the person navigates away mid-refresh
    await new Promise((r) => setTimeout(r, 1));
    return { columns: ['a'], rows: [[1]] };
  }, {
    signal: ctl.signal,
    // The property is "nothing lands after the page is gone" — asserted by watching for it
    // rather than by predicting how many had settled first, which depends on how the workers
    // happened to interleave and is not what this test is about.
    onUpdate: (id, s) => { if (gone && s.status !== 'loading') late.push(id); },
  });

  assert.ok(ran >= 5 && ran < 5 + CONCURRENCY, `${ran} queries ran after aborting at 5`);
  assert.deepEqual(late, [], 'a result landed on a page that had already gone away');
});

test('a panel reads loading before its query lands, not empty', () => {
  const st = panelState(THREE_OVER_ONE.panels[0], new Map());
  assert.equal(st.status, 'loading');
});

test('a panel with no query says so rather than sitting blank forever', () => {
  const doc = docWith([], [{ id: 'p1', layout: { x: 0, y: 0, w: 4, h: 2 }, viz: { kind: 'stat', column: 'a' } }]);
  assert.match(panelState(doc.panels[0], new Map()).error, /isn’t connected/);
});

test('a panel pointing at a renamed query names the query it wanted', () => {
  const doc = docWith([{ id: 'q_new', sql: 'SELECT 1' }],
    [{ id: 'p1', query: 'q_old', layout: { x: 0, y: 0, w: 4, h: 2 }, viz: { kind: 'stat', column: 'a' } }]);
  assert.match(panelState(doc.panels[0], new Map()).error, /q_old/);
});

test('freshness stays coarse, so nobody reads it as a live counter', () => {
  const now = Date.parse('2026-08-14T12:00:00Z');
  assert.equal(freshness(now - 5_000, now), 'just now');
  assert.equal(freshness(now - 300_000, now), '5 min ago');
  assert.equal(freshness(now - 7_200_000, now), '2 h ago');
  assert.equal(freshness(0, now), '');
});
