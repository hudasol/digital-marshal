# WP2.9 development module (point queue)

Deterministic synthetic FIFO point queue model with corrections to the WP2.7 verification layer. It is a model level experiment on an invented network. It is not a microscopic simulation, not calibrated, and not evidence about Dubai roads. It has not had an independent human review.

The preserved historical baseline is in `../baseline_wp2_7` and is not modified.

## What the audit checks

`src/raw_audit.py` is an independent check of the raw output records. It imports nothing from the model and reads a separately written graph and scenario specification, `config/graph_spec.json`. It does not repeat the model's service recurrence (the WP2.7 `audit_fifo` did, so it could not catch an error in that recurrence).

Per run, from raw vehicle and edge event records: path legality, continuity between edges, the free flow lower bound, wait bookkeeping, no overtaking, minimum headway, work conservation, entry to closed edges, vehicle conservation, the departure schedule, completion and censoring against the 7200 s horizon, and recomputation of the reported metrics.

Per package (completeness): the expected matrix is every scenario crossed with every policy in the specification (5 by 3 = 15 runs). All five result files must contain every expected run, the metrics file exactly once, and nothing else. A missing file, a missing, duplicated or unexpected run, or a count mismatch in the decision or batch logs gives a non zero exit status and a diagnostic naming the file, scenario and policy.

Limits: the specification and the audit were written with AI assistance and have not been transcribed or reviewed by a second human engineer; tests that compare the specification with the model only detect drift. The audit says nothing about whether the model is realistic. The 7200 s horizon still needs explicit project owner confirmation.

## Commands

Run from this directory.

```
PYTHONPATH=src python -m unittest discover -s tests -v          # 85 tests
python tools/mutation_check.py . python                         # re breaks each fix; every mutant must be caught
PYTHONPATH=src python src/confirmatory.py --out ../../../scratch/check   # regeneration check, not a confirmatory run
python src/raw_audit.py --results ../../../scratch/check        # exit 0 only for a complete, clean package
PYTHONPATH=src python src/exploratory.py --out ../../../scratch/expl     # exploratory policies, separate output
```

Never point `--out` at the historical results of the baseline.

## Related documents

`docs/WP2_9_CHANGES.md`, `docs/WP2_9_POLICY_REVIEW.md`, and at the repository root `docs/architecture.md`. The reproduction guide and the known issues register (`docs/reproduction-guide.md`, `docs/known-issues.md`) are added by the separate Track A pull request.
