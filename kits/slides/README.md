# Slides

A deck is a conversation. Ask for a presentation and the agent designs it — structure first, then
a style system, then slide by slide — and everything it makes is yours to edit.

Launch it from **Starter Kits** in the HarnessRouter console. That provisions the Harness this app
talks to; nothing else is deployed and nothing is configured.

## How it works

- **One session is one deck.** The deck list is this Harness's session list, and a deck's content
  is `deck.json` in that session's workspace. There is no database.
- **The app is served by the HarnessRouter image** at `/kits/slides`, same-origin with the
  console, which is why it needs no API key and no login of its own.
- **The deck is JSON on a fixed 1920×1080 stage.** Every slide and element carries a stable id and
  an absolute `frame{x,y,w,h,rotation}`, so the same renderer drives the canvas, the filmstrip
  thumbnails and the print view.

## What's in the folder

| Path | What |
|---|---|
| `kit.json` | The Harness this kit needs, and where its app is served |
| `skills/slide-design/` | How to design a deck — read before any slide is written |
| `templates/templates.json` | 46 starting points |
| `app/` | The UI |

Template credits are in [CREDITS.md](./CREDITS.md).
