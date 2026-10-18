# Track C SUMO evidence (exploratory)

Exploratory runs of the synthetic SUMO cross-check. **Not confirmatory**: the protocol is not frozen and owner decisions D1 to D6 and D8 are pending. Not independently reviewed. Historical results (`results/historical/`, `results/manifests/`) are untouched.

| Directory | What | Produced by |
|---|---|---|
| `calibration/` | Discharge-rate measurements: base reproduction, the four point headway search for half capacity, the three seed results for both variants (copies of `simulation/sumo/network/calibration_branch_*.json`) | `calibrate.py` |
| `smoke_7200/` | Smoke matrix: 5 scenarios x 5 policies, seed 1, horizon 7200 s | `run_matrix.py --plan track_c_smoke --horizon-s 7200` |
| `matrix_7200/` | Scenario matrix: 5 scenarios x 5 policies; seeds 1..20 for near capacity, 1..10 otherwise (fixed before any run); horizon 7200 s | `run_matrix.py --plan track_c --horizon-s 7200` |

Each matrix directory holds `plan.json` (plan, horizon, start and finish, status counts), `manifest.jsonl` (one line per run: exact command with the output directory as `<matrix>`, exit code, status `ok`, `invalid` or `failed` with the reason, SHA-256 of every output file), `runs/<run>/summary.json` and `run_config.json` (scenario parameters, policy, seed, horizon, termination, SUMO version, network and demand SHA-256, calibration values), `logs.tar.gz` (per run `vehicles.csv`, `decisions.csv`, `crossings.json`; deterministic archive), `SHA256SUMS.txt` (every exported file, written last) and `aggregate/` (generated from the directory itself).

Not exported: `tripinfo.xml` (its SUMO header contains absolute local paths) and `demand.rou.xml` (regenerated from the seed by `dm_run.make_demand`). Their hashes are in the manifest.

## Reproduce

Environment: Python 3.12, `pip install -r environment/requirements.txt` (eclipse-sumo, traci, sumolib 1.28.0); `sumo` on `PATH`. Runs here were made on Windows 11 with Python 3.12.

```bash
cd simulation/sumo/scripts
python run_matrix.py OUT --plan track_c --horizon-s 7200 --workers 12
python export_matrix.py OUT ../../../results/exploratory/track_c/matrix_7200
python aggregate_track_c.py ../../../results/exploratory/track_c/matrix_7200 ../../../results/exploratory/track_c/matrix_7200/aggregate
python ../../../tools/reconcile_track_c.py
```

SUMO is seeded; reruns with the same SUMO version, platform and inputs are expected to give the same totals, but bit-for-bit identity across platforms has not been checked. `simulation/sumo/tests/test_track_c_scenarios.py` (`CommittedRunEvidence`) verifies the checksums and that the aggregates reproduce from the committed files.
