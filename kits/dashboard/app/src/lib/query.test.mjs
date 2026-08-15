// The connection, as the server that owns it describes it.
//
// The database is an ordinary MCP server on the Harness, so nothing here reads connection state
// off the harness: the app asks that one server, at its own entry id, and renders what it gets
// back. Every route and every field name below belongs to the gateway rather than to this app,
// which is the whole reason this file exists — if one of them moves, the app does not fail, it
// renders "No database connected" over a dashboard that is still refreshing perfectly well from
// a database it now refuses to name.
//
// Driven through the real transport with `fetch` stubbed, so the PATHS are pinned too. A helper
// that only tested a projection could not tell you the app was asking the wrong URL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureKit } from 'reifyui/harness';
import { datasource, datasourceLabel, schema, runQuery, QueryError } from './query.js';

const HARNESS = { id: 'hrn-1', kit: 'dashboard', name: 'Dashboards' };
const CONNECTION = { engine: 'postgres', host: 'db.internal:5432', database: 'shop', sampleRows: 5 };
const SERVER = { id: 'mcp.database', name: 'database', enabled: true, connection: CONNECTION };

const BASE = '/api/harness/v1';
const DB_ROUTE = `${BASE}/harnesses/hrn-1/servers/mcp.database`;

/** Answers the harness list from `harnesses`, and everything else from `routes`. Records what was
 *  asked, because "which URL" is half of what this file is checking. */
function stub(routes, { harnesses = [HARNESS] } = {}) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method || 'GET', body: init.body });
    if (url === `${BASE}/harnesses`) return json(200, { harnesses });
    const r = routes[`${init.method || 'GET'} ${url}`] ?? routes[url];
    if (!r) return json(404, { error: { message: 'not found' } });
    return json(r.status || 200, r.body);
  };
  // Also drops reifyui's memo of which harness this kit launched, so tests do not leak into
  // each other through it.
  configureKit({ kitId: 'dashboard', base: BASE });
  return seen;
}

function json(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

test('the connection is asked of the server that owns it', async () => {
  const seen = stub({ [DB_ROUTE]: { body: SERVER } });
  assert.deepEqual(await datasource({ fresh: true }), CONNECTION);
  assert.deepEqual(seen.at(-1), { url: DB_ROUTE, method: 'GET', body: undefined });
});

// `enabled` decides whether an AGENT's turn is handed the tool. Opening a dashboard is not a turn
// and keeps working, so the app bar has to keep naming the database the numbers came from.
test('a switched-off database is still the database these numbers came from', async () => {
  stub({ [DB_ROUTE]: { body: { ...SERVER, enabled: false } } });
  assert.equal((await datasource({ fresh: true }))?.database, 'shop');
});

// Deleting the tool in the console is how someone disconnects, and a dashboard with nothing to
// read is a state to render — not an error to put in a red box.
test('no such server is no connection, not a failure', async () => {
  stub({});
  assert.equal(await datasource({ fresh: true }), null);
});

test('a harness that was never launched says so', async () => {
  stub({}, { harnesses: [] });
  await assert.rejects(() => datasource({ fresh: true }), (e) => e instanceof QueryError);
});

// Nothing the chip renders could be a credential. The server sends none; this pins that a field
// arriving beside the four the label knows about still cannot reach the screen.
test('the label says which database, and never more than that', async () => {
  assert.equal(datasourceLabel(CONNECTION), 'PostgreSQL · shop @ db.internal:5432');
  assert.equal(datasourceLabel({ ...CONNECTION, engine: 'mysql' }), 'MySQL · shop @ db.internal:5432');
  assert.equal(datasourceLabel({ ...CONNECTION, dsn: 'postgresql://u:pw@h/db' }).includes('pw'), false);
  assert.equal(datasourceLabel(null), '');
});

test('schema and one query go to that same server, not to the harness', async () => {
  const seen = stub({
    [`${DB_ROUTE}/schema`]: { body: { engine: 'postgres', tables: [] } },
    [`POST ${DB_ROUTE}/query`]: { body: { columns: ['n'], rows: [[1]], row_count: 1 } },
  });
  assert.deepEqual(await schema(), { engine: 'postgres', tables: [] });
  assert.equal(seen.at(-1).url, `${DB_ROUTE}/schema`);

  const out = await runQuery('select 1 as n', { maxRows: 50 });
  assert.equal(out.row_count, 1);
  assert.deepEqual(seen.at(-1), {
    url: `${DB_ROUTE}/query`,
    method: 'POST',
    body: JSON.stringify({ sql: 'select 1 as n', max_rows: 50 }),
  });
});

// The database's own sentence is what fixes a panel, and the status is how the app tells a refused
// statement from a database that is down.
test('a refused statement arrives as the database said it', async () => {
  stub({ [`POST ${DB_ROUTE}/query`]: { status: 400, body: { error: { message: 'column o.amont does not exist' } } } });
  await assert.rejects(() => runQuery('select o.amont from orders o'), (e) =>
    e instanceof QueryError && e.status === 400 && e.message === 'column o.amont does not exist');
});
