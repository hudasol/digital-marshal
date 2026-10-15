# WP2.9 change notes

Branch `wp2.9-fixes`, based on tag `wp2.7-baseline` (WP2.7 source, tests, docs and regenerated results exactly as supplied; hashes match the Phase 2 manifest). The original WP2.7 archive and results are not modified. No confirmatory experiment has been run or authorised.

| Item | Change | Where |
|---|---|---|
| Horizon | One constant `HORIZON_S = 7200.0` in `canonical_model.py`, enforced by `run_fixed_routes(horizon_s=...)`; `confirmatory.py` and `metric_spec.json` read it. The baseline enforced a hard-coded 3600 s. 7200 s is the value in the WP2.7 docs and `metric_spec.json`; confirm this is the intended frozen horizon. | `src/canonical_model.py`, `src/confirmatory.py` |
| Closure gate | `closure_violation` and `closed_link_entries` are derived from each vehicle's entry time on `E2`/`E3` (entry at or after `closure_start_s`). They were hard-coded `False` / `0`. Audit flags `all_depart_before_incident` and `all_p_arrivals_at_or_after_incident` are computed, not constants. | same |
| Audit | `audit_fifo` (which re-applied the model's own recurrence) is removed. `src/raw_audit.py` checks properties of the raw records against `config/graph_spec.json`, a separately transcribed spec with no model imports. | `src/raw_audit.py`, `config/graph_spec.json` |
| Tests | 116 tests (6 original unchanged + 110 new, including 47 audit completeness, route and epoch tests, 3 oracle tests and an adversarial runner test): adversarial closed route (unit and pipeline), horizon enforcement and boundary, hand-computed queue values, pinned results, golden byte-identity of 6 frozen outputs, audit independence, spec drift, 14 fault-injection tests, exploratory separation. | `tests/` |
| Mutation check | `tools/mutation_check.py` re-breaks each fix in a scratch copy; 34/34 mutants are caught (18 original, 10 audit completeness, 4 route consistency, 2 epoch and decision field). | `tools/` |
| Policy review | Independent policy review and corrected epoch grid. | `docs/WP2_9_POLICY_REVIEW.md` |
| Exploratory baselines | `independent_each_vehicle`, `peer_aware_sequential`; separate runner that refuses to write to `results/`. | `src/exploratory.py` |

## Audit completeness (B-01)

`raw_audit.audit_results_dir` and the command line tool now derive the expected run matrix from `config/graph_spec.json` (scenarios times policies), not from the metrics file under test. They fail closed (exit 1) on a missing or empty result file, a missing, duplicated or unexpected scenario policy group in any of the five result files, and decision or batch log totals that do not match the scenario. The malformed value, missing column, cross file count and internal error paths are also checked, and `tools/audit_adversarial.py` runs 67 corrupted copies through the real command. Before this change, removing one metrics row still gave `runs_audited: 14`, `all_pass: true` and exit 0.

## Route consistency (post engineering review)

A review probe showed that swapping `route_A_count` and `route_B_count`, flipping a route label in `vehicle_records.csv`, or flipping `chosen_route` in `decision_log.csv` still gave exit 0, because those fields were never compared with the edge paths. `audit_results_dir` now derives each vehicle's route from its raw edge events (labels in `route_labels` in `config/graph_spec.json`) and flags `vehicle_route_label_mismatch`, `decision_route_mismatch`, `metrics_route_counts_vs_paths` and `batch_route_totals_vs_paths`. Frozen outputs are unaffected.

## Bounded closeout additions

* `raw_audit.py` also checks, per run, each batch log row against the batch epoch of the vehicles' P arrivals (`batch_epoch_mismatch`) and the decision log time fields (`decision_field_mismatch`: P arrival, epoch not after P arrival, epoch equal to the batch epoch, seconds after incident). `epoch_s` (30) and `epoch_anchor_s` (180) were added to `config/graph_spec.json`; they are protocol parameters (decision D3), not new choices. The CLI output now names the specification used (`spec_sha256`, `spec_is_default`).
* `tools/exhaustive_batch_oracle.py` (analysis only, never writes to `results/`): see README.

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
