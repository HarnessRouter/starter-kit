---
name: calibrate
description: Calibrate another harness's configuration against its declared objective, one change per version, validated by that harness's own model. Use when asked to improve a harness, raise its pass rate, or find out why it fails.
---

# Calibrate a harness

You are the outer loop. The inner harness is any harness on this platform: a System One reflex over
an environment, or a System Two agent over a task suite. You change its **configuration** (what its
model is told, shown, allowed, and how often it acts) and nothing else: never the model, never the
environment's truth, never anything that chooses in the model's place.

Everything you need is in the inner harness's package: `config.yaml` (the configuration, versioned;
`objective` says what counts as success, failure, ordered metrics, locus and evidence) and
`ledger.jsonl` (every version so far, with its evidence and verdict). Read both first. The
harness's id, the platform URL and your credential are in `HR_INNER_HARNESS`, `HR_API_URL` and
`HR_CALIBRATION_TOKEN`. The scripts under `scripts/` do the platform work; read `--help`.

## The method

1. **Baseline.** `scripts/bench.py --runs 3` starts three runs, one at a time (never two on one
   machine: shared machines drop frames and fake regressions), fetches each run's `trace.json` and
   its evidence archive, and prints the objective's scoreboard and the failures grouped by locus.
   Write the scoreboard down.
2. **Read.** Take the largest failure group. Render its evidence (the package may ship a renderer
   under `tools/`, for example `tools/evidence.py <trace> <observations> <out>`; read the images it
   writes). Read the trace around the failing steps: the state the model saw, the questions, its
   probabilities. Say in one sentence what killed the run there.
3. **Measure.** No change without a measurement. Probe the environment at that locus with
   `scripts/probe.py "action,action,..."` (a scripted run) until the mechanism is a number or a
   reproducible case: a distance, a window, a timing, a wrong sentence in the state.
4. **Change one thing.** Edit `config.yaml`: one fact or rule in `instructions`, one tunable, one
   gate threshold, or one encoder setting. One change. Bump `version`. Append a ledger line with
   the evidence (session ids, file paths, the measurement) and `verdict: pending`. If the state
   itself is wrong (the environment lied), do not patch around it: write the failing case down and
   stop with a proposed code fix for a person to merge.
5. **Publish and validate.** `scripts/publish.py` uploads the package as the harness's plugin and
   relaunches it. Run the bench again (same run count). The verdict comes from those runs and the
   ordered metrics only: `kept` if they improved in order, `reverted` if not. On `reverted`, put
   the previous version back and publish again. Record the verdict in the ledger line.
6. **Stop** at the target, at the budget, or after three reverted versions in a row. Report the
   scoreboard before and after, the ledger lines you added, and which limit stopped you: the
   world's truth, the pace, or the model.

## What never changes

- One change per version. Batching four changes cost a night of untangling.
- The verdict comes from the inner harness's own model runs. A stand-in that follows the rendered
  advice deterministically went to zero failures while the model went from three passes in three
  to none in six.
- Read failures from the evidence, not from the summary text.
- Reversible and attributed: every version is in the ledger with what it changed and why.
