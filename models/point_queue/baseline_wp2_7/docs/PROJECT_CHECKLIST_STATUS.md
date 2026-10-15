# DIGITAL MARSHAL — Master Checklist Status (WP2.7, 2026-10-15)

Legend: **[x] green = evidenced in this synthetic model** · **[~] partial / external validation still required** · **[ ] open**

## A. Nine scenario-validity questions

- [x] **1. Is the critical link connected to both alternative routes before the incident?** Graph tests verify shared approach P and route connectivity. Synthetic graph only.
- [x] **2. Can every affected vehicle reach its destination after the closure?** Routes A/B remain available after E2/E3 close; all 15 policy/scenario runs complete every trip and record zero closed-link entries.
- [x] **3. Is the shorter route genuinely faster under free-flow conditions?** Assumed route totals are critical=7, A=9, B=11 minutes. Arithmetic verified; not measured Dubai travel time.
- [x] **4. Is the shorter route sufficiently constrained that concentrating demand can increase its travel time?** A has 4 veh/min unique-edge bottleneck vs B's 8 veh/min. Model shows delay under higher demand and capacity sensitivity.
- [x] **5. Does independent rerouting actually create measurable detour concentration?** The 30-second independent baseline is implemented. It chooses using a common pre-batch snapshot and cannot reserve capacity for simultaneous peers. At 24 vehicles it assigns 18 A/6 B (75% A); at 60 stress vehicles it assigns 30/30 overall but still sends every vehicle in each 30-second decision batch to one route (max batch dominant-route share 100%). Coordinated allocation reduces max batch concentration to 66.7% in the 60-vehicle stress case. This demonstrates the *synthetic herding mechanism*, not actual driver behavior.
- [x] **6. Is the comparison against traffic-aware independent rerouting still informative?** Yes as a reproducible controlled comparison: same graph, capacities, closure, departure/P-arrival schedule, decision epochs and no future realized exits. The difference is individual same-snapshot choice vs joint allocation of the same current batch. Coordinated total travel time is 1.70% lower in the 24-vehicle near-capacity scenario and 2.55% lower in the 60-vehicle stress scenario; both are below the discussion-only 5% target. Thus the comparison is informative, but a ≥5% benefit is NOT established.
- [x] **7. Are all policies receiving equivalent information?** Information contract is now explicit and logged: same synthetic graph, free-flow times, nominal capacities, incident state, scheduled demand and prior committed routes; no future realized exits. The coordinator's extra capability is joint assignment within the current batch, not privileged input data. This is model-level parity, not real deployment data parity.
- [x] **8. Are the outcome metrics defined before we run the experiment?** Frozen in `results/metric_spec.json` before this run: primary total fleet travel time; mean, median, nearest-rank P95; completion/incomplete; route counts/shares; maximum dominant-route share per 30-second batch; route switches; time to first feasible decision; closed-link entries; FIFO events/violations. Route switches are zero by design because route locks at P; mid-branch rerouting is explicitly outside this experiment. The 5% threshold remains a proposal, not approved and not met.
- [x] **9. Can another engineer reproduce the scenario from the specification alone?** Source, frozen policy contract, graph/model, scenario config, test suite, decision/batch logs, vehicle and edge records, paired metrics, manifest and run instructions are included.

## B. WP2.7 execution checklist

- [x] Implement a 30-second periodic independent policy with deterministic epoch anchoring and route tie-break.
- [x] Implement an information-matched coordinated batch policy; exhaustive split search within the current batch.
- [x] Prevent look-ahead: evaluation simulates only previously committed and current-batch vehicles; no future realized edge exits are used.
- [x] Freeze metric definitions before running policy comparisons.
- [x] Run five predeclared scenarios across static, independent and coordinated policies (15 runs).
- [x] All departures precede t=120s; all P arrivals are at/after t=180s.
- [x] Recompute FIFO recurrence for raw edge events; 0 violations across all runs.
- [x] All trips complete, zero closed-link entries, all 15 invariant audits pass.
- [x] Run automated regression tests: 6/6 passed.
- [x] Save per-vehicle, per-edge, per-decision, per-batch, paired metrics and SHA-256 manifest.
- [ ] Team approval of practical success threshold. Proposed ≥5% lower total travel time in near-capacity primary scenario plus zero safety/model violations and no P95 degradation; this proposal is not approved and the current near-capacity improvement is only 1.70%.
- [ ] Independent code review and reproduction by a second engineer.
- [ ] Validate route-choice model with a more realistic simulation (e.g. SUMO) and calibrated/credible network parameters; no microscopic simulation or real Dubai data used here.

## Gate decision

**Synthetic mechanism and controlled comparison: PASS. Real-world/competition performance claim: NOT YET VALIDATED.** Questions 5, 6 and 8 are green because the policy is now implemented, the comparison is explicit and reproducible, and metrics are frozen. Green does not mean the proposed 5% success target passed: it did not. Near-capacity gain is 1.70%; stress-case gain is 2.55%. The next bottleneck is not missing metrics or an absent baseline; it is limited effect size under this point-queue model and external validity of the synthetic assumptions.
