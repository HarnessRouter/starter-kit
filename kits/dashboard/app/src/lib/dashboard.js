// The dashboard document, and what the app is allowed to do with it.
//
// The contract is written down once, in skills/dashboard-design/SKILL.md, because the agent and
// this file must agree about it and only one of them can be argued with. This module is the app's
// side of that agreement:
//
//   { meta: {schema, title}, datasource: {engine, ref},
//     queries: [ {id, name, sql} ],
//     panels:  [ {id, title, caption?, query, layout:{x,y,w,h}, viz} ] }
//
// Two rules run through everything below.
//
// The first: a malformed document must degrade to a visible, specific complaint, never to a blank
// page and never to a plausible-looking wrong one. An agent writes this file, so it WILL sometimes
// be wrong, and the person needs to be able to read what to say back to it.
//
// The second: no value on a dashboard is ever invented here. There is no default for a number, no
// zero standing in for a query that failed, no sample data behind a chart that has not loaded.
// A panel with no result yet renders as a panel with no result yet.

export const SCHEMA = 1;
export const GRID_COLS = 12;

/** Read the file into the shape the app renders, or explain why it cannot.
 *
 *  Returns `{doc}` or `{error}`. Everything downstream may then assume arrays are arrays and
 *  layouts are numbers, which is the only reason the render path has no defensive checks in it. */
export function parseDashboard(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'This dashboard is empty.' };
  const schema = raw.meta?.schema;
  if (schema !== SCHEMA) {
    return {
      error: schema == null
        ? 'This file is missing meta.schema, so it can’t be read as a dashboard.'
        : `This dashboard was written for version ${schema}; this app reads version ${SCHEMA}.`,
    };
  }

  const queries = new Map();
  for (const q of Array.isArray(raw.queries) ? raw.queries : []) {
    if (q && typeof q.id === 'string' && q.id && typeof q.sql === 'string' && q.sql.trim()) {
      queries.set(q.id, { id: q.id, name: q.name || q.id, sql: q.sql });
    }
  }

  const seen = new Set();
  const panels = [];
  for (const p of Array.isArray(raw.panels) ? raw.panels : []) {
    if (!p || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    panels.push({
      id: p.id,
      title: typeof p.title === 'string' ? p.title : '',
      caption: typeof p.caption === 'string' ? p.caption : '',
      query: typeof p.query === 'string' ? p.query : '',
      layout: normalizeLayout(p.layout, panels.length),
      viz: normalizeViz(p.viz),
      // Named here rather than discovered at render time: a panel pointing at a query that was
      // renamed is a specific, fixable mistake, and it should say so in the panel rather than
      // draw an empty chart that looks like an empty table.
      missingQuery: Boolean(p.query) && !queries.has(p.query),
    });
  }

  return {
    doc: {
      title: raw.meta?.title || 'Untitled dashboard',
      engine: raw.datasource?.engine || '',
      ref: raw.datasource?.ref || '',
      queries,
      panels,
    },
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp a layout into the grid. A panel that claims x=10 w=6 would be pushed somewhere by the
 *  grid engine anyway; deciding where here means the app and the saved file agree about it. */
export function normalizeLayout(l, index = 0) {
  const w = Math.max(1, Math.min(GRID_COLS, Math.round(num(l?.w, 4))));
  const x = Math.max(0, Math.min(GRID_COLS - w, Math.round(num(l?.x, (index * 4) % GRID_COLS))));
  return { x, w, y: Math.max(0, Math.round(num(l?.y, 0))), h: Math.max(1, Math.round(num(l?.h, 4))) };
}

const KINDS = new Set(['stat', 'chart', 'table']);

function normalizeViz(v) {
  const kind = KINDS.has(v?.kind) ? v.kind : '';
  if (kind === 'stat') {
    return {
      kind,
      column: typeof v.column === 'string' ? v.column : '',
      format: typeof v.format === 'string' ? v.format : 'text',
      // No default currency, deliberately. A number rendered in the wrong currency is worse than
      // a number rendered plain, and the skill says the code is required.
      currency: typeof v.currency === 'string' ? v.currency : '',
      unit: typeof v.unit === 'string' ? v.unit : '',
    };
  }
  if (kind === 'table') {
    return { kind, columns: Array.isArray(v.columns) ? v.columns.filter((c) => typeof c === 'string') : null };
  }
  if (kind === 'chart') return { kind, option: v.option && typeof v.option === 'object' ? v.option : null };
  return { kind: '' };
}

/** The queries a refresh actually has to run: those some panel reads, each once.
 *
 *  Only the referenced ones. A query no panel points at produces nothing visible however it is
 *  treated, so running it would be a round trip and a database timeout budget spent on something
 *  no one can see. */
export function queriesToRun(doc) {
  const ids = new Set();
  for (const p of doc.panels) if (p.query && doc.queries.has(p.query)) ids.add(p.query);
  return [...ids].map((id) => doc.queries.get(id));
}

// ── rendering a result ─────────────────────────────────────────────────────

/** The value a stat panel shows: the first row, at the named column.
 *
 *  Returns `{value}` or `{error}` — never a zero for a column that is not there. "This query
 *  returned no column called mrr" is a sentence someone can act on; `0` is a sentence that is
 *  wrong and looks fine. */
export function statValue(result, viz) {
  if (!result?.rows?.length) return { error: 'This query returned no rows.' };
  const i = result.columns.indexOf(viz.column);
  if (i < 0) {
    return { error: viz.column
      ? `No column called “${viz.column}” — this query returns ${result.columns.join(', ')}.`
      : 'This panel doesn’t say which column to show.' };
  }
  return { value: result.rows[0][i] };
}

const NUMERIC = new Set(['int', 'decimal', 'currency', 'percent', 'compact']);

/** Format one value for display. Anything that is not a number under a numeric format is shown
 *  as it arrived rather than coerced — NaN on a dashboard has cost people money. */
export function formatValue(v, { format = 'text', currency = '', unit = '' } = {}) {
  if (v == null) return '—';
  if (!NUMERIC.has(format)) return String(v);
  // Money arrives as a string from the server on purpose: DECIMAL through a float loses cents.
  // Number() is applied only for formatting, and only after the string is known to be numeric.
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return String(v);
  let out;
  if (format === 'currency' && currency) {
    out = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } else if (format === 'percent') {
    out = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(n);
  } else if (format === 'compact') {
    out = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } else if (format === 'int') {
    out = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
  } else {
    out = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  }
  return unit ? `${out} ${unit}` : out;
}

/** The ECharts option for a chart panel: the agent's option, with the query result installed as
 *  its dataset.
 *
 *  `dataset` is assigned by the app and never taken from the file — that is the rule that keeps
 *  a chart from carrying numbers the database never returned. `sourceHeader: false` because rows
 *  come without a header row and `dimensions` names the columns explicitly.
 *
 *  Returns `{option}` or `{error}`. */
export function chartOption(result, viz, theme) {
  if (!viz.option) return { error: 'This panel has no chart definition.' };
  if (!result?.columns?.length) return { error: 'This query returned no columns.' };
  const option = mergeOption(theme || {}, viz.option);
  delete option.data;
  option.dataset = { dimensions: result.columns, source: result.rows, sourceHeader: false };
  if (Array.isArray(option.series)) {
    // A series carrying its own `data` overrides the dataset in ECharts and would render the
    // file's numbers instead of the database's. The skill forbids writing it; this makes the
    // forbidding effective rather than advisory.
    option.series = option.series.map(({ data, ...rest }) => rest);
  }
  return { option };
}

/** Deep merge for plain objects; arrays and scalars from `over` replace. The theme sets axis and
 *  grid defaults, and a chart that specifies its own axis means to replace it, not to blend. */
export function mergeOption(base, over) {
  if (Array.isArray(over) || over === null || typeof over !== 'object') return over;
  const out = Array.isArray(base) || base === null || typeof base !== 'object' ? {} : { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = mergeOption(out[k], v);
  return out;
}

/** The rows a table panel draws, restricted to the columns it named. An unknown column name is
 *  dropped rather than rendered as a blank column, and if that leaves nothing the panel falls
 *  back to every column — an empty table would read as "no data". */
export function tableView(result, viz) {
  if (!result?.columns?.length) return { columns: [], rows: [] };
  if (!viz.columns?.length) return { columns: result.columns, rows: result.rows };
  const idx = viz.columns.map((c) => result.columns.indexOf(c)).filter((i) => i >= 0);
  if (!idx.length) return { columns: result.columns, rows: result.rows };
  return { columns: idx.map((i) => result.columns[i]), rows: result.rows.map((r) => idx.map((i) => r[i])) };
}

/** The document, back in the on-disk shape, with the person's current layout in it.
 *
 *  Written whole, because the agent writes it whole and a partial write is how two writers lose
 *  each other's work. Unknown fields on a panel are carried through untouched: the app must not
 *  be the reason something the agent wrote disappears. */
export function toFile(raw, doc, layouts) {
  const byId = new Map((layouts || []).map((l) => [l.i, l]));
  return {
    ...raw,
    meta: { ...(raw.meta || {}), schema: SCHEMA, title: doc.title },
    panels: (Array.isArray(raw.panels) ? raw.panels : []).map((p) => {
      const l = byId.get(p?.id);
      return l ? { ...p, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : p;
    }),
  };
}
