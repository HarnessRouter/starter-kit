#!/usr/bin/env python3
"""The objective's scoreboard and failure groups over traces already on disk.

    report.py --package <dir> traces/run-*/trace.json"""
import argparse
import json
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(__file__))
import metrics  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("traces", nargs="+")
    a = ap.parse_args()
    objective = (yaml.safe_load(open(os.path.join(a.package, "config.yaml"))) or {}).get("objective") or {}
    rep = metrics.report([json.load(open(p)) for p in a.traces], objective)
    print("scoreboard:", json.dumps(rep["scoreboard"]))
    for g in rep["failure_groups"][:8]:
        ex = g["examples"][0] if g["examples"] else {}
        print(f"  {g['count']:3d} x at {g['locus']}: run {ex.get('run')} step {ex.get('step')} {ex.get('action')}: {str(ex.get('text'))[:160]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
