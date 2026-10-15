# Baseline integrity (candidate `9ae528d2238d0d4dedcd07ba7083349f111d422a` against `main` `8072895`)

| Item | Result |
|---|---|
| Git tree `models/point_queue/baseline_wp2_7` | `4413642d2f915180fe0994bf2a78decc46503a30` on both: identical |
| Git tree `results/historical` | `a87f254493b40020203288bc2568236d0125df94` on both: identical |
| Git tree `simulation` | `414a3ef7ac34908614193d4a539a9e819a42d9be` on both: identical |
| WP2.9 `src/` changes versus main | `raw_audit.py` only (model, policies, confirmatory code unchanged) |
| Baseline tests | 6/6, exit 0 |
| Regeneration to scratch versus `tests/golden/SHA256SUMS` | 6/6 match (`golden_check.log`) |

Golden hashes: confirmatory_metrics.csv `f912881e56ab964e95edf8f014e425b289c744fbb7158007560003a98515503b`; decision_log.csv `bd8fde77…`; batch_allocation_log.csv `fd964b10…`; vehicle_records.csv `dd538680…`; edge_event_records.csv `fa88945e…`; metric_spec.json `73bf238d…` (full values in `tests/golden/SHA256SUMS`). `invariant_audit.json` differs from WP2.7 by design and is not in the list. Reconciliation against the original WP2.7 archive belongs to the unmerged Track A pull request and was not repeated here.
