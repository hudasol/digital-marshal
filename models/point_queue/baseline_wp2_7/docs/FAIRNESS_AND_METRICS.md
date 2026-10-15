# WP2.7 — Frozen policy contract and metrics

## Decision and information parity
All policies use the same synthetic directed graph, free-flow times, nominal capacities, closure state at t=120 s, the same scheduled vehicle list and the same E1-derived P-arrival schedule. No policy receives future realized edge exits. Decisions are grouped into 30-second epochs anchored at the first possible P arrival (t=180 s). All vehicles in a batch are upstream of P until their assigned route begins; route is locked at P, so no teleporting or mid-branch switching occurs.

- **Static:** route A for every affected vehicle.
- **Independent periodic:** at each epoch, each vehicle independently chooses the route with lower estimated arrival time against the *previously committed* cohort only. Vehicles in the same epoch share the same pre-batch snapshot and do not reserve capacity for simultaneous peers. This models the herd/concentration mechanism; it is a deliberately specified independent-policy baseline, not a claim about any commercial navigation system.
- **Coordinated batch:** sees the same public graph, capacities, incident, schedule, and current epoch cohort. It jointly evaluates all A/B splits for that current batch against the already committed cohort, then commits the best split. It does not use future realized exits; the shared departure schedule is known to both. This isolates joint allocation vs independent simultaneous choices in this synthetic setup.

The difference between independent and coordinated is **decision coupling**, not privileged data. Both know the common scheduled demand and the same network/incident state; only the coordinator can jointly assign peers in the current batch.

## Frozen metrics
Primary: total fleet travel time in vehicle-minutes, summing every vehicle from scheduled departure to destination arrival. All runs finish within the 7,200-second horizon; no censoring or exclusion.

Secondary: mean, median, nearest-rank P95 (sorted times, 1-based index ceil(0.95*n)); completed/incomplete; route A/B counts and shares; maximum dominant-route share in any 30-second batch; total route switches; time from incident activation to first feasible decision; closed-link entries; FIFO event count and violations. Route switches are zero by design because assignment locks at P; mid-branch rerouting is outside this experiment.

## Predeclared acceptance proposal
Discussion proposal only, not approved by the team: at least 5% lower total fleet travel time than independent periodic rerouting in the near-capacity primary scenario, zero closed-link entries, zero FIFO violations, all trips accounted for, and no P95 degradation. Do not call the threshold passed until the team approves it. All five scenarios and all three policies are reported to avoid cherry-picking.

## Limits
The model is deterministic, synthetic, point-queue, infinite-storage and has no spillback, signal timing, lanes, car-following, stochastic route-choice or calibration to Dubai traffic. Results establish an internally testable mechanism only.
