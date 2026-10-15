#!/usr/bin/env python3
"""Aggregate the SUMO matrix: per-scenario policy means, paired improvements (same seed) with bootstrap 95% CI, audit roll-up.
Improvement % = 100*(T_baseline - T_coord)/T_baseline per seed (positive favours coordination), as in the project's ADR.
usage: aggregate.py MATRIX_DIR OUT_CSV
"""
import csv, json, random, statistics, sys
from collections import defaultdict
from pathlib import Path

mx = Path(sys.argv[1]); R = defaultdict(dict); audits = defaultdict(lambda: defaultdict(int))
for f in sorted(mx.glob('*/summary.json')):
    s = json.load(open(f)); R[(s['scenario'], s['policy'])][s['seed']] = s
    a = audits[(s['scenario'], s['policy'])]
    a['runs'] += 1; a['fail'] += (not s['checks_pass']); a['closed'] += s['closed_link_entries']
    a['illegal'] += s['illegal_transitions']; a['incomplete'] += s['incomplete']; a['collisions'] += s['collisions']

def boot(xs, n=5000, seed=7):
    rng = random.Random(seed); m = [statistics.mean(rng.choices(xs, k=len(xs))) for _ in range(n)]; m.sort()
    return m[int(.025 * n)], m[int(.975 * n)]

def paired(sc, base, treat, key='total_vehicle_min'):
    seeds = sorted(set(R[(sc, base)]) & set(R[(sc, treat)]))
    imp = [100 * (R[(sc, base)][s][key] - R[(sc, treat)][s][key]) / R[(sc, base)][s][key] for s in seeds]
    return imp

rows = []
print('=== mean total fleet travel time (vehicle-min) per policy ===')
for sc in ('manageable_primary', 'near_branch_capacity', 'overload_stress'):
    line = f'{sc:24}'
    for pol in ('static', 'measured_periodic', 'independent_periodic', 'coordinated_batch'):
        xs = [r['total_vehicle_min'] for r in R[(sc, pol)].values()]
        p95 = statistics.mean(r['p95_min'] for r in R[(sc, pol)].values())
        nA = statistics.mean(r['n_A'] for r in R[(sc, pol)].values()); nB = statistics.mean(r['n_B'] for r in R[(sc, pol)].values())
        line += f'  {pol[:11]:11}={statistics.mean(xs):8.1f} (p95 {p95:5.2f}, A/B {nA:5.1f}/{nB:5.1f})'
        rows.append(dict(scenario=sc, policy=pol, n_seeds=len(xs), mean_total_vehicle_min=round(statistics.mean(xs), 3),
                         sd=round(statistics.stdev(xs), 3) if len(xs) > 1 else '', mean_p95_min=round(p95, 3), mean_A=nA, mean_B=nB))
    print(line)

print('\n=== paired improvement of coordinated_batch vs baseline, % (mean, bootstrap 95% CI, seeds where coord better) ===')
prow = []
for sc in ('manageable_primary', 'near_branch_capacity', 'overload_stress'):
    for base in ('static', 'measured_periodic', 'independent_periodic'):
        imp = paired(sc, base, 'coordinated_batch')
        lo, hi = boot(imp); wins = sum(x > 0 for x in imp)
        p95i = paired(sc, base, 'coordinated_batch', 'p95_min')
        print(f'{sc:22} vs {base:20} {statistics.mean(imp):7.2f}%  [{lo:6.2f}, {hi:6.2f}]  wins {wins}/{len(imp)}   p95 change {statistics.mean(p95i):6.2f}%')
        prow.append(dict(scenario=sc, baseline=base, n=len(imp), mean_improvement_pct=round(statistics.mean(imp), 3),
                         ci_lo=round(lo, 3), ci_hi=round(hi, 3), seeds_coord_better=wins, mean_p95_improvement_pct=round(statistics.mean(p95i), 3)))

print('\n=== audit roll-up (all computed from the SUMO trace) ===')
for k, a in sorted(audits.items()):
    print(k, dict(a))
with open(sys.argv[2], 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
with open(sys.argv[2].replace('.csv', '_paired.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(prow[0])); w.writeheader(); w.writerows(prow)
