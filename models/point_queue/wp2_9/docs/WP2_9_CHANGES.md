# WP2.9 change notes

Branch `wp2.9-fixes`, based on tag `wp2.7-baseline` (WP2.7 source, tests, docs and regenerated results exactly as supplied; hashes match the Phase 2 manifest). The original WP2.7 archive and results are not modified. No confirmatory experiment has been run or authorised.

| Item | Change | Where |
|---|---|---|
| Horizon | One constant `HORIZON_S = 7200.0` in `canonical_model.py`, enforced by `run_fixed_routes(horizon_s=...)`; `confirmatory.py` and `metric_spec.json` read it. The baseline enforced a hard-coded 3600 s. 7200 s is the value in the WP2.7 docs and `metric_spec.json`; confirm this is the intended frozen horizon. | `src/canonical_model.py`, `src/confirmatory.py` |
| Closure gate | `closure_violation` and `closed_link_entries` are derived from each vehicle's entry time on `E2`/`E3` (entry at or after `closure_start_s`). They were hard-coded `False` / `0`. Audit flags `all_depart_before_incident` and `all_p_arrivals_at_or_after_incident` are computed, not constants. | same |
| Audit | `audit_fifo` (which re-applied the model's own recurrence) is removed. `src/raw_audit.py` checks properties of the raw records against `config/graph_spec.json`, a separately transcribed spec with no model imports. | `src/raw_audit.py`, `config/graph_spec.json` |
| Tests | 65 tests (6 original unchanged + 59 new): adversarial closed route (unit and pipeline), horizon enforcement and boundary, hand-computed queue values, pinned results, golden byte-identity of 6 frozen outputs, audit independence, spec drift, 14 fault-injection tests, exploratory separation. | `tests/` |
| Mutation check | `tools/mutation_check.py` re-breaks each fix in a scratch copy; 13/13 mutants are caught. | `tools/` |
| Policy review | Independent policy review and corrected epoch grid. | `docs/WP2_9_POLICY_REVIEW.md` |
| Exploratory baselines | `independent_each_vehicle`, `peer_aware_sequential`; separate runner that refuses to write to `results/`. | `src/exploratory.py` |

## Output compatibility

Re-running `python src/confirmatory.py --out <dir>` produces byte-identical `confirmatory_metrics.csv`, `decision_log.csv`, `batch_allocation_log.csv`, `vehicle_records.csv`, `edge_event_records.csv` and `metric_spec.json`. `invariant_audit.json` differs on purpose: it now carries the independent audit and the horizon. `tests/golden/SHA256SUMS` enforces this.

## Commands

```
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python src/confirmatory.py --out results_check      # frozen experiment (do NOT run as confirmatory before protocol freeze)
python src/raw_audit.py --results results_check                    # post hoc independent audit of any results folder
PYTHONPATH=src python src/exploratory.py --out exploratory_out     # exploratory screening only
python tools/mutation_check.py . python
```

## Not addressed (open)

* A-01 human independent reproduction and A-02 artifacts not produced by the documented command (`execution_summary.json`, `paired_comparison.json`, `run_manifest.json`, `test_results.txt`).
* Protocol freeze, SUMO scenario matrix freeze, and the 5% target decision.
* An exhaustive check that `coordinated_batch` is optimal on small batches.
