# Digital Marshal WP2.7 — Periodic baseline and fair comparison

This package implements a 30-second epoch-based independent rerouter and an information-matched coordinated batch policy, freezes metric definitions, emits decision/vehicle/edge logs, and checks FIFO recurrence. It is an abstract deterministic point-queue model, not microscopic simulation or real Dubai traffic evidence.

Run from this directory:

```bash
python src/confirmatory.py --out results
python -m unittest discover -s tests -v
```

The independent policy deliberately shares a pre-batch snapshot among simultaneous agents without peer reservations; the coordinator jointly allocates the same batch. This makes the congestion-herding mechanism explicit and testable. Review `docs/FAIRNESS_AND_METRICS.md` before treating the 5% proposal as an acceptance gate.
