# Model assumptions of the preserved baseline

Taken from `models/point_queue/baseline_wp2_7` source and `docs/FAIRNESS_AND_METRICS.md`. Nothing here is validated against real traffic.

* **Deterministic point queue.** Each edge is a FIFO server: exit time = max(arrival + free flow time, previous exit + 60 / capacity per minute). No randomness.
* **Infinite storage, no spillback.** Queues never block upstream edges.
* **No microscopic behaviour.** No car following, lanes, or signal dynamics.
* **Synthetic network.** Nodes O, P, C, A1, A2, B1, B2, B3, M, D and edges E1 to E11. E1 is 3 minutes at 30 vehicles per minute. Route A is E1, E4, E5, E6, E11 (capacity 4 on E4 to E6). Route B is E1, E7, E8, E9, E10, E11 (capacity 8 on E7 to E10). E11 has capacity 20. The critical route through E2 and E3 is closed from 120 s. The first vehicle reaches P at 180 s. The capacity scenarios scale E4 to E10 only.
* **Route locking.** A vehicle chooses at P and cannot change route afterwards, so route switches are zero by design.
* **Decision epochs.** 30 s epochs; the first is anchored at 180 s; policies see committed vehicles only and no future exits.
* **Scenarios.** manageable_primary (10 vehicles every 10 s), near_branch_capacity (24 every 5 s), overload_stress (60 every 2 s), primary_half_capacity (capacity scale 0.5), primary_double_capacity (scale 2.0).
* **Policies as implemented.** `static`: all vehicles on Route A. `independent_periodic`: for each 30 s batch, the first vehicle estimates its arrival at D on each route against previously committed vehicles, and the whole batch takes that choice (ties go to A). `coordinated_batch`: for each batch, searches the number of vehicles sent to Route A, spread evenly through the batch, and picks the lowest total travel time for committed plus current batch vehicles (ties go to the larger A count). Source: `src/confirmatory.py` `assign_policy`.
* **Metrics.** Total fleet vehicle minutes (primary), mean, median, nearest rank P95 (index ceil(0.95 n)), completion, route counts. Definitions are frozen in `results/metric_spec.json`.
* **Model level experiment, not field deployment.**
