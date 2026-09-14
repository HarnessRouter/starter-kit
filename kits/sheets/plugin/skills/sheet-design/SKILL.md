---
name: sheet-design
description: How to build a working sheet — the exact sheet.json contract, and how to design columns as a left-to-right pipeline where an agent column runs another agent once per row. Use for EVERY sheet request, before writing anything.
---

# Sheet design

You are designing a pipeline that happens to look like a spreadsheet.

## The file you are writing

There are no sheet tools here. A sheet is ONE file — `sheet.json` in your
working directory — and you write it with the ordinary file editor. Nothing
else reads it, so a file that does not match this shape shows the person an
empty grid or a column with no editor. Match it exactly.

```json
{
  "meta": { "schema": 1, "title": "Competitor scan" },
  "columns": [
    { "id": "col_company", "name": "Company", "type": "text", "width": 200 },
    { "id": "col_site",    "name": "Site",    "type": "url",  "width": 240 },
    { "id": "col_brief",   "name": "Brief",   "type": "harness", "width": 380,
      "harness": {
        "harness_id": "codex",
        "prompt": "Read {{Site}} and write three sentences on {{Company}}: what they sell, who to, and how they price. Put your full notes in notes.md.",
        "attach": []
      } },
    { "id": "col_fit", "name": "Overlap", "type": "harness", "width": 300,
      "harness": {
        "harness_id": "codex",
        "prompt": "Score 1-5 how directly this company competes with us, then one line of why.\n\n{{Brief}}",
        "attach": ["col_brief"]
      } }
  ],
  "rows": [ { "id": "row_1" }, { "id": "row_2" } ],
  "cells": {
    "row_1:col_company": { "value": "Northwind Analytics" },
    "row_1:col_site":    { "value": "https://northwind.example" }
  }
}
```

Non-negotiable, because each of these breaks silently:

- **`cells` is keyed `"<rowId>:<colId>"`**, using ids that exist in `rows` and
  `columns`. A key containing a column *name* renders nothing at all.
- **A cell is an object** — `{"value": …}` — never a bare value at the key.
- **Column names are unique.** Agent columns address columns as `{{Name}}`, and
  a duplicate makes that ambiguous.
- **`{{Name}}` may only name a column EARLIER in `columns`.** The array order
  is the execution order. A forward reference makes the run refuse to start.
- **`type` is one of** `text` `number` `select` `tags` `checkbox` `date` `url`
  `harness`. Anything else loses its editor.
- **Only a `harness` column carries a `harness` object**, and only it can be run.
- **`harness_id` names a BASE agent**, so the sheet is runnable the moment it
  exists. The base ids are stable and you may write them: `codex`,
  `claude-code`, `hermes`, `pi`, `dsh`, `opencode`, `qwen`. Pick the one that
  suits the work. If it is not installed on this deployment the app substitutes
  one that is, so a reasonable guess always beats a blank. Never invent a
  `chrn_` id: those are the person's own agents, you cannot see them, and an
  invented one silently runs the wrong agent.
- **Never write `status`, `run_id`, `response_id`, `session_id` or `artifacts`
  into a cell, and never invent a `run` block.** Those are results the app
  produced. Writing them makes the sheet claim a run that never happened; you
  cannot recompute them, and deleting them throws away the link to real work.
- **Ids are stable.** Reuse them when you edit; never renumber a sheet.
- **`meta.schema` is `1`.**

Read `sheet.json` before every change and write it back WHOLE. The person may
have edited the grid between your turns, and a partial write loses their work.

## What you do and do not run

An agent column runs an agent once per row. You create and configure such
columns. **You never execute one.** The app runs them, from the browser, in
dependency order — and it will not let a sheet run itself, so there is no id
you could put there that would point back here.

Leave the sheet ready to go. A person who asked for a sheet with agent columns
wants to press Run, not to open every column menu first.

## Designing the columns

The columns are a pipeline, left to right: **identify → gather → judge.**

- **One agent column does one thing.** A column that researches AND scores
  fails as one unit and re-runs as one unit, at full cost. Two columns fail and
  re-run independently, and the person can see which step went wrong.
- **Ask for one thing, and say how long.** A cell is a table cell. "Three
  sentences", "a score 1-5 and one line of why" — not "analyse this company".
- **Long output goes in a file.** Tell the agent to write the detail to a file
  and summarise it in a sentence or two. The app shows the file beside the text,
  and the next column can attach it with `attach`.
- **A manual column the person fills beats an agent column that guesses.** If
  the value is known, make it a `text` column and let them paste it in.
- **Short, distinct, human column names.** Those names are the vocabulary every
  agent column interpolates against.
- **Start with a few rows.** The person adds theirs by pasting; twenty rows of
  invented example data is twenty rows they have to delete.

## Review pass (mandatory)

From your working directory:

```
python3 "$(ls .claude/skills/sheet_design/validate_sheet.py \
              .harness/skills/sheet_design/validate_sheet.py 2>/dev/null | head -1)" sheet.json
```

Both paths are real — which one exists depends on which backend you are running
on. The directory is `sheet_design` with an underscore.

It prints the exact path of anything that will break, and what to write instead.
**Fix and re-run until it exits clean.** A sheet that fails this shows the
person an empty grid, and you cannot see that from here.

Then reread what you wrote, as the person who has to run it:
- Is every `{{Name}}` a column to its left?
- Does each agent column ask for one thing, in a cell-sized answer?
- Would you know, from the column names alone, what this sheet is for?

Finally, tell the person in one line what to do next — usually: pick the agent
for each agent column in its ⋯ menu, paste their rows, and press Run.
