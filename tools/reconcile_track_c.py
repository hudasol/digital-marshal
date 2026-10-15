#!/usr/bin/env python3
"""Generate the numeric tables of docs/track_c/CROSS_MODEL_TRACK_C.md from result files (standard library only).

usage: python tools/reconcile_track_c.py            print the tables
       python tools/reconcile_track_c.py --check    exit 1 if the document is out of date
Point queue: models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv (frozen WP2.7 numbers, deterministic)
SUMO Track C: results/exploratory/track_c/matrix_7200/aggregate/ (exploratory, seeded; not confirmatory)
SUMO historical prototype: results/historical/sumo_phase1/sumo_results_paired.csv (for the reproduction row only)
Improvement % = 100 x (baseline total - coordinated total) / baseline total (docs/acceptance-criteria.md).

Comparability label, computed per scenario (rules, not judgement):
  non-comparable        SUMO mean origin insertion delay under any policy > INSERTION_LIMIT_S: the SUMO total then mixes
                        origin queueing with route choice (the point queue has no insertion delay), or a SUMO run is not ok.
  partially comparable  otherwise. Same scenario table, closure, horizon (7200 s in both) and travel-time window
                        (departure to arrival, censored at the horizon), but the models differ (deterministic FIFO point
                        queue vs seeded car following, 7.5 SUMO vehicles per abstract vehicle) and so does batching
                        (P-arrival epochs vs a lead-time cohort). Half and double capacity are realised approximately.
  comparable            would need identical comparator semantics and batching; no scenario meets that, so none is.
"""
import csv, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PQ = ROOT / 'models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv'
AGG = ROOT / 'results/exploratory/track_c/matrix_7200/aggregate'
HIST = ROOT / 'results/historical/sumo_phase1/sumo_results_paired.csv'
CAL = ROOT / 'simulation/sumo/network'
DOC = ROOT / 'docs/track_c/CROSS_MODEL_TRACK_C.md'
BEGIN, END = '<!-- BEGIN GENERATED -->', '<!-- END GENERATED -->'
K = 7.5
INSERTION_LIMIT_S = 30.0
SCEN = ('manageable_primary', 'near_branch_capacity', 'overload_stress', 'primary_half_capacity', 'primary_double_capacity')
TARGET_PCT = 5.0       # provisional, unapproved (docs/acceptance-criteria.md); shown, never changed


def rd(p):
    with p.open(newline='') as f: return list(csv.DictReader(f))


def pct(b, c): return 100 * (b - c) / b


def label(sc, means):
    rows = [r for r in means if r['scenario'] == sc]
    if any(int(r['ok']) != int(r['runs']) for r in rows): return 'non-comparable', 'a SUMO run is not ok'
    worst = max(float(r['mean_insertion_delay_s']) for r in rows)
    if worst > INSERTION_LIMIT_S: return 'non-comparable', f'SUMO origin insertion delay up to {worst:.0f} s'
    return 'partially comparable', f'insertion delay at most {worst:.1f} s'


def tables():
    pq = {(r['scenario'], r['policy']): r for r in rd(PQ)}
    means = rd(AGG / 'track_c_means.csv')
    su = {(r['scenario'], r['policy']): r for r in means}
    pr = {(r['scenario'], r['baseline']): r for r in rd(AGG / 'track_c_paired.csv')}
    fh = json.loads((AGG / 'track_c_fairness_and_horizon.json').read_text())
    hist = {(r['scenario'], r['baseline']): r for r in rd(HIST)}
    T = lambda s, p: float(pq[s, p]['total_fleet_travel_time_vehicle_min'])
    out = [f"Runs: {sum(fh['status_counts'].values())} ({', '.join(f'{k} {v}' for k, v in sorted(fh['status_counts'].items()))}). "
           f"Fairness checks (shared inputs across policies per scenario and seed): {fh['fairness_pass']} of {fh['fairness_checks']} pass. "
           f"Horizon {', '.join(str(h) for h in fh['horizon']['horizons_used'])} s; latest arrival {fh['horizon']['latest_arrival_s']:.0f} s; "
           f"runs with an arrival after 3600 s: {fh['horizon']['runs_with_arrival_after_3600_s']}.", '',
           '### Realised branch capacity scale (measured discharge ratio at P)', '',
           '| Scenario | Nominal scale | SUMO mechanism | Realised A | Realised B |', '|---|---:|---|---:|---:|']
    for sc, f, mech in (('primary_half_capacity', 'calibration_branch_x0_5.json', 'headway tau on E4..E10'),
                        ('primary_double_capacity', 'calibration_branch_x2.json', 'branch lanes x2, one approach lane per outgoing lane')):
        c = json.loads((CAL / f).read_text())
        if c.get('branch_tau'): mech += f" = {c['branch_tau']}"
        out.append(f"| {sc} | {c['branch_capacity_scale']} | {mech} | {c['realised_scale_A']:.3f} | {c['realised_scale_B']:.3f} |")
    out += ['', '### Total fleet travel time, vehicle minutes (SUMO: mean over ok seeds)', '',
            '| Scenario | Policy | Point queue | SUMO mean | SUMO / 7.5 | SUMO incomplete trips | SUMO closed-link entries | SUMO infeasible routes |',
            '|---|---|---:|---:|---:|---:|---:|---:|']
    for sc in SCEN:
        for p in ('static', 'independent_periodic', 'independent_batch_copy', 'coordinated_batch'):
            s = su[sc, p]; v = float(s['mean_total_vehicle_min'])
            pqv = f'{T(sc, p):.2f}' if (sc, p) in pq else 'n/a'
            out.append(f"| {sc} | {p} | {pqv} | {v:.1f} | {v / K:.1f} | {s['incomplete_total']} | {s['closed_link_entries_total']} | {s['route_feasibility_violations_total']} |")
    out += ['', '### Coordinated improvement, percent', '',
            '| Scenario | Label | Point queue vs independent_periodic | SUMO vs independent_periodic [95% CI] (wins) | SUMO vs independent_batch_copy [95% CI] (wins) | Seeds | Sign agreement (point queue vs SUMO batch copy) | Why |',
            '|---|---|---:|---|---|---:|---|---|']
    for sc in SCEN:
        lab, why = label(sc, means)
        pqi = pct(T(sc, 'independent_periodic'), T(sc, 'coordinated_batch'))
        a, b = pr[sc, 'independent_periodic'], pr[sc, 'independent_batch_copy']
        sb = float(b['mean_improvement_pct'])
        sign = 'point queue 0' if abs(pqi) < 1e-9 else ('same' if (pqi > 0) == (sb > 0) else 'opposite')
        f = lambda r: f"{float(r['mean_improvement_pct']):.2f} [{float(r['ci95_lo']):.2f}, {float(r['ci95_hi']):.2f}] ({r['seeds_coordinated_better']})"
        out.append(f"| {sc} | {lab} | {pqi:.2f} | {f(a)} | {f(b)} | {a['n_paired']} | {sign} | {why} |")
    hm = rd(HIST.with_name('sumo_results.csv'))
    same_means = sum(abs(float(r['mean_total_vehicle_min']) - float(su[r['scenario'], r['policy']]['mean_total_vehicle_min'])) < 1e-3 for r in hm)
    keys = ('mean_improvement_pct', 'ci_lo', 'ci_hi', 'seeds_coord_better')
    mine = ('mean_improvement_pct', 'ci95_lo', 'ci95_hi', 'seeds_coordinated_better')
    same_pairs = sum(all(abs(float(r[a]) - float(pr[r['scenario'], r['baseline']][b])) < 1e-9 for a, b in zip(keys, mine))
                     for r in hist.values())
    out += ['', '### Reproduction of the historical SUMO prototype (three original scenarios, four original policies)', '',
            '| Quantity | Equal in the Track C rerun | Of |', '|---|---:|---:|',
            f'| Policy mean total travel time (within 0.001 vehicle minute; history is rounded to 3 decimals) | {same_means} | {len(hm)} |',
            f'| Paired improvement: mean, 95% interval and seeds coordinated better (exact) | {same_pairs} | {len(hist)} |']
    nb = pr['near_branch_capacity', 'independent_periodic']; h = hist['near_branch_capacity', 'independent_periodic']
    out += ['', '### Near capacity against the provisional target (unchanged, not approved)', '',
            '| Source | Improvement vs independent_periodic, % | Provisional target, % | Meets target |', '|---|---:|---:|---|',
            f"| Point queue, frozen WP2.7 | {pct(T('near_branch_capacity', 'independent_periodic'), T('near_branch_capacity', 'coordinated_batch')):.2f} | {TARGET_PCT:.0f} | no |",
            f"| SUMO historical prototype (3600 s horizon, {h['n']} seeds) | {float(h['mean_improvement_pct']):.2f} | {TARGET_PCT:.0f} | no |",
            f"| SUMO Track C rerun (7200 s horizon, {nb['n_paired']} seeds) | {float(nb['mean_improvement_pct']):.2f} | {TARGET_PCT:.0f} | {'yes' if float(nb['mean_improvement_pct']) >= TARGET_PCT else 'no'} |"]
    return '\n'.join(out)


def is_current(doc_text, generated=None):
    got = doc_text.split(BEGIN)[1].split(END)[0].strip() if BEGIN in doc_text and END in doc_text else None
    return got == (tables() if generated is None else generated).strip()


if __name__ == '__main__':
    if '--check' in sys.argv: sys.exit(0 if is_current(DOC.read_text()) else 1)
    print(tables())
