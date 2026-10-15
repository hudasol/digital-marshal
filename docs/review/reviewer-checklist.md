# Reviewer checklist for the WP2.9 audit, specification and horizon

Status: READY FOR INDEPENDENT REVIEW, NOT YET SIGNED OFF. No human has performed this review. Do not record it as done until a named person has filled in the sign off block at the end.

Scope: findings B-03 and B-07. Related documents: `graph-spec-traceability.md`, `independence-and-common-mode.md`, `../decisions/OWNER_DECISIONS.md`.

## 1. Environment and commands

Use a clean checkout, a fresh directory and Python 3.11 or later (the AI assistant used 3.13). The WP2.9 module needs only the standard library.

```
git clone https://github.com/hudasol/digital-marshal && cd digital-marshal
git checkout feature/wp2.9-audit-completeness      # or the commit named in results/manifests/wp2_9_closure/COMMANDS.md
python tools/run_tests.py                                         # expect exit 0, four suites OK
cd models/point_queue/wp2_9
PYTHONPATH=src python -W error::ResourceWarning -m unittest discover -s tests    # expect OK, no ResourceWarning
python tools/mutation_check.py . python                           # expect every mutant KILLED
mkdir -p /tmp/dm_check
PYTHONPATH=src python src/confirmatory.py --out /tmp/dm_check     # regeneration into scratch, not a confirmatory run
python src/raw_audit.py --results /tmp/dm_check                   # expect exit 0, 15 runs
python tools/audit_adversarial.py                                 # expect every case behaves as expected, fixture unchanged
( cd /tmp/dm_check && sha256sum -c <repo>/models/point_queue/wp2_9/tests/golden/SHA256SUMS )
```

`invariant_audit.json` is deliberately not in the golden list. Never write regenerated output into `models/point_queue/baseline_wp2_7/` or `results/`.

Expected SHA-256 of the frozen outputs (`tests/golden/SHA256SUMS`):

```
f912881e56ab964e95edf8f014e425b289c744fbb7158007560003a98515503b  confirmatory_metrics.csv
bd8fde7715e453b6a2ac213be02754b0ace9dfd2a8c2c851c9a74009a0379a76  decision_log.csv
fd964b107068e87bc70b37e46302986b77bf5d8a72c714ae464000c5f328d92b  batch_allocation_log.csv
dd5386803e225ca5546f47ce45ee4e8a1cea797acfcb0f25eac1157a174f45b5  vehicle_records.csv
fa88945e82aa2cdca9f0e596717141ca6a953502063a725b0050a2cf94087d07  edge_event_records.csv
73bf238dac359849f9df458e382a85008052a8a473a75d99fdec49cbd20d4f92  metric_spec.json
```

Interpreting failures: a hash mismatch means the model output changed (find out why before anything else); an audit exit 1 lists violations with check name, file, scenario and policy; exit 2 means the audit crashed and reports `audit_crashed`; a surviving mutant means a test no longer protects that fix; an adversarial case that does not behave as expected means the audit accepts or rejects a package it should not.

## 2. Checklist

Tick each item yourself; do not copy the AI's conclusions.

### Provenance of `config/graph_spec.json` (B-07)
- [ ] Obtain the original WP2.7 archive and verify its SHA-256 (see the Track A pull request, which is not merged at the time of writing).
- [ ] Compare nodes, edges, free flow times, capacities, branch scaled edges, closed edges, incident time against `FAIR_BASELINE_SPEC.md` section 2, independently of `graph-spec-traceability.md`.
- [ ] Compare the scenario table with section 3; note the two identifier differences.
- [ ] Judge the inferred critical route `E1,E2,E3`.
- [ ] Confirm the horizon and the policy list are not in the FAIR spec and come from WP2.7 documents.

### Audit logic (`src/raw_audit.py`)
- [ ] Read it with the specification open; confirm it imports only the standard library and does not apply the service recurrence.
- [ ] Check each property (path legality, continuity, free flow bound, wait bookkeeping, no overtaking, headway, work conservation, closed edge entry, conservation, schedule, censoring, metric recomputation) is stated correctly.
- [ ] Check the expected matrix is derived from the specification (scenarios times policies), not from the files audited.
- [ ] Check every failure path exits non zero and names check, file, scenario and policy.

### Scenario and policy coverage
- [ ] 5 scenarios times 3 policies = 15 runs, 1,792 events on the frozen package.
- [ ] Missing, duplicate, unexpected, renamed and whitespace or case variant groups are rejected in each of the five files.

### Raw record invariants and metrics
- [ ] Recompute a few vehicles by hand from `vehicle_records.csv` and `edge_event_records.csv`.
- [ ] Recompute total, mean, median and nearest rank P95 for one run; confirm the improvement formula `100 (T_ind - T_coord) / T_ind`.

### Horizon semantics
- [ ] Confirm the boundary tests before, at and after 7200 s and censoring (travel time = horizon - depart) are what the owner intends. The owner decision itself (D1) is separate.

### Test quality
- [ ] Read `tests/test_audit_completeness.py` and `tools/audit_adversarial.py`; judge whether expected outcomes are independent of the implementation.
- [ ] Judge whether the 34 mutants cover the risks you care about; add mutants if not.
- [ ] Review `independence-and-common-mode.md` for risks missed.

## 3. Sign off block (empty)

| Field | Entry |
|---|---|
| Reviewer name | |
| Date | |
| Commit reviewed | |
| Scope reviewed | |
| Findings | |
| Differences from the AI's results | |
