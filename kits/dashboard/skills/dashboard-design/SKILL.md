---
name: dashboard-design
description: How to build a working dashboard — the exact dashboard.json contract, how to explore a schema and test SQL before it becomes a panel, which chart answers which question, and how to lay panels out so the important number is where the eye lands. Use for EVERY dashboard request, before writing anything.
---

# Dashboard design

You are answering a question with a database, not decorating one.

## The file you are writing

There are no dashboard tools here. A dashboard is ONE file — `dashboard.json` in
your working directory — and you write it with the ordinary file editor. Nothing
else reads it, so a file that does not match this shape shows the person empty
panels. Match it exactly.

```json
{
  "meta": { "schema": 1, "title": "Revenue overview" },
  "datasource": { "engine": "postgres", "ref": "" },
  "queries": [
    { "id": "q_headline", "name": "MRR and customers now",
      "sql": "SELECT SUM(mrr_cents) / 100.0 AS mrr, COUNT(*) AS customers FROM subscriptions WHERE status = 'active'" },
    { "id": "q_revenue_by_month", "name": "Revenue by month",
      "sql": "SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount_cents) / 100.0 AS revenue\nFROM invoices\nWHERE status = 'paid' AND paid_at >= CURRENT_DATE - INTERVAL '12 months'\nGROUP BY 1 ORDER BY 1" }
  ],
  "panels": [
    { "id": "p_mrr", "title": "Monthly recurring revenue", "caption": "Active paid subscriptions",
      "query": "q_headline", "layout": { "x": 0, "y": 0, "w": 3, "h": 2 },
      "viz": { "kind": "stat", "column": "mrr", "format": "currency", "currency": "USD" } },
    { "id": "p_customers", "title": "Paying customers",
      "query": "q_headline", "layout": { "x": 3, "y": 0, "w": 3, "h": 2 },
      "viz": { "kind": "stat", "column": "customers", "format": "int" } },
    { "id": "p_trend", "title": "Revenue by month",
      "query": "q_revenue_by_month", "layout": { "x": 0, "y": 2, "w": 8, "h": 5 },
      "viz": { "kind": "chart", "option": {
        "xAxis": { "type": "category" },
        "yAxis": { "type": "value" },
        "series": [ { "type": "line", "smooth": true, "encode": { "x": "month", "y": "revenue" } } ]
      } } }
  ]
}
```

That is the whole vocabulary. Three arrays of facts: where the data comes from,
what to ask it, and what to draw with the answer.

### The rules that are not negotiable

Each of these fails silently — an empty panel, or worse, a number nobody can
trust:

- **`meta.schema` is `1`.** The app refuses a file it cannot read rather than
  guessing at it.
- **A panel names a query by id: `"query": "q_revenue_by_month"`.** Not an inline
  query, not a `dataSource` object. A panel whose `query` names nothing renders
  empty.
- **You never write the data.** `viz.option` carries no `dataset`, and no
  `series[].data`. The app runs the query when the person opens the page and
  injects the result as the chart's dataset. Data written into the option is
  either ignored or, worse, shown — a chart that says something the database
  never said and never updates.
- **Charts address result columns by name, through `encode`.** The app sets
  `dataset.dimensions` to the query's column names, so
  `"encode": { "x": "month", "y": "revenue" }` means the columns your own SELECT
  aliased `month` and `revenue`. Alias every expression in your SQL — `SUM(x)/100.0`
  with no alias gets a column name the database invented.
- **`viz.kind` is one of `stat`, `chart`, `table`.** Not `type`; not the ECharts
  series name. The series type lives inside `option.series[].type`.
- **A `stat` reads the FIRST row** of its query's result, at the named column. A
  query for a stat should return exactly one row.
- **`currency` format requires a `currency` code** (`"USD"`, `"EUR"`, …). There
  is no default. Nobody may put a dollar sign in front of a number you did not
  confirm is dollars.
- **`layout` is a 12-column grid**: `x + w` never exceeds 12, `w` and `h` are at
  least 1, and no two panels overlap. Overlapping panels get shoved around by
  the grid and the person sees a layout you did not design.
- **Ids are stable and unique** across `queries` and across `panels`. Reuse them
  when you edit; never renumber a dashboard, or the person's saved arrangement
  detaches from the panels.
- **`datasource.ref` is not yours to invent, and never a connection string.** It
  names the connection the person set up when they created this dashboard. If
  the file already has one, copy it forward untouched. If you are creating the
  file, write `""` — the app fills it in. A connection string written here would
  be a password in a file the browser reads.

Optional and worth having: `panel.caption`, one short line under the title for
the thing the number does not say ("Excludes trials", "Last 12 complete
months"). Everything not listed above is not a field. There is no refresh
setting: opening the dashboard runs every query, and that is the only refresh
there is.

### What the app does with the file

Worth knowing, because it explains every rule above:

1. It runs **each query a panel reads, once**, whatever number of panels read
   it. Three stat panels pointing at one `SELECT a, b, c` cost one round trip;
   three near-identical queries cost three. A query no panel names is not run
   at all — so deleting a panel and leaving its query behind costs nothing, but
   nothing will tell you the query is dead either.
2. A result is `{ columns: [name…], rows: [[value…]…] }` — the query's own
   column names and its rows.
3. For a `chart` panel it merges your `option` over a small theme base — the
   palette, fonts, and tooltip and grid defaults — and sets `dataset` to
   `{ dimensions: columns, source: rows, sourceHeader: false }`. The base adds
   no axes: a `bar`, `line` or `scatter` declares its own `xAxis` and `yAxis`; a
   `pie` or `funnel` declares neither, or ECharts draws stray ones through it.
4. For a `stat` it formats `rows[0]` at the named column; for a `table` it draws
   the rows, restricted to `viz.columns` if you named them.
5. A query that fails shows its error in the panels that read it. It does not
   show a zero. Nothing on a dashboard is ever a stand-in for a number that did
   not arrive.

Read `dashboard.json` before every change and write it back WHOLE. The person
may have dragged panels between your turns, and a partial write loses that.

## The database is not yours to guess

Your tool list contains the database tools for this dashboard — read it, and use
the names you find there. Do not guess a tool name from this document. There are
two capabilities:

- **The schema tool** returns
  `{ engine, tables: [ { schema, name, columns: [ { name, type, nullable } ], sample? } ], table_count, truncated, sampled }`.
  Call it FIRST, on every new dashboard, before you write a line of SQL. `engine`
  is what you copy into `datasource.engine`.
- **The query tool** runs one SELECT and returns
  `{ columns, rows, row_count, truncated, limit_applied }`.

If neither is in your tool list, stop and say so: this dashboard has no database
connected yet, and SQL you cannot run is SQL you cannot promise.

**Sample rows are the person's choice.** When they set the dashboard up they
decided whether the agent may see real rows alongside the column names;
`sampled` in the schema response tells you which way it went. When it is
`false`, they have deliberately kept their data out of this conversation — work
from names and types, and do not go fishing with `SELECT *`. Confirm shapes with
questions that are about shape (`COUNT(*)`, the aggregate you intend to chart),
not with dumps of rows.

**Read the schema like a person, not a parser.** Names and types tell you most
of it: `status`, `deleted_at`, `is_test`, `plan`, `*_id`, timestamps. Before
charting a category column, find out what is actually in it —
`SELECT status, COUNT(*) FROM subscriptions GROUP BY 1 ORDER BY 2 DESC` — because
a dashboard filtered on `status = 'active'` when the table says `'ACTIVE'` shows
an honest, confident zero. That question is about shape and stays fair game
whatever the sample setting: it asks which categories exist, not what any
particular customer did.

**When the schema cannot answer the question, say so.** If they ask for churn and
there is no cancellation date anywhere, the correct move is one sentence telling
them what is missing and what you can show instead. Not a plausible-looking
query over the wrong column.

## SELECT, and nothing else

Every statement you send is checked before it reaches the database, and refused
unless it is a single read:

- one statement — no semicolons joining two;
- it starts with `SELECT` or `WITH`;
- no `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`, `GRANT`, `SET`,
  `COPY`, `CALL`, `INTO`, … anywhere in it, including inside a CTE — a
  data-modifying CTE starts with `WITH` and still deletes rows;
- on PostgreSQL it additionally runs inside a read-only transaction;
- results are row-capped and the statement is timed out.

That check is a parser, and a parser is a thing that can be wrong, which is why
the setup guide also asks for a database account that only has SELECT. Two
independent defences. Do not design around either of them: no temp tables, no
`SET search_path`, no stored procedure calls. If a word in the forbidden list is
genuinely a column name (`comment`, `set`, `into`), alias it — the check cannot
tell a column from a command.

Keep queries cheap. Aggregate in SQL, never in the panel: `GROUP BY` and
`SUM`/`COUNT` server-side and return the dozen rows you will draw, rather than
ten thousand rows for the browser to add up. Bound every time series
(`WHERE occurred_at >= CURRENT_DATE - INTERVAL '90 days'`) and put a `LIMIT` on
every "top N" query.

**`ORDER BY` is not optional on anything with an axis.** A database returns rows
in whatever order it likes; a month axis that is not ordered draws September
before March and looks like data corruption.

### Dialect

`datasource.engine` is `postgres` or `mysql` (MariaDB counts as `mysql`). Most of
what a dashboard needs differs in exactly three places:

| | PostgreSQL | MySQL / MariaDB |
|---|---|---|
| Month bucket | `date_trunc('month', created_at)` | `DATE_FORMAT(created_at, '%Y-%m-01')` |
| Relative date | `CURRENT_DATE - INTERVAL '30 days'` | `CURRENT_DATE - INTERVAL 30 DAY` |
| Identifier quoting | `"order"` | `` `order` `` |

Write for the engine the schema tool reported. Do not write one query that tries
to work on both.

## Test every query before it becomes a panel

Run it. Read what came back. Then write the panel.

A query you have not run is a guess about a column name, a join cardinality, an
empty result and a type all at once, and the person finds all four for you when
they open the page. Specifically, check:

- **It runs at all.** Half of first drafts name a column that does not exist; the
  error says which.
- **It returned rows.** Zero rows is a real answer sometimes and a wrong filter
  the rest of the time. Widen the window and see whether the data appears.
- **The columns are named what your `encode` says.** This is the single most
  common cause of a blank chart: the SQL says `SUM(mrr_cents)/100.0` and the
  encode says `mrr`.
- **A stat query returned exactly one row.**
- **The numbers are plausible.** Revenue of 4,899,000 when they told you it is a
  small business usually means cents charted as currency, or a join fanning out
  rows. Divide by 100, or count `DISTINCT`.
- **`truncated` is false.** If the row cap cut your result, the chart would be
  drawing a slice of the answer. Aggregate harder.

## Choosing the chart for the question

Pick the form from the question, not from variety. One question per panel.

| The question | The panel |
|---|---|
| How much / how many, right now? | `stat` — a big number, with a caption saying "of what" |
| Is it going up? | `line`, time on the x-axis, one to three series |
| Which is biggest? | `bar`, sorted by value, horizontal when the labels are words |
| How does the whole split? | `pie` (donut) — only with ≤ 6 slices, otherwise a bar |
| Where do things drop off? | `funnel`, stages in order |
| Which specific rows need attention? | `table`, ≤ 10 rows, most urgent first |
| Do two numbers move together? | `scatter` |

Bars emphasise magnitude, lines emphasise trend
([eazyBI](https://eazybi.com/blog/data-visualization-and-chart-types)). A pie
with nine slices and a pie with three near-equal slices are both unreadable;
past six categories, use a sorted bar. Never a pie for a pipeline: it hides the
one thing you wanted, which is where the drop is
([ORM](https://orm-tech.com/blog/sales-dashboard-chart-types)).

A number is only a metric when it is compared to something. Give a headline stat
either a `delta` (from a second column in the same query) or a trend line
directly under it. `delta.good` says which direction is good — `"up"` for
revenue, `"down"` for churn and response time — so the app can colour it
correctly, and a falling response time is not painted red.

```json
"viz": { "kind": "stat", "column": "mrr", "format": "currency", "currency": "USD",
         "delta": { "column": "mom_pct", "format": "percent", "good": "up" } }
```

Formats: `int` (whole number, grouped), `decimal` (up to 2 places), `compact`
(1.2M — for a number too big for its tile), `percent` (**the query returns 12.4,
not 0.124** — it renders as "12.4%"), `currency` (with its code), and `text` for
a value that is not a number at all. Money in a database is usually an integer
number of cents: divide in SQL, or the dashboard is off by a hundred.

The series types that read a query result are `bar`, `line`, `pie`, `scatter`
and `funnel`. `gauge`, `radar` and `treemap` do not — for a single number use a
`stat`, which is what a gauge was pretending to be.

Leave colours alone. The app themes every chart from one palette that works in
both light and dark; set a colour only to make one series mean something (a
target line, the one bar you are talking about), never to decorate.

## Laying it out

The grid is **12 columns wide**, rows are a fixed height, and it scrolls
vertically. Narrow screens stack every panel full width in reading order — top
to bottom, left to right — so the order you lay out in is the order a phone
reads.

- **The top-left panel is the answer to their question.** Eyes land there first
  and the F-pattern takes them right and then down; the most important number
  gets the best real estate
  ([Domo](https://www.domo.com/learn/article/dashboard-design-examples-best-practices),
  [UXPin](https://www.uxpin.com/studio/blog/dashboard-design-principles/)).
- **Row one is numbers, not charts.** Three or four stats across the top —
  `w: 4, h: 2` gives three, `w: 3, h: 2` gives four — then the charts that
  explain them underneath.
- **Sizes that work**: stat `h: 2`; a chart `w: 6-8, h: 4-6` (never narrower
  than 4, or the axis labels collide); a table `w: 6, h: 5-8`. Anything wide and
  short is a trend; anything square is a comparison.
- **Five to nine panels.** Stephen Few's definition of a dashboard is the
  information needed for a job, on one screen, monitored at a glance
  ([Perceptual Edge](https://www.perceptualedge.com/files/Dashboard_Design_Course.pdf));
  working memory holds about seven things
  ([Figr](https://figr.design/blog/dashboard-design-best-practices)). Past a
  dozen panels nobody reads any of them — that is a second dashboard for a
  second audience.
- **Group by subject, not by chart type.** Revenue next to revenue. Reading MRR
  and ARR apart hides the relationship between them
  ([Orbix](https://www.orbix.studio/blogs/saas-metrics-dashboard-guide)).
- **Leave no half-row gaps.** Every row's panels sum to 12 columns.
- **Titles are the question, in their words.** "Sign-ups by week", not
  "COUNT(id) GROUP BY week". Never name a table or a column in a title.

`templates/templates.json` in this kit holds five worked dashboards — SaaS
revenue, sales pipeline, web analytics, support operations, an executive
summary — each with real SQL and real ECharts options. They are written against
a schema the person almost certainly does not have. Use them for **which panels
belong on this kind of dashboard and how they are arranged**, then rewrite every
query against the schema you actually read. A template's SQL pasted in
unchanged is a dashboard of error messages.

## Review pass (mandatory)

From your working directory:

```
python3 "$(ls .claude/skills/dashboard_design/validate_dashboard.py \
              .harness/skills/dashboard_design/validate_dashboard.py 2>/dev/null | head -1)" dashboard.json
```

Both paths are real — which one exists depends on which backend you are running
on. The directory is `dashboard_design`, with an underscore.

It prints the exact path of anything that will render wrong, and what to write
instead. **Fix and re-run until it exits clean.** It catches a statement the
read-only gate would refuse, data written into a chart, a panel pointing at no
query, and panels overlapping — none of which you can see from here.

The validator cannot run your SQL. You can, and you must: every query, before it
ships. Then reread the file as the person opening it:

- Does the top-left panel answer the question they actually asked?
- Is every number labelled well enough that they know what it excludes?
- Would any two panels be better as one?

Finish by telling them, in one line, what the dashboard shows and anything you
could not answer from their schema.
