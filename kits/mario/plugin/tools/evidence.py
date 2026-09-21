#!/usr/bin/env python3
"""The evidence renderer for this environment: a contact sheet around each failure.

    evidence.py <trace.json> <observations dir> <out dir>

Reads the run's trace and the archived frames (observations/NNNNNN.jpg with frames.jsonl of
timestamps), finds each failure (a life lost), and writes failure_N.jpg: nine frames from one
second before the last live decision to a second and a half after, captioned with the step, the
action and the state. With Pillow missing it writes failure_N.html instead, the same frames as
images. The outer loop reads these; nothing here is specific to the calibration method.
"""
import json
import os
import re
import sys


def _frames(obs_dir):
    idx = os.path.join(obs_dir, "frames.jsonl")
    rows = []
    if os.path.exists(idx):
        for line in open(idx):
            try:
                d = json.loads(line)
                rows.append((float(d["t"]), os.path.join(obs_dir, d["file"])))
            except (ValueError, KeyError):
                continue
    else:
        for name in sorted(os.listdir(obs_dir)):
            m = re.match(r"^(\d+(?:\.\d+)?)\.jpg$", name)
            if m:
                rows.append((float(m.group(1)), os.path.join(obs_dir, name)))
    rows.sort()
    return rows


def _failures(trace):
    steps = trace.get("steps") or []
    prev = None
    last_live = None
    out = []
    for st in steps:
        f = ((st.get("result") or {}).get("fields") or {})
        lives = f.get("lives")
        if lives is not None and prev is not None and lives < prev:
            src = last_live or st
            out.append(src)
        if lives is not None:
            prev = lives
        if f.get("lives") is not None and not f.get("restarting") and not f.get("dead"):
            last_live = st
    return out


def _nearest(frames, t):
    best = None
    for ft, path in frames:
        if best is None or abs(ft - t) < abs(best[0] - t):
            best = (ft, path)
    return best


def main(argv):
    trace_path, obs_dir, out_dir = argv[1], argv[2], argv[3]
    trace = json.load(open(trace_path))
    frames = _frames(obs_dir)
    os.makedirs(out_dir, exist_ok=True)
    fails = _failures(trace)
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        Image = None
    written = []
    for n, st in enumerate(fails, 1):
        t0 = float(st.get("started_at") or 0)
        times = [t0 - 1.0 + i * 0.3125 for i in range(9)]
        picks = [_nearest(frames, t) for t in times] if frames else []
        text = str((st.get("result") or {}).get("text") or "")
        cap = f"failure {n} before step {st.get('index')}: {st.get('action')}: {text[:200]}"
        if Image and picks:
            tiles = []
            for ft, path in picks:
                im = Image.open(path).convert("RGB")
                im.thumbnail((400, 250))
                tiles.append((ft - t0, im))
            w, h = tiles[0][1].size
            sheet = Image.new("RGB", (w * 3, (h + 22) * 3 + 24), "white")
            d = ImageDraw.Draw(sheet)
            d.text((6, 4), cap[:180], fill="black")
            for i, (dt, im) in enumerate(tiles):
                x, y = (i % 3) * w, 24 + (i // 3) * (h + 22)
                sheet.paste(im, (x, y))
                d.text((x + 4, y + h + 4), f"t{dt:+.1f}s", fill="black")
            out = os.path.join(out_dir, f"failure_{n}.jpg")
            sheet.save(out, quality=80)
        else:
            out = os.path.join(out_dir, f"failure_{n}.html")
            imgs = "".join(f'<figure><img src="{os.path.relpath(p, out_dir)}" width="300"><figcaption>t{ft - t0:+.1f}s</figcaption></figure>' for ft, p in picks)
            open(out, "w").write(f"<h3>{cap}</h3><div style='display:grid;grid-template-columns:repeat(3,1fr)'>{imgs}</div>")
        written.append({"failure": n, "step": st.get("index"), "action": st.get("action"), "file": out, "text": text[:300]})
    json.dump(written, open(os.path.join(out_dir, "failures.json"), "w"), indent=1)
    print(f"{len(written)} failures rendered into {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
