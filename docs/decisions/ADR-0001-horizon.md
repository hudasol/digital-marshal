# ADR-0001: One simulation horizon for the point queue model

Status: applied in `models/point_queue/wp2_9`, awaiting confirmation by the project owner.

Context. The WP2.7 documents and `metric_spec.json` state a 7200 s horizon. The WP2.7 code enforced a hard coded 3600 s in `run_fixed_routes`, so the specification and the implementation disagreed. All 15 frozen runs finish well before 3600 s, so the historical numbers are not affected.

Decision. A single constant `HORIZON_S = 7200.0` in `canonical_model.py` is enforced by `run_fixed_routes(horizon_s=...)` and is read by `confirmatory.py`, the metric specification and the independent audit (`config/graph_spec.json`). A trip that has not finished at the horizon is marked incomplete and its travel time is censored at the horizon. A trip finishing exactly at the horizon is complete.

Tests. `tests/test_gates_and_horizon.py` covers the single source constant, the metric specification, a trip finishing between 3600 s and 7200 s, a trip after the horizon, the inclusive boundary, and the audit.

Migration. Existing results are unchanged (byte for byte, except `invariant_audit.json`, which now carries the audit and the horizon). A future scenario with trips longer than 3600 s would have been mis marked incomplete by the old code.

Open. The SUMO runner still uses 3600 s. It must be aligned or documented before any comparison that depends on censoring.
