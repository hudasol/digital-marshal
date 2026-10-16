# Historical results (WP2.7, as reported and re verified)

Status: historical record. These are outputs of a deterministic synthetic model. They are not field measurements, they carry no statistical significance (there is no randomness to sample), and they do not show deployment readiness. No SUMO or microscopic model was used to produce them.

## Verified values

Source file: `models/point_queue/baseline_wp2_7/results/confirmatory_metrics.csv` (column `total_fleet_travel_time_vehicle_min`, unit vehicle minutes, scheduled departure to arrival, summed over all vehicles). Improvement (%) = 100 x (independent total - coordinated total) / independent total, computed here from the file.

| Scenario | Static (vehicle minutes) | Independent periodic (vehicle minutes) | Coordinated batch (vehicle minutes) | Improvement over independent (%) |
|---|---:|---:|---:|---:|
| Manageable demand | 93.750 | 93.750 | 93.750 | 0.00 |
| Near capacity | 262.000 | 254.275 | 249.950 | 1.70 |
| Overload stress | 923.500 | 719.875 | 701.492 | 2.55 |
| Half branch capacity | 105.000 | 104.050 | 102.800 | 1.20 |
| Double branch capacity | 90.000 | 90.000 | 90.000 | 0.00 |

`tests/test_historical_results_doc.py` fails if this table disagrees with the source file. The independent and coordinated columns match the values reported in `results/historical/wp2_7_reported/paired_comparison.json` (rounded to three decimals) and in `WP2_7_Audit_Report.md` (rounded to two decimals); the reported file and the source file are both in this repository.

## Regeneration check

Running the preserved pipeline into a scratch folder reproduced all seven output files byte for byte (`results/manifests/track_a/regeneration_comparison.txt`). That run is a regeneration check, not a confirmatory run, and the historical `results` folder was not touched.

## Limits that apply to every number above

* Deterministic abstraction with infinite storage, no spillback, no signals, no car following.
* Synthetic graph and capacities. Not Dubai road data.
* The reported audit gates (closure, FIFO, horizon) have known weaknesses recorded in `docs/known-issues.md`. The words PASS in the reported audit refer to the synthetic mechanism experiment only.
* The 5% figure is a candidate threshold and is not approved. None of the five scenarios reaches it.
