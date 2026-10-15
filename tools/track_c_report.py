#!/usr/bin/env python3
"""Generate the numeric tables of docs/TRACK_C_CROSS_MODEL_REPORT.md from result files (standard library only).
usage: python tools/track_c_report.py          print the tables
       python tools/track_c_report.py --check  exit 1 if the document is out of date
Point queue source: models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv (frozen WP2.7 numbers)
SUMO source: results/track_c/h3600, h7200, control (Track C smoke matrix, exploratory, seeds 1 to 3)
Improvement is always 100 * (baseline - coordinated) / baseline, baseline = independent_periodic."""
import csv, json, statistics as st, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PQ = ROOT / 'models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv'
TC = ROOT / 'results/track_c'
NET = ROOT / 'simulation/sumo/network'
DOC = ROOT / 'docs/TRACK_C_CROSS_MODEL_REPORT.md'
BEGIN, END = '<!-- BEGIN GENERATED -->', '<!-- END GENERATED -->'
K = 7.5
SEEDS = (1, 2, 3)
SCEN = ('manageable_primary', 'near_branch_capacity', 'overload_stress', 'primary_half_capacity', 'primary_double_capacity')
VARIANT = {'primary_half_capacity': 'cap0p5', 'primary_double_capacity': 'cap2'}
LABEL = {'manageable_primary': 'directly comparable (inputs); mechanism differs',
         'near_branch_capacity': 'partially comparable (comparator semantics, D2)',
         'overload_stress': 'partially comparable (comparator semantics, D2)',
         'primary_half_capacity': 'partially comparable (capacity ratio approximate)',
         'primary_double_capacity': 'not comparable on capacity (achieved ratio is not 2.0)'}


def rd(p): return list(csv.DictReader(p.open()))
def imp(b, c): return 100 * (b - c) / b
def S(h, sc, p, s): return json.loads((TC / h / f'{sc}__{p}__{s}' / 'summary.json').read_text())
def M(h, sc, p, s): return json.loads((TC / h / f'{sc}__{p}__{s}' / 'run_manifest.json').read_text())


def tables():
    pq = {(r['scenario'], r['policy']): r for r in rd(PQ)}
    cal = {'base': json.loads((NET / 'calibration.json').read_text())}
    for v in ('cap0p5', 'cap2'): cal[v] = json.loads((NET / f'calibration_{v}.json').read_text())
    o = ['### 1. Scenario identity and comparability', '',
         '| Scenario | Abstract vehicles | Spacing s | Point queue capacity scale | SUMO variant | SUMO achieved A, B ratio to base | Comparability |', '|---|---:|---:|---:|---|---|---|']
    for sc in SCEN:
        r = pq[sc, 'static']; v = VARIANT.get(sc, 'base')
        ra = '1.00, 1.00 (reference)' if v == 'base' else f"{cal[v]['ratio_to_base_A']:.2f}, {cal[v]['ratio_to_base_B']:.2f}"
        o.append(f"| {sc} | {r['vehicles']} | {float(r['departure_spacing_s']):g} | {float(r['capacity_scale_E4_E10_only']):g} | {v} | {ra} | {LABEL[sc]} |")
    o += ['', '### 2. Total fleet travel time, vehicle minutes (SUMO: mean of seeds 1 to 3, horizon 3600 s)', '',
          '| Scenario | PQ independent | PQ coordinated | SUMO independent | SUMO coordinated | SUMO independent / 7.5 | SUMO coordinated / 7.5 |', '|---|---:|---:|---:|---:|---:|---:|']
    mean = lambda h, sc, p: st.mean(S(h, sc, p, s)['total_vehicle_min'] for s in SEEDS)
    for sc in SCEN:
        a, b = mean('h3600', sc, 'independent_periodic'), mean('h3600', sc, 'coordinated_batch')
        o.append(f"| {sc} | {float(pq[sc, 'independent_periodic']['total_fleet_travel_time_vehicle_min']):.2f} | {float(pq[sc, 'coordinated_batch']['total_fleet_travel_time_vehicle_min']):.2f} | {a:.1f} | {b:.1f} | {a / K:.1f} | {b / K:.1f} |")
    o += ['', '### 3. Coordinated improvement over independent periodic, percent', '',
          '| Scenario | Point queue | SUMO seed 1 | SUMO seed 2 | SUMO seed 3 | SUMO mean | Seeds with negative improvement |', '|---|---:|---:|---:|---:|---:|---:|']
    for sc in SCEN:
        p = imp(float(pq[sc, 'independent_periodic']['total_fleet_travel_time_vehicle_min']), float(pq[sc, 'coordinated_batch']['total_fleet_travel_time_vehicle_min']))
        v = [imp(S('h3600', sc, 'independent_periodic', s)['total_vehicle_min'], S('h3600', sc, 'coordinated_batch', s)['total_vehicle_min']) for s in SEEDS]
        o.append(f"| {sc} | {p:.2f} | {v[0]:.2f} | {v[1]:.2f} | {v[2]:.2f} | {st.mean(v):.2f} | {sum(x < 0 for x in v)} of 3 |")
    o += ['', '### 4. Completion, unfinished trips and checks', '',
          '| Scenario | PQ horizon s | PQ incomplete (ind, coord) | SUMO horizon s | SUMO incomplete, all 9 runs | SUMO in network or not inserted at end | SUMO runs with checks_pass | Latest SUMO end time s | Termination |', '|---|---:|---:|---:|---:|---:|---:|---:|---|']
    for sc in SCEN:
        runs = [S('h3600', sc, p, s) for p in ('static', 'independent_periodic', 'coordinated_batch') for s in SEEDS]
        term = sorted({r['termination_reason'] for r in runs})
        o.append(f"| {sc} | 7200 | {pq[sc, 'independent_periodic']['incomplete']}, {pq[sc, 'coordinated_batch']['incomplete']} | 3600 | {sum(r['incomplete'] for r in runs)} | "
                 f"{sum(r['in_network_at_end'] + r['not_inserted_at_end'] for r in runs)} | {sum(bool(r['checks_pass']) for r in runs)} of {len(runs)} | {max(r['sim_end_s'] for r in runs):g} | {', '.join(term)} |")
    o += ['', '### 5. SUMO horizon sensitivity, 3600 s against 7200 s', '',
          '| Scenario | Largest absolute difference in any run total, vehicle minutes | Runs compared | Runs whose horizon was reached |', '|---|---:|---:|---:|']
    for sc in SCEN:
        d = 0.0; n = 0; hit = 0
        for p in ('static', 'independent_periodic', 'coordinated_batch'):
            for s in SEEDS:
                a, b = S('h3600', sc, p, s), S('h7200', sc, p, s)
                d = max(d, abs(a['total_vehicle_min'] - b['total_vehicle_min'])); n += 1
                hit += (a['termination_reason'] == 'horizon') + (b['termination_reason'] == 'horizon')
        o.append(f'| {sc} | {d:.4f} | {n} | {hit} |')
    c = S('control', 'near_branch_capacity', 'no_reroute_control', 1); cm = M('control', 'near_branch_capacity', 'no_reroute_control', 1)
    o += ['', '### 6. Negative control (not a comparator)', '',
          '| Run | Completed | Route infeasible | Closed link entries | checks_pass | Failed gates |', '|---|---:|---:|---:|---|---|',
          f"| near_branch_capacity no_reroute_control seed 1 | {c['completed']} of {c['vehicles']} | {c['route_infeasible']} | {c['closed_link_entries']} | {c['checks_pass']} | {', '.join(c['failed_gates'])} |"]
    return '\n'.join(o)


if __name__ == '__main__':
    t = tables()
    if '--check' in sys.argv:
        d = DOC.read_text()
        got = d.split(BEGIN)[1].split(END)[0].strip() if BEGIN in d and END in d else None
        sys.exit(0 if got == t.strip() else 1)
    print(t)
