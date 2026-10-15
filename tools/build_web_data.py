#!/usr/bin/env python3
"""Build web/data.js for the Digital Marshal viewer from the frozen point queue model outputs.

Runs the WP2.9 confirmatory regeneration into a scratch folder (never into results/) and packs per vehicle,
per edge event and per batch records. Synthetic data only. Usage: python tools/build_web_data.py
"""
import csv, json, subprocess, sys, tempfile, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / 'models' / 'point_queue' / 'wp2_9'
SPEC = json.loads((MODEL / 'config' / 'graph_spec.json').read_text())

def rows(p):
    with open(p, newline='') as f:
        return list(csv.DictReader(f))

def main():
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ, PYTHONPATH=str(MODEL / 'src'))
        subprocess.run([sys.executable, str(MODEL / 'src' / 'confirmatory.py'), '--out', td], check=True, env=env, stdout=subprocess.DEVNULL)
        met = rows(Path(td) / 'confirmatory_metrics.csv')
        veh = rows(Path(td) / 'vehicle_records.csv')
        edg = rows(Path(td) / 'edge_event_records.csv')
        bat = rows(Path(td) / 'batch_allocation_log.csv')
    runs = {}
    for m in met:
        key = m['scenario'] + '|' + m['policy']
        runs[key] = {'metrics': {k: m[k] for k in ('total_fleet_travel_time_vehicle_min', 'mean_travel_time_min', 'median_travel_time_min', 'p95_nearest_rank_min', 'route_A_count', 'route_B_count', 'max_30s_batch_dominant_route_share', 'closed_link_entries', 'fifo_violations', 'checks_pass', 'vehicles', 'departure_spacing_s', 'capacity_scale_E4_E10_only')},
                     'vehicles': {}, 'batches': []}
    for v in veh:
        runs[v['scenario'] + '|' + v['policy']]['vehicles'][v['vehicle']] = {'d': float(v['depart_s']), 'p': float(v['p_time_s']), 'r': v['route'], 'a': float(v['arrival_s'])}
    for e in edg:
        r = runs[e['scenario'] + '|' + e['policy']]['vehicles'][e['vehicle']]
        r.setdefault('ev', []).append([e['edge'], float(e['arrival_s']), float(e['exit_s']), float(e['queue_wait_s'])])
    for b in bat:
        runs[b['scenario'] + '|' + b['policy']]['batches'].append([float(b['epoch_s']), int(b['batch_size']), int(b['A_count']), int(b['B_count'])])
    out = {'graph': {'edges': SPEC['edges'], 'closed': SPEC['closed_edges'], 'incident_s': SPEC['incident_s'], 'horizon_s': SPEC['horizon_s']},
           'scenarios': SPEC['scenarios'], 'runs': runs}
    (ROOT / 'web' / 'data.js').write_text('window.DM_DATA = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print('runs', len(runs), 'bytes', (ROOT / 'web' / 'data.js').stat().st_size)

if __name__ == '__main__':
    main()
