# ADR-0003: Exploratory policies stay separate from the frozen policies

Status: applied.

Decision. The frozen policy names `static`, `independent_periodic` and `coordinated_batch` and their historical results are unchanged. Two new policies, `independent_each_vehicle` and `peer_aware_sequential`, live in `src/exploratory.py`, write only to an exploratory output folder, refuse to write to `results/`, and label every row `EXPLORATORY`. They never replace a historical baseline.

Reason. The frozen independent policy lets the first vehicle of a batch probe the costs and the whole batch copies its choice, so herding is built in. `peer_aware_sequential` shows how much of the coordinated gain comes from vehicles seeing their peers' commitments. This is screening information only.
