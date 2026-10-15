#!/usr/bin/env python3
"""Measure the discharge rate at the P diverge for route A (1 lane) and route B (2 lanes) under saturation,
and check free-flow P->D times against the point-queue values (A 360 s, B 480 s) with a single unimpeded vehicle.
Writes calibration.json. Run once; the controller reads it.
usage: calibrate.py OUTDIR
"""
import json, sys, statistics
from pathlib import Path
import dm_run

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
res = {}
for pol, key in (('static', 'A'), ('allB', 'B')):
    all_rates = []
    for seed in (1, 2, 3):
        d = out / f'sat_{key}_{seed}'
        s = dm_run.run('overload_stress', pol, seed, d, {'mu_A': .5, 'mu_B': 1.0})
        cr = json.load(open(d / 'crossings.json'))
        ts = sorted(v[0] for v in cr.values())
        # saturated window: middle 60% of crossings (queue is standing there)
        a, b = int(len(ts) * .2), int(len(ts) * .8)
        all_rates.append((b - a) / (ts[b] - ts[a]))
    res[f'mu_{key}'] = statistics.mean(all_rates); res[f'mu_{key}_runs'] = all_rates
res['unit_veh_h_per_abstract_vpm_implied_A'] = res['mu_A'] * 3600 / 4
res['unit_veh_h_per_abstract_vpm_implied_B'] = res['mu_B'] * 3600 / 8
res['note'] = 'mu in veh/s measured at the P diverge under a standing queue (overload demand, 3 seeds, middle 60% of crossings)'
(Path(__file__).resolve().parent.parent / 'network' / 'calibration.json').write_text(json.dumps(res, indent=2))
print(json.dumps(res, indent=2))
