#!/usr/bin/env python3
"""Measure the discharge rate at the P diverge for route A and route B under saturation, for one capacity variant.
usage: calibrate.py OUTDIR [--variant base|cap2|cap0p5] [--tau T] [--write]

Saturation demand is overload_stress run on the variant's network (3 seeds, middle 60% of crossings). Results are written to
network/calibration_<variant>.json only with --write; the historical network/calibration.json (variant base) is NEVER overwritten
by this script: for variant base the result goes to OUTDIR only. --tau overrides the driver time headway for exploration."""
import argparse, json, statistics
from pathlib import Path
import dm_run

ap = argparse.ArgumentParser(); ap.add_argument('outdir'); ap.add_argument('--variant', default='base', choices=sorted(dm_run.VARIANTS))
ap.add_argument('--tau', type=float, default=None); ap.add_argument('--write', action='store_true'); a = ap.parse_args()
out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)
if a.tau is not None: dm_run.VARIANTS[a.variant]['tau'] = a.tau
res = {'variant': a.variant, 'driver_tau_s': dm_run.VARIANTS[a.variant]['tau'], 'network_file': dm_run.VARIANTS[a.variant]['net']}
for pol, key in (('static', 'A'), ('allB', 'B')):
    all_rates = []
    for seed in (1, 2, 3):
        d = out / f'sat_{key}_{seed}'
        dm_run.run('overload_stress', pol, seed, d, {'mu_A': .5, 'mu_B': 1.0}, variant=a.variant)
        ts = sorted(v[0] for v in json.load(open(d / 'crossings.json')).values())
        lo, hi = int(len(ts) * .2), int(len(ts) * .8)                  # saturated window: middle 60% of crossings
        all_rates.append((hi - lo) / (ts[hi] - ts[lo]))
    res[f'mu_{key}'] = statistics.mean(all_rates); res[f'mu_{key}_runs'] = all_rates
base = json.load(open(dm_run.NETDIR / 'calibration.json'))
res['ratio_to_base_A'] = res['mu_A'] / base['mu_A']; res['ratio_to_base_B'] = res['mu_B'] / base['mu_B']
res['note'] = 'mu in veh/s measured at the P diverge under a standing queue (overload demand, 3 seeds, middle 60% of crossings); ratio_to_base is the achieved capacity scale'
print(json.dumps(res, indent=2))
(out / f'calibration_{a.variant}.json').write_text(json.dumps(res, indent=2))
if a.write and a.variant != 'base':
    (dm_run.NETDIR / f'calibration_{a.variant}.json').write_text(json.dumps(res, indent=2))
