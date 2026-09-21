"""The objective: what an environment declares as success, failure, ordered metrics and place.

The outer loop reads only this declaration; it knows nothing about lives, levels or tests. The
predicates are small on purpose:

    pass:    "<field> == <value>" | "<field>" (truthy) | "terminal <reason>"
    failure: "<field> decreased" | "<field> increased" | "terminal <reason>" | "<field> == <value>"
    metrics: [{field: <name>, better: true | false | higher | lower}, ...]   ordered
    locus:   [<field>, ...]                                                   where a failure happened

`evaluate` reads a run record (the trace's dict) and returns the metrics and the failures;
`report` groups the failures of several runs by locus; `compare` says whether a run set improved.
"""
from __future__ import annotations

import re
from statistics import mean

ELAPSED = "elapsed"
FAILURES = "failures"


def _fields_of(step: dict) -> dict:
    r = step.get("result") or {}
    return dict(r.get("fields") or {}) if isinstance(r, dict) else {}


def _value(fields: dict, name: str):
    return fields.get(name)


def _literal(text: str):
    t = text.strip()
    if t.lower() in ("true", "false"):
        return t.lower() == "true"
    if t.lower() in ("null", "none"):
        return None
    try:
        return int(t)
    except ValueError:
        pass
    try:
        return float(t)
    except ValueError:
        return t.strip("'\"")


def _pass(run: dict, expr: str, final: dict) -> bool:
    e = (expr or "").strip()
    if not e:
        return run.get("status") == "completed"
    m = re.match(r"^terminal\s+(\S+)$", e)
    if m:
        return run.get("reason") == m.group(1)
    m = re.match(r"^(\w+)\s*==\s*(.+)$", e)
    if m:
        return _value(final, m.group(1)) == _literal(m.group(2))
    return bool(_value(final, e))


def _failure_steps(run: dict, expr: str) -> list[dict]:
    """Each failure as {step, locus fields, last live text}: the step at which the failure signal fired."""
    e = (expr or "").strip()
    steps = run.get("steps") or []
    out: list[dict] = []
    m = re.match(r"^(\w+)\s+(decreased|increased)$", e)
    if m:
        name, direction = m.group(1), m.group(2)
        prev = None
        last_live: dict | None = None
        for st in steps:
            f = _fields_of(st)
            v = f.get(name)
            if v is None:
                continue
            fired = prev is not None and ((direction == "decreased" and v < prev) or (direction == "increased" and v > prev))
            if fired:
                src = last_live if last_live is not None else st
                out.append({"step": int(src.get("index", 0)), "action": src.get("action"), "fields": _fields_of(src),
                            "text": str((src.get("result") or {}).get("text") or "")[:400]})
            prev = v
            if not f.get("restarting") and not f.get("dead"):
                last_live = st
        return out
    m = re.match(r"^terminal\s+(\S+)$", e)
    if m:
        if run.get("reason") == m.group(1) and steps:
            st = steps[-1]
            out.append({"step": int(st.get("index", 0)), "action": st.get("action"), "fields": _fields_of(st),
                        "text": str((st.get("result") or {}).get("text") or "")[:400]})
        return out
    m = re.match(r"^(\w+)\s*==\s*(.+)$", e)
    if m:
        want = _literal(m.group(2))
        for st in steps:
            if _fields_of(st).get(m.group(1)) == want:
                out.append({"step": int(st.get("index", 0)), "action": st.get("action"), "fields": _fields_of(st),
                            "text": str((st.get("result") or {}).get("text") or "")[:400]})
        return out
    return out


def evaluate(run: dict, objective: dict) -> dict:
    """The metrics of one run under the objective, and its failures."""
    steps = run.get("steps") or []
    final: dict = {}
    for st in steps:
        f = _fields_of(st)
        if f:
            final = {**final, **f}
    failures = _failure_steps(run, str(objective.get("failure") or ""))
    started, finished = run.get("started_at"), run.get("finished_at")
    elapsed = round(float(finished) - float(started), 1) if started is not None and finished is not None else None
    metrics: dict = {"pass": _pass(run, str(objective.get("pass") or ""), final), FAILURES: len(failures), ELAPSED: elapsed}
    for m in objective.get("metrics") or []:
        name = m.get("field")
        if name in (FAILURES, ELAPSED, "pass"):
            continue
        metrics[name] = final.get(name)
    return {"metrics": metrics, "failures": failures, "final": final, "status": run.get("status"), "reason": run.get("reason"),
            "steps": len(steps), "config_version": run.get("config_version")}


def _better(direction, a, b):
    """True when a is better than b for the direction (true/false as target values, higher/lower)."""
    if a is None or b is None:
        return False
    if isinstance(direction, bool) or str(direction).lower() in ("true", "false"):
        want = direction if isinstance(direction, bool) else str(direction).lower() == "true"
        return (a == want) and (b != want)
    if str(direction).lower() == "higher":
        return a > b
    return a < b


def _aggregate(evals: list[dict], name: str):
    vals = [e["metrics"].get(name) for e in evals]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    if all(isinstance(v, bool) for v in vals):
        return round(sum(1 for v in vals if v) / len(vals), 3)   # a rate
    return round(mean(float(v) for v in vals), 2)


def scoreboard(evals: list[dict], objective: dict) -> dict:
    names = ["pass", FAILURES] + [m.get("field") for m in objective.get("metrics") or [] if m.get("field") not in ("pass", FAILURES, ELAPSED)] + [ELAPSED]
    board = {n: _aggregate(evals, n) for n in names}
    board["runs"] = len(evals)
    return board


def compare(before: list[dict], after: list[dict], objective: dict) -> str:
    """kept | reverted | same, by the ordered metrics; the first metric that differs decides."""
    b, a = scoreboard(before, objective), scoreboard(after, objective)
    order = [("pass", True), (FAILURES, "lower")] + [(m.get("field"), m.get("better")) for m in objective.get("metrics") or []
                                                    if m.get("field") not in ("pass", FAILURES)]
    for name, direction in order:
        x, y = a.get(name), b.get(name)
        if x is None or y is None or x == y:
            continue
        if name == "pass":
            return "kept" if x > y else "reverted"
        if isinstance(direction, bool) or str(direction).lower() in ("true", "false"):
            return "kept" if x > y else "reverted"
        return "kept" if (str(direction).lower() == "higher" and x > y) or (str(direction).lower() == "lower" and x < y) else "reverted"
    return "same"


def report(runs: list[dict], objective: dict) -> dict:
    """The scoreboard over runs and the failures grouped by locus, largest group first."""
    evals = [evaluate(r, objective) for r in runs]
    locus = list(objective.get("locus") or [])
    groups: dict = {}
    for i, e in enumerate(evals):
        for f in e["failures"]:
            key = tuple(_bucket(f["fields"].get(l)) for l in locus) if locus else ("*",)
            g = groups.setdefault(key, {"locus": dict(zip(locus, key)) if locus else {}, "count": 0, "examples": []})
            g["count"] += 1
            if len(g["examples"]) < 3:
                g["examples"].append({"run": i, "step": f["step"], "action": f["action"], "text": f["text"]})
    ordered = sorted(groups.values(), key=lambda g: -g["count"])
    return {"scoreboard": scoreboard(evals, objective), "runs": evals, "failure_groups": ordered}


def _bucket(v, width: float = 5.0):
    """Numbers are grouped in bands so nearby failures fall together."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v // width) * width
    return v
