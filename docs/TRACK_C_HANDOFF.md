# Track C handoff: SUMO scenarios, reproducibility and cross model reconciliation

Status: AI assisted engineering, exploratory evidence, not independently reviewed. Branch `feature/track-c-sumo-reconciliation`, stacked on `feature/wp2.9-audit-completeness` (PR 2). No confirmatory evaluation was run or authorised. Nothing is merged. Owner decisions D1 to D8 remain OPEN.

## What was built

* `simulation/sumo/scripts/dm_run.py`: every run writes `run_manifest.json` (configuration identity, versions, input and output SHA-256, run status). A run with missing or inconsistent outputs is written INVALID and the command exits 3. Hard gates (`checks_pass`, `failed_gates`) are separate from run validity. New options `--horizon`, `--variant`, `--calib`. Termination reason and unfinished counts (in network, not inserted) are recorded.
* Scenarios `primary_half_capacity` (variant `cap0p5`, driver time headway 3.0 s) and `primary_double_capacity` (variant `cap2`, doubled branch lanes, `network/dm_cap2.*`). Achieved capacity is measured by `scripts/calibrate.py` and stored in `network/calibration_cap0p5.json` and `calibration_cap2.json`.
* `scripts/sumo_audit.py`: standard library auditor that imports neither the runner nor traci. Checks one run or a baseline and treatment pair.
* `scripts/run_track_c.py`: the smoke matrix (5 scenarios, 3 policies, seeds 1 to 3, horizons 3600 s and 7200 s, plus the negative control).
* `tools/track_c_report.py` generates the tables of `docs/TRACK_C_CROSS_MODEL_REPORT.md`; a test guards agreement.
* Historical files (`network/dm.*`, `calibration.json`, `results/historical/sumo_phase1`, the point queue baseline and golden fixtures) are unchanged; a test compares them with recorded hashes from commit `a960b7f`.

## Comparator semantics (D2) as implemented

Point queue `independent_periodic`: the first vehicle of a batch probes and the whole batch copies it. SUMO `independent_periodic`: each vehicle decides against a shared snapshot with no peer reservation and no batch copy. These are different policies. The batch copy form is a recommendation for the SUMO baseline, not an approved decision, and D2 is not resolved. No SUMO batch copy variant was built.

## Horizon (D1) options

Unfinished trips are censored at the horizon (`horizon - scheduled departure`, `complete` false), counted as incomplete, and split into in network and not inserted at the end. In this matrix no run was unfinished and 3600 s and 7200 s gave identical totals (report table 5).
1. Align SUMO to 7200 s if the owner confirms 7200 s. Cost: none observed here; longer worst case runs.
2. Keep 3600 s and document the difference. Risk: a scenario that leaves trips unfinished would be censored earlier than in the point queue.
3. Choose another value for both models.
Recommendation (not a decision): option 1 once D1 is decided, because it removes the only horizon difference between the models at no cost in this matrix.

## Commands

```
pip install -r environment/requirements.txt      # eclipse-sumo, traci, sumolib 1.28.0
export PATH=<venv>/bin:$PATH                      # the sumo binary must be on PATH
cd simulation/sumo
python scripts/calibrate.py OUTDIR --variant cap0p5 --write     # capacity ratios
python scripts/dm_run.py --scenario primary_half_capacity --policy coordinated_batch --seed 1 --out OUT
python scripts/run_track_c.py OUTDIR                             # the 91 run smoke matrix
python scripts/sumo_audit.py RUN_DIR... | --pair BASE TREAT      # exit 0 pass, 1 violations, 2 crash
cd ../.. && python tools/track_c_report.py                      # regenerate tables
python tools/run_tests.py                                        # regression suite (no SUMO needed)
```

## Artifacts

`results/track_c/h3600`, `h7200`, `control` (full run directories) and `results/track_c/SHA256SUMS`. Report: `docs/TRACK_C_CROSS_MODEL_REPORT.md`. Run manifests contain the exact identity of each run.

## Unresolved

* D1 horizon, D2 comparator, D3 epoch phase, D4 scenario matrix and identifiers (a closure and stale information scenario beyond the incident closure is not built), D5 acceptance criterion (5% provisional, near capacity point queue 1.70%), D6 licence, D7 independent review, D8 protocol freeze.
* Double capacity does not reach twice the capacity on branch A (measured 1.01); the cause is not established. Half capacity is approximate (0.50 and 0.49).
* Track A archive reconciliation remains blocked on the missing WP2.7 zip.
* The 160 run historical aggregates were not regenerated.

## Next authorised step

Owner decisions on D1 and D2, then, if wanted, a SUMO batch copy comparator labelled exploratory. A confirmatory run needs D8.
