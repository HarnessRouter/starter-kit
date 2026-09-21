#!/usr/bin/env python3
"""Publish the package as the inner harness's plugin: the new config.yaml and ledger.jsonl travel
with it, and the harness's instructions follow config.yaml. Every other harness setting is kept.

    publish.py --package <dir>"""
import argparse
import base64
import json
import os
import sys

import yaml

sys.path.insert(0, os.path.dirname(__file__))
import hr  # noqa: E402

SKIP_DIRS = {"__pycache__", "node_modules", "observations", ".git"}
TEXT = {".py", ".md", ".json", ".yaml", ".yml", ".txt", ".sh", ".toml", ".cfg", ""}


def package_files(root: str) -> list[dict]:
    out = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            p = os.path.join(dirpath, name)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            data = open(p, "rb").read()
            ext = os.path.splitext(name)[1].lower()
            if ext in TEXT:
                try:
                    out.append({"path": rel, "content": data.decode("utf-8")})
                    continue
                except UnicodeDecodeError:
                    pass
            out.append({"path": rel, "content_b64": base64.b64encode(data).decode()})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--new", action="store_true", help="add a package the harness does not carry yet")
    a = ap.parse_args()
    cfg = yaml.safe_load(open(os.path.join(a.package, "config.yaml"))) or {}
    manifest = json.load(open(os.path.join(a.package, "plugin.json")))
    h = hr.get_harness()
    files = package_files(a.package)
    names = [p.get("name") for p in (h.get("plugins") or [])]
    if not manifest.get("version"):
        sys.exit(f"{a.package}/plugin.json has no version; fetch the real package with fetch.py, never the harness's export")
    if manifest["name"] not in names and not a.new:
        sys.exit(f"the harness carries {names}, not {manifest['name']!r}; a publish replaces the same-named package (use --new to add one)")
    others = [p for p in (h.get("plugins") or []) if p.get("name") != manifest["name"]]
    body = {"name": h["name"], "base": h["base"], "defaultModel": h.get("defaultModel"),
            "mcpServers": h.get("mcpServers", []), "skills": h.get("skills", []),
            "plugins": others + [{"name": manifest["name"], "files": files, "enabled": True}],
            "disabledTools": h.get("disabledTools", []), "additionalHeaders": h.get("additionalHeaders", []),
            "timeoutSeconds": h.get("timeoutSeconds"),
            "system_prompt": cfg.get("instructions") or h.get("systemPrompt") or "",
            "max_step": h.get("maxStep") or h.get("max_step")}
    r = hr.put_harness(body)
    pv = [(p["name"], (p.get("manifest") or {}).get("version")) for p in r.get("plugins") or []]
    print(f"published config v{cfg.get('version')} of {manifest['name']} {manifest.get('version')} on {r.get('id')}: plugins {pv}, prompt {len(r.get('systemPrompt') or '')} chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
