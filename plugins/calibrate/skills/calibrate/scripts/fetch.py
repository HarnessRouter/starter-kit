#!/usr/bin/env python3
"""Fetch the inner harness's package (config.yaml, ledger.jsonl, the environment) into a directory.

    fetch.py [--name <package name>] [--out package]

Without --name, the package that carries the environment (the one with MCP servers) is taken.
Use this, not the harness's plugin export: the export is a generated package named after the
harness and has no version, and publishing it back adds a second package beside the real one."""
import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hr  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default=None)
    ap.add_argument("--out", default="package")
    a = ap.parse_args()
    h = hr.get_harness()
    plugins = h.get("plugins") or []
    if not plugins:
        sys.exit("the inner harness carries no package")
    chosen = None
    if a.name:
        chosen = next((p for p in plugins if p.get("name") == a.name), None)
    else:
        chosen = next((p for p in plugins if p.get("mcpServers")), None) or plugins[0]
    if chosen is None:
        sys.exit(f"no package named {a.name!r}; the harness carries {[p.get('name') for p in plugins]}")
    listing = hr.call("GET", f"/v1/harnesses/{hr.HARNESS}/plugins/{chosen['name']}/files")
    files = listing.get("files") if isinstance(listing, dict) else listing
    if not files:
        sys.exit(f"the package {chosen['name']!r} has no files to fetch")
    os.makedirs(a.out, exist_ok=True)
    n = 0
    for f in files:
        rel = f.get("path")
        if not rel or rel.startswith("/") or ".." in rel:
            continue
        p = os.path.join(a.out, rel)
        os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
        if f.get("content") is not None:
            open(p, "w").write(f["content"])
        elif f.get("content_b64") is not None:
            open(p, "wb").write(base64.b64decode(f["content_b64"]))
        else:
            continue
        n += 1
    print(f"fetched {chosen['name']} {(chosen.get('manifest') or {}).get('version')}: {n} files into {a.out}/")
    for must in ("config.yaml", "ledger.jsonl", "plugin.json"):
        if not os.path.exists(os.path.join(a.out, must)):
            print(f"  note: no {must} in the package")
    return 0


if __name__ == "__main__":
    sys.exit(main())
