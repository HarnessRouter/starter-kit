#!/usr/bin/env python3
"""A probe: one run of the inner harness driven by a fixed action sequence instead of its model,
to measure the environment. Prints the trace's steps with their state text.

    probe.py "run_right,run_right,jump_right,jump_right" [--goal ...] [--out probe/]"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hr  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("--goal", default="Probe.")
    ap.add_argument("--out", default="probe")
    a = ap.parse_args()
    actions = [x.strip() for x in a.script.split(",") if x.strip()]
    r = hr.wait_run(hr.start_run(a.goal, script=actions, max_step=len(actions) + 2)["id"])
    sid = hr.session_of(r)
    ws = hr.fetch_workspace(sid, a.out)
    if not ws["trace"]:
        sys.exit("no trace.json came back")
    t = json.load(open(ws["trace"]))
    for s in t.get("steps") or []:
        print(f"{s.get('index'):3d} {s.get('action'):12s} {str((s.get('result') or {}).get('text') or '')[:200]}")
    print(f"\nsession {sid}; workspace under {a.out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
