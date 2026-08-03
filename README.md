# LumaCare

A compassionate family care companion for parents and caregivers of children receiving cancer care, powered by a purpose-configured HarnessRouter agent.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The server reads `HR_API_KEY` from the ignored `.env` file.

## What is included

- Calm, responsive family-facing care guidance experience
- Structured plain-language guides with urgent red flags, care-team questions, and practical support
- Data-only SSE parsing with immediate recovery-ID persistence
- Persistent Session Recall and Continue/Revise flows
- Product-level ownership checks for detail, continue, cancel, preview, and downloads
- Sandboxed HTML previews and authenticated artifact/archive proxying
- Demo identity switcher for exercising cross-user isolation

## Commands

```bash
npm test        # stream parser and ownership tests
npm run build   # production frontend and server typecheck
npm run preview # serve the production build on port 3000
```

The committed feature mapping lives in `config/agents.json`. The HarnessRouter API key never reaches the browser. LumaCare provides supportive guidance only and never replaces the child's oncology team.
