#!/usr/bin/env python3
"""Track C SUMO smoke matrix (exploratory, NOT the frozen confirmatory run, NOT the 160 run set).
Five scenarios x three policies (static, independent_periodic, coordinated_batch) x seeds 1..3 at the historical 3600 s horizon,
a 7200 s horizon sensitivity set for every scenario (seed 1..3), and one negative control run.
usage: run_track_c.py OUTDIR
"""
import subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import dm_run

SCEN = ('manageable_primary', 'near_branch_capacity', 'overload_stress', 'primary_half_capacity', 'primary_double_capacity')
POLS = ('static', 'independent_periodic', 'coordinated_batch')
SEEDS = (1, 2, 3)
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
jobs = [(f'h3600/{sc}__{p}__{s}', sc, p, s, 3600) for sc in SCEN for s in SEEDS for p in POLS]
jobs += [(f'h7200/{sc}__{p}__{s}', sc, p, s, 7200) for sc in SCEN for s in SEEDS for p in POLS]
jobs += [('control/near_branch_capacity__no_reroute_control__1', 'near_branch_capacity', 'no_reroute_control', 1, 3600)]

def go(j):
    rel, sc, p, s, h = j; d = out / rel
    if (d / 'run_manifest.json').exists(): return rel, 'cached'
    r = subprocess.run([sys.executable, str(Path(__file__).parent / 'dm_run.py'), '--scenario', sc, '--policy', p, '--seed', str(s),
                        '--horizon', str(h), '--out', str(d)], capture_output=True, text=True)
    return rel, f'exit={r.returncode}'

with ThreadPoolExecutor(2) as ex:
    for i, (rel, st) in enumerate(ex.map(go, jobs), 1): print(i, len(jobs), rel, st, flush=True)
print('DONE', flush=True)
