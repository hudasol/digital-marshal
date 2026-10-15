# Changelog

## Unreleased

### Added
* Repository bootstrap: WP2.7 baseline imported unchanged (`models/point_queue/baseline_wp2_7`).
* WP2.9 development module with a closure gate measured from vehicle records, one horizon contract (7200 s), an independent raw record audit, value asserting tests, a mutation check, and two exploratory policies.
* Synthetic SUMO network, runner, one command smoke test with a raw record audit and negative tests.
* Cross model reconciliation with generated tables and a staleness test.
* Architecture notes, acceptance criteria, traceability, decisions, incomplete items list, CI workflow.

### Changed (relative to WP2.7, in the development module only)
* `run_fixed_routes` enforces the horizon passed to it and derives closure violations from entry times.
* `invariant_audit.json` now contains the independent audit and the horizon. The other six frozen outputs are byte identical to the baseline.

### Track B closure (branch `feature/wp2.9-audit-completeness`)
* Raw audit derives the expected 5 by 3 matrix from the specification and fails closed on missing, empty, malformed, duplicated, unexpected or inconsistent packages, with diagnostics naming check, file, scenario and policy (B-01).
* 102 WP2.9 tests, 28 mutants, a 67 case adversarial runner against the real command.
* Horizon consistency documented, owner decision still open (ADR-0001 addendum, B-02). Review documents for independent review (B-03, B-07). Owner decisions list. Stale README replaced (B-04).

### Corrected
* An earlier review claimed the frozen epoch anchor gave the maximum improvement. The sweep it used allowed decisions after a vehicle reached P. The corrected range is 0.73% to 1.74% (see `results/manifests/wp2_9_evidence/ERRATUM.md`).
