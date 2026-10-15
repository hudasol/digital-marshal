#!/usr/bin/env python3
"""Run the SUMO scenario x policy x seed matrix (exploratory cross-check, NOT the frozen confirmatory run).
Seeds are fixed here before any result is viewed: primary scenario 1..20, others 1..10. Matched seeds: every policy sees the
same departure jitter and the same per-vehicle speed factors (SUMO --seed); car-following noise diverges as states diverge.
Plans:
  historical       the three original scenarios x four policies, SUMO default horizon (as before Track C; resumable)
  track_c_smoke    Track C: all five WP2.7 scenarios x five policies, seed 1
  track_c          Track C: all five WP2.7 scenarios x five policies, seeds as above
Track C plans need --horizon-s, start in an empty directory, and write manifest.jsonl (one line per run: exact command,
exit code, status, output hashes) and plan.json. Status: ok | invalid (outputs present, a hard gate failed) |
failed (non-zero exit or a missing output). Nothing is treated as successful by default.
usage: run_matrix.py OUTDIR [--plan historical|track_c_smoke|track_c] [--horizon-s S] [--workers N]
"""
import argparse, csv, hashlib, json, platform, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import dm_run

HERE = Path(__file__).resolve().parent
SEEDS = {'near_branch_capacity': range(1, 21), 'manageable_primary': range(1, 11), 'overload_stress': range(1, 11),
         'primary_half_capacity': range(1, 11), 'primary_double_capacity': range(1, 11)}
PLANS = {'historical': ({k: SEEDS[k] for k in ('near_branch_capacity', 'manageable_primary', 'overload_stress')}, dm_run.POLICIES),
         'track_c_smoke': ({k: range(1, 2) for k in SEEDS}, dm_run.TRACK_C_POLICIES),
         'track_c': (SEEDS, dm_run.TRACK_C_POLICIES)}
REQUIRED = ('summary.json', 'vehicles.csv', 'decisions.csv', 'run_config.json', 'tripinfo.xml', 'demand.rou.xml')


def jobs(plan):
    seeds, policies = PLANS[plan]
    return [(sc, pol, s) for sc, ss in seeds.items() for s in ss for pol in policies]


def classify(returncode, d):
    """Status of one run from its exit code and its files only."""
    missing = [f for f in REQUIRED if not (d / f).exists()]
    if returncode != 0 or missing:
        return 'failed', (f'exit {returncode}' if returncode else '') + (f' missing {missing}' if missing else '')
    s = json.loads((d / 'summary.json').read_text())
    with (d / 'vehicles.csv').open(newline='') as f: n_rows = sum(1 for _ in csv.DictReader(f))
    reasons = []
    if n_rows != s.get('vehicles'): reasons.append(f'vehicles.csv has {n_rows} rows, summary says {s.get("vehicles")}')
    if s.get('termination') != 'all_arrived': reasons.append(f'termination {s.get("termination")}')
    if not s.get('checks_pass'): reasons.append('checks_pass false')
    return ('invalid', '; '.join(reasons)) if reasons else ('ok', '')


def run_one(out, job, horizon_s):
    sc, pol, s = job
    name = f'{sc}__{pol}__{s}'; d = out / name
    args = ['simulation/sumo/scripts/dm_run.py', '--scenario', sc, '--policy', pol, '--seed', str(s), '--out', f'<matrix>/{name}']
    if horizon_s is not None: args += ['--horizon-s', repr(horizon_s)]
    real = [sys.executable, str(HERE / 'dm_run.py')] + [str(d) if a.startswith('<matrix>') else a for a in args[1:]]
    t0 = time.time()
    r = subprocess.run(real, capture_output=True, text=True)
    status, reason = classify(r.returncode, d)
    hashes = {f: dm_run.sha256(d / f) for f in REQUIRED if (d / f).exists()}
    return dict(run=name, scenario=sc, policy=pol, seed=s, command=['python'] + args, exit_code=r.returncode, status=status,
                reason=reason, wall_s=round(time.time() - t0, 1), output_sha256=hashes,
                stderr_tail=r.stderr[-400:] if r.returncode else '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out'); ap.add_argument('--plan', default='historical', choices=sorted(PLANS))
    ap.add_argument('--horizon-s', type=float, default=None); ap.add_argument('--workers', type=int, default=2)
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    js = jobs(a.plan)
    if a.plan == 'historical':          # original behaviour: resumable, default horizon
        def go(job):
            sc, pol, s = job; d = out / f'{sc}__{pol}__{s}'
            if (d / 'summary.json').exists(): return job, 'cached'
            r = subprocess.run([sys.executable, str(HERE / 'dm_run.py'), '--scenario', sc, '--policy', pol,
                                '--seed', str(s), '--out', str(d)], capture_output=True, text=True)
            return job, ('ok' if r.returncode == 0 else 'FAIL ' + r.stderr[-300:])
        with ThreadPoolExecutor(a.workers) as ex:
            for i, (job, st) in enumerate(ex.map(go, js), 1): print(i, len(js), job, st, flush=True)
        print('DONE', flush=True); return
    if a.horizon_s is None: sys.exit('--horizon-s is required for Track C plans (owner decision D1 is pending; record the choice)')
    if any(out.iterdir()): sys.exit(f'{out} is not empty; Track C plans start from an empty directory')
    seeds, policies = PLANS[a.plan]
    plan = dict(plan=a.plan, label='exploratory (not confirmatory; protocol not frozen)', horizon_s=a.horizon_s,
                scenarios={k: dict(params=dict(zip(('n_abstract', 'spacing_abstract_s', 'branch_capacity_scale'),
                                                   dm_run.SCENARIOS[k])), seeds=list(v)) for k, v in seeds.items()},
                policies=list(policies), runs=len(js), workers=a.workers, python=platform.python_version(),
                started=time.strftime('%Y-%m-%dT%H:%M:%S%z'))
    (out / 'plan.json').write_text(json.dumps(plan, indent=2))
    counts = {}
    with ThreadPoolExecutor(a.workers) as ex, (out / 'manifest.jsonl').open('w', newline='\n') as mf:
        for i, rec in enumerate(ex.map(lambda j: run_one(out, j, a.horizon_s), js), 1):
            mf.write(json.dumps(rec) + '\n'); mf.flush()
            counts[rec['status']] = counts.get(rec['status'], 0) + 1
            print(i, len(js), rec['run'], rec['status'], rec['reason'], flush=True)
    plan.update(finished=time.strftime('%Y-%m-%dT%H:%M:%S%z'), status_counts=counts)
    (out / 'plan.json').write_text(json.dumps(plan, indent=2))
    print('DONE', counts, flush=True)
    sys.exit(0 if set(counts) == {'ok'} else 1)


if __name__ == '__main__':
    main()
