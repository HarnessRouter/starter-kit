// The database half of the data layer — the half with no database in it.
//
// This app never sees a connection string. The person types one into the launch form, the server
// stores it, and from then on both this app and the agent refer to the database by nothing more
// than the harness it is attached to. Everything here is one of three routes:
//
//   GET  /harnesses/{id}/datasource     what is connected (engine, host, database — no credential)
//   GET  /harnesses/{id}/sql/schema     tables and columns, so a panel can be checked against them
//   POST /harnesses/{id}/sql/query      one SELECT, row-capped and timed out, server-side
//
// The query route is why opening a dashboard is fast. The alternative — asking the agent to
// refresh each panel — is a turn per panel per page-load, which is both slow and billed. The
// agent writes the SQL once, at build time; the app replays it forever. Both go through the same
// read-only gate, so replaying cannot do anything the agent could not have done.
import { hr, kitHarness } from 'reifyui/harness';

/** Errors from the SQL routes carry the database's own complaint, which is the useful part —
 *  "column o.amont does not exist" is what fixes a panel. `.status` distinguishes a refused
 *  statement (400) from a missing connection (409) from a database that is down (502). */
export class QueryError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'QueryError';
    this.status = status;
  }
}

async function harnessId() {
  const h = await kitHarness();
  if (!h) throw new QueryError('Dashboards hasn’t been launched yet.', 0);
  return h.id;
}

async function call(path, init) {
  try {
    return await hr(path, init);
  } catch (e) {
    throw new QueryError(e.message || 'The database request failed.', e.status || 0);
  }
}

// ── what is connected ──────────────────────────────────────────────────────
let _ds;

/** The connected database as the server describes it: `{engine, host, database, sampleRows, …}`,
 *  or null when nothing is connected. Never a credential — the server does not return one and
 *  there is no route here that could ask for it.
 *
 *  Cached because every page asks and the answer changes only when someone reconnects. */
export async function datasource({ fresh = false } = {}) {
  if (_ds && !fresh) return _ds;
  const id = await harnessId();
  const body = await call(`/harnesses/${encodeURIComponent(id)}/datasource`);
  _ds = body?.dataSource || null;
  return _ds;
}

/** A short human label for the connection — "postgres · shop @ db.internal". Rendered in the
 *  app bar so it is always visible WHICH database the numbers came from; a dashboard that does
 *  not say what it is reading is a dashboard someone will eventually misread. */
export function datasourceLabel(ds) {
  if (!ds) return '';
  const engine = ds.engine === 'mysql' ? 'MySQL' : 'PostgreSQL';
  const where = [ds.database, ds.host].filter(Boolean).join(' @ ');
  return where ? `${engine} · ${where}` : engine;
}

// ── the shape of it ────────────────────────────────────────────────────────
/** Tables, columns and types — and sample rows only if the person left them on at launch.
 *  The app uses this to tell "this panel's query is stale because the column was renamed" from
 *  "the database is unreachable", which are the same red box otherwise. */
export async function schema() {
  const id = await harnessId();
  return call(`/harnesses/${encodeURIComponent(id)}/sql/schema`);
}

// ── running one panel ──────────────────────────────────────────────────────
/** One SELECT. Returns `{columns, rows, row_count, truncated, limit_applied}` exactly as the
 *  server returns it — no reshaping here, because the chart layer maps columns to encodings and
 *  a helpful transform in between is a second opinion about the data. */
export async function runQuery(sql, { maxRows } = {}) {
  const id = await harnessId();
  return call(`/harnesses/${encodeURIComponent(id)}/sql/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(maxRows ? { sql, max_rows: maxRows } : { sql }),
  });
}
