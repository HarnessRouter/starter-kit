<div align="center">
  <a href="https://harnessrouter.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/images/logo-dark.png">
      <source media="(prefers-color-scheme: light)" srcset=".github/images/logo-light.png">
      <img alt="HarnessRouter" src=".github/images/logo-light.png" width="55%">
    </picture>
  </a>
</div>

<div align="center">
  <h3>Launch a working agent product. Then make it yours.</h3>
  <p><strong>Production kits and readable demos for HarnessRouter, the world's first unified interface for agent harnesses.</strong></p>
</div>

<p align="center">
  <a href="https://github.com/HarnessRouter/starter-kit" title="Star HarnessRouter Starter Kit on GitHub"><img src="https://img.shields.io/github/stars/HarnessRouter/starter-kit?style=flat&amp;logo=github&amp;logoColor=white&amp;label=Stars&amp;labelColor=444c56&amp;color=285aff" alt="GitHub stars"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Mixed-285AFF?style=flat&amp;labelColor=444c56" alt="Mixed license: MIT demos and separately licensed kits"></a>
  <a href="./kits"><img src="https://img.shields.io/badge/Starter_Kits-5-285AFF?style=flat&amp;labelColor=444c56" alt="Five starter kits"></a>
  <a href="https://discord.gg/nPcbwqVPb2"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat&amp;logo=discord&amp;logoColor=white&amp;labelColor=444c56" alt="Join the HarnessRouter Discord"></a>
</p>

<br>

**Start with finished work, then open the code.** Launch a complete agent-powered product from a Starter Kit, or study a compact demo that shows the integration patterns in code you can read in an afternoon.

[HarnessRouter](https://harnessrouter.ai) gives supported agent harnesses one shared interface. Your app sends a task through one Agent API. The harness gets a sandbox, tools, and a loop, then returns finished files and artifacts instead of only tokens.

<p align="center">
  <img src=".github/images/kits/kit-mario-gameplay.gif" width="100%" alt="A System One model uses the Super Mario Starter Kit to play a live browser game by choosing one typed action per step.">
  <br>
  <sub><strong>A System One model playing a live browser game through a Starter Kit.</strong> It reads structured game state, chooses one typed action per step, and never generates control text.</sub>
</p>

<p align="center"><sub>The demo uses <a href="https://supermarioplay.com/game/mario.html?v=1.0.1">Full Screen Mario</a>. Mario and its characters belong to Nintendo. No game files ship with this repository.</sub></p>

<a href="https://github.com/HarnessRouter/starter-kit" title="Star HarnessRouter Starter Kit on GitHub">
  <picture>
    <source media="(max-width: 600px)" srcset=".github/images/github-readme-star-cta-mobile.svg">
    <img src=".github/images/github-readme-star-cta-desktop.svg" width="100%" alt="Build from working agent products. Star this repo.">
  </picture>
</a>

> [!TIP]
> **Start here:** [Choose a kit](#the-kits) · [Run a demo](#demos) · [See the repository structure](#repository-structure) · [Review the licenses](#licensing)

## Choose your starting point

| | Starter Kits | Demos |
|---|---|---|
| **Use them to** | Launch a working product and make it your own. | Learn the API from a small local app. |
| **What is included** | The app, harness configuration, and Skills plugin. | Frontend, server, tests, agent mapping, and documentation. |
| **How they run** | Launch from the HarnessRouter console. | Run locally with Node.js and a HarnessRouter API key. |
| **License** | [HarnessRouter Starter Kit License](./kits/LICENSE.md) | [MIT](./LICENSE) |

## The kits

Five working products, each launched from **Starter Kits** in the HarnessRouter console. Launching
one provisions the Harness it needs and serves the app from the HarnessRouter image. There is no
separate service to deploy, no database to configure, and no API key to paste into the app.

Each kit's Skills ship as a plugin, a package in the
[Agent Plugins](https://agent-plugins.org) format at `kits/<kit>/plugin/`: `plugin.json` names and
versions it, `skills/` holds the Skills. Launching a kit installs that package on the Harness it
provisions, so the Harness shows the kit as a named plugin it can export, and the same package installs
into any other server that speaks the
[Unified Harness Protocol](https://unifiedharnessprotocol.org/spec/2026-09-12/plugins) or any client that
reads the format.

The four document kits share one idea: **a session is a document**. The list of decks, sheets,
dashboards, or films is the Harness's session list, and the document is a file in that session's
workspace. Delete the session and the work goes with it. Super Mario uses the same kit boundary
for a live environment instead of a document editor.

<br>

### Slides: design a deck by talking about it

Ask for a presentation and the agent works the way a designer does: structure first, then a style
system, then slide by slide. Everything it makes is an object on the canvas you can drag, retype,
and restyle. It hands you a deck, not a picture of one.

![The Slides kit: the request at the top of the conversation, the run beneath it, and the finished deck on the canvas](.github/images/kits/kit-slides.png)

**[Open the Slides kit →](./kits/slides)**

<br>

### Sheets: a column that is an agent

Rows are your data. An **agent column** runs one of your other agents once per row, builds its
input from the columns to its left, and fills each cell with what that agent said and made. Two
hundred rows is two hundred runs you did not have to orchestrate.

![The Sheets kit: real investor rows, with an agent column filling one cell per row](.github/images/kits/kit-sheets.png)

**[Open the Sheets kit →](./kits/sheets)**

<br>

### Dashboards: ask your database a question

Say what you want to understand. The agent reads your schema, decides which charts answer it,
writes the SQL for each and lays them out. Opening the dashboard re-runs every query, so the
numbers are today's. It connects with a **SELECT-only** account and every statement is checked
before it runs.

![The Dashboards kit: both turns of the conversation on the right, and the live panels they produced](.github/images/kits/kit-dashboard.png)

**[Open the Dashboards kit →](./kits/dashboard)**

<br>

### Videos: describe the film, watch the shots arrive

The agent plans the shots, writes a prompt for each, renders them, and lays them on a canvas while
they land. Cut them on a real timeline with trimming, splitting, layers, a music bed, and a
voice-over, then export one file. Shots can be seeded from a still or continue from the frame the
last one ended on, which is how two clips join without a jump.

![The Videos kit: a two-shot cinematic teaser on the timeline, its shots on the canvas, and the exported film playing](.github/images/kits/kit-video.png)

**[Open the Videos kit →](./kits/video)**

<br>

### Super Mario: watch a System One model decide

A System One model plays a live platform game several decisions a second while you watch its
browser. The environment reads the game's structured state, presents a finite action space, and
holds each chosen key state until the next decision. The model never sees a pixel and never writes
control text.

**[Open the Super Mario kit →](./kits/mario)**

<br>

All five are launched from one page in the console:

![The Starter Kits page in the HarnessRouter console](.github/images/kits/starter-kits-page.png)

## Licensing at a glance

The kits under `kits/` are **not** MIT. They carry the
[HarnessRouter Starter Kit License Agreement](./kits/LICENSE.md). Individual local use is free;
so is internal use for up to three people, or any size on HarnessRouter Cloud. Selling or hosting
one for an external customer needs the
[Commercial Use and Deployment Agreement](./kits/COMMERCIAL-DEPLOYMENT-AGREEMENT.md). The full
terms are [below](#licensing).

## Demos

Smaller, MIT-licensed, and meant to be read: these show streaming, sessions, follow-up turns,
cancellation, and file download in as little code as possible.

### 1. Cursor-style coding app

A coding-agent interface that demonstrates project-aware tasks, streamed output, persistent sessions, follow-up work, cancellation, and generated-file downloads. Watch the [55-second build video](https://harnessrouter.ai/example?ref=github-starter) to see it running.

[Open the Cursor-style demo guide](./demos/01-cursor-coding-app/README.md)

```bash
npm install
cp .env.example .env
# Add HR_API_KEY and HR_CURSOR_AGENT_ID to .env
npm run dev:cursor
```

Then open [http://localhost:3000](http://localhost:3000).

### 2. LumaCare

A family-care companion that uses the same secure streaming and session architecture in a healthcare-support experience.

[Open the LumaCare demo guide](./demos/02-lumacare/README.md)

```bash
# Add HR_API_KEY to .env; LumaCare's agent mapping is checked in
npm run dev:lumacare
```

Then open [http://localhost:3000](http://localhost:3000).

Run one demo at a time because both use port `3000` by default.

## Repository structure

```text
.
├── demos/
│   ├── 01-cursor-coding-app/  # Primary demo
│   └── 02-lumacare/           # Secondary reference demo
├── kits/                      # Separately licensed production kits (see kits/LICENSE.md)
│   ├── slides/                # Design a deck by conversation
│   ├── sheets/                # A spreadsheet where a column is an agent
│   ├── dashboard/             # Ask your database a question
│   ├── video/                 # Describe the film, watch the shots arrive
│   └── mario/                 # Watch a System One model play a browser game
├── .env.example               # Shared local configuration template
├── package.json               # npm workspace commands
└── README.md                  # Repository and demo index
```

Each demo owns its frontend, server, tests, agent mapping, and documentation. This keeps the two products independent while making their shared HarnessRouter architecture easy to compare.

## Prerequisites

- Node.js 22 or newer
- A HarnessRouter API key, from the [quickstart](https://app.harnessrouter.ai/quickstart?ref=github-starter). The kits need none; only the demos do.
- A HarnessRouter coding-agent ID for the primary demo

## Commands

```bash
npm run dev:cursor   # Run the primary coding demo
npm run dev:lumacare # Run the secondary LumaCare demo
npm test             # Test both workspaces
npm run build        # Build and type-check both workspaces
```

Credentials belong in an ignored `.env` file and never in source control. See each demo's README for its configuration and architecture.

## Resources

- **[HarnessRouter](https://github.com/HarnessRouter/harnessrouter):** the open-source engine these demos and kits run on.
- **[Documentation and Cloud](https://harnessrouter.ai):** hosted service, guides, and pricing.
- **[Unified Harness Protocol](https://unifiedharnessprotocol.org):** the open standard behind it.
- **[Discord](https://discord.gg/nPcbwqVPb2):** community for questions and integrations.

## Licensing

This is a mixed-license repository:

- Files without a more specific directory license, including the reference demos, are available under the [repository MIT License](./LICENSE).
- Everything under `kits/` is governed by the [HarnessRouter Starter Kit License Agreement](./kits/LICENSE.md), not MIT. This covers all current and future contents of `kits/`, including any kit added later.
- Individual local use is free, including learning, evaluation, personal projects, and the individual's own business operations.
- Organizations using HarnessRouter Cloud for Internal Use do not pay a separate Kit license fee or have a Direct User limit; Cloud plan and usage charges still apply.
- Non-Cloud Internal Use is free for up to three Direct Users. A paid entitlement is required before a fourth Direct User begins use or for separately metered automation.
- **Creating paid Client Deliverables or selling, deploying, hosting, or providing an End Product to an external customer requires the [Commercial Use and Deployment Agreement](./kits/COMMERCIAL-DEPLOYMENT-AGREEMENT.md) and an applicable Order Form.**
- Sharing materials about your own business with investors, customers, advisers, and other counterparties is not Commercial Use merely because an external person receives them.
- Generated presentations and exported files remain usable subject to the applicable Internal or Commercial Use rights.
- Third-party components remain governed by their own licenses and notices.

The license included with a particular copy controls that copy. The current license structure does not revoke rights validly granted for an earlier copy under the license distributed with that earlier copy.

## Learn more

- [HarnessRouter website](https://harnessrouter.ai?ref=github-starter)
- [Documentation](https://harnessrouter.ai/docs?ref=github-starter)
- [Pricing](https://harnessrouter.ai/pricing?ref=github-starter)
