"""deck_model — the Slides canonical data model + validator + vocabulary.

A deck is JSON truth (like the CG graph schema / Flowness workflow DSL), NOT
raw HTML and NOT a flat image — see docs/slides-architecture.md. The renderer
(frontend-slide-editor) compiles this JSON to HTML on a fixed 1920×1080 stage;
this module is the schema, the vocabulary the copilot builds with (served via
the MCP `list_*` tools), and the validator that keeps a saved deck sane.

Shape (shallow, id-addressable — every slide + element has a stable id, the
unit of partial edit / annotation / collab):

  Deck   { meta{title,aspectRatio}, stage{width,height}, theme{...}, slides[] }
  Slide  { id, layout, background, notes, elements[] }
  Element{ id, type, frame{x,y,w,h,rotation}, style{}, content{}, meta?{} }
"""
from __future__ import annotations

import uuid

STAGE = {"width": 1920, "height": 1080}   # fixed canvas; the renderer scales to fit


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# ── Element vocabulary (served by list_element_types) ─────────────────────────
# Each element is a discriminated union on `type`; `content` is type-specific.
# Coordinates in `frame` are absolute px on the 1920×1080 stage.
ELEMENT_TYPES: list[dict] = [
    {"type": "text", "label": "Text",
     "description": "A rich-text box. content.role is title | subtitle | body | "
                    "bullets | caption (drives default sizing from the theme); "
                    "content.runs is an ordered list of {text, marks[]} where a "
                    "mark is bold | italic | underline | code | {link:url}. Use "
                    "bullets role with one run per line for bullet lists.",
     "content": {"role": "title|subtitle|body|bullets|caption",
                 "runs": "[{text, marks?}]"}},
    {"type": "image", "label": "Image",
     "description": "A picture. content.src is a blob ref (from generate_image) "
                    "or a URL; content.fit is cover | contain; content.alt is "
                    "alt text; content.prompt (optional) records the generation "
                    "prompt. Use for backgrounds, hero art, icons — never as a "
                    "whole slide (that kills partial edits).",
     "content": {"src": "blobRef|url", "fit": "cover|contain", "alt": "string",
                 "prompt": "optional generation prompt"}},
    {"type": "chart", "label": "Chart",
     "description": "A data chart. content.spec is an Apache ECharts `option` "
                    "JSON object (bar/line/pie/scatter/…); it renders to crisp "
                    "SVG. Author the option directly — do not embed a chart as "
                    "an image.",
     "content": {"spec": "ECharts option JSON"}},
    {"type": "flowchart", "label": "Flowchart",
     "description": "A diagram/flowchart. content.mermaid is Mermaid source "
                    "(flowchart / sequence / gantt …), rendered to SVG. Mermaid "
                    "is the right tool for process/flow diagrams — not charts.",
     "content": {"mermaid": "mermaid source"}},
    {"type": "shape", "label": "Shape",
     "description": "A vector shape. content.kind is rect | ellipse | line | "
                    "arrow; style carries fill/stroke. Use for dividers, "
                    "callouts, connectors.",
     "content": {"kind": "rect|ellipse|line|arrow"}},
    {"type": "table", "label": "Table",
     "description": "A table. content.columns is a list of header strings; "
                    "content.rows is a list of row arrays (cell strings).",
     "content": {"columns": "[string]", "rows": "[[string]]"}},
    {"type": "code", "label": "Code",
     "description": "A syntax-highlighted code block. content.lang + "
                    "content.source.",
     "content": {"lang": "string", "source": "string"}},
    {"type": "embed", "label": "Embed",
     "description": "Raw HTML escape hatch (sandboxed). content.html. Last "
                    "resort — prefer a typed element so edits stay addressable.",
     "content": {"html": "string"}},
]
ELEMENT_TYPE_NAMES = {e["type"] for e in ELEMENT_TYPES}

# ── Layout vocabulary (served by list_layouts) — a starting arrangement ───────
LAYOUTS: list[dict] = [
    {"layout": "title", "label": "Title", "description": "A centered title + subtitle cover slide."},
    {"layout": "section", "label": "Section", "description": "A section divider — big heading on a color/brand background."},
    {"layout": "title-content", "label": "Title + content", "description": "A heading with a body/bullets area below."},
    {"layout": "two-column", "label": "Two column", "description": "A heading over two side-by-side content columns."},
    {"layout": "image-full", "label": "Full image", "description": "A full-bleed image with an optional text overlay."},
    {"layout": "chart-focus", "label": "Chart focus", "description": "A heading with a large chart as the hero."},
    {"layout": "quote", "label": "Quote", "description": "A large centered quotation + attribution."},
    {"layout": "blank", "label": "Blank", "description": "An empty canvas."},
]
LAYOUT_NAMES = {l["layout"] for l in LAYOUTS}

# ── Theme presets (served by list_themes) — ~10 tokens → CSS vars ─────────────
THEMES: dict[str, dict] = {
    "clean-light": {
        "name": "Clean Light",
        "palette": {"bg": "#FFFFFF", "surface": "#F7F8FB", "ink": "#111827",
                    "mute": "#6B7280", "brand": "#4F46E5", "accent": "#06B6D4"},
        "fonts": {"head": "Inter, system-ui, sans-serif", "body": "Inter, system-ui, sans-serif"},
        "radius": 16,
    },
    "midnight": {
        "name": "Midnight",
        "palette": {"bg": "#0B1020", "surface": "#151B2E", "ink": "#F3F4F6",
                    "mute": "#9AA4B2", "brand": "#818CF8", "accent": "#22D3EE"},
        "fonts": {"head": "Inter, system-ui, sans-serif", "body": "Inter, system-ui, sans-serif"},
        "radius": 16,
    },
    "warm-editorial": {
        "name": "Warm Editorial",
        "palette": {"bg": "#FBF7F0", "surface": "#F3EBDD", "ink": "#2A2118",
                    "mute": "#8A7A63", "brand": "#B4531F", "accent": "#2F6F5B"},
        "fonts": {"head": "Georgia, 'Times New Roman', serif", "body": "Inter, system-ui, sans-serif"},
        "radius": 10,
    },
}
DEFAULT_THEME = "clean-light"


def blank_deck(title: str = "Untitled deck", theme: dict | None = None) -> dict:
    """A fresh deck: one title slide with a heading. Templates hand in their
    own theme so a new deck opens already styled; otherwise the default.
    Mirrors Flowness's blank-workflow-seeds-a-note — the engine + renderer are
    happier with >= 1 slide, and the copilot builds from here."""
    theme = dict(theme) if theme else {**THEMES[DEFAULT_THEME]}
    return {
        "meta": {"title": title, "aspectRatio": "16:9"},
        "stage": dict(STAGE),
        "theme": theme,
        "slides": [{
            "id": new_id("slide"),
            "layout": "title",
            # no background: omitted = inherit the theme (var(--sl-bg)), so a
            # later set_theme restyles every slide that hasn't overridden it.
            "notes": "",
            "elements": [{
                "id": new_id("el"),
                "type": "text",
                "frame": {"x": 260, "y": 430, "w": 1400, "h": 160, "rotation": 0},
                "style": {"align": "center"},
                "content": {"role": "title", "runs": [{"text": title}]},
            }, {
                "id": new_id("el"),
                "type": "text",
                "frame": {"x": 260, "y": 610, "w": 1400, "h": 90, "rotation": 0},
                "style": {"align": "center"},
                "content": {"role": "subtitle",
                            "runs": [{"text": "Describe your deck to the copilot to begin."}]},
            }],
        }],
    }


class DeckError(ValueError):
    """A deck failed validation."""


def validate(deck: dict) -> dict:
    """Structural validation — raises DeckError with a fixable message. Kept
    permissive on content (the renderer tolerates partial elements) but strict
    on the skeleton: ids present + unique, known types, slides/elements are
    lists. Returns the deck for chaining."""
    if not isinstance(deck, dict):
        raise DeckError("deck must be an object")
    slides = deck.get("slides")
    if not isinstance(slides, list) or not slides:
        raise DeckError("deck.slides must be a non-empty list")
    seen_slide_ids: set[str] = set()
    for i, sl in enumerate(slides):
        if not isinstance(sl, dict):
            raise DeckError(f"slide {i} must be an object")
        sid = sl.get("id")
        if not sid or not isinstance(sid, str):
            raise DeckError(f"slide {i} needs a string id")
        if sid in seen_slide_ids:
            raise DeckError(f"duplicate slide id {sid!r}")
        seen_slide_ids.add(sid)
        layout = sl.get("layout", "blank")
        if layout not in LAYOUT_NAMES:
            raise DeckError(f"slide {sid}: unknown layout {layout!r} "
                            f"(one of {sorted(LAYOUT_NAMES)})")
        els = sl.get("elements", [])
        if not isinstance(els, list):
            raise DeckError(f"slide {sid}: elements must be a list")
        seen_el_ids: set[str] = set()
        for j, el in enumerate(els):
            if not isinstance(el, dict):
                raise DeckError(f"slide {sid} element {j} must be an object")
            eid = el.get("id")
            if not eid or not isinstance(eid, str):
                raise DeckError(f"slide {sid} element {j} needs a string id")
            if eid in seen_el_ids:
                raise DeckError(f"slide {sid}: duplicate element id {eid!r}")
            seen_el_ids.add(eid)
            etype = el.get("type")
            if etype not in ELEMENT_TYPE_NAMES:
                raise DeckError(f"slide {sid} element {eid}: unknown type "
                                f"{etype!r} (one of {sorted(ELEMENT_TYPE_NAMES)})")
    return deck
