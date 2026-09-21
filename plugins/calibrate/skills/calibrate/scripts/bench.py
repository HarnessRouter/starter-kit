#!/usr/bin/env python3
"""K runs of the inner harness, one at a time, then the objective's scoreboard and failure groups.

    bench.py --runs 3 --package <dir with config.yaml> [--goal ...] [--out traces/]

Each run's workspace (trace.json, observations/) is fetched into <out>/run-N/. The report is
printed and written to <out>/report.json. Never start two runs at once."""
import argparse
import json
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(__file__))
import hr  # noqa: E402
import metrics  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--package", required=True, help="the inner harness's package directory (config.yaml, ledger.jsonl)")
    ap.add_argument("--goal", default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--out", default="traces")
    a = ap.parse_args()
    cfg = yaml.safe_load(open(os.path.join(a.package, "config.yaml"))) or {}
    objective = cfg.get("objective") or {}
    goal = a.goal or cfg.get("goal") or "Play."
    traces = []
    sessions = []
    for i in range(1, a.runs + 1):
        r = hr.start_run(goal, model=a.model)
        rid = r["id"]
        r = hr.wait_run(rid)
        sid = hr.session_of(r)
        print(f"run {i}: response {rid} status {r.get('status')} {((r.get('incomplete_details') or {}).get('reason') or '')} session {sid}", flush=True)
        if not sid:
            sys.exit("the response names no session; cannot fetch its workspace")
        ws = hr.fetch_workspace(sid, os.path.join(a.out, f"run-{i}"))
        if not ws["trace"]:
            sys.exit(f"run {i}: no trace.json in the session's workspace ({ws['dir']}); the inner harness must write it")
        t = json.load(open(ws["trace"]))
        t["session_id"] = sid
        t["observations"] = ws["observations"]
        traces.append(t)
        sessions.append(sid)
    rep = metrics.report(traces, objective)
    rep["sessions"] = sessions
    rep["config_version"] = cfg.get("version")
    os.makedirs(a.out, exist_ok=True)
    json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=1, default=str)
    print("\nscoreboard:", json.dumps(rep["scoreboard"]))
    for g in rep["failure_groups"][:8]:
        ex = g["examples"][0] if g["examples"] else {}
        print(f"  {g['count']:3d} x at {g['locus']}: run {ex.get('run')} step {ex.get('step')} {ex.get('action')}: {str(ex.get('text'))[:160]}")
    print(f"\nreport: {os.path.join(a.out, 'report.json')}; traces under {a.out}/run-N/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
