#!/usr/bin/env python3
"""EXPLORATORY baselines for WP2.9. NOT part of the frozen three-policy matrix and never written to results/.

  independent_each_vehicle  Every vehicle in a batch evaluates ITS OWN route costs against the pre-batch snapshot (committed
                            vehicles only; no peers). This is the 'truly independent' reading of the WP2.7 independent policy.
                            The frozen independent_periodic instead lets the first vehicle of a batch probe the costs and
                            copies that choice to the whole batch (confirmatory.py: probe=group[0]), so dominant-route share
                            is 1.00 by construction.
  peer_aware_sequential     Vehicles decide one at a time in (P-arrival, id) order and each sees the commitments of earlier
                            vehicles in the SAME batch as well as all earlier batches. Greedy, no joint search. It has MORE
                            information than the frozen independent policy and a weaker optimiser than coordinated_batch,
                            so it separates 'seeing peers' from 'jointly optimising'.

Both reuse the frozen cost estimator (confirmatory.estimate_added_vehicle), the same batches, tie-break (route A before B on an
exact tie) and the same metric/audit code (confirmatory.summarize, raw_audit). Use for screening only.
usage: python src/exploratory.py --out DIR [--update-s 30] [--offset-s 0]
"""
import argparse, csv, json
from pathlib import Path
import canonical_model as m
import confirmatory as c

EXPLORATORY_POLICIES = ('independent_each_vehicle', 'peer_aware_sequential')
FROZEN_POLICIES = ('static', 'independent_periodic', 'coordinated_batch')
INFO = {
    'independent_each_vehicle': 'same synthetic graph, free-flow times, nominal capacities, closure at 120s, common schedule; pre-batch committed assignments only; each vehicle evaluates only its own route costs; no peers; no future realized exits',
    'peer_aware_sequential': 'same synthetic graph, free-flow times, nominal capacities, closure at 120s, common schedule; prior committed assignments AND choices already made by earlier vehicles in the same batch; no future realized exits'}


def assign_exploratory(vs, scale, policy, update_s=None, offset_s=0.0):
    if policy not in EXPLORATORY_POLICIES: raise ValueError(policy)
    assigned = {}; decision_log = []; batch_stats = []
    for epoch, group in c.batches(vs, update_s, offset_s):
        before = dict(assigned); choices = {}
        for v in group:
            snap = before if policy == 'independent_each_vehicle' else assigned   # assigned grows inside the batch for peer_aware
            costA = c.estimate_added_vehicle(v, 'A', snap, vs, scale)
            costB = c.estimate_added_vehicle(v, 'B', snap, vs, scale)
            r = min(('A', 'B'), key=lambda x: ({'A': costA, 'B': costB}[x], x))
            choices[v['id']] = r
            if policy == 'peer_aware_sequential': assigned[v['id']] = r
        assigned.update(choices)
        for v in group:
            decision_log.append({'vehicle': v['id'], 'decision_epoch_s': epoch, 'p_arrival_s': v['p_arrival_s'],
                'seconds_after_incident': epoch - m.INCIDENT_S, 'policy': policy, 'chosen_route': choices[v['id']],
                'eligible_routes': 'A;B', 'available_info': INFO[policy],
                'decision_method': 'own_cost_argmin_pre_batch_snapshot' if policy == 'independent_each_vehicle' else 'sequential_greedy_with_peer_commitments',
                'route_switches': 0})
        batch_stats.append({'epoch_s': epoch, 'batch_size': len(group),
            'A_count': sum(choices[x['id']] == 'A' for x in group), 'B_count': sum(choices[x['id']] == 'B' for x in group),
            'dominant_route_share': max(sum(choices[x['id']] == r for x in group) for r in ('A', 'B')) / len(group),
            'coordinator_A_split': None})
    return assigned, decision_log, batch_stats


def run_exploratory(outdir, update_s=None, offset_s=0.0):
    out = Path(outdir).resolve()
    if out == (Path(__file__).resolve().parent.parent / 'results').resolve():
        raise SystemExit('refusing to write exploratory output into results/ (reserved for the frozen experiment)')
    out.mkdir(parents=True, exist_ok=True)
    rows, audits = [], []
    for sc in c.SCENARIOS:
        vs = c.make_vehicles(sc['n'], sc['spacing_s'])
        res = {}
        for pol in FROZEN_POLICIES + EXPLORATORY_POLICIES:
            if pol in FROZEN_POLICIES: routes, dec, bat = c.assign_policy(vs, sc['scale'], pol, update_s, offset_s)
            else: routes, dec, bat = assign_exploratory(vs, sc['scale'], pol, update_s, offset_s)
            met, vrows, logs, fifo = c.summarize(vs, routes, sc['scale'], pol, dec, bat)
            res[pol] = met
            audits.append({'scenario': sc['name'], 'policy': pol, 'overall_pass': met['checks_pass'],
                           'violation_counts': fifo['audit']['violation_counts']})
        coord = res['coordinated_batch']['total_fleet_travel_time_vehicle_min']
        for pol, met in res.items():
            t = met['total_fleet_travel_time_vehicle_min']
            rows.append({'scenario': sc['name'], 'policy': pol, 'status': 'frozen' if pol in FROZEN_POLICIES else 'EXPLORATORY',
                'total_fleet_travel_time_vehicle_min': t, 'mean_travel_time_min': met['mean_travel_time_min'],
                'p95_nearest_rank_min': met['p95_nearest_rank_min'], 'route_A_count': met['route_A_count'],
                'route_B_count': met['route_B_count'], 'max_30s_batch_dominant_route_share': met['max_30s_batch_dominant_route_share'],
                'closed_link_entries': met['closed_link_entries'], 'checks_pass': met['checks_pass'],
                'coordinated_improvement_vs_this_policy_pct': round(100 * (t - coord) / t, 4) if t else 0.0,
                'update_s': update_s if update_s is not None else c.UPDATE_S, 'offset_s': offset_s})
    with (out / 'exploratory_comparison.csv').open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    (out / 'exploratory_audit.json').write_text(json.dumps(audits, indent=2))
    (out / 'EXPLORATORY_NOT_CONFIRMATORY.txt').write_text(
        'These outputs are exploratory screening runs. They are not the frozen confirmatory experiment, '
        'must not be cited as PASS/FAIL evidence, and use two policies that are not part of the frozen matrix.\n')
    return rows, audits


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True)
    ap.add_argument('--update-s', type=float, default=None); ap.add_argument('--offset-s', type=float, default=0.0)
    a = ap.parse_args(); rows, audits = run_exploratory(a.out, a.update_s, a.offset_s)
    print(json.dumps({'rows': len(rows), 'all_checks_pass': all(x['overall_pass'] for x in audits)}, indent=2))
    for r in rows:
        if r['scenario'] == 'near_branch_capacity':
            print(f"{r['policy']:26} {r['status']:11} {r['total_fleet_travel_time_vehicle_min']:9.3f}  A/B {r['route_A_count']}/{r['route_B_count']}  coord better by {r['coordinated_improvement_vs_this_policy_pct']:6.2f}%")
