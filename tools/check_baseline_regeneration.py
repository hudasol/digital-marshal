#!/usr/bin/env python3
"""Regeneration check for the preserved WP2.7 baseline (NOT a confirmatory run).
Runs the preserved pipeline into a temporary folder and compares the seven output files with the historical ones by SHA 256.
The historical results folder is never written. Exit 0 when all seven match, 1 otherwise."""
import hashlib, os, subprocess, sys, tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / 'models/point_queue/baseline_wp2_7'
FILES = ['confirmatory_metrics.csv', 'decision_log.csv', 'batch_allocation_log.csv', 'vehicle_records.csv',
         'edge_event_records.csv', 'metric_spec.json', 'invariant_audit.json']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

with tempfile.TemporaryDirectory() as d:
    r = subprocess.run([sys.executable, 'src/confirmatory.py', '--out', d], cwd=BASE, capture_output=True, text=True,
                       env=dict(os.environ, PYTHONPATH=str(BASE / 'src'), PYTHONDONTWRITEBYTECODE='1'))
    if r.returncode: print(r.stderr[-800:]); sys.exit(1)
    bad = [f for f in FILES if sha(Path(d) / f) != sha(BASE / 'results' / f)]
for f in FILES: print(('MISMATCH ' if f in bad else 'MATCH    ') + f)
sys.exit(1 if bad else 0)
