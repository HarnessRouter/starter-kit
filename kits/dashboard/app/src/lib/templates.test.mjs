// The template library, pinned.
//
// Templates are data, and data with no test is data that rots: a renamed column, a percentage
// multiplied twice, a preview that renders as five error boxes. All of it ships silently, because
// nothing fails to compile.
//
// The rule these tests exist to protect: a template's `sample` figures may appear in the preview
// and NOWHERE else. They are the one place in this product where a number on a panel did not come
// from the person's database, and the boundary has to be mechanical rather than remembered.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chartOption, formatValue, parseDashboard, statValue, tableView } from './dashboard.js';

const LIB = JSON.parse(readFileSync(new URL('../../../templates/templates.json', import.meta.url), 'utf8'));
const TEMPLATES = LIB.templates;
const sampleOf = (t) => Object.fromEntries(
  Object.entries(t.sample || {}).filter(([k]) => k !== '$comment'),
);

test('the library is not empty and every template has the fields the app reads', () => {
  assert.ok(TEMPLATES.length >= 5);
  for (const t of TEMPLATES) {
    for (const k of ['id', 'name', 'description', 'prompt', 'dialect', 'assumes', 'adapt', 'dashboard']) {
      assert.ok(t[k], `${t.id} is missing ${k}`);
    }
  }
});

test('every template parses as a dashboard', () => {
  for (const t of TEMPLATES) {
    const { doc, error } = parseDashboard(t.dashboard);
    assert.equal(error, undefined, `${t.id}: ${error}`);
    assert.ok(doc.panels.length > 0, `${t.id} has no panels`);
    assert.equal(doc.panels.some((p) => p.missingQuery), false, `${t.id} has a panel with no query`);
  }
});

test('no two panels in a template overlap', () => {
  // Overlapping panels get shoved around by the grid, so the person sees a layout nobody chose.
  for (const t of TEMPLATES) {
    const { doc } = parseDashboard(t.dashboard);
    for (let i = 0; i < doc.panels.length; i += 1) {
      for (let j = i + 1; j < doc.panels.length; j += 1) {
        const a = doc.panels[i].layout;
        const b = doc.panels[j].layout;
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.equal(hit, false,
          `${t.id}: ${doc.panels[i].id} overlaps ${doc.panels[j].id}`);
      }
    }
  }
});

// ── the sample figures ───────────────────────────────────────────────────────

test('every query a panel reads has sample data, so no preview renders as an error', () => {
  for (const t of TEMPLATES) {
    const s = sampleOf(t);
    const { doc } = parseDashboard(t.dashboard);
    for (const p of doc.panels) {
      assert.ok(s[p.query], `${t.id}/${p.id} reads ${p.query}, which has no sample`);
    }
  }
});

test('every panel can actually be drawn from its sample', () => {
  for (const t of TEMPLATES) {
    const s = sampleOf(t);
    const { doc } = parseDashboard(t.dashboard);
    for (const p of doc.panels) {
      const res = s[p.query];
      if (p.viz.kind === 'stat') {
        const { value, error } = statValue(res, p.viz);
        assert.equal(error, undefined, `${t.id}/${p.id}: ${error}`);
        assert.notEqual(value, null, `${t.id}/${p.id} sample value is null`);
      } else if (p.viz.kind === 'chart') {
        const { option, error } = chartOption(res, p.viz, {});
        assert.equal(error, undefined, `${t.id}/${p.id}: ${error}`);
        // A series encoding a column the query does not return draws an empty chart, silently.
        for (const ser of option.series || []) {
          for (const col of Object.values(ser.encode || {})) {
            assert.ok(res.columns.includes(col),
              `${t.id}/${p.id} encodes "${col}", which ${p.query} does not return`);
          }
        }
      } else if (p.viz.kind === 'table') {
        const { columns } = tableView(res, p.viz);
        assert.ok(columns.length, `${t.id}/${p.id} table has no columns`);
      }
    }
  }
});

test('a percent panel is fed a RATIO, not a percentage', () => {
  // Every one of these queries used to end in `* 100.0` while the panel formatted the result as a
  // percent — and Intl multiplies by 100 again. A 2.1% churn rendered as "210%" in four of the
  // five templates. Nothing caught it because the preview had no numbers in it.
  for (const t of TEMPLATES) {
    const s = sampleOf(t);
    const { doc } = parseDashboard(t.dashboard);
    for (const p of doc.panels) {
      if (p.viz.format !== 'percent') continue;
      const { value } = statValue(s[p.query], p.viz);
      assert.ok(Number(value) <= 1,
        `${t.id}/${p.id}: percent panel got ${value}; it must be a ratio (0.021), not 2.1`);
      assert.match(formatValue(value, p.viz), /^\d+(\.\d+)?%$/);
    }
  }
});

test('the SQL for a percent panel does not multiply by 100 either', () => {
  for (const t of TEMPLATES) {
    const { doc } = parseDashboard(t.dashboard);
    for (const p of doc.panels) {
      if (p.viz.format !== 'percent') continue;
      const sql = doc.queries.get(p.query).sql;
      assert.equal(/\*\s*100(\.0)?\b/.test(sql), false,
        `${t.id}/${p.query} multiplies by 100; the percent format already does`);
    }
  }
});

// ── the boundary ─────────────────────────────────────────────────────────────

test('the document a template becomes carries no sample figures', () => {
  // The whole safeguard, mechanically. `sample` sits beside `dashboard`, never inside it, and the
  // copilot sends `dashboard`. If a sample value ever appears in the document, a real dashboard
  // could ship a number nobody's database produced.
  for (const t of TEMPLATES) {
    const doc = JSON.stringify(t.dashboard);
    assert.equal(doc.includes('"sample"'), false, `${t.id}: dashboard contains a sample key`);
    for (const [qid, res] of Object.entries(sampleOf(t))) {
      for (const row of res.rows) {
        for (const cell of row) {
          // NUMBERS only. A category label is shape, not data: "direct" is both a sample row and
          // a value the SQL filters on, and it must be, or the query would not match the sample.
          // What may never appear in the document is a figure — that is the thing a person would
          // read off a panel and believe.
          const v = String(cell);
          if (!/^\d[\d.]{3,}$/.test(v)) continue;
          assert.equal(doc.includes(v), false,
            `${t.id}: sample figure "${v}" from ${qid} appears in the dashboard document`);
        }
      }
    }
  }
});

test('a dashboard document holds no data of its own — no dataset, no series data', () => {
  for (const t of TEMPLATES) {
    const { doc } = parseDashboard(t.dashboard);
    for (const p of doc.panels) {
      if (p.viz.kind !== 'chart') continue;
      const opt = JSON.stringify(p.viz.option);
      assert.equal(opt.includes('"dataset"'), false, `${t.id}/${p.id} carries a dataset`);
      for (const ser of p.viz.option.series || []) {
        assert.equal('data' in ser, false, `${t.id}/${p.id} carries series data`);
      }
    }
  }
});
