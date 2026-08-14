#!/usr/bin/env python3
"""Check dashboard.json against the contract the app actually enforces.

A dashboard that is wrong in the wrong way does not fail loudly — the person
opens the page and gets an empty rectangle where a chart should be, or worse, a
number the database never said. The agent cannot see either from inside the
turn. That is what this exists for: run it after every write, and fix what it
prints until it exits 0.

Three families of rule live here, and they mirror three real things:

  * the DOCUMENT rules mirror the app's reader — a panel binds to a query by id,
    a chart's data comes from the query and never from the file, `viz.kind` is
    one of three;
  * the SQL rules mirror the read-only gate in the gateway's SQL plane, so a
    statement that would be refused at run time is refused here instead, before
    anyone opens the page;
  * the LAYOUT rules mirror the 12-column grid, where overlapping panels are
    silently rearranged into a layout nobody designed.

If a rule here and the app ever disagree, the app is right and this file is the
bug. What this canNOT do is run your SQL — only you can, and a query you have
not run is not a panel yet.

    python3 validate_dashboard.py [dashboard.json]

Exit 0 = renders. Exit 1 = something will be wrong on the page.
"""
import json
import re
import sys

SCHEMA = 1
GRID_COLS = 12
ENGINES = ("postgres", "mysql")            # = ENGINES in the gateway's SQL plane
VIZ_KINDS = ("stat", "chart", "table")
# The app's vocabulary (dashboard.js formatValue). `text` shows the value as it came back.
FORMATS = ("text", "int", "decimal", "percent", "currency", "compact")
# Series types that can read a dataset. A gauge/radar/treemap ignores one and draws nothing.
DATASET_SERIES = ("bar", "line", "pie", "scatter", "funnel", "effectScatter", "candlestick", "boxplot")
PANEL_KEYS = {"id", "title", "caption", "query", "layout", "viz"}
MAX_PANELS = 12                            # past a dozen, nobody reads any of them

# The reference implementation this schema descends from spelled these differently. An agent that
# has seen that code writes them out of habit, and every one of them renders nothing.
STALE_PANEL_KEYS = {
    "dataSource": 'the data source is per-dashboard; a panel names a query id: "query": "q_…"',
    "datasource": 'a panel names a query id: "query": "q_…"',
    "sql": 'SQL lives in queries[], not in a panel; add it there and reference its id',
    "refresh": "there is no refresh setting — opening the dashboard runs every query",
    "intent": "say it in the title and caption, which the person can actually read",
}
STALE_VIZ_KEYS = {
    "type": 'the panel kind is "kind" (stat | chart | table); the series type goes in option.series[].type',
    "echartsOption": 'the ECharts option is "option"',
    "encoding": 'a chart carries a full ECharts option; column binding goes in option.series[].encode',
    "value": 'a stat names its column: "column": "…"',
}

errors: list[str] = []
warnings: list[str] = []


def err(where: str, what: str, fix: str) -> None:
    errors.append(f"{where}: {what}\n    → {fix}")


def warn(where: str, what: str, fix: str) -> None:
    warnings.append(f"{where}: {what}\n    → {fix}")


# ── the read-only gate, mirrored ──────────────────────────────────────────────────
# Kept deliberately identical to gateway/sql_plane.py:check_readonly. The point is not to
# duplicate the defence — the gateway still refuses at run time — it is to tell the agent NOW,
# in the turn where it can fix the query, instead of at the moment someone opens the page.

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_STRING = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|`[^`]*`")
_FORBIDDEN = (
    "insert", "update", "delete", "merge", "upsert", "replace",
    "drop", "create", "alter", "truncate", "rename", "comment",
    "grant", "revoke", "vacuum", "analyze", "reindex", "cluster",
    "copy", "call", "do", "execute", "prepare", "deallocate",
    "set", "reset", "begin", "commit", "rollback", "savepoint",
    "lock", "listen", "notify", "load", "handler", "attach", "detach",
    "into",
)
# Enough of them that "this query returns one row" is not mistaken for "this query returns the
# table". Missing one costs a spurious warning, never a missed error.
AGGREGATES = ("count", "sum", "avg", "min", "max", "median", "stddev", "variance", "var_pop",
              "percentile_cont", "percentile_disc", "array_agg", "string_agg", "corr")


def _strip_sql(sql: str) -> str:
    """Comments and quoted text removed, so a column called `update_time` is not mistaken for a
    command and a literal 'please delete me' is not either."""
    s = _BLOCK_COMMENT.sub(" ", sql)
    s = _LINE_COMMENT.sub(" ", s)
    return _STRING.sub(" '' ", s)


def check_sql(sql: str, where: str) -> None:
    raw = (sql or "").strip().rstrip(";").strip()
    if not raw:
        err(where, "has no SQL", "a query without a statement is a panel that cannot draw")
        return
    bare = _strip_sql(raw)

    if ";" in bare.strip().rstrip(";"):
        err(where, "contains more than one statement",
            "send one statement — the connection refuses anything with a second one")
    words = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", bare.lower())
    if not words:
        err(where, "does not look like SQL", "write a SELECT")
        return
    if words[0] not in ("select", "with"):
        err(where, f"starts with {words[0].upper()}",
            "only SELECT is allowed — this connection exists to read data and chart it")
    hit = next((w for w in words if w in _FORBIDDEN), None)
    if hit:
        err(where, f"contains {hit.upper()}",
            f"only SELECT is allowed. If {hit!r} is a column or table name, alias it — the check "
            "cannot tell them apart")

    low = " ".join(words)
    if " group by " in f" {low} " and " order by " not in f" {low} ":
        warn(where, "groups without ORDER BY",
             "a database returns grouped rows in whatever order it likes, so the axis comes out "
             "shuffled — add ORDER BY")
    if " limit " not in f" {low} " and " group by " not in f" {low} " and not any(
            f"{fn}(" in bare.lower() for fn in AGGREGATES):
        warn(where, "selects rows with no aggregate and no LIMIT",
             "it may return the whole table and be cut off by the row cap; aggregate in SQL, or "
             "add a LIMIT")


# ── the document ──────────────────────────────────────────────────────────────────

_DSN_ISH = re.compile(r"://|@|password|:\d{4,5}/", re.I)


def check_datasource(ds: object) -> None:
    if not isinstance(ds, dict):
        err("datasource", "is missing",
            'add "datasource": {"engine": "postgres", "ref": ""} — the app fills in ref')
        return
    engine = ds.get("engine")
    if engine not in ENGINES:
        err("datasource.engine", f"is {json.dumps(engine)}",
            f"this build reads {' and '.join(ENGINES)} (MariaDB counts as mysql)")
    ref = ds.get("ref")
    if ref is None:
        err("datasource.ref", "is missing", 'write "" and the app fills in the connection')
    elif not isinstance(ref, str):
        err("datasource.ref", "is not a string", 'it names a connection: "" if you do not know it')
    elif _DSN_ISH.search(ref):
        # The one rule here that is about safety rather than rendering. This file is read by the
        # browser; a connection string in it is a password on a web page.
        err("datasource.ref", "looks like a connection string",
            "never write a connection string into this file — ref names a connection the app "
            'resolves. Write "" and let the app fill it in')


def check_layout(p: dict, where: str) -> tuple | None:
    lay = p.get("layout")
    if not isinstance(lay, dict):
        err(where, 'has no "layout"',
            'add layout: {"x":0,"y":0,"w":4,"h":4} on the 12-column grid')
        return None
    vals = {}
    for k in ("x", "y", "w", "h"):
        v = lay.get(k)
        if not isinstance(v, int) or isinstance(v, bool):
            err(f"{where}.layout", f"{k}={v!r} is not a whole number",
                "grid coordinates are integers: x and y are cells, w and h are spans")
            return None
        vals[k] = v
    if vals["w"] < 1 or vals["h"] < 1:
        err(f"{where}.layout", "has a zero span", "a panel with w or h of 0 is invisible")
        return None
    if vals["x"] < 0 or vals["y"] < 0:
        err(f"{where}.layout", "has a negative position", "x and y start at 0")
        return None
    if vals["x"] + vals["w"] > GRID_COLS:
        err(f"{where}.layout", f"runs past the grid (x={vals['x']} + w={vals['w']} > {GRID_COLS})",
            f"the grid is {GRID_COLS} columns wide; narrow the panel or move it left")
        return None
    return (vals["x"], vals["y"], vals["w"], vals["h"])


def check_chart(viz: dict, where: str) -> None:
    opt = viz.get("option")
    if not isinstance(opt, dict):
        err(where, 'has no "option" object',
            'a chart carries an ECharts option: {"xAxis":{"type":"category"},"yAxis":{"type":"value"},'
            '"series":[{"type":"bar","encode":{"x":"…","y":"…"}}]}')
        return

    # THE mistake. Data in the file is data that never refreshes — and it is a number the database
    # never said, which is worse than an empty panel.
    if "dataset" in opt:
        err(f"{where}.option", 'has a "dataset"',
            "the app injects the query result as the dataset; delete it and bind columns with "
            "series[].encode")

    series = opt.get("series")
    if not isinstance(series, list) or not series:
        err(f"{where}.option", "has no series[]",
            'add "series": [{"type":"bar","encode":{"x":"…","y":"…"}}] — one entry per line/bar set')
        return
    for i, s in enumerate(series):
        at = f"{where}.option.series[{i}]"
        if not isinstance(s, dict):
            err(at, "is not an object", "every series is a JSON object with a type")
            continue
        st = s.get("type")
        if not st:
            err(at, "has no type", 'add "type": "bar" (or line, pie, scatter, funnel)')
        elif st not in DATASET_SERIES:
            err(at, f'is a "{st}" series',
                f"only {', '.join(DATASET_SERIES[:5])} can read a query result. For a single "
                'number use {"kind":"stat"}')
        if "data" in s:
            err(at, 'has "data"',
                "a chart never carries its own data — the numbers come from the query when the "
                "person opens the page. Delete it and use encode")
        enc = s.get("encode")
        if enc is None:
            warn(at, "has no encode",
                 'say which columns you mean: "encode": {"x":"month","y":"revenue"} (pie/funnel: '
                 '{"itemName":"…","value":"…"})')
        elif not isinstance(enc, dict) or not enc:
            err(f"{at}.encode", "is not a mapping",
                'encode maps a channel to a result column name: {"x":"month","y":"revenue"}')
        else:
            for ch, col in enc.items():
                if not isinstance(col, str) or not col.strip():
                    err(f"{at}.encode.{ch}", f"is {json.dumps(col)}",
                        "name the column your SELECT aliased, as a string")
    if "color" in opt:
        warn(f"{where}.option", 'sets "color"',
             "the app themes charts from one palette that works in light and dark; set a colour "
             "on a single series only when it means something")


def check_viz(p: dict, where: str) -> str | None:
    viz = p.get("viz")
    if not isinstance(viz, dict):
        err(where, 'has no "viz"', 'add viz: {"kind":"stat","column":"…"} or {"kind":"chart","option":{…}}')
        return None
    for k, fix in STALE_VIZ_KEYS.items():
        if k in viz:
            err(f"{where}.viz", f'has "{k}"', fix)
    kind = viz.get("kind")
    if kind not in VIZ_KINDS:
        err(f"{where}.viz", f"kind is {json.dumps(kind)}", f"use one of: {', '.join(VIZ_KINDS)}")
        return None

    if kind == "stat":
        col = viz.get("column")
        if not isinstance(col, str) or not col.strip():
            err(f"{where}.viz", "has no column",
                'a stat reads one column of the query\'s first row: "column": "mrr"')
        fmt = viz.get("format")
        if fmt is not None and fmt not in FORMATS:
            err(f"{where}.viz.format", f"is {json.dumps(fmt)}", f"use one of: {', '.join(FORMATS)}")
        if fmt == "currency" and not (isinstance(viz.get("currency"), str) and len(viz["currency"]) == 3):
            err(f"{where}.viz", 'is currency-formatted with no "currency" code',
                'add "currency": "USD" (or EUR, GBP…). There is no default — nobody may put a '
                "currency symbol on a number you did not confirm")
        d = viz.get("delta")
        if d is not None:
            if not isinstance(d, dict):
                err(f"{where}.viz.delta", "is not an object",
                    '"delta": {"column":"mom_pct","format":"percent","good":"up"}')
            else:
                dc = d.get("column")
                if not isinstance(dc, str) or not dc.strip():
                    err(f"{where}.viz.delta", "has no column",
                        "the change comes from a second column of the same query")
                elif dc == viz.get("column"):
                    err(f"{where}.viz.delta", "names the same column as the value",
                        "the change is its own column — a value cannot be its own delta")
                if d.get("format") is not None and d["format"] not in FORMATS:
                    err(f"{where}.viz.delta.format", f"is {json.dumps(d['format'])}",
                        f"use one of: {', '.join(FORMATS)}")
                if d.get("good") not in ("up", "down"):
                    err(f"{where}.viz.delta", f"good is {json.dumps(d.get('good'))}",
                        'say which way is good: "up" for revenue, "down" for churn and response '
                        "time — it decides the colour")
    elif kind == "chart":
        check_chart(viz, f"{where}.viz")
    elif kind == "table":
        cols = viz.get("columns")
        if cols is not None:
            if not isinstance(cols, list) or not all(isinstance(c, str) for c in cols):
                err(f"{where}.viz.columns", "is not a list of column names",
                    '"columns": ["customer","mrr"] picks and orders them; leave it out for all')
    return kind


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "dashboard.json"
    try:
        with open(path) as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        print(f"{path} does not exist — write the dashboard first.")
        return 1
    except json.JSONDecodeError as e:
        # Worth its own message: a truncated write is the other way a dashboard dies.
        print(f"{path} is not valid JSON: {e}\n"
              f"    → line {e.lineno}, column {e.colno}. Rewrite the file whole.")
        return 1

    if not isinstance(doc, dict):
        print("dashboard.json must be a JSON object.")
        return 1

    meta = doc.get("meta")
    if not isinstance(meta, dict) or meta.get("schema") != SCHEMA:
        got = meta.get("schema") if isinstance(meta, dict) else None
        err("meta.schema", f"is {json.dumps(got)}, not {SCHEMA}",
            f'set "schema": {SCHEMA}. The app refuses anything else rather than guessing')
    if not isinstance(meta, dict) or not str(meta.get("title") or "").strip():
        warn("meta.title", "is empty", "it is how this dashboard is named in the list")

    check_datasource(doc.get("datasource"))

    queries = doc.get("queries")
    if not isinstance(queries, list) or not queries:
        err("queries", "is missing or empty",
            'add "queries": [{"id":"q_…","name":"…","sql":"SELECT …"}] — a panel draws a query')
        queries = []

    qids: set[str] = set()
    for i, q in enumerate(queries):
        at = f"queries[{i}]"
        if not isinstance(q, dict):
            err(at, "is not an object", "every query is {id, name, sql}")
            continue
        qid = q.get("id")
        if not qid or not isinstance(qid, str):
            err(at, "has no id", 'give it a stable id like "q_mrr_by_month"; panels reference it')
        elif qid in qids:
            err(at, f"reuses the id {qid!r}", "query ids must be unique")
        else:
            qids.add(qid)
        if not str(q.get("name") or "").strip():
            warn(at, "has no name", "one short line saying what it asks, for whoever edits this next")
        check_sql(q.get("sql"), f"{at}.sql")

    panels = doc.get("panels")
    if not isinstance(panels, list) or not panels:
        err("panels", "is missing or empty", 'add "panels": [ … ] — a dashboard with no panels is a blank page')
        panels = []

    pids: set[str] = set()
    used: set[str] = set()
    boxes: list[tuple] = []
    top_y = min((p["layout"]["y"] for p in panels
                 if isinstance(p, dict) and isinstance(p.get("layout"), dict)
                 and isinstance(p["layout"].get("y"), int)), default=0)
    top_row_kinds: list[str] = []

    for i, p in enumerate(panels):
        at = f"panels[{i}]"
        if not isinstance(p, dict):
            err(at, "is not an object", "every panel is a JSON object")
            continue
        pid = p.get("id")
        if not pid or not isinstance(pid, str):
            err(at, "has no id", 'give it a stable id like "p_mrr"; the person\'s arrangement is keyed by it')
        elif pid in pids:
            err(at, f"reuses the id {pid!r}", "panel ids must be unique")
        else:
            pids.add(pid)

        if not str(p.get("title") or "").strip():
            err(at, "has no title", "an unlabelled number cannot be read; title it as the question it answers")

        for k, fix in STALE_PANEL_KEYS.items():
            if k in p:
                err(at, f'has "{k}"', fix)
        unknown = [k for k in p if k not in PANEL_KEYS and k not in STALE_PANEL_KEYS]
        if unknown:
            warn(at, f"has unknown key(s): {', '.join(sorted(unknown))}",
                 f"the app reads only: {', '.join(sorted(PANEL_KEYS))}")

        qref = p.get("query")
        if not qref or not isinstance(qref, str):
            err(at, 'has no "query"', 'name the query it draws: "query": "q_…"')
        elif qids and qref not in qids:
            err(at, f"draws query {qref!r}, which does not exist",
                f"use one of: {', '.join(sorted(qids)) or '(none)'}")
        else:
            used.add(qref)

        box = check_layout(p, at)
        kind = check_viz(p, at)

        if box:
            x, y, w, h = box
            for (ox, oy, ow, oh, oat) in boxes:
                if x < ox + ow and ox < x + w and y < oy + oh and oy < y + h:
                    err(f"{at}.layout", f"overlaps {oat}",
                        "the grid pushes overlapping panels aside, so the person sees an "
                        "arrangement you did not design — give each panel its own cells")
                    break
            boxes.append((x, y, w, h, at))
            if kind == "stat" and h < 2:
                warn(f"{at}.layout", f"is a stat only {h} row tall", "a headline number needs h: 2")
            if kind == "chart" and (w < 4 or h < 3):
                warn(f"{at}.layout", f"is a chart {w}×{h}",
                     "under w: 4 or h: 3 the axis labels collide; charts want w 6-8, h 4-6")
            if y == top_y:
                top_row_kinds.append(kind or "")

        # A stat shows the first row. Which row is first is the database's business unless you say.
        if kind == "stat" and qref:
            q = next((x for x in queries if isinstance(x, dict) and x.get("id") == qref), None)
            sql = _strip_sql(str((q or {}).get("sql") or "")).lower()
            if " group by " in f" {sql} " and " limit " not in f" {sql} ":
                warn(at, "is a stat over a grouped query",
                     "a stat reads the first row only; add ORDER BY … LIMIT 1 so it is the row you mean")

    for qid in sorted(qids - used):
        warn(f"queries[{qid}]", "is drawn by no panel",
             "delete it, or add the panel it was written for")

    if len(panels) > MAX_PANELS:
        warn("panels", f"there are {len(panels)}",
             f"past about {MAX_PANELS} nobody reads any of them — this is two dashboards for two "
             "audiences")
    if len(panels) >= 4 and top_row_kinds and "stat" not in top_row_kinds:
        warn("panels", "the top row has no headline number",
             "eyes land top-left first; put the numbers there and the charts that explain them "
             "underneath")

    if errors:
        print(f"{len(errors)} problem(s) that will render wrong:\n")
        for e in errors:
            print("  ✗ " + e)
    if warnings:
        print(f"\n{len(warnings)} warning(s):\n")
        for w in warnings:
            print("  ! " + w)
    if not errors:
        n = len(panels)
        print(f"dashboard.json is valid — {n} panel{'s' if n != 1 else ''} over "
              f"{len(queries)} quer{'ies' if len(queries) != 1 else 'y'}."
              + (" Review the warnings above." if warnings else ""))
        print("This does not run your SQL. Run every query before you finish.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
