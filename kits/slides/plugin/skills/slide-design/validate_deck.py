#!/usr/bin/env python3
"""Check deck.json against the contract the renderer actually enforces.

A deck that is wrong in the wrong way does not fail loudly — it renders as an
empty coloured rectangle, and the agent has no way to notice from inside the
turn. That is what this exists for: run it after every write, and fix what it
prints until it exits 0.

Every rule here mirrors a real branch in the renderer (SlideView / ElementView
in `reifyui/slides`): an element positions itself from `frame`, text comes from
`content.runs`, and paint order comes from list order. If a rule below and the
renderer ever disagree, the renderer is right and this file is the bug.

    python3 validate_deck.py [deck.json]

Exit 0 = renders. Exit 1 = something will be invisible or wrong.
"""
import json
import sys

STAGE_W, STAGE_H = 1920, 1080
TYPES = {"text", "image", "chart", "flowchart", "shape", "table", "code", "embed"}  # = RENDERERS in reifyui/src/slides/elements.jsx
ROLES = {"title", "subtitle", "body", "bullets", "caption"}
MIN_FONT = 22

errors: list[str] = []
warnings: list[str] = []


def err(where: str, what: str, fix: str) -> None:
    errors.append(f"{where}: {what}\n    → {fix}")


def warn(where: str, what: str, fix: str) -> None:
    warnings.append(f"{where}: {what}\n    → {fix}")


def check_element(el: object, where: str) -> None:
    if not isinstance(el, dict):
        err(where, "is not an object", "every element is a JSON object")
        return

    if not el.get("id"):
        err(where, 'has no "id"',
            'give it a stable id (e.g. "s2-title"); the canvas keeps selection by id')

    t = el.get("type")
    if t not in TYPES:
        err(where, f'type {t!r} is not renderable',
            f"use one of: {', '.join(sorted(TYPES))}")

    # THE mistake. Top-level geometry is silently ignored: the element renders at
    # 0×0 with no size, which looks like a blank slide.
    stray = [k for k in ("x", "y", "w", "h", "width", "height") if k in el]
    if stray:
        err(where, f"has top-level {', '.join(stray)}",
            'position goes in frame: {"x":…, "y":…, "w":…, "h":…, "rotation":0}')

    if "z" in el:
        err(where, 'has "z"',
            "there is no z property — paint order is list order, so move the "
            "element later in elements[] to raise it")

    f = el.get("frame")
    if not isinstance(f, dict):
        err(where, 'has no "frame"',
            'add frame: {"x":…, "y":…, "w":…, "h":…, "rotation":0} in stage pixels')
    else:
        for k in ("x", "y", "w", "h"):
            v = f.get(k)
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                err(f"{where}.frame", f"{k}={v!r} is not a number",
                    "frame values are numbers in stage pixels (1920×1080)")
        if isinstance(f.get("w"), (int, float)) and f["w"] <= 0:
            err(f"{where}.frame", "w is not positive", "a zero-width element is invisible")
        if isinstance(f.get("h"), (int, float)) and f["h"] <= 0:
            err(f"{where}.frame", "h is not positive", "a zero-height element is invisible")
        x, y = f.get("x"), f.get("y")
        w, h = f.get("w"), f.get("h")
        if all(isinstance(v, (int, float)) for v in (x, y, w, h)):
            if x + w <= 0 or y + h <= 0 or x >= STAGE_W or y >= STAGE_H:
                err(where, f"sits entirely off the {STAGE_W}×{STAGE_H} stage "
                           f"(x={x}, y={y}, w={w}, h={h})",
                    "move it onto the stage")
            elif x < 0 or y < 0 or x + w > STAGE_W or y + h > STAGE_H:
                warn(where, "extends past the stage edge", "keep a ≥120px margin")

    c = el.get("content")
    if t == "text":
        if isinstance(c, str):
            err(where, "content is a bare string",
                'text lives in content.runs: {"role":"body","runs":[{"text":"…"}]}')
        elif not isinstance(c, dict):
            err(where, "has no content object",
                'add content: {"role":"body","runs":[{"text":"…"}]}')
        else:
            runs = c.get("runs")
            if not isinstance(runs, list) or not runs:
                err(where, "content.runs is missing or empty",
                    'runs is a non-empty array of {"text":"…"} objects')
            else:
                for i, r in enumerate(runs):
                    if isinstance(r, str):
                        err(f"{where}.content.runs[{i}]", "is a bare string",
                            'each run is an object: {"text":"…"}')
                    elif not isinstance(r, dict) or not isinstance(r.get("text"), str):
                        err(f"{where}.content.runs[{i}]", "has no text string",
                            'each run is {"text":"…"}')
            role = c.get("role")
            if role is not None and role not in ROLES:
                warn(where, f"role {role!r} is not known",
                     f"use one of: {', '.join(sorted(ROLES))}")
        size = (el.get("style") or {}).get("fontSize")
        if isinstance(size, (int, float)) and size < MIN_FONT:
            warn(where, f"fontSize {size} is below {MIN_FONT}",
                 "nothing under 22px is readable projected")
    elif t == "image":
        if not isinstance(c, dict) or not c.get("src"):
            err(where, "image has no content.src",
                'add content: {"src":"path/in/workspace.png","alt":"…","fit":"cover"}')
    elif t == "shape":
        if not (el.get("style") or {}).get("fill"):
            warn(where, "shape has no style.fill",
                 "it will fall back to the theme brand colour")


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "deck.json"
    try:
        with open(path) as fh:
            deck = json.load(fh)
    except FileNotFoundError:
        print(f"{path} does not exist — write the deck first.")
        return 1
    except json.JSONDecodeError as e:
        # Worth its own message: a truncated write is the other way a deck dies.
        print(f"{path} is not valid JSON: {e}\n"
              f"    → line {e.lineno}, column {e.colno}. Rewrite the file whole.")
        return 1

    if not isinstance(deck, dict):
        print("deck.json must be a JSON object.")
        return 1

    slides = deck.get("slides")
    if not isinstance(slides, list) or not slides:
        err("deck", "has no slides[]", 'add "slides": [ … ] with at least one slide')
        slides = []

    theme = deck.get("theme")
    if not isinstance(theme, dict) or not theme.get("palette"):
        warn("deck", "has no theme.palette",
             "slides fall back to defaults and lose the template's look")

    seen: set[str] = set()
    for i, s in enumerate(slides):
        where = f"slides[{i}]"
        if not isinstance(s, dict):
            err(where, "is not an object", "every slide is a JSON object")
            continue
        sid = s.get("id")
        if not sid:
            err(where, 'has no "id"', 'give it a stable id (e.g. "s3")')
        elif sid in seen:
            err(where, f"reuses id {sid!r}", "slide ids must be unique")
        else:
            seen.add(str(sid))

        els = s.get("elements")
        if not isinstance(els, list):
            err(where, "has no elements[]", 'add "elements": [ … ]')
            continue
        if not els:
            warn(where, "has no elements", "an empty slide renders as a blank rectangle")
        for j, el in enumerate(els):
            check_element(el, f"{where}.elements[{j}]")
        if len(els) > 8:
            warn(where, f"has {len(els)} elements", "over ~8 reads as clutter; split the slide")

    if errors:
        print(f"{len(errors)} problem(s) that will render wrong:\n")
        for e in errors:
            print("  ✗ " + e)
    if warnings:
        print(f"\n{len(warnings)} warning(s):\n")
        for w in warnings:
            print("  ! " + w)
    if not errors:
        n = len(slides)
        print(f"deck.json is valid — {n} slide{'s' if n != 1 else ''} will render."
              + (" Review the warnings above." if warnings else ""))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
