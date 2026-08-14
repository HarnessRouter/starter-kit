// The document contract, pinned.
//
// An agent writes dashboard.json, so every case here is one an agent will eventually produce:
// a panel pointing at a renamed query, a chart carrying its own numbers, a currency format with
// no currency code, a stat naming a column the SELECT does not return. The rule under all of
// them is the same — a dashboard may show a number the database returned, or it may show why it
// could not, and there is no third option.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chartOption, formatValue, mergeOption, normalizeLayout, parseDashboard, queriesToRun,
  statValue, tableView, toFile,
} from './dashboard.js';

const DOC = {
  meta: { schema: 1, title: 'Revenue' },
  datasource: { engine: 'postgres', ref: 'ds_1' },
  queries: [
    { id: 'q_head', name: 'Headline', sql: 'SELECT 1 AS mrr, 2 AS customers' },
    { id: 'q_trend', name: 'Trend', sql: 'SELECT month, revenue FROM t' },
  ],
  panels: [
    { id: 'p1', title: 'MRR', query: 'q_head', layout: { x: 0, y: 0, w: 3, h: 2 },
      viz: { kind: 'stat', column: 'mrr', format: 'currency', currency: 'USD' } },
    { id: 'p2', title: 'Customers', query: 'q_head', layout: { x: 3, y: 0, w: 3, h: 2 },
      viz: { kind: 'stat', column: 'customers', format: 'int' } },
    { id: 'p3', title: 'Trend', query: 'q_trend', layout: { x: 0, y: 2, w: 8, h: 5 },
      viz: { kind: 'chart', option: { series: [{ type: 'line', encode: { x: 'month', y: 'revenue' } }] } } },
  ],
};

const parsed = () => parseDashboard(structuredClone(DOC)).doc;

// ── reading the file ─────────────────────────────────────────────────────────

test('a well-formed document parses to its panels and queries', () => {
  const doc = parsed();
  assert.equal(doc.title, 'Revenue');
  assert.equal(doc.panels.length, 3);
  assert.equal(doc.queries.size, 2);
});

test('a document from a future schema is refused by version, not half-read', () => {
  const { doc, error } = parseDashboard({ ...DOC, meta: { schema: 2, title: 'x' } });
  assert.equal(doc, undefined);
  assert.match(error, /version 2/);
});

test('a missing schema says so rather than being guessed at', () => {
  const { error } = parseDashboard({ panels: [], queries: [] });
  assert.match(error, /meta\.schema/);
});

test('a panel pointing at a query that is not there is marked, not dropped', () => {
  // The agent renamed the query and missed one panel. Dropping the panel would make the mistake
  // invisible; the person needs to see which panel to ask about.
  const doc = parseDashboard({ ...DOC, panels: [{ ...DOC.panels[0], query: 'q_gone' }] }).doc;
  assert.equal(doc.panels.length, 1);
  assert.equal(doc.panels[0].missingQuery, true);
});

test('duplicate panel ids keep the first, so the grid cannot key two panels the same', () => {
  const doc = parseDashboard({ ...DOC, panels: [DOC.panels[0], { ...DOC.panels[1], id: 'p1' }] }).doc;
  assert.equal(doc.panels.length, 1);
  assert.equal(doc.panels[0].title, 'MRR');
});

test('a query with no sql is not a query', () => {
  const doc = parseDashboard({ ...DOC, queries: [{ id: 'q_head', sql: '   ' }] }).doc;
  assert.equal(doc.queries.size, 0);
  assert.equal(doc.panels[0].missingQuery, true);
});

test('an unknown viz kind renders as a complaint rather than as a chart', () => {
  const doc = parseDashboard({ ...DOC, panels: [{ ...DOC.panels[0], viz: { kind: 'gauge' } }] }).doc;
  assert.equal(doc.panels[0].viz.kind, '');
});

// ── the grid ─────────────────────────────────────────────────────────────────

test('a panel wider than the grid is clamped instead of overflowing it', () => {
  assert.deepEqual(normalizeLayout({ x: 0, y: 0, w: 20, h: 3 }), { x: 0, y: 0, w: 12, h: 3 });
});

test('a panel pushed off the right edge is pulled back inside it', () => {
  assert.deepEqual(normalizeLayout({ x: 10, y: 1, w: 6, h: 2 }), { x: 6, y: 1, w: 6, h: 2 });
});

test('a missing layout gets a real one rather than stacking every panel at 0,0', () => {
  assert.deepEqual(normalizeLayout(undefined, 1), { x: 4, y: 0, w: 4, h: 4 });
});

// ── what a refresh has to run ────────────────────────────────────────────────

test('two panels over one query is one query to run', () => {
  const ids = queriesToRun(parsed()).map((q) => q.id);
  assert.deepEqual(ids.sort(), ['q_head', 'q_trend']);
});

test('a query no panel reads is not run', () => {
  const doc = parseDashboard({
    ...DOC,
    queries: [...DOC.queries, { id: 'q_orphan', sql: 'SELECT pg_sleep(30)' }],
  }).doc;
  assert.equal(queriesToRun(doc).some((q) => q.id === 'q_orphan'), false);
});

// ── a stat ───────────────────────────────────────────────────────────────────

test('a stat naming a column the query does not return says which columns it does', () => {
  const { value, error } = statValue({ columns: ['mrr'], rows: [[10]] }, { column: 'arr' });
  assert.equal(value, undefined);
  assert.match(error, /arr/);
  assert.match(error, /mrr/);
});

test('a query that returned no rows is not a zero', () => {
  const { value, error } = statValue({ columns: ['mrr'], rows: [] }, { column: 'mrr' });
  assert.equal(value, undefined);
  assert.match(error, /no rows/);
});

// ── formatting ───────────────────────────────────────────────────────────────

test('money arrives as a string and keeps its cents', () => {
  // DECIMAL through a float loses precision, so the server sends money as a string. Formatting
  // must read that string, not fall through to String() and print "154130.00" raw.
  assert.equal(formatValue('154130.00', { format: 'currency', currency: 'USD' }), '$154,130.00');
});

test('currency with no code is shown as a plain number, never with an assumed symbol', () => {
  const out = formatValue('1234.5', { format: 'currency', currency: '' });
  assert.equal(/[$€£¥]/.test(out), false);
  assert.match(out, /1,234\.5/);
});

test('a non-numeric value under a numeric format is shown as it arrived, not as NaN', () => {
  assert.equal(formatValue('n/a', { format: 'int' }), 'n/a');
});

test('null is a dash, because it is not zero', () => {
  assert.equal(formatValue(null, { format: 'int' }), '—');
  assert.equal(formatValue(0, { format: 'int' }), '0');
});

// ── a chart ──────────────────────────────────────────────────────────────────

const RESULT = { columns: ['month', 'revenue'], rows: [['2025-07', '14750.00'], ['2025-08', '17949.00']] };

test('the query result becomes the dataset, named by the query’s own columns', () => {
  const { option } = chartOption(RESULT, parsed().panels[2].viz, {});
  assert.deepEqual(option.dataset.dimensions, ['month', 'revenue']);
  assert.deepEqual(option.dataset.source, RESULT.rows);
  assert.equal(option.dataset.sourceHeader, false);
});

test('numbers written into the file are stripped, so a chart cannot show data the database never returned', () => {
  const viz = { kind: 'chart', option: { series: [{ type: 'bar', data: [1, 2, 3] }] } };
  const { option } = chartOption(RESULT, viz, {});
  assert.equal('data' in option.series[0], false);
  assert.equal(option.series[0].type, 'bar');
});

test('a dataset written into the file is replaced by the real one', () => {
  const viz = { kind: 'chart', option: { dataset: { source: [['fake', 999]] }, series: [{ type: 'line' }] } };
  const { option } = chartOption(RESULT, viz, {});
  assert.deepEqual(option.dataset.source, RESULT.rows);
});

test('the theme provides defaults and the panel overrides them', () => {
  const theme = { grid: { left: 8, top: 8 }, xAxis: { type: 'category' } };
  const viz = { kind: 'chart', option: { grid: { top: 24 }, series: [{ type: 'line' }] } };
  const { option } = chartOption(RESULT, viz, theme);
  assert.deepEqual(option.grid, { left: 8, top: 24 });
  assert.deepEqual(option.xAxis, { type: 'category' });
});

test('an array in the override replaces rather than merges', () => {
  // Merging series arrays element-wise would leave a two-series theme showing a ghost second
  // series under a one-series chart.
  assert.deepEqual(mergeOption({ color: ['a', 'b'] }, { color: ['c'] }), { color: ['c'] });
});

test('a chart panel with no option says so instead of drawing an empty canvas', () => {
  const { error } = chartOption(RESULT, { kind: 'chart', option: null }, {});
  assert.match(error, /no chart definition/);
});

// ── a table ──────────────────────────────────────────────────────────────────

test('a table shows the columns it named, in that order', () => {
  const { columns, rows } = tableView(RESULT, { columns: ['revenue', 'month'] });
  assert.deepEqual(columns, ['revenue', 'month']);
  assert.deepEqual(rows[0], ['14750.00', '2025-07']);
});

test('naming only columns that do not exist falls back to all of them rather than to nothing', () => {
  const { columns } = tableView(RESULT, { columns: ['nope'] });
  assert.deepEqual(columns, RESULT.columns);
});

// ── writing it back ──────────────────────────────────────────────────────────

test('dragging a panel writes its new layout and nothing else', () => {
  const raw = structuredClone(DOC);
  const out = toFile(raw, parsed(), [{ i: 'p1', x: 6, y: 4, w: 3, h: 2 }]);
  assert.deepEqual(out.panels[0].layout, { x: 6, y: 4, w: 3, h: 2 });
  assert.deepEqual(out.panels[1].layout, DOC.panels[1].layout);
});

test('fields the app does not understand survive a save', () => {
  // The agent may add something this build has never heard of. Losing it on the next drag would
  // make the app the reason the agent's work disappeared.
  const raw = structuredClone(DOC);
  raw.panels[0].annotations = [{ note: 'excludes trials' }];
  raw.meta.author = 'agent';
  const out = toFile(raw, parsed(), [{ i: 'p1', x: 0, y: 0, w: 3, h: 2 }]);
  assert.deepEqual(out.panels[0].annotations, [{ note: 'excludes trials' }]);
  assert.equal(out.meta.author, 'agent');
});
