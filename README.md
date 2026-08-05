# HarnessRouter Demo at Harvard

Open-source demo repository for the HarnessRouter workshop at Harvard.

This repository contains two separate applications. The **Cursor-style coding app is the primary workshop demo**; **LumaCare is a second reference demo** showing how the same HarnessRouter patterns transfer to a different domain.

## Demos

### 1. Cursor-style coding app — primary demo

**Workshop:** Build a Cursor in 3 Steps

A coding-agent interface that demonstrates project-aware tasks, streamed output, persistent sessions, follow-up work, cancellation, and generated-file downloads.

[Open the Cursor-style demo guide](./demos/01-cursor-coding-app/README.md)

```bash
npm install
cp .env.example .env
# Add HR_API_KEY and HR_CURSOR_AGENT_ID to .env
npm run dev:cursor
```

Then open [http://localhost:3000](http://localhost:3000).

### 2. LumaCare — secondary reference demo

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
│   ├── 01-cursor-coding-app/  # Primary Harvard workshop demo
│   └── 02-lumacare/           # Secondary reference demo
├── .env.example               # Shared local configuration template
├── package.json               # npm workspace commands
└── README.md                  # Repository and demo index
```

Each demo owns its frontend, server, tests, agent mapping, and documentation. This keeps the two products independent while making their shared HarnessRouter architecture easy to compare.

## Prerequisites

- Node.js 22 or newer
- A HarnessRouter API key
- A HarnessRouter coding-agent ID for the primary demo

## Commands

```bash
npm run dev:cursor   # Run the primary coding demo
npm run dev:lumacare # Run the secondary LumaCare demo
npm test             # Test both workspaces
npm run build        # Build and type-check both workspaces
```

Credentials belong in an ignored `.env` file and never in source control. See each demo's README for its configuration and architecture.
