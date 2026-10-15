# Decisions that belong to the project owner

Status of every item below: OPEN. Nothing here has been decided, approved or signed off by anyone. An AI assistant listed these and must not close them. Record a decision by editing this file with the name of the decider and the date.

| ID | Decision | Why it is open | Options | Engineering impact |
|---|---|---|---|---|
| D1 | Simulation horizon (7200 s provisional) | WP2.7 documents say 7200 s, the baseline code used 3600 s, the SUMO runner uses 3600 s | Confirm 7200 s; choose another value; set SUMO to match or document the difference | None on current results (all runs end by about 1425 s). Affects future scenarios and the completion gate. See ADR-0001 addendum |
| D2 | Frozen independent comparator semantics | Frozen `independent_periodic` lets the first vehicle of a batch probe and the whole batch copy it. `independent_each_vehicle` is an exploratory per vehicle reading | Keep batch copy; switch to per vehicle; report both | Identical at the frozen timing, different on shifted grids. Exploratory results do not replace the frozen comparator |
| D3 | Epoch phase | 30 s epochs anchored at 180 s (first P arrival) | Freeze at 180 s; choose another phase; report a sweep | Corrected sweep range for near capacity is 0.73% to 1.74% (frozen 1.70%). The audit now also encodes the 30 s epoch and 180 s anchor in `graph_spec.json`, so changing D3 means changing that file |
| D4 | Scenario matrix and identifiers | The FAIR spec text names two scenarios differently from the WP2.7 outputs; SUMO lacks half and double capacity scenarios and a closure and stale information scenario | Freeze the five scenarios as is; rename; extend | Changes the audit specification and the SUMO matrix |
| D5 | Acceptance criterion (provisional 5% in near capacity) | The 5% target is a candidate, not approved. Current result is 1.70% | Approve; change; replace by an interval criterion | Decides what counts as pass or fail of the confirmatory pass. Exploratory results cannot decide it |
| D6 | Licence | None chosen. Without a licence default copyright applies and general reuse is not permitted | Owner chooses | Documentation only |
| D7 | Independent human review | Not performed. See `docs/review/reviewer-checklist.md` | Name a reviewer and scope | Gate F |
| D8 | Protocol freeze and authorisation of any confirmatory run | Not frozen; no confirmatory run has been executed or authorised | Freeze after D1 to D5 and D7 | Gate G |
