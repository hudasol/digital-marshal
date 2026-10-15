# ADR-0001: One simulation horizon for the point queue model

Status: applied in `models/point_queue/wp2_9`, awaiting confirmation by the project owner.

Context. The WP2.7 documents and `metric_spec.json` state a 7200 s horizon. The WP2.7 code enforced a hard coded 3600 s in `run_fixed_routes`, so the specification and the implementation disagreed. All 15 frozen runs finish well before 3600 s, so the historical numbers are not affected.

Decision. A single constant `HORIZON_S = 7200.0` in `canonical_model.py` is enforced by `run_fixed_routes(horizon_s=...)` and is read by `confirmatory.py`, the metric specification and the independent audit (`config/graph_spec.json`). A trip that has not finished at the horizon is marked incomplete and its travel time is censored at the horizon. A trip finishing exactly at the horizon is complete.

Tests. `tests/test_gates_and_horizon.py` covers the single source constant, the metric specification, a trip finishing between 3600 s and 7200 s, a trip after the horizon, the inclusive boundary, and the audit.

Migration. Existing results are unchanged (byte for byte, except `invariant_audit.json`, which now carries the audit and the horizon). A future scenario with trips longer than 3600 s would have been mis marked incomplete by the old code.

Open. The SUMO runner still uses 3600 s. It must be aligned or documented before any comparison that depends on censoring.

## Addendum (Track B closure): consistency check and the open owner decision

Status: PROVISIONAL. Owner decision D1 is OPEN (see `OWNER_DECISIONS.md`). This addendum does not approve the horizon and nobody has approved it.

What was verified (engineering consistency only):

| Where | Value |
|---|---|
| `src/canonical_model.py` `HORIZON_S` | 7200.0 |
| `config/graph_spec.json` `horizon_s` (independent copy for the audit) | 7200.0 |
| `metric_spec.json` `horizon_s` (generated, golden hashed) | 7200.0 |
| WP2.7 documents | 7200 s |
| Baseline code `run_fixed_routes` | 3600 s hard coded (not changed; the baseline is immutable) |
| SUMO runner `simulation/sumo/scripts/dm_run.py` `SIM_HORIZON_S` | 3600.0 |

Tests that pin the contract (`tests/test_gates_and_horizon.py`): the single source constant, the metric specification, a trip finishing between 3600 s and 7200 s (complete), a trip after the horizon (incomplete, retained, travel time censored at `horizon - depart`), and the inclusive boundary (a trip arriving exactly at the horizon is complete; 0.001 s earlier horizon makes it incomplete). Before, at and after the boundary are therefore all covered. `tests/test_raw_audit.py::test_completion_flag_contradicts_horizon` checks the audit side. The mutation check includes horizon mutants.

Point queue versus SUMO. The point queue model uses 7200 s; the SUMO runner uses 3600 s. These are different models with different scenario sets and are not claimed to be equivalent. All 15 frozen point queue runs finish by about 1425 s, so neither value changes any current number. The horizon matters only for future scenarios and for the completion gate. A comparison that depends on censoring must not be made until the two horizons are aligned or the difference is documented in the protocol.

Owner decision needed: confirm 7200 s (or give another value) and whether SUMO should use the same value. Until then every document describes the horizon as provisional.
