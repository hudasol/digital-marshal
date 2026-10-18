#!/usr/bin/env python3
"""Measure the discharge rate at the P diverge for route A (1 lane) and route B (2 lanes) under saturation,
and check free-flow P->D times against the point-queue values (A 360 s, B 480 s).
Base network (scale 1.0): the historical network/calibration.json; Track C never rewrites it.
Track C variants: --branch-scale 0.5 (with --branch-tau) or 2.0 measure the variant and report the REALISED scale as the
ratio of measured discharge rates to the base calibration. --write stores the result in the variant's calibration file.
usage: calibrate.py OUTDIR [--branch-scale S] [--branch-tau T] [--seeds 1 2 3] [--write]
"""
import argparse, csv, json, statistics, sys
from pathlib import Path
import dm_run


def measure(out, scale, tau, seeds):
    res, free = {}, {}
    for pol, key in (('static', 'A'), ('allB', 'B')):
        rates, ff = [], []
        for seed in seeds:
            d = out / f'sat_{key}_{seed}'
            calib = {'mu_A': .5, 'mu_B': 1.0, 'branch_tau': tau}     # mu is unused by static / allB
            dm_run.run('overload_stress', pol, seed, d, calib, branch_scale=scale)
            cr = json.load(open(d / 'crossings.json'))
            ts = sorted(v[0] for v in cr.values())
            # saturated window: middle 60% of crossings (queue is standing there)
            a, b = int(len(ts) * .2), int(len(ts) * .8)
            rates.append((b - a) / (ts[b] - ts[a]))
            arr = {r['vehicle']: float(r['arrival_s']) for r in csv.DictReader((d / 'vehicles.csv').open()) if r['arrival_s']}
            ff.append(min(arr[v] - cr[v][0] for v in cr if v in arr))   # fastest P->D trip observed
        res[f'mu_{key}'] = statistics.mean(rates); res[f'mu_{key}_runs'] = rates
        free[key] = min(ff)
    return res, free


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out'); ap.add_argument('--branch-scale', type=float, default=1.0)
    ap.add_argument('--branch-tau', type=float, default=None); ap.add_argument('--seeds', type=int, nargs='+', default=[1, 2, 3])
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    var = dm_run.variant(a.branch_scale)
    if var['branch_tau'] and a.branch_tau is None: sys.exit('--branch-tau is required for this branch scale')
    if a.branch_scale == 1.0 and a.write: sys.exit('refusing to rewrite the historical base calibration.json')
    res, free = measure(out, a.branch_scale, a.branch_tau, a.seeds)
    base = json.loads((dm_run.NETWORK_DIR / 'calibration.json').read_text())
    res.update(branch_capacity_scale=a.branch_scale, branch_tau=a.branch_tau, seeds=a.seeds,
               network=str(Path(var['net']).relative_to(dm_run.HERE.parent)), network_sha256=dm_run.sha256(var['net']),
               realised_scale_A=res['mu_A'] / base['mu_A'], realised_scale_B=res['mu_B'] / base['mu_B'],
               fastest_P_to_D_s=free, point_queue_free_P_to_D_s=dm_run.FREE_P_TO_D,
               note='mu in veh/s measured at the P diverge under a standing queue (overload demand, middle 60% of '
                    'crossings). realised_scale = mu / base calibration.json mu. fastest_P_to_D_s = fastest observed '
                    'P crossing to arrival, a free-flow check.')
    (out / 'calibration_result.json').write_text(json.dumps(res, indent=2))
    if a.write: var['calib'].write_text(json.dumps(res, indent=2) + '\n', newline='\n')
    print(json.dumps(res, indent=2))


if __name__ == '__main__':
    main()
