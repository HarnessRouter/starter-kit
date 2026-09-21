# Calibrate

The outer loop of the dual loop (the design is `docs/dual-loop.md` in the System One Harness
repository): a reasoning harness that improves another harness's configuration against the
objective that harness's package declares, one change per version, validated by that harness's
own model, with the evidence in a ledger.

Install this package on a reasoning harness (a coding base) with platform access for one inner
harness: `HR_API_URL`, `HR_CALIBRATION_TOKEN` (a per-turn credential scoped to that harness) and
`HR_INNER_HARNESS` (its id). The Skill carries the method; the scripts do the platform work:

| Script | What it does |
|---|---|
| `bench.py --runs 3 --package <dir>` | K runs, one at a time; fetches each run's workspace; the objective's scoreboard and failure groups |
| `fetch.py --out package` | the inner harness's package (the one carrying the environment), never the harness's export |
| `probe.py "a,b,c"` | one run driven by a fixed action sequence, to measure the environment |
| `publish.py --package <dir>` | uploads the package as the inner harness's plugin; its instructions follow `config.yaml` |
| `report.py --package <dir> traces...` | the report over traces already on disk |

The inner harness's package must carry `config.yaml` (with an `objective`) and `ledger.jsonl`;
the harness must write `trace.json` into its session workspace, and its environment may archive
what it showed under `observations/`. The Super Mario kit is the first such package.
