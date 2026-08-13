#!/usr/bin/env python3
"""Check sheet.json against the contract the app actually enforces.

A sheet that is wrong in the wrong way does not fail loudly — it shows the
person an empty grid, or a column with no editor, or a cell that renders
nothing. The agent cannot see that from inside the turn. That is what this
exists for: run it after every write, and fix what it prints until it exits 0.

Every rule here mirrors a real branch in the app (`app/src/lib/model.js`
validate(), and the planner in `app/src/lib/run.js`). If a rule below and the
app ever disagree, the app is right and this file is the bug.

    python3 validate_sheet.py [sheet.json]

Exit 0 = the sheet loads and can run. Exit 1 = something is broken.
"""
import json
import re
import sys

TYPES = {"text", "number", "select", "tags", "checkbox", "date", "url", "harness"}
STATUSES = {"queued", "running", "done", "failed", "skipped"}
APP_OWNED = ("status", "run_id", "response_id", "session_id", "artifacts", "started_at", "ended_at")
CHRN = re.compile(r"^chrn_[0-9a-f]{32}$")
REF = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")

errors: list[str] = []
warnings: list[str] = []


def err(where: str, what: str, fix: str) -> None:
    errors.append(f"{where}: {what}\n    → {fix}")


def warn(where: str, what: str, fix: str) -> None:
    warnings.append(f"{where}: {what}\n    → {fix}")


def refs(prompt: object) -> list[str]:
    out: list[str] = []
    for m in REF.finditer(str(prompt or "")):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


def check_columns(columns: list) -> dict:
    """Returns {lowercased name: index} for the columns that named themselves."""
    by_name: dict[str, int] = {}
    seen_ids: set[str] = set()
    for i, c in enumerate(columns):
        at = f"columns[{i}]"
        if not isinstance(c, dict):
            err(at, "is not an object", 'every column is {"id": …, "name": …, "type": …}')
            continue
        cid = c.get("id")
        if not cid:
            err(at, "has no id", 'give it a stable id like "col_a1b2c3d4"')
        elif cid in seen_ids:
            err(at, f'repeats the id "{cid}"', "ids must be unique across columns")
        else:
            seen_ids.add(cid)

        name = str(c.get("name") or "").strip()
        if not name:
            err(at, "has no name", "every column needs a short, human name")
        elif name.lower() in by_name:
            err(at, f'repeats the name "{name}"',
                "column names must be unique — agent prompts address columns as {{Name}}, "
                "and a duplicate makes that ambiguous")
        else:
            by_name[name.lower()] = i

        if c.get("type") not in TYPES:
            err(at, f"has type {json.dumps(c.get('type'))}", f"use one of: {' '.join(sorted(TYPES))}")

        if c.get("type") in ("select", "tags") and "options" in c and not isinstance(c["options"], list):
            err(f"{at}.options", "is not an array", 'write "options": ["Todo", "Doing", "Done"]')
    return by_name


def check_harness(columns: list, by_name: dict) -> None:
    for i, c in enumerate(columns):
        if not isinstance(c, dict):
            continue
        at = f"columns[{i}]"
        is_agent = c.get("type") == "harness"
        cfg = c.get("harness")

        if is_agent and not isinstance(cfg, dict):
            err(at, 'is an agent column with no "harness" object',
                'add "harness": {"harness_id": "", "prompt": "…", "attach": []}')
            continue
        if not is_agent and cfg is not None:
            err(at, 'carries a "harness" object but is not an agent column',
                'either set "type": "harness" or delete the harness object')
            continue
        if not is_agent:
            continue

        hid = cfg.get("harness_id", "")
        if hid != "" and not CHRN.match(str(hid)):
            err(f"{at}.harness.harness_id", f"is {json.dumps(hid)}",
                'leave it "" unless you were given a real agent id — you cannot see the list, '
                "and an invented id silently runs the wrong agent")

        prompt = str(cfg.get("prompt") or "")
        if not prompt.strip():
            err(f"{at}.harness.prompt", "is empty",
                "an agent column needs a prompt; it is what runs on every row")
        elif not refs(prompt):
            warn(f"{at}.harness.prompt", "references no columns",
                 "without a {{Column}} reference every row gets the same input, "
                 "so every row gets the same answer")

        known = ", ".join(str(columns[j].get("name")) for j in range(i)) or "(none — this is the first column)"
        for name in refs(prompt):
            j = by_name.get(name.strip().lower())
            if j is None:
                err(f"{at}.harness.prompt", f"references {{{{{name}}}}}, which is not a column",
                    f"columns to its left are: {known}")
            elif j >= i:
                err(f"{at}.harness.prompt", f"references {{{{{name}}}}}, which is not to its left",
                    f'move "{columns[j].get("name")}" before "{c.get("name")}" — '
                    "a column can only read columns earlier in the sheet")

        attach = cfg.get("attach") or []
        if not isinstance(attach, list):
            err(f"{at}.harness.attach", "is not an array", 'write "attach": []')
            continue
        for a in attach:
            hit = next((k for k, x in enumerate(columns) if isinstance(x, dict) and x.get("id") == a), None)
            if hit is None:
                err(f"{at}.harness.attach", f'names "{a}", which is not a column id', "attach only real column ids")
            elif hit >= i:
                err(f"{at}.harness.attach", f'attaches "{columns[hit].get("name")}", which is not to its left',
                    "a column can only attach files from columns earlier in the sheet")
            elif columns[hit].get("type") != "harness":
                err(f"{at}.harness.attach", f'attaches "{columns[hit].get("name")}", which is not an agent column',
                    "only agent columns produce files — reference a plain column as {{Name}} instead")


def check_cells(sheet: dict, columns: list, row_ids: set) -> None:
    cells = sheet.get("cells")
    if cells is None:
        return
    if not isinstance(cells, dict):
        err("cells", "is not an object", 'write "cells": {"<rowId>:<colId>": {"value": …}}')
        return
    by_id = {c.get("id"): c for c in columns if isinstance(c, dict)}
    for key, cell in cells.items():
        at = f'cells["{key}"]'
        parts = key.split(":")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            err(at, 'is not a "<rowId>:<colId>" key', "join the row id and the column id with one colon")
            continue
        row_ref, col_ref = parts
        if row_ref not in row_ids:
            err(at, f'names row "{row_ref}", which does not exist', "use an id from rows[]")
        col = by_id.get(col_ref)
        if col is None:
            err(at, f'names column "{col_ref}", which does not exist',
                "use an id from columns[] — a column NAME here renders nothing")
            continue
        if not isinstance(cell, dict):
            err(at, "is not an object", 'write {"value": …} — never a bare value at the key')
            continue

        if col.get("type") != "harness":
            owned = [f for f in APP_OWNED if f in cell]
            if owned:
                err(at, f"carries {', '.join(owned)} in a plain column",
                    "only agent cells carry run state, and only the app writes it")
        else:
            st = cell.get("status")
            if st is not None and st not in STATUSES:
                err(f"{at}.status", f"is {json.dumps(st)}", f"use one of: {' '.join(sorted(STATUSES))}")
            if bool(cell.get("run_id")) != bool(cell.get("session_id")) and (cell.get("run_id") or cell.get("session_id")):
                err(at, "has one of run_id / session_id but not the other",
                    "both come from a real run — delete them, or leave the cell out entirely")

        if col.get("type") == "checkbox" and "value" in cell and not isinstance(cell["value"], bool):
            warn(at, "is a checkbox holding a non-boolean", "write true or false")
        if col.get("type") == "number" and cell.get("value") is not None \
                and "value" in cell and not isinstance(cell["value"], (int, float)):
            warn(at, "is a number column holding a non-number", "write the value as a number, not a string")
        opts = col.get("options")
        if col.get("type") in ("select", "tags") and isinstance(opts, list) and opts:
            labels = {o if isinstance(o, str) else o.get("label") for o in opts}
            vals = cell.get("value") if col["type"] == "tags" else cell.get("value")
            vals = vals if isinstance(vals, list) else ([vals] if vals not in (None, "") else [])
            for v in vals:
                if v not in labels:
                    warn(at, f'holds "{v}", which is not one of the column\'s options',
                         "add it to options, or use one of the existing ones")


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "sheet.json"
    try:
        raw = open(path, encoding="utf-8").read()
    except OSError as e:
        print(f"cannot read {path}: {e}")
        return 1
    try:
        sheet = json.loads(raw)
    except json.JSONDecodeError as e:
        # A truncated or half-escaped write is the other way a sheet dies, and the line and column
        # are the whole diagnosis.
        print(f"{path} is not valid JSON: {e.msg} at line {e.lineno}, column {e.colno}")
        print("    → rewrite the file whole; a partial write leaves it unparseable")
        return 1

    if not isinstance(sheet, dict):
        print(f"{path}: the file is not a JSON object")
        return 1

    if sheet.get("meta", {}).get("schema") != 1:
        err("meta.schema", f"is {json.dumps(sheet.get('meta', {}).get('schema'))}",
            'set "schema": 1 — the app refuses anything else rather than guessing')

    columns = sheet.get("columns")
    rows = sheet.get("rows")
    if not isinstance(columns, list):
        err("columns", "is missing or not an array", 'write "columns": []')
        columns = []
    if not isinstance(rows, list):
        err("rows", "is missing or not an array", 'write "rows": []')
        rows = []

    by_name = check_columns(columns)
    check_harness(columns, by_name)

    row_ids: set = set()
    for i, r in enumerate(rows):
        rid = r.get("id") if isinstance(r, dict) else None
        if not rid:
            err(f"rows[{i}]", "has no id", 'give it a stable id like "row_a1b2c3d4"')
        elif rid in row_ids:
            err(f"rows[{i}]", f'repeats the id "{rid}"', "ids must be unique across rows")
        else:
            row_ids.add(rid)

    check_cells(sheet, columns, row_ids)

    if sheet.get("run"):
        for cid in sheet["run"].get("columns", []):
            if not any(isinstance(c, dict) and c.get("id") == cid for c in columns):
                warn("run.columns", f'names column "{cid}", which no longer exists',
                     "leave it — the run header simply counts one column fewer")

    if len(raw.encode("utf-8")) > 2 * 1024 * 1024:
        warn(path, "is over 2 MB", "trim long agent answers; the app caps what it stores per cell")

    for w in warnings:
        print(f"warning  {w}")
    for e in errors:
        print(f"ERROR    {e}")
    if errors:
        print(f"\n{len(errors)} problem(s) will break this sheet. Fix them and run this again.")
        return 1
    print(f"{path}: OK" + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
