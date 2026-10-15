# What `raw_audit.py` checks independently, and what it does not

Status: READY FOR INDEPENDENT REVIEW, NOT YET SIGNED OFF. Written by an AI assistant; no human has reviewed it.

## Implemented independently of the model

`src/raw_audit.py` imports only the standard library (enforced by `tests/test_raw_audit.py`). It does not call the model's service recurrence. It reads raw vehicle and edge event rows and checks properties any correct FIFO point queue record must satisfy: path endpoints, connectivity and membership in the allowed path set; continuity between consecutive edges; the free flow lower bound; wait bookkeeping; no overtaking; minimum headway; work conservation; no entry to a closed edge at or after the incident; vehicle conservation and uniqueness; departure schedule; completion flag and censoring against the horizon; recomputation of total, mean, median and nearest rank P95 from raw rows; and package completeness and structure (this change).

## Shared assumptions (common mode risk)

| Item | Where it comes from | Risk |
|---|---|---|
| Graph, capacities, closure, allowed paths, scenario table | `config/graph_spec.json`, transcribed by an AI from FAIR_BASELINE_SPEC.md | If the transcription is wrong, the model and audit could still agree only if the model has the same error. `tests/test_raw_audit.py` compares them, but agreement of two copies written in the same working session is weak evidence. A human must compare the file with the source (see `graph-spec-traceability.md`). |
| Scenario and policy identifiers | The WP2.7 outputs | The identifier differs from the FAIR spec text for two scenarios. Agreement of the audit with the outputs cannot detect a wrong choice of names. |
| Horizon 7200 s | Provisional | The audit and the model use the same constant source value in the specification. Agreement is not an owner decision. |
| Metric definitions | WP2.7 `metric_spec.json` | The audit recomputes the same definitions; it does not question them. |
| The tests | Written by the same AI that wrote the audit | Tests may share its blind spots. The adversarial runner (`tools/audit_adversarial.py`) states its expected outcomes in a hand written table rather than deriving them from the implementation, and the mutation check re breaks the audit to confirm tests notice, but both are still AI work. |

Residual blind spots (known, not closed): `--spec` accepts any specification file, so a weakened specification would shrink the expected matrix (the CLI now prints `spec_sha256` and `spec_is_default` so a run names its specification, and the default one is pinned to the model by `tests/test_raw_audit.py`; a human should confirm it); the decision log text fields (`eligible_routes`, `available_info`, `decision_method`, `route_switches`) are not validated; the epoch rule (30 s, anchor 180 s) is a shared assumption with the model; the exhaustive batch oracle shares the queue simulator and objective with production; tests and mutants share the author of the audit.

Not checked by the audit: whether the model is realistic; whether the policies implement the intended semantics; route choice quality; whether the frozen comparator is fair.

## What a human reviewer should do

Use `reviewer-checklist.md`. Agreement between the model and the audit is not independent evidence if both use an incorrect shared specification.
