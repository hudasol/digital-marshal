# Acceptance criteria

Status: provisional. Nothing below is approved or frozen.

* **Primary metric.** Total fleet travel time in vehicle minutes. Improvement (%) = 100 x (baseline total - coordinated total) / baseline total.
* **Provisional target.** At least 5% improvement of `coordinated_batch` over `independent_periodic` in the near capacity scenario. Unchanged and not approved. Current exploratory results: 1.70% (point queue) and 0.53% mean (SUMO prototype). Target not met.
* **Guardrail.** Coordinated P95 trip time must not exceed the independent P95 in the primary scenario.
* **Hard gates, per run.** No closed link entries (measured from records), no FIFO violations (independent audit), no incomplete trips, no invalid or infeasible routes, vehicle conservation.
* **A gate counts as passed only if its test can fail** when the invariant is deliberately violated. Evidence: `models/point_queue/wp2_9/tests/test_raw_audit.py`, `test_gates_and_horizon.py`, `tools/mutation_check.py`, `simulation/sumo/tests/test_smoke_audit.py`.
* **Confirmatory experiment.** Not to be run or labelled until the protocol is frozen and prerequisite gates are accepted by the project owner.
* **Deterministic model.** No statistical significance is inferred from point queue runs.
