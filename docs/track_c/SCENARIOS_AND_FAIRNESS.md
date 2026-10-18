# Track C: SUMO scenarios, closure, horizon and fairness

Status: engineering groundwork and exploratory runs. Not confirmatory. Not independently reviewed. Owner decisions D1 to D6 and D8 (listed in PR #2, `docs/decisions/OWNER_DECISIONS.md` on that branch) remain pending; nothing here approves them. The SUMO network is synthetic: no Dubai calibration, no RTA data, no real world validation, no RTA endorsement.

## 1. Scenario table

The SUMO table in `simulation/sumo/scripts/dm_run.py` (`SCENARIOS`) is the WP2.7 table from `models/point_queue/wp2_9/config/graph_spec.json`: five scenarios, the same abstract vehicle counts, spacings and branch capacity scales. `tests/test_track_c_scenarios.py` fails if they drift apart. One abstract vehicle corresponds to 7.5 SUMO vehicles (existing prototype rule, 1 abstract vehicle per minute = 450 veh/h).

| Scenario | Abstract vehicles | Spacing s | Branch scale (E4..E10) | SUMO vehicles |
|---|---:|---:|---:|---:|
| manageable_primary | 10 | 10 | 1.0 | 75 |
| near_branch_capacity | 24 | 5 | 1.0 | 180 |
| overload_stress | 60 | 2 | 1.0 | 450 |
| primary_half_capacity | 10 | 10 | 0.5 | 75 |
| primary_double_capacity | 10 | 10 | 2.0 | 75 |

## 2. How capacity scaling is represented in SUMO

The point queue multiplies the service rate of E4..E10. SUMO has no service rate setting; capacity comes from lanes and car following. Two mechanisms are used, and the realised scale is **measured**, not assumed (`simulation/sumo/scripts/calibrate.py`: saturated discharge rate at the P diverge, overload demand, three seeds, middle 60% of crossings, divided by the base calibration).

* **Scale 2.0** (`network/branch_x2/`): branch lanes doubled (route A 1 to 2 lanes, route B 2 to 4). Lane doubling alone was tried first and measured a realised scale of 1.00 on route A and 1.78 on route B, because netconvert fed both route A lanes from a single E1 lane. The base network gives each outgoing lane at P its own approach lane on E1 (1 + 2 + 1 = 4 lanes); the variant applies the same rule (2 + 4 + 1 = 7 lanes) with explicit one to one connections (`dm.con.xml`). Lengths, speeds and node positions are unchanged.
* **Scale 0.5** (base network): while a vehicle is on E4..E10 its car-following headway `tau` is raised from 1.0 to a calibrated value and restored on E11. Free-flow time is unchanged (a free vehicle does not use its headway). The value 3.0 was chosen from a four point search (2.0, 2.5, 3.0, 3.5; one seed each, `results/exploratory/track_c/calibration/half_tau_search_*.json`) before any scenario was run.

| Scale | Realised route A | Realised route B | Fastest P to D, A / B (base 378 / 505 s) |
|---:|---:|---:|---|
| 2.0 | 2.039 | 2.028 | 381 / 505 s |
| 0.5 | 0.499 | 0.490 | 378 / 505 s |

Limits: these are two different mechanisms, so half and double capacity differ from the base in more than one respect (storage, lane changing on a seven lane approach). The widened E1 also changes origin insertion (more lanes). The match is within 3%, not exact. The base calibration and network are historical files and are unchanged (the generator rebuilds the committed base network identically).

## 3. The closure (incident) scenario

All five WP2.7 scenarios are closure scenarios: edges E2 and E3 (the critical route) close at 120 s and every affected vehicle must use route A or B. In SUMO the closure disallows passenger vehicles on every lane of E2 and E3 (`dm_run.apply_closure`). What is now verified, on both networks:

* before 120 s the critical route can be assigned; after the closure SUMO rejects it at assignment and accepts the detours (`SumoClosureAndApproach`, needs SUMO);
* after closure the only origin to destination paths are routes A and B (pure test on the network files);
* every run counts closed-link entries, transitions that are not network connections, and vehicles whose observed edge sequence is not a prefix of route A or B (`route_feasibility_violations`), all from the trace. Any non-zero count makes the run invalid.

**Not implemented: a "closure and stale information" scenario.** It is listed as missing in `docs/INCOMPLETE_ITEMS.md`, but no definition exists in the WP2.7 documents, the scenario table or `graph_spec.json` (what is stale, for how long, for which policy). Defining it is a scenario matrix decision (D4), so it is blocked rather than invented.

## 4. Horizon

`dm_run.py --horizon-s` sets the horizon. The default stays at the historical 3600 s so that existing commands behave as before; Track C plans refuse to run without an explicit value. Each run records its horizon and a `termination` of `all_arrived` or `horizon`; a run ending at the horizon is invalid. Unfinished trips are censored at the configured horizon (tested for 3600 and 7200 s).

Consequences: the run loop ends when every vehicle has arrived, so a run whose last arrival is before 3600 s is identical under both horizons. Only scenarios with trips longer than 3600 s are affected, and there 3600 s would mark trips incomplete that the point-queue contract counts as complete.

**Recommendation for D1 (not an approval):** use 7200 s in SUMO, the value in the WP2.7 documents and ADR-0001, so that both models censor identically. In the Track C matrix no trip arrives after 3600 s (see the generated report), so this choice does not change any current number; it removes a future source of disagreement.

## 5. Fair comparison of independent periodic and coordinated batch

Checked from `run_config.json` for every scenario and seed: all policies share the demand file (SHA-256), network (SHA-256), horizon, incident time, closed edges, decision tick and lead time, branch scale and headway, the measured discharge rates used by the shared predictor, the SUMO version and the vehicle scale. The measurement window is the same for every policy: scheduled departure to arrival (insertion delay included), censored at the horizon. The generated report gives the count of passing checks.

Semantic differences that remain, and their effect:

| Difference | Point queue (frozen) | SUMO | Effect |
|---|---|---|---|
| Independent comparator | first vehicle of a batch is scored, the batch copies it | `independent_periodic`: each vehicle scored separately on the same snapshot | Different policies with one name. Track C adds `independent_batch_copy`, the frozen rule, as a separate comparator; the original is unchanged. Which one is the comparator is D2. |
| Batching | 30 s epochs by P arrival, anchored at 180 s | ticks every 30 s from 120 s; cohort = undecided vehicles within 60 s free-flow of P | Batches contain different vehicles. Not aligned (would need D3 in SUMO terms). |
| Predictor | every edge a FIFO server with nominal capacity | only the P diverge, with measured discharge rates | Coordinated and independent share it within SUMO, so the comparison is internally fair, but the two models optimise against different predictions. |
| Randomness | deterministic | seeded departures and speed factors, matched across policies | SUMO gives intervals; the point queue gives single values. |
| Overload | no origin limit | origin insertion saturates | Overload totals mix origin queueing with route choice. |

No routing policy and no evaluation criterion was changed to obtain a result.
