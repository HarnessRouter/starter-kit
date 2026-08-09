# LumaCare

The secondary HarnessRouter reference demo in this repository, originally built for the HarnessRouter workshop at Harvard.

LumaCare is a family-care companion for parents and caregivers of children receiving cancer care. It demonstrates how the same secure streaming, persistence, ownership, and artifact patterns used by the primary coding demo can support a specialized domain experience.

## Run it

From the repository root:

1. Run `npm install` if dependencies are not installed.
2. Copy `.env.example` to the repository root as `.env` and set `HR_API_KEY`.
3. Start the demo:

   ```bash
   npm run dev:lumacare
   ```

Open [http://localhost:3000](http://localhost:3000).

The checked-in `config/agents.json` maps the `care_companion` feature to its purpose-configured HarnessRouter agent.

## What is included

- Calm, responsive family-facing care guidance
- A stable guide viewport across waiting, live streaming, and completed states
- Structured plain-language guides and care-team questions
- Data-only streaming with isolated per-run buffers and immediate recovery-ID persistence
- Explicit per-run cancellation that remains safe during fast stop/retry and caregiver switching
- Session recall and continue/revise flows
- Ownership checks for session details, cancellation, previews, and downloads
- Sandboxed HTML previews and authenticated artifact/archive proxying
- Demo identity switching for cross-user isolation testing

## Safety note

LumaCare provides supportive guidance only and never replaces a child's oncology team. Do not enter identifying patient information in the demo.

## Direct workspace commands

```bash
npm run test --workspace=@harnessrouter/lumacare
npm run build --workspace=@harnessrouter/lumacare
npm run preview:lumacare
```

The LumaCare tests include stream parsing, cross-user ownership, family-facing guide formatting, checklist-state preservation, and responsive guide-layout contracts.
