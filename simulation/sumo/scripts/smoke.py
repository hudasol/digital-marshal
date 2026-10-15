#!/usr/bin/env python3
"""One command SUMO smoke test: python simulation/sumo/scripts/smoke.py [OUTDIR]

Runs the manageable_primary scenario under the three named policies (seed 1), then audits the raw per vehicle
records with code that does not import dm_run. Exits 1 on any failure. Synthetic network, exploratory only."""
import csv, json, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLOSED = {'E2', 'E3'}
POLICIES = ('static', 'independent_periodic', 'coordinated_batch')
ALLOWED = {('E1', 'E4', 'E5', 'E6', 'E11'), ('E1', 'E7', 'E8', 'E9', 'E10', 'E11')}


def audit(d, expected=75):   # 10 abstract vehicles x K=7.5 SUMO vehicles each (see dm_run.K)
    rows = list(csv.DictReader((d / 'vehicles.csv').open()))
    summ = json.loads((d / 'summary.json').read_text())
    bad = []
    if len(rows) != expected: bad.append(('vehicle_count', len(rows)))
    for r in rows:
        path = tuple(r['edges'].split())
        if CLOSED & set(path): bad.append(('closed_edge_in_path', r['vehicle']))
        if path not in ALLOWED: bad.append(('path_not_allowed', r['vehicle'], path))
        if r['complete'] != 'True': bad.append(('incomplete', r['vehicle']))
        if r['complete'] == 'True' and abs(float(r['arrival_s']) - float(r['sched_depart_s']) - float(r['travel_time_s'])) > 0.01:
            bad.append(('travel_time_accounting', r['vehicle']))
    total = sum(float(r['travel_time_s']) for r in rows) / 60
    if abs(total - summ['total_vehicle_min']) > 1e-3: bad.append(('total_mismatch', total, summ['total_vehicle_min']))
    return bad


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix='dm_smoke_'))
    failed = False
    for pol in POLICIES:
        d = out / pol
        r = subprocess.run([sys.executable, str(HERE / 'dm_run.py'), '--scenario', 'manageable_primary', '--policy', pol,
                            '--seed', '1', '--out', str(d)], capture_output=True, text=True)
        if r.returncode: print(pol, 'RUN FAILED', r.stderr[-400:]); failed = True; continue
        bad = audit(d)
        print(f'{pol:22s} audit_violations={len(bad)} total_vehicle_min={json.loads((d/"summary.json").read_text())["total_vehicle_min"]}')
        failed |= bool(bad)
        if bad: print('  ', bad[:3])
    g = subprocess.run([sys.executable, str(HERE / 'test_gate.py')], capture_output=True, text=True)
    print('closure gate negative test:', 'OK' if g.returncode == 0 else 'FAIL', g.stdout.strip()[-120:])
    failed |= g.returncode != 0
    print('SMOKE', 'FAIL' if failed else 'PASS', '| raw outputs in', out)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
