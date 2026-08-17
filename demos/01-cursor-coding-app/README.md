# Cursor-style Coding App

The primary application for the **Build a Cursor in 3 Steps** HarnessRouter workshop at Harvard.

This demo shows how to turn a purpose-configured HarnessRouter coding agent into a product experience with streamed output, recoverable sessions, follow-up tasks, cancellation, and artifact downloads.

## Run it

From the repository root:

1. Install dependencies.

   ```bash
   npm install
   ```

2. Copy `.env.example` to the repository root as `.env`, then set both values.

   ```dotenv
   HR_API_KEY=your_key_here
   HR_CURSOR_AGENT_ID=your_coding_agent_id
   PORT=3000
   ```

   No key yet? Create one from the [quickstart](https://app.harnessrouter.ai/quickstart?ref=github-starter). Starting the demo consumes no credits; credits are only used when tasks run.

3. Start the primary demo.

   ```bash
   npm run dev:cursor
   ```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

| Layer | Responsibility |
| --- | --- |
| `config/agents.json` | Declares the `coding_assistant` feature; `HR_CURSOR_AGENT_ID` supplies its HarnessRouter agent ID |
| `server/index.ts` | Keeps credentials server-side and proxies runs, sessions, cancellation, previews, and downloads |
| `src/api.ts` | Parses data-only server-sent events |
| `src/App.tsx` | Provides the Cursor-style coding-agent interface and session history |
| `tests/` | Covers stream parsing and cross-user session ownership |

The demo intentionally does not include a production repository sandbox. Configure the HarnessRouter coding agent with the tools and repository access appropriate to your environment.

## Direct workspace commands

```bash
npm run test --workspace=@harnessrouter/cursor-coding-app
npm run build --workspace=@harnessrouter/cursor-coding-app
npm run preview:cursor
```
