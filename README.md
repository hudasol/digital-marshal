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
| `docs` | Architecture, acceptance criteria, decisions, reconciliation, incomplete items |

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

## Web viewers

Static pages, no build step. Open `web/index.html` (2D control room) or `web/3d.html` (3D corridor view) from a file, or serve the folder with `python -m http.server -d web`.

The 3D view replays the same frozen point queue output on three corridors side by side (static, independent periodic, coordinated). Drag to orbit, scroll to zoom, click a vehicle to follow it, press space to play. The guided tour captions are generated from the run data, and the incident time control recomputes all three policies with `web/engine.js`, the JavaScript port checked against the frozen results. Models are drawn in code, so there are no external assets other than the supplied logo. The viewer is keyboard operable (Tab, arrow keys to orbit, plus and minus to zoom) and labelled for screen readers.

`python tools/check_vendor.py` verifies the vendored three.js build against `web/vendor/CHECKSUMS.txt`. `python tools/build_artifact_3d.py OUT.html` writes a single file copy of the 3D viewer for hosts that accept only one page; the repository itself stays modular.

Third party and assets: `web/vendor/three.min.js` is three.js r149 under the MIT licence (`web/vendor/three.LICENSE.txt`). `web/assets/rta-logo.png` is the logo file supplied by the team, shown for context only and never altered. This remains a student prototype and not an RTA system.

## Results so far

Numbers are in `docs/CROSS_MODEL_RECONCILIATION.md`, generated from result files. In short, the coordinated advantage over independent periodic is small in both models and below the provisional target, and much of it comes from vehicles seeing their peers' commitments.

## Limits

See `docs/INCOMPLETE_ITEMS.md`. Not claimed: calibration, real world validity, statistical significance for the deterministic model, or any endorsement.
