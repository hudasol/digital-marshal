#!/usr/bin/env python3
"""Run the SUMO scenario x policy x seed matrix (exploratory cross-check, NOT the frozen confirmatory run).
Seeds are fixed here before any result is viewed: primary scenario 1..20, others 1..10. Matched seeds: every policy sees the
same departure jitter and the same per-vehicle speed factors (SUMO --seed); car-following noise diverges as states diverge.
usage: run_matrix.py OUTDIR
"""
import json, subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import dm_run

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
PLAN = {'near_branch_capacity': range(1, 21), 'manageable_primary': range(1, 11), 'overload_stress': range(1, 11)}
jobs = [(sc, pol, s) for sc, seeds in PLAN.items() for s in seeds for pol in dm_run.POLICIES]

def go(job):
    sc, pol, s = job
    d = out / f'{sc}__{pol}__{s}'
    if (d / 'summary.json').exists(): return job, 'cached'
    r = subprocess.run([sys.executable, str(Path(__file__).parent / 'dm_run.py'), '--scenario', sc, '--policy', pol,
                        '--seed', str(s), '--out', str(d)], capture_output=True, text=True)
    return job, ('ok' if r.returncode == 0 else 'FAIL ' + r.stderr[-300:])

with ThreadPoolExecutor(2) as ex:
    for i, (job, st) in enumerate(ex.map(go, jobs), 1):
        print(i, len(jobs), job, st, flush=True)
print('DONE', flush=True)
