# DIGITAL MARSHAL — WP2.8 Phase 1
## Performance Acceptance Threshold Decision Record

**Document ID:** DM-WP2.8-P1-ADR-001  
**Version:** 1.0  
**Prepared:** 15 October 2026  
**Status:** Engineering recommendation adopted as the project's working decision; external/team approval not claimed  
**Scope:** Student-built synthetic prototype; not an RTA document, endorsement, or operational requirement.

---

## 1. Decision

**Retain a minimum 5% reduction in total fleet travel time as the candidate acceptance target. Do not lower it to fit the observed results. The threshold remains provisional until the engineering evidence and protocol conditions in this record are satisfied.**

For project planning, use the following working specification:

- **Primary endpoint:** total fleet travel time, in vehicle-minutes.
- **Primary scenario:** near-capacity demand.
- **Comparator:** independent periodic rerouting.
- **Treatment:** coordinated batch allocation.
- **Candidate minimum effect:** at least 5% reduction in total fleet travel time.
- **Performance guardrail:** P95 travel time must not degrade relative to the comparator.
- **Hard model-level gates:** zero closed-link entries; zero FIFO violations; all required trips completed within the declared horizon; every route is feasible and respects modeled closures and legal transitions.
- **Overall status:** provisional working decision, not an externally approved requirement and not evidence of real-world readiness.

The project owner is proceeding without requesting a new teammate decision. This document therefore records the project's current engineering recommendation and does not fabricate team signatures or imply consensus.

## 2. Evidence considered

The following are the previously reported WP2.7 deterministic synthetic-model outputs. They are preserved as supplied; they are not field measurements.

| Scenario | Independent travel time (vehicle-min) | Coordinated travel time (vehicle-min) | Reported improvement |
|---|---:|---:|---:|
| Manageable demand | 93.750 | 93.750 | 0.00% |
| Near-capacity demand | 254.275 | 249.950 | 1.70% |
| Overload stress test | 719.875 | 701.492 | 2.55% |
| Half branch capacity | 104.050 | 102.800 | 1.20% |
| Double branch capacity | 90.000 | 90.000 | 0.00% |

Improvement is calculated as:

`100 × (independent fleet travel time − coordinated fleet travel time) / independent fleet travel time`

None of the listed scenarios met the proposed 5% target. This does not justify reducing the threshold after observing the outcomes. It means the current prototype has not demonstrated the proposed effect size.

## 3. Rationale

### Why retain 5% as the candidate?

1. It is the pre-existing proposed target and is clear enough to test.
2. Keeping it avoids post-hoc target adjustment to fit observed results.
3. The current results do not establish what minimum benefit is practically worthwhile in a real deployment context.
4. Selecting a smaller numerical target now would lack an independent rationale and risk confusing “observed effect” with “acceptable effect.”

### What this decision does not mean

- It does not mean that 5% is an empirically proven transport-industry standard.
- It does not mean that a 5% reduction has been achieved.
- It does not establish statistical significance; the existing experiment is deterministic.
- It does not establish real-world safety, operational readiness, or performance on Dubai roads.
- It does not claim RTA endorsement or approval.

## 4. Acceptance criteria matrix

| Criterion | Working rule | Classification | Current validation boundary |
|---|---|---|---|
| Primary performance | At least 5% lower total fleet travel time in the predeclared near-capacity scenario versus independent periodic rerouting | Provisional performance target | Not met in current WP2.7 result; requires fresh confirmatory run |
| Primary endpoint | Sum of each required vehicle's arrival time minus departure time, reported in vehicle-minutes | Metric definition | Recompute from vehicle-level records |
| Closed-link entries | Exactly zero | Hard model-level gate | Previously reported as zero; must be checked again |
| FIFO violations | Exactly zero | Hard implementation gate | Previously reported as zero; must be checked again |
| Trip completion | 100% of required trips complete within the frozen horizon | Hard model-level gate | Previously reported complete; must be checked again |
| Route feasibility | Every assigned route reaches its destination and respects modeled closure and legal-transition constraints | Hard model-level gate | Must be tested and logged |
| P95 travel time | Coordinated policy P95 must be no greater than baseline P95 | Provisional performance guardrail | Must be computed using the same population, horizon, and nearest-rank definition |
| Reproducibility | Frozen package, configuration, outputs, tests, and hashes are available for audit | Verification gate | Independent reproduction remains outstanding |
| Real-world safety | No pass claim based solely on this model | Unvalidated requirement | Requires more realistic simulation and separate safety assurance |

### Improvement formula

Let `T_ind` be total fleet travel time under independent periodic rerouting and `T_coord` be total fleet travel time under coordinated batch allocation.

`Improvement (%) = 100 × (T_ind − T_coord) / T_ind`

Positive values favour coordination, zero indicates no reduction, and negative values indicate a regression.

### P95 definition

Retain the existing nearest-rank definition:

`P95 = x_(ceil(0.95 × N))`

where `x_(k)` is the k-th sorted trip travel time and `N` is the number of included trips. The protocol must define the trip population and horizon consistently for both policies. Incomplete trips must not be silently omitted or assigned favourable travel times.

## 5. Overall decision rules

**PASS** only if all mandatory model-level gates pass, the primary scenario demonstrates at least 5% reduction, P95 does not degrade, and all frozen protocol/reproducibility requirements are met.

**FAIL** if any mandatory gate is violated, or the confirmatory result fails the frozen performance rule under the approved evaluation method.

**INCONCLUSIVE** if the run is invalid, required outputs are missing, reproducibility cannot be established, or—if stochastic evaluation is introduced—the predeclared uncertainty criterion does not support a pass or fail conclusion.

A travel-time improvement cannot compensate for a closed-link entry, FIFO violation, incomplete required trip, or infeasible route.

## 6. Evidence and uncertainty

The current deterministic model can establish repeatable outputs for its specified rules and test whether those rules are implemented consistently. It cannot estimate real-traffic variability, demonstrate statistical significance, or validate behavior under microscopic interactions, signal dynamics, or spillback.

Before the fresh confirmatory run:

1. Complete independent reproduction of the existing package.
2. Cross-check the mechanism in SUMO or a comparable microscopic simulator, with assumptions and parameter provenance documented.
3. Freeze the exact confirmatory scenario matrix, code/configuration versions, metric rules, horizon, and output requirements.
4. If stochastic simulation is used, predeclare matched seeds, run count or stopping rule, uncertainty method, and handling of failed runs before viewing results.
5. Do not change the 5% candidate threshold after seeing confirmatory outcomes.

For stochastic evaluation, use paired comparisons where meaningful. If the estimated effect reaches 5% but the predeclared uncertainty rule is not satisfied, classify the result as INCONCLUSIVE rather than passing it by point estimate alone. Re-running an identical deterministic scenario is a reproducibility check, not independent statistical evidence.

## 7. Pre-confirmatory freeze checklist

- [ ] Threshold and rationale frozen in a versioned protocol.
- [ ] Near-capacity scenario confirmed as the primary scenario.
- [ ] Secondary and stress scenarios enumerated in advance.
- [ ] Independent periodic rerouting fixed as the comparator.
- [ ] Policy source versions and parameters frozen.
- [ ] Information parity and decision timing frozen.
- [ ] Total fleet travel time and P95 definitions frozen.
- [ ] Horizon, trip inclusion, and incomplete-trip handling frozen.
- [ ] Hard gates and PASS/FAIL/INCONCLUSIVE rules frozen.
- [ ] Seed/run-count/uncertainty method frozen if stochastic runs are used.
- [ ] Raw logs, metrics, invariant reports, and SHA-256 manifest required.
- [ ] Independent reviewer and run authorization recorded.
- [ ] Protocol archived before confirmatory outputs are generated.

## 8. Risks and limitations

- Synthetic topology and capacities are not calibrated Dubai measurements.
- The point-queue model has infinite storage and does not model spillback, microscopic car-following, or traffic-signal dynamics.
- Routes are locked at P; stateful en-route rerouting is not covered.
- The current performance gains are modest and below the 5% candidate target.
- Independent second-engineer reproduction is not yet evidenced.
- Passing model invariants is not real-world safety certification.
- No RTA endorsement, operational deployment readiness, or Dubai-specific benefit is claimed.

## 9. Approval / status record

**Decision owner:** DIGITAL MARSHAL project engineering lead (working decision recorded by the project author)  
**Technical reviewer:** Pending independent review  
**Decision date:** 15 October 2026  
**Document version:** 1.0  
**Working decision:** Retain ≥5% as candidate target; do not lower it to fit existing results; block fresh confirmatory run until protocol is frozen and required verification prerequisites are completed.  
**External/team approval:** Not claimed.  
**Dissenting views:** None recorded; no team consultation is represented by this document.

### Final recommendation

Retain the proposed ≥5% reduction as the candidate target and use it for planning. Do not describe it as a team-approved or externally validated requirement. Before the fresh confirmatory experiment, complete independent reproduction, conduct the planned microscopic-simulator cross-check, and freeze the full protocol. This preserves experimental integrity without pretending that the current results meet the target.
