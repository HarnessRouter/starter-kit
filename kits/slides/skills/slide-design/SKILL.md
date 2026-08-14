---
name: slide-design
description: How to plan and design presentation decks — content architecture first, then a deliberate style system, then slide-by-slide craft. Use for EVERY deck request, before touching any slide tool.
---

# Slide design

You are designing a presentation, not filling a form.

## The file you are writing

There are no slide tools here. A deck is ONE file — `deck.json` in your working
directory — and you write it with the ordinary file editor. Nothing else reads
the deck, so a file that does not match this shape renders as an empty
rectangle: correct colours, no content. Match it exactly.

```json
{
  "meta":  { "title": "Deck title" },
  "stage": { "width": 1920, "height": 1080 },
  "theme": { "palette": { "bg": "#efe7d4", "surface": "#e6dcc4", "ink": "#1a1a17",
                          "mute": "#3a5a36", "brand": "#2e4a2a", "accent": "#e89cb1" },
             "fonts":   { "head": "Source Serif 4, Georgia, serif",
                          "body": "Source Serif 4, Georgia, serif" } },
  "slides": [
    {
      "id": "s1",
      "layout": "title",
      "background": { "color": "#2e4a2a" },
      "notes": "What to say, not what is written.",
      "elements": [
        { "id": "s1-title", "type": "text",
          "frame": { "x": 160, "y": 400, "w": 1600, "h": 200, "rotation": 0 },
          "style": { "fontSize": 120, "color": "#efe7d4" },
          "content": { "role": "title", "runs": [ { "text": "The Step 3 Cliff" } ] } },
        { "id": "s1-rule", "type": "shape",
          "frame": { "x": 160, "y": 640, "w": 160, "h": 8, "rotation": 0 },
          "style": { "fill": "#e89cb1" } }
      ]
    }
  ]
}
```

Non-negotiable, because each of these silently renders nothing:

- Position lives in **`frame`** — `{x, y, w, h, rotation}` in stage pixels.
  Never `x`/`y`/`w`/`h` at the top level of an element.
- Text lives in **`content.runs`**, an ARRAY of `{ "text": "..." }` objects.
  Never a bare string. `role` is one of `title`, `subtitle`, `body`,
  `bullets`, `caption`; for `bullets`, each run is one bullet.
- Every slide and every element needs a stable **`id`**. Reuse ids when you
  edit so the canvas keeps selection; never renumber a whole deck.
- Paint order IS z-order: later elements in `elements[]` sit on top. There is
  no `z` property.
- `type` is one of `text`, `shape`, `image`, `table`, `chart`, `flowchart`,
  `code`, `embed`. Shapes carry their colour in `style.fill`; images use
  `content.src` + `content.alt` + `content.fit`.

Read `deck.json` before every change and write it back WHOLE. It is the single
source of truth and the person may have edited it on the canvas between turns.

## 0. Reference documents (when present)

If the user attached documents, they are in your working directory (ls to find
them). Read them BEFORE planning — they are the starting point, not garnish:
- **PDF**: read it directly; extract the narrative, key numbers, and section
  structure.
- **PPTX**: it is a zip. `unzip -o file.pptx -d _ref` then read
  `_ref/ppt/slides/slide*.xml` for the text of every slide (in order), and
  `_ref/ppt/theme/theme1.xml` for the brand palette (srgbClr values) + fonts.
- From the reference, extract TWO plans: (a) **content** — reuse its actual
  facts, numbers, product names, and slide order as the base outline, updated
  per the user's ask; (b) **style** — derive the deck theme from its brand
  colors/fonts (write it into `theme`), so the new deck reads
  as the same brand, then apply this skill's craft rules on top.
- Reuse the reference's IMAGES: a PPTX's pictures live in `_ref/ppt/media/`.
  Pick the meaningful ones (logo, product shots — not decorations), crop or
  clean them in your workspace if needed (Pillow is available; or generate one with the imagegen skill), then reference them from an image element's `content.src`
  by workspace-relative path — a brand logo on the cover instantly grounds the deck.
- Tell the user in one line what you extracted (e.g. "Working from your intro
  deck: 12 slides, brand navy #0B2A4A + orange accent").

## 0.5 Template starter decks (when present)

If the deck already contains DESIGNED starter slides (a rich template — you
can tell: multiple styled slides with placeholder editorial copy), that IS the
style plan. Do NOT delete them or restyle: ADAPT in place — rewrite
each text with the user's real content, keep every frame, accent shape, and
type choice; delete only slides whose content type isn't needed; clone an
existing slide's element pattern (matching x/w columns and fonts) when adding
more. The design system is the template's value — preserve it.

Then work in this order, every time: **plan the content → plan the style →
build → review**. Never start adding slides before both plans exist.

## 1. Plan the content (the narrative)

- Extract the deck's ONE job from the request (persuade an investor, teach a
  concept, report a week). Everything serves that job.
- Write the arc as a slide outline first — section titles + the single idea per
  slide. Well-known arcs to reach for:
  - Pitch: title → problem → solution → product → market (chart) → traction
    (chart) → business model → team → ask.
  - Report: title → headline summary → 2-4 evidence sections (each: claim +
    chart/table) → risks → next steps.
  - Teaching: title → objectives → concept build-up (diagram-led) → worked
    example → recap.
- One idea per slide. If a slide needs two ideas, it is two slides.
- Plan where the DATA lives: which slides get a chart (numbers over time /
  comparisons), a flowchart (process, architecture), a table (feature/pricing
  grids), a big-number stat, a quote. A deck of only bullet lists is a failed
  plan.
- Sections deserve divider slides (`section` layout) in decks over ~8 slides.

## 2. Plan the style (the system)

Decide ONCE, before building — then every slide obeys it:

- **Theme**: pick or derive a palette that fits the mood (if the deck already
  has a theme, keep it — it came from the template the user picked). Dark = dramatic/keynote,
  light = clean/business, warm = editorial/human. Set it FIRST so every slide
  inherits it. Slide backgrounds default to the theme — only override
  background for deliberate accents (a brand-colored section divider, a
  gradient title slide).
- **Type scale** (px on the 1920×1080 stage): display 96-120 for the title
  slide's hero, 64-72 slide titles, 30-34 body, 22-24 captions. Set via
  style.fontSize when the role default isn't enough. Never go below 22.
- **Grid**: margins ≥ 120px from every edge; content column starts at x=160.
  Align to a consistent left edge; centered only on title/section/quote
  slides. Whitespace is a feature — a slide more than ~60% full is overfull.
- **Accents**: pick ONE accent move and repeat it (a brand-colored rule under
  slide titles, a numbered-section chip, a left color bar) — repetition reads
  as design; variety reads as noise.

## 3. Build with craft

- Write the whole deck in one pass: every slide with its full `elements[]`.
- **Title slides**: hero text ~y 400-500, subtitle under it, generous space.
  A gradient background ({gradient: "linear-gradient(135deg, <bg>, <surface>)"} 
  or brand-tinted) instantly lifts it.
- **Bullets**: max 5 per slide, ≤ 12 words each, one run per bullet. Prefer
  turning 3+ parallel bullets into a 2-3 column layout of short text blocks
  (separate text elements side by side) — it reads as designed, not typed.
- **Big numbers**: a stat deserves 120-160px bold text with a small caption
  under it, not a bullet. Three stats across = x at 160 / 720 / 1280, w 480.
- **Charts (ECharts option JSON)**: style them to the theme — axis label color
  = mute, splitLine color rgba(ink, .08), bar color = brand, the ONE bar/point
  you want remembered = accent. barWidth 45-55%, borderRadius [8,8,0,0].
  Always show value labels when ≤ 8 data points. Kill legends for single
  series. Charts get room: w ≥ 1200, h ≥ 560.
- **Flowcharts (Mermaid)**: `flowchart LR` for pipelines, `TD` for
  hierarchies; ≤ 8 nodes per slide; short node labels (1-3 words).
- **Shapes**: rects/lines as accents — an 8px-tall brand rect under a title
  (w ≈ 160), a full-height surface-colored rect as a sidebar panel, thin
  divider lines. Rotation sparingly.
- **Images**: use only when they carry meaning (product shot, hero mood);
  fit: "cover" inside a rounded frame (style.radius 16-24). Never stretch.
- **Tables**: ≤ 5 columns; header row relies on the built-in brand rule.
- Speaker notes: one tight paragraph per slide in the slide's `notes` — what
  to SAY, not what's written.

## 4. Review pass (mandatory)

FIRST, check it renders at all. From your working directory:

```
python3 ~/.harness/skills/slide_design/validate_deck.py deck.json
```

It prints the exact path of anything the renderer will drop, and what to write
instead. **Fix and re-run until it exits clean** — a deck that fails this
renders as blank coloured rectangles for the user, and you cannot see that from
here. Never end a turn on a failing deck.

Then reread the file you just wrote, as a designer:
- Consistent title positions/sizes across sibling slides? Same margins?
- Any slide with > 5 elements or > 60% coverage → split or cut.
- Any orphan default styling (wrong ink on custom background)?
- Does the arc land the deck's one job?
Fix what fails, then summarize the deck for the user in their terms.
