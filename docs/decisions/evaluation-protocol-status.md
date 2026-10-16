# Evaluation protocol status

Status: provisional. Nothing here is approved, frozen or externally validated.

Sources: `docs/decisions/source/WP2_8_Phase1_Threshold_Decision.md` and `acceptance_criteria.json` (WP2.8 Phase 1, preserved unchanged), and `models/point_queue/baseline_wp2_7/results/metric_spec.json`.

* Primary endpoint: total fleet travel time in vehicle minutes. Primary scenario: near capacity demand. Comparator: independent periodic rerouting. Treatment: coordinated batch allocation.
* Candidate minimum effect: at least 5% reduction. The Phase 1 record states that it is a provisional working decision, not an approved requirement and not external validation. It must not be lowered to fit results.
* Improvement (%) = 100 x (independent total - coordinated total) / independent total.
* Guardrail: P95 travel time must not degrade. Hard gates: zero closed link entries, zero FIFO violations, all trips complete within the declared horizon, feasible routes. Note KI-01, KI-03, KI-04 and KI-05: the current implementations of these gates are known to be weak.
* The historical near capacity improvement is 1.70%, so the candidate threshold is not met.
* The confirmatory experiment has not been run for this protocol. The file `src/confirmatory.py` is named after the intended experiment but, in this repository, it was run only as a regeneration check into a scratch folder. The protocol has not been frozen.
* No endorsement or approval by RTA, EDGE or any other institution is claimed.
