# Digital Marshal

A student built simulation study of how autonomous vehicles could be coordinated around a road incident. Three routing policies are compared on a small synthetic network: a static baseline, independent periodic rerouting, and coordinated batch allocation.

## Status and honesty labels

* **Synthetic.** The network, demand and capacities are invented for the study. Nothing here is calibrated to Dubai infrastructure or measured traffic.
* **Exploratory.** No confirmatory experiment has been run. The protocol is not frozen. The provisional target (coordinated improves total fleet travel time by at least 5% over independent periodic in the near capacity scenario) is not approved, and no result in this repository meets it.
* **Proposal seed, not a deployment.** This work is not endorsed by, and is not affiliated with, any government body or company. It was built with AI assistance and has not yet had an independent human engineering review.

## What is in the repository

| Path | Contents |
|---|---|
| `models/point_queue/baseline_wp2_7` | The supplied WP2.7 deterministic point queue model, tests and results, unchanged |
| `models/point_queue/wp2_9` | Development module: real closure gate, one horizon contract, independent raw record audit, stronger tests, exploratory policies |
| `simulation/sumo` | Synthetic SUMO network, scenario runner, smoke test |
| `results/historical` | Earlier SUMO aggregates, kept and labelled |
| `results/manifests` | Execution records, logs and hashes |
| `docs` | Architecture, acceptance criteria, decisions (including `docs/decisions/OWNER_DECISIONS.md`), review documents, reconciliation, incomplete items |

The WP2.7 baseline is immutable. WP2.9 is the development model. `independent_each_vehicle` and `peer_aware_sequential` are exploratory and do not replace the frozen `independent_periodic` comparator. `coordinated_batch` is a restricted optimiser. Historical SUMO results are earlier and uncalibrated. The Track A import and provenance pull request is open and not merged; this repository does not rely on its files.

## Run

```
python tools/run_tests.py                                 # all suites, standard library only
pip install -r environment/requirements.txt               # SUMO packages (pinned)
python simulation/sumo/scripts/smoke.py                   # SUMO smoke test with raw record audit
```

Point queue regeneration check (writes to a scratch folder, not a confirmatory run):

```
cd models/point_queue/wp2_9
PYTHONPATH=src python src/confirmatory.py --out ../../../scratch/check
python src/raw_audit.py --results ../../../scratch/check
```

## Results so far

Numbers are in `docs/CROSS_MODEL_RECONCILIATION.md`, generated from result files. In short, the coordinated advantage over independent periodic is small in both models and below the provisional target, and much of it comes from vehicles seeing their peers' commitments.

## Limits

See `docs/INCOMPLETE_ITEMS.md`. Not claimed: calibration, real world validity, statistical significance for the deterministic model, or any endorsement.
