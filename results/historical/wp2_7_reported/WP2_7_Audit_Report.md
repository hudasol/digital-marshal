# WP2.7 Audit Report — Periodic Independent Baseline and Fair Comparison

**Decision:** PASS for the defined synthetic mechanism experiment; NOT VALIDATED for real-world performance.

## What was engineered

WP2.6's blockers were the missing periodic baseline, ambiguous information parity, and unfrozen metrics. WP2.7 implements a deterministic 30-second epoch independent rerouter and an information-matched coordinated batch policy. All policies share the graph, capacities, incident state, scheduled demand and P-arrival schedule. No policy receives future realized edge exits. The baseline makes choices against the pre-batch snapshot and does not account for peers' simultaneous uncommitted choices. The coordinator jointly searches A/B splits within the same current batch. This difference in decision coupling is the mechanism being tested.

A code review of the evaluation logic also removed future-vehicle placeholders from batch scoring, avoiding route-dependent merge look-ahead. The candidate evaluates only previously committed and current-batch vehicles.

## Results


| Scenario | Independent (veh-min) | Coordinated (veh-min) | Reduction | Independent A/B | Coordinated A/B |
|---|---:|---:|---:|---:|---:|
| manageable_primary | 93.75 | 93.75 | 0.00% | 10/0 | 10/0 |
| near_branch_capacity | 254.28 | 249.95 | 1.70% | 18/6 | 16/8 |
| overload_stress | 719.88 | 701.49 | 2.55% | 30/30 | 25/35 |
| primary_half_capacity | 104.05 | 102.80 | 1.20% | 9/1 | 8/2 |
| primary_double_capacity | 90.00 | 90.00 | 0.00% | 10/0 | 10/0 |

## Validation gates

- 15/15 scenario-policy invariant audits pass.
- 0 FIFO recurrence violations in all raw edge logs.
- 0 closed-link entries.
- All trips complete; no censoring.
- 6/6 regression tests pass.
- Primary metric and secondary metric definitions are frozen in `results/metric_spec.json`.
- Decision-level information contract and route choices are recorded in `results/decision_log.csv`; edge and vehicle records are preserved.

## Why checklist items 5, 6, and 8 are now green

**5 — Measurable detour concentration:** the independent policy makes same-snapshot decisions in 30-second cohorts and cannot reserve capacity for peers. At near-capacity demand, it allocates 18/24 vehicles to A (75%). In the overload case, aggregate allocation is 30/30, but within each independent decision batch all vehicles choose the same route (100% dominant-route share). Coordinated batch assignment lowers the maximum dominant-route share to 66.7% in the overload case. This is direct evidence of the modeled herding mechanism.

**6 — Informative comparison:** the comparison now has explicit matched information, timing, capacity, closure, and demand. The coordination policy differs only in being able to jointly allocate peers in the current batch. The measured differences are small but interpretable: 1.70% in the near-capacity scenario and 2.55% in overload. A 5% threshold was never approved and is not reached; therefore this supports an informative comparison, not a claim of meeting a performance target.

**8 — Metrics defined before the run:** primary and secondary metrics, P95 convention, completion handling, route-switch interpretation, and candidate success criterion are frozen in the metric spec. The 5% threshold is explicitly labeled proposed/unapproved, so it cannot be retrospectively presented as a pass.

## Remaining limitations and bottleneck

1. **Effect size:** current gains are below the discussion-only 5% proposal. Do not change the threshold after seeing results to manufacture a pass.
2. **Policy abstraction:** independent choices are modeled as same-snapshot cohort decisions; this is a clear herding mechanism but not a calibrated model of real autonomous-vehicle routing behavior.
3. **Queue model:** deterministic point queues with infinite storage, no spillback, signals, lane geometry, car-following, stochasticity, or real-world calibration.
4. **Route switching:** this experiment locks a route at P and prohibits mid-branch changes. The route-switch metric is therefore zero by design; a future en-route rerouting experiment needs a stateful vehicle-position model to avoid teleportation.
5. **Independent reproduction:** a second engineer has not yet reproduced the package, and no SUMO/microscopic run has been performed.

## Decision

The nine design questions are green for the synthetic experiment, with scope qualifications recorded. The broader engineering gate remains open for a validated performance claim until a second engineer reproduces the run, the team approves an acceptance threshold before a fresh confirmatory run, and a more realistic simulation validates the mechanism. No claim of real Dubai/RTA performance is supported.
