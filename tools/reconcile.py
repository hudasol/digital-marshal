#!/usr/bin/env python3
"""Generate the numeric tables of docs/CROSS_MODEL_RECONCILIATION.md from result files (standard library only).

usage: python tools/reconcile.py            print the tables
       python tools/reconcile.py --check    exit 1 if the document is out of date
Point queue source: models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv (frozen WP2.7 numbers)
SUMO source: results/historical/sumo_phase1/sumo_results.csv and sumo_results_paired.csv (historical, exploratory)"""
import csv, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PQ = ROOT / 'models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv'
SU = ROOT / 'results/historical/sumo_phase1/sumo_results.csv'
SP = ROOT / 'results/historical/sumo_phase1/sumo_results_paired.csv'
DOC = ROOT / 'docs/CROSS_MODEL_RECONCILIATION.md'
BEGIN, END = '<!-- BEGIN GENERATED -->', '<!-- END GENERATED -->'
K = 7.5          # SUMO vehicles per abstract vehicle (simulation/sumo/scripts/dm_run.py)
SCEN = ('manageable_primary', 'near_branch_capacity', 'overload_stress')


def rd(p): return list(csv.DictReader(p.open()))


def tables():
    pq = {(r['scenario'], r['policy']): float(r['total_fleet_travel_time_vehicle_min']) for r in rd(PQ)}
    su = {(r['scenario'], r['policy']): float(r['mean_total_vehicle_min']) for r in rd(SU)}
    paired = {(r['scenario'], r['baseline']): r for r in rd(SP)}
    out = ['### Total fleet travel time, vehicle minutes', '',
           '| Scenario | Policy | Point queue (abstract vehicles) | SUMO mean (SUMO vehicles) | SUMO divided by 7.5 |', '|---|---|---:|---:|---:|']
    for s in SCEN:
        for p in ('static', 'independent_periodic', 'coordinated_batch'):
            out.append(f'| {s} | {p} | {pq[s, p]:.2f} | {su[s, p]:.1f} | {su[s, p] / K:.1f} |')
    out += ['', '### Coordinated improvement over independent periodic, percent', '',
            '| Scenario | Point queue (deterministic) | SUMO mean | SUMO 95% bootstrap interval | Seeds coordinated better |', '|---|---:|---:|---|---:|']
    for s in SCEN:
        i, c = pq[s, 'independent_periodic'], pq[s, 'coordinated_batch']
        r = paired[s, 'independent_periodic']
        out.append(f"| {s} | {100 * (i - c) / i:.2f} | {float(r['mean_improvement_pct']):.2f} | [{r['ci_lo']}, {r['ci_hi']}] | {r['seeds_coord_better']} of {r['n']} |")
    out += ['', '### Coordinated improvement over static Route A, percent', '',
            '| Scenario | Point queue | SUMO mean |', '|---|---:|---:|']
    for s in SCEN:
        b, c = pq[s, 'static'], pq[s, 'coordinated_batch']
        out.append(f"| {s} | {100 * (b - c) / b:.2f} | {float(paired[s, 'static']['mean_improvement_pct']):.2f} |")
    return '\n'.join(out)


if __name__ == '__main__':
    t = tables()
    if '--check' in sys.argv:
        d = DOC.read_text()
        got = d.split(BEGIN)[1].split(END)[0].strip() if BEGIN in d and END in d else None
        sys.exit(0 if got == t.strip() else 1)
    print(t)
