#!/usr/bin/env python3
"""One command test run: python tools/run_tests.py   (standard library only; no SUMO needed)
Runs the baseline suite, the WP2.9 suite, the SUMO smoke audit tests and the repository level tests, each in its own process."""
import os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUITES = [('baseline WP2.7', ROOT / 'models/point_queue/baseline_wp2_7', 'tests', 'src'),
          ('WP2.9 development', ROOT / 'models/point_queue/wp2_9', 'tests', 'src'),
          ('SUMO smoke audit', ROOT / 'simulation/sumo', 'tests', 'scripts'),
          ('repository', ROOT, 'tests', 'tools')]
failed = []
for name, cwd, tests, pypath in SUITES:
    env = dict(os.environ, PYTHONPATH=str(cwd / pypath), PYTHONDONTWRITEBYTECODE='1')
    r = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', tests], cwd=cwd, env=env, capture_output=True, text=True)
    last = (r.stderr.strip().splitlines() or ['?'])[-1]
    print(f'{name:22s} exit={r.returncode} {last}')
    if r.returncode: failed.append(name); print(r.stderr[-1500:])
sys.exit(1 if failed else 0)
