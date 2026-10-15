#!/usr/bin/env python3
"""Aggregate a Track C matrix (run_matrix.py --plan track_c). Standard library only.
Only runs with manifest status 'ok' enter means and paired comparisons; invalid and failed runs are counted, never dropped
silently. Improvement % = 100*(T_baseline - T_coord)/T_baseline per seed (positive favours coordination), as in aggregate.py.
Fairness: for every scenario and seed, all policies must share the demand file, network, horizon, incident, closure and
predictor inputs (from run_config.json). Horizon sensitivity: a run whose last arrival is before 3600 s is identical under a
3600 s and a 7200 s horizon (the loop ends when every vehicle has arrived; the horizon only truncates).
MATRIX_DIR is either a raw matrix (run directories next to manifest.jsonl) or an export from export_matrix.py (run
directories under runs/, logs in logs.tar.gz, extracted in memory).
usage: aggregate_track_c.py MATRIX_DIR OUT_DIR
"""
import csv, io, json, random, statistics, sys, tarfile
from collections import defaultdict
from pathlib import Path

BASELINES = ('independent_periodic', 'independent_batch_copy', 'static', 'measured_periodic')
SHARED = ('demand_sha256', 'network_sha256', 'horizon_s', 'incident_s', 'closed_edges', 'update_s', 'lead_s',
          'branch_capacity_scale', 'branch_tau', 'mu_A', 'mu_B', 'sumo_version', 'k_sumo_per_abstract')


def boot(xs, n=5000, seed=7):
    rng = random.Random(seed); m = sorted(statistics.mean(rng.choices(xs, k=len(xs))) for _ in range(n))
    return m[int(.025 * n)], m[int(.975 * n)]


def vehicles_csv(mx, name):
    """Text of a run's vehicles.csv from a raw matrix or from an export's logs.tar.gz; None if absent."""
    p = mx / name / 'vehicles.csv'
    if p.exists(): return p.read_text()
    tar = mx / 'logs.tar.gz'
    if tar.exists():
        if not hasattr(vehicles_csv, 'cache'): vehicles_csv.cache = {}
        if mx not in vehicles_csv.cache:
            with tarfile.open(tar) as t:
                vehicles_csv.cache[mx] = {m.name.split('/')[0]: t.extractfile(m).read().decode()
                                          for m in t.getmembers() if m.name.endswith('/vehicles.csv')}
        return vehicles_csv.cache[mx].get(name)
    return None


def load(mx):
    manifest = {}
    for line in (mx / 'manifest.jsonl').read_text().splitlines():
        r = json.loads(line); manifest[r['run']] = r
    base = mx / 'runs' if (mx / 'runs').is_dir() else mx
    runs = {}
    for name, rec in manifest.items():
        d = base / name
        s = json.loads((d / 'summary.json').read_text()) if (d / 'summary.json').exists() else None
        c = json.loads((d / 'run_config.json').read_text()) if (d / 'run_config.json').exists() else None
        delay, text = None, vehicles_csv(mx, name)
        if text is not None:
            ds = [float(v['actual_depart_s']) - float(v['sched_depart_s']) for v in csv.DictReader(io.StringIO(text)) if v['actual_depart_s']]
            delay = statistics.mean(ds) if ds else None
        runs[name] = dict(rec=rec, summary=s, config=c, insertion_delay_s=delay)
    return runs


def aggregate(mx):
    runs = load(mx)
    by = defaultdict(dict)
    for r in runs.values(): by[(r['rec']['scenario'], r['rec']['policy'])][r['rec']['seed']] = r
    scenarios = sorted({k[0] for k in by}); policies = sorted({k[1] for k in by})
    means = []
    for sc in scenarios:
        for pol in policies:
            cell = by[(sc, pol)]; ok = [r for r in cell.values() if r['rec']['status'] == 'ok']
            st = [r['summary'] for r in ok]
            def m(k): return round(statistics.mean(s[k] for s in st), 4) if st else ''
            means.append(dict(scenario=sc, policy=pol, runs=len(cell), ok=len(ok),
                              invalid=sum(r['rec']['status'] == 'invalid' for r in cell.values()),
                              failed=sum(r['rec']['status'] == 'failed' for r in cell.values()),
                              mean_total_vehicle_min=m('total_vehicle_min'),
                              sd_total_vehicle_min=round(statistics.stdev(s['total_vehicle_min'] for s in st), 4) if len(st) > 1 else '',
                              mean_p95_min=m('p95_min'), mean_completed=m('completed'),
                              incomplete_total=sum(s['incomplete'] for s in st), mean_n_A=m('n_A'), mean_n_B=m('n_B'),
                              closed_link_entries_total=sum(s['closed_link_entries'] for s in st),
                              route_feasibility_violations_total=sum(s['route_feasibility_violations'] for s in st),
                              illegal_transitions_total=sum(s['illegal_transitions'] for s in st),
                              collisions_total=sum(s['collisions'] for s in st),
                              max_arrival_s=max((s['max_arrival_s'] for s in st), default=''),
                              arrivals_after_3600_s_total=sum(s['arrivals_after_3600_s'] for s in st),
                              mean_insertion_delay_s=round(statistics.mean(r['insertion_delay_s'] for r in ok), 3) if ok else ''))
    paired = []
    for sc in scenarios:
        co = by[(sc, 'coordinated_batch')]
        for base in BASELINES:
            b = by[(sc, base)]
            seeds = sorted(s for s in set(b) & set(co) if b[s]['rec']['status'] == 'ok' and co[s]['rec']['status'] == 'ok')
            if not seeds: continue
            T = lambda r, k='total_vehicle_min': r['summary'][k]
            imp = [100 * (T(b[s]) - T(co[s])) / T(b[s]) for s in seeds]
            p95 = [100 * (T(b[s], 'p95_min') - T(co[s], 'p95_min')) / T(b[s], 'p95_min') for s in seeds]
            lo, hi = boot(imp)
            paired.append(dict(scenario=sc, baseline=base, n_paired=len(seeds),
                               excluded_not_ok=len(set(b) | set(co)) - len(seeds),
                               mean_baseline_total_vehicle_min=round(statistics.mean(T(b[s]) for s in seeds), 3),
                               mean_coordinated_total_vehicle_min=round(statistics.mean(T(co[s]) for s in seeds), 3),
                               mean_improvement_pct=round(statistics.mean(imp), 3), ci95_lo=round(lo, 3), ci95_hi=round(hi, 3),
                               seeds_coordinated_better=sum(x > 0 for x in imp), seeds_equal=sum(x == 0 for x in imp),
                               mean_p95_improvement_pct=round(statistics.mean(p95), 3)))
    fairness = []
    for sc in scenarios:
        for seed in sorted({s for pol in policies for s in by[(sc, pol)]}):
            cfgs = {pol: by[(sc, pol)][seed]['config'] for pol in policies if seed in by[(sc, pol)]}
            missing = sorted(p for p, c in cfgs.items() if c is None)
            present = {p: c for p, c in cfgs.items() if c is not None}
            diff = sorted(k for k in SHARED if len({json.dumps(c.get(k)) for c in present.values()}) > 1)
            fairness.append(dict(scenario=sc, seed=seed, policies=len(cfgs), missing_config=missing, differing_fields=diff,
                                 pass_=not missing and not diff))
    horizon = dict(runs_ok=sum(r['rec']['status'] == 'ok' for r in runs.values()),
                   horizons_used=sorted({r['config']['horizon_s'] for r in runs.values() if r['config']}),
                   runs_with_arrival_after_3600_s=sum(1 for r in runs.values() if r['summary'] and r['summary']['arrivals_after_3600_s']),
                   latest_arrival_s=max(r['summary']['max_arrival_s'] for r in runs.values() if r['summary'] and r['summary']['max_arrival_s']))
    status = defaultdict(int)
    for r in runs.values(): status[r['rec']['status']] += 1
    return dict(means=means, paired=paired, fairness=fairness, horizon=horizon, status=dict(status))


def write(res, out):
    out.mkdir(parents=True, exist_ok=True)
    for name in ('means', 'paired'):
        with (out / f'track_c_{name}.csv').open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(res[name][0]), lineterminator='\n'); w.writeheader(); w.writerows(res[name])
    fair = res['fairness']
    (out / 'track_c_fairness_and_horizon.json').write_text(json.dumps(dict(
        status_counts=res['status'], fairness_checks=len(fair), fairness_pass=sum(f['pass_'] for f in fair),
        fairness_failures=[f for f in fair if not f['pass_']], shared_fields_checked=list(SHARED), horizon=res['horizon']),
        indent=2) + '\n', newline='\n')


if __name__ == '__main__':
    res = aggregate(Path(sys.argv[1])); write(res, Path(sys.argv[2]))
    print(json.dumps(dict(status=res['status'], horizon=res['horizon'],
                          fairness_pass=sum(f['pass_'] for f in res['fairness']), fairness_checks=len(res['fairness']))))
    for p in res['paired']:
        print(f"{p['scenario']:24} vs {p['baseline']:22} n={p['n_paired']:2} imp={p['mean_improvement_pct']:7.3f}% "
              f"[{p['ci95_lo']:7.3f},{p['ci95_hi']:7.3f}] wins={p['seeds_coordinated_better']} eq={p['seeds_equal']}")
