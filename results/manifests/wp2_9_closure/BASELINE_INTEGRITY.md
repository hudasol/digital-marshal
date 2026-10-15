# Baseline integrity (candidate `0b5c58961614ad6fb2c1edcbd2cb075727e01bd7`)

| Item | Result |
|---|---|
| Git tree of `models/point_queue/baseline_wp2_7` | `4413642d2f915180fe0994bf2a78decc46503a30` on both `main` (`8072895`) and the candidate: identical |
| Git tree of `results/historical` | `a87f254493b40020203288bc2568236d0125df94`, identical |
| Git tree of `simulation` | `414a3ef7ac34908614193d4a539a9e819a42d9be`, identical |
| `git diff --name-only main <candidate> -- baseline_wp2_7 results/historical` | 0 files |
| Baseline tests | 6/6 OK, exit 0 |
| Frozen WP2.9 source | only `src/raw_audit.py` changed relative to main among `src/` files; model, policies and confirmatory code unchanged |
| Regeneration into a scratch directory | exit 0; 6 files match `tests/golden/SHA256SUMS` |

Frozen output hashes:

```
f912881e56ab964e95edf8f014e425b289c744fbb7158007560003a98515503b  confirmatory_metrics.csv
bd8fde7715e453b6a2ac213be02754b0ace9dfd2a8c2c851c9a74009a0379a76  decision_log.csv
fd964b107068e87bc70b37e46302986b77bf5d8a72c714ae464000c5f328d92b  batch_allocation_log.csv
dd5386803e225ca5546f47ce45ee4e8a1cea797acfcb0f25eac1157a174f45b5  vehicle_records.csv
fa88945e82aa2cdca9f0e596717141ca6a953502063a725b0050a2cf94087d07  edge_event_records.csv
73bf238dac359849f9df458e382a85008052a8a473a75d99fdec49cbd20d4f92  metric_spec.json
```

`invariant_audit.json` differs from the WP2.7 file on purpose (it carries the independent audit and the horizon) and is not in the golden list. These are outputs of the WP2.9 development module compared with its own golden list; the Track A pull request (not merged) holds the reconciliation against the original WP2.7 archive.
