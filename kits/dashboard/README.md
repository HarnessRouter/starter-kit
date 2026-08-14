# Dashboards

A dashboard built by conversation. You say what you want to understand; the agent reads your
database's schema, decides which charts answer it, writes the SQL for each, and lays them out.
Opening the dashboard re-runs every query and draws it fresh.

Launch it from **Starter Kits** in the HarnessRouter console. That provisions the Harness this app
talks to; nothing else is deployed and nothing is configured except your database connection.

## Before you launch: the database account

Point this at a database user that can only **SELECT**.

Every statement the agent writes is checked before it runs — one statement, SELECT only, no
data-modifying CTE, row-capped, timed out, and on PostgreSQL inside a read-only transaction. That
check is a parser, and a parser is a thing that can be wrong. A read-only account is the second
defence, it is independent of the first, and it takes a minute to create:

```sql
-- PostgreSQL
CREATE ROLE dashboards LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE app TO dashboards;
GRANT USAGE ON SCHEMA public TO dashboards;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboards;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboards;

-- MySQL / MariaDB
CREATE USER 'dashboards'@'%' IDENTIFIED BY '…';
GRANT SELECT ON app.* TO 'dashboards'@'%';
```

Give it a connection to the smallest set of tables the dashboard needs. PostgreSQL and
MySQL/MariaDB are what this version reads.

## Sample rows: your call, at launch

The agent always sees table and column names and their types — without them it would be guessing
at table names, which is how you get a dashboard of confident errors.

Whether it also sees a few **real rows** is a switch you set when you create the dashboard, and it
starts **on**. Sample rows make the agent much better at the things names do not tell it: that
`status` holds `'ACTIVE'` and not `'active'`, that `amount` is in cents, that a "country" column
holds ISO codes. Turn it off and the agent gets the shape of your database and not one row of what
is in it.

## How it works

- **One session is one dashboard.** The dashboard list is this Harness's session list, and a
  dashboard's content is `dashboard.json` in that session's workspace. There is no database of
  ours anywhere — yours is the only one involved.
- **The app is served by the HarnessRouter image** at `/kits/dashboard`, same-origin with the
  console, which is why it needs no API key and no login of its own.
- **Your connection string is resolved in one place**, inside the gateway, at the moment a query
  runs. The agent never receives it, the browser never receives it, and `dashboard.json` holds a
  reference to the connection rather than the connection itself — the same shape the console
  already uses for MCP bearer tokens.
- **Opening a dashboard costs no agent turn.** The page asks the gateway to run the queries
  directly. A turn per panel per page-load would be slow and billed; this is neither.
- **Every number is live.** There is nowhere in `dashboard.json` to write a figure. A chart's data
  arrives when someone opens the page, and a query that fails shows its error in the panel instead
  of a zero.

## What's in the folder

| Path | What |
|---|---|
| `kit.json` | The Harness this kit needs, and where its app is served |
| `skills/dashboard-design/` | The `dashboard.json` contract, how to explore a schema, which chart answers which question, and the validator — read before anything is written |
| `templates/templates.json` | Five worked dashboards (revenue, pipeline, traffic, support, executive) as reference material |
| `app/` | The UI |

## The document

`dashboard.json` is the whole dashboard: `meta`, one `datasource`, a list of `queries` (id, name,
SQL), and a list of `panels` (a title, the query it draws, its place on a 12-column grid, and
either a single-number readout or an ECharts option). The contract is stated once, in
`skills/dashboard-design/SKILL.md`, and enforced twice — by the app's reader and by
`validate_dashboard.py`, which the agent runs before it finishes. If the two ever disagree, the
app is right and the validator is the bug.

```
python3 skills/dashboard-design/validate_dashboard.py path/to/dashboard.json
```

It catches what cannot be seen from inside a turn: a statement the read-only check would refuse,
data written into a chart instead of read from the database, a panel pointing at a query that does
not exist, panels overlapping on the grid. It does not run your SQL — only the agent can, and it
is told to run every query before shipping a panel.

## Working on the app

```
cd app
npm install
npm test
npm run build
```

## License

This kit is governed by the [HarnessRouter Starter Kit License Agreement](../LICENSE.md), not MIT.

- Individual local use is free under that Agreement.
- Selling, deploying, hosting or providing an End Product to an external customer, and creating
  paid Client Deliverables, require the
  [Commercial Use and Deployment Agreement](../COMMERCIAL-DEPLOYMENT-AGREEMENT.md) and an
  [Order Form](../ORDER-FORM-TEMPLATE.md).

Third-party materials keep their own licenses — see [CREDITS.md](./CREDITS.md).
