# WP2.9 development module (point queue)

Deterministic synthetic FIFO point queue model with corrections to the WP2.7 verification layer. It is a model level experiment on an invented network. It is not a microscopic simulation, not calibrated, and not evidence about Dubai roads. It has not had an independent human review.

The preserved historical baseline is in `../baseline_wp2_7` and is not modified.

## What the audit checks

`src/raw_audit.py` is an independent check of the raw output records. It imports nothing from the model and reads a separately written graph and scenario specification, `config/graph_spec.json`. It does not repeat the model's service recurrence (the WP2.7 `audit_fifo` did, so it could not catch an error in that recurrence).

Per run, from raw vehicle and edge event records: path legality, continuity between edges, the free flow lower bound, wait bookkeeping, no overtaking, minimum headway, work conservation, entry to closed edges, vehicle conservation, the departure schedule, route labels, decision routes and route counts against the paths actually driven, completion and censoring against the 7200 s horizon, and recomputation of the reported metrics.

Per package (completeness): the expected matrix is every scenario crossed with every policy in the specification (5 by 3 = 15 runs). All five result files must contain every expected run, the metrics file exactly once, and nothing else. A missing file, a missing, duplicated or unexpected run, or a count mismatch in the decision or batch logs gives a non zero exit status and a diagnostic naming the file, scenario and policy.

Limits: the specification and the audit were written with AI assistance and have not been transcribed or reviewed by a second human engineer; tests that compare the specification with the model only detect drift. The audit says nothing about whether the model is realistic. The 7200 s horizon still needs explicit project owner confirmation.

## Commands

Run from this directory.

```
PYTHONPATH=src python -m unittest discover -s tests -v          # 116 tests
python tools/mutation_check.py . python                         # re breaks each fix; every mutant (34) must be caught
python tools/audit_adversarial.py                               # 75 corrupted copies run through the real audit command
python tools/exhaustive_batch_oracle.py --max-batch 16          # analysis: all 2^m assignments per batch vs the restricted optimiser (about 35 s)
PYTHONPATH=src python src/confirmatory.py --out ../../../scratch/check   # regeneration check, not a confirmatory run
python src/raw_audit.py --results ../../../scratch/check        # exit 0 only for a complete, clean package
PYTHONPATH=src python src/exploratory.py --out ../../../scratch/expl     # exploratory policies, separate output
```

Never point `--out` at the historical results of the baseline.

## What is what

* Immutable WP2.7 baseline: `../baseline_wp2_7` (source, tests and results as supplied; not modified).
* WP2.9 development model: this directory. Frozen policies: `static`, `independent_periodic` and `coordinated_batch`. `coordinated_batch` is a restricted optimiser (it searches the count sent to Route A with an even spread, not all assignments); it is not proven optimal. An exhaustive per batch check (`tools/exhaustive_batch_oracle.py`, replaying the frozen history) found it optimal in 18 of the 20 frozen batches and short of the optimum by 4.5 s (near_branch_capacity, epoch 240) and 12.0 s (overload_stress, epoch 180) of summed batch travel time in the other two; that is evidence of a gap, not of global optimality, and nothing was changed.
* Exploratory policies `independent_each_vehicle` and `peer_aware_sequential` (`src/exploratory.py`) are separate, never write to `results/`, and do not replace the frozen `independent_periodic` or decide any confirmatory pass or fail.
* Historical SUMO results: `../../../results/historical/sumo_phase1`, kept as produced and labelled.
* The 5% improvement target is provisional and not approved. Cross model differences and the SUMO scenario gaps remain open.

## Related documents

Within this directory: `docs/WP2_9_CHANGES.md`, `docs/WP2_9_POLICY_REVIEW.md`. At the repository root: `docs/architecture.md`, `docs/INCOMPLETE_ITEMS.md`, `docs/decisions/OWNER_DECISIONS.md`, `docs/decisions/ADR-0001-horizon.md`, `docs/review/reviewer-checklist.md`, `docs/review/graph-spec-traceability.md`, `docs/review/independence-and-common-mode.md`, and the evidence in `results/manifests/wp2_9_closure/`.
