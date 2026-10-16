# Reproduction guide for the preserved baseline

Requirements: Python 3.12 or newer, standard library only. The recorded run used Python 3.13.

From the repository root:

```
cd models/point_queue/baseline_wp2_7
PYTHONPATH=src python -m unittest discover -s tests -v
```

Regeneration check (writes to a scratch folder; never point `--out` at `results`, which holds the historical outputs):

```
PYTHONPATH=src python src/confirmatory.py --out ../../../scratch/regen
sha256sum ../../../scratch/regen/*.csv ../../../scratch/regen/*.json
sha256sum results/*.csv results/*.json
```

Seven files should match the historical hashes recorded for the original archive members in `docs/provenance/archive-reconciliation.csv`. The default of `--out` is `results`, so running `confirmatory.py` without an argument overwrites the historical outputs. Do not do that.

Recorded evidence from one execution is in `results/manifests/track_a/` (test log with environment, regeneration log, hash comparison). It was produced by an AI assistant in a cloud sandbox and has not been independently reproduced by a human.

All suites in the repository can be run with `python tools/run_tests.py`.

To check the original archive against the provenance records (when the archive is available):

```
python tools/verify_archive.py /path/to/Digital_Marshal_WP2_7_Fair_Comparison_Package.zip
```
