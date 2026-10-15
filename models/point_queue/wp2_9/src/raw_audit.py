#!/usr/bin/env python3
"""Independent raw-record audit for the Digital Marshal point-queue model (WP2.9).

Independence contract
  * Imports NOTHING from canonical_model.py or confirmatory.py (standard library only).
  * Graph, capacities, closure, horizon and scenario table come from config/graph_spec.json, hand-transcribed from
    FAIR_BASELINE_SPEC.md. tests/test_raw_audit.py fails if the spec and the model ever drift apart.
  * It does not re-run the model's service recurrence (that was the circular WP2.7 'audit_fifo'). Instead it checks
    properties that any correct FIFO point-queue record must satisfy: no teleporting, free-flow lower bound, no overtaking,
    minimum headway 60/capacity, work conservation (a vehicle waits only while the server is continuously busy),
    path legality, closure entry, vehicle conservation, horizon/censoring and metric recomputation from raw rows.

Library use:  audit_run(spec, edge_events, vehicle_rows, scale=..., expected_vehicles=..., ...)
CLI:          python src/raw_audit.py --results results [--spec config/graph_spec.json]   (exit 0 pass, 1 fail)
"""
import argparse, csv, json, math, sys
from collections import defaultdict
from pathlib import Path

EPS = 1e-6
METRIC_TOL = 2e-5
DEFAULT_SPEC = Path(__file__).resolve().parent.parent / 'config' / 'graph_spec.json'


def load_spec(path=DEFAULT_SPEC):
    return json.loads(Path(path).read_text())


def _f(x): return float(x)
def _b(x): return x if isinstance(x, bool) else str(x).strip().lower() == 'true'


def audit_run(spec, edge_events, vehicle_rows, *, scale, expected_vehicles, spacing_s=None,
              horizon_s=None, incident_s='spec', reported=None):
    """Audit one (scenario, policy) run from raw records only. Returns a dict with 'pass', 'violations', 'events_checked'."""
    horizon_s = spec['horizon_s'] if horizon_s is None else horizon_s
    incident_s = spec['incident_s'] if incident_s == 'spec' else incident_s       # None disables the closure check
    edges = {e['id']: e for e in spec['edges']}
    scaled = set(spec['branch_scaled_edges']); closed = set(spec['closed_edges'])
    allowed = {tuple(p) for p in spec['allowed_paths']}
    V = []
    def bad(check, **kw): V.append({'check': check, **kw})

    events = [dict(edge=e['edge'], vehicle=e['vehicle'], arr=_f(e['arrival_s']), exit=_f(e['exit_s']),
                   wait=_f(e['queue_wait_s'])) for e in edge_events]
    rows = [dict(vehicle=r['vehicle'], depart=_f(r['depart_s']), arrival=_f(r['arrival_s']), tt=_f(r['travel_time_s']),
                 complete=_b(r['complete']), p_time=_f(r['p_time_s']) if 'p_time_s' in r and r['p_time_s'] != '' else None)
            for r in vehicle_rows]

    # --- vehicle conservation and duplicates -------------------------------------------------------------------
    ids = [r['vehicle'] for r in rows]
    if len(ids) != len(set(ids)): bad('duplicate_vehicle_rows', n=len(ids) - len(set(ids)))
    if len(set(ids)) != expected_vehicles: bad('vehicle_conservation', found=len(set(ids)), expected=expected_vehicles)
    byv = defaultdict(list)
    for e in events: byv[e['vehicle']].append(e)
    if set(byv) != set(ids): bad('vehicle_event_mismatch', missing_events=sorted(set(ids) - set(byv))[:5],
                                 orphan_events=sorted(set(byv) - set(ids))[:5])
    seen = set()
    for e in events:
        k = (e['vehicle'], e['edge'])
        if k in seen: bad('edge_visited_twice', vehicle=e['vehicle'], edge=e['edge'])
        seen.add(k)
        if e['edge'] not in edges: bad('unknown_edge', edge=e['edge'])

    # --- demand schedule -----------------------------------------------------------------------------------------
    if spacing_s is not None:
        for r in rows:
            k = int(r['vehicle'][1:]) - 1
            if abs(r['depart'] - k * spacing_s) > EPS: bad('departure_schedule', vehicle=r['vehicle'], depart=r['depart'])

    # --- per-vehicle path / hand-off / free-flow / closure / horizon -----------------------------------------------
    rowmap = {r['vehicle']: r for r in rows}
    for vid, evs in byv.items():
        if any(e['edge'] not in edges for e in evs): continue
        evs = sorted(evs, key=lambda x: x['arr'])
        path = tuple(e['edge'] for e in evs)
        if edges[path[0]]['src'] != spec['origin'] or edges[path[-1]]['dst'] != spec['destination']:
            bad('path_endpoints', vehicle=vid, path=path)
        for a, b in zip(path, path[1:]):
            if edges[a]['dst'] != edges[b]['src']: bad('path_disconnected', vehicle=vid, edges=(a, b))
        if path not in allowed: bad('path_not_in_allowed_set', vehicle=vid, path=path)
        for x, y in zip(evs, evs[1:]):
            if abs(y['arr'] - x['exit']) > EPS: bad('handoff_gap_or_teleport', vehicle=vid, edges=(x['edge'], y['edge']),
                                                    exit=x['exit'], next_arrival=y['arr'])
        for e in evs:
            ff = e['arr'] + edges[e['edge']]['free_min'] * 60
            if e['exit'] + EPS < ff: bad('faster_than_free_flow', vehicle=vid, edge=e['edge'])
            if e['wait'] < -EPS or abs(e['wait'] - (e['exit'] - ff)) > EPS:
                bad('wait_bookkeeping', vehicle=vid, edge=e['edge'], wait=e['wait'], implied=e['exit'] - ff)
            if incident_s is not None and e['edge'] in closed and e['arr'] >= incident_s:
                bad('closed_link_entry', vehicle=vid, edge=e['edge'], entry_s=e['arr'])
        r = rowmap.get(vid)
        if r is not None:
            if abs(evs[0]['arr'] - r['depart']) > EPS: bad('depart_vs_first_arrival', vehicle=vid)
            last = evs[-1]['exit']
            if abs(r['arrival'] - last) > EPS: bad('arrival_vs_last_exit', vehicle=vid, row=r['arrival'], events=last)
            if r['p_time'] is not None:
                e1 = [e for e in evs if e['edge'] == 'E1']
                if e1 and abs(r['p_time'] - e1[0]['exit']) > EPS: bad('p_time_vs_E1_exit', vehicle=vid)
            should_complete = last <= horizon_s
            if r['complete'] != should_complete: bad('completion_flag_vs_horizon', vehicle=vid, last_exit=last,
                                                     horizon=horizon_s, flag=r['complete'])
            implied_tt = (last if should_complete else horizon_s) - r['depart']
            if abs(r['tt'] - implied_tt) > EPS: bad('travel_time_mismatch', vehicle=vid, row=r['tt'], implied=implied_tt)

    # --- per-edge queue discipline ---------------------------------------------------------------------------------
    byedge = defaultdict(list)
    for e in events:
        if e['edge'] in edges: byedge[e['edge']].append(e)
    for eid, L in byedge.items():
        cap = edges[eid]['cap_vpm'] * (scale if eid in scaled else 1.0)
        head = 60.0 / cap
        # FIFO / no overtaking: sorted by arrival; strictly later arrivals may not leave earlier
        by_arr = sorted(L, key=lambda x: (x['arr'], x['exit']))
        for x, y in zip(by_arr, by_arr[1:]):
            if y['arr'] > x['arr'] + EPS and y['exit'] + EPS < x['exit']:
                bad('overtaking', edge=eid, first=x['vehicle'], second=y['vehicle'])
        # headway and work conservation, in service (exit) order
        by_exit = sorted(L, key=lambda x: x['exit'])
        for x, y in zip(by_exit, by_exit[1:]):
            gap = y['exit'] - x['exit']
            if gap + EPS < head: bad('headway_below_service_time', edge=eid, vehicles=(x['vehicle'], y['vehicle']),
                                     gap=gap, required=head)
            if y['wait'] > EPS and gap > head + EPS:
                bad('server_idle_while_vehicle_waited', edge=eid, vehicle=y['vehicle'], gap=gap, headway=head)

    # --- metric recomputation from raw vehicle rows ------------------------------------------------------------------
    tt = sorted(r['tt'] / 60.0 for r in rows)
    recomputed = {}
    if tt:
        recomputed = {'total_fleet_travel_time_vehicle_min': sum(tt), 'mean_travel_time_min': sum(tt) / len(tt),
                      'median_travel_time_min': (tt[len(tt) // 2] if len(tt) % 2 else (tt[len(tt) // 2 - 1] + tt[len(tt) // 2]) / 2),
                      'p95_nearest_rank_min': tt[math.ceil(0.95 * len(tt)) - 1],
                      'completed': sum(r['complete'] for r in rows), 'incomplete': sum(not r['complete'] for r in rows)}
        for k, v in (reported or {}).items():
            if k in recomputed and abs(_f(v) - recomputed[k]) > METRIC_TOL:
                bad('metric_mismatch', metric=k, reported=_f(v), recomputed=recomputed[k])

    counts = defaultdict(int)
    for v in V: counts[v['check']] += 1
    return {'pass': not V, 'violations': V, 'violation_counts': dict(counts), 'events_checked': len(events),
            'vehicles_checked': len(set(ids)), 'recomputed': recomputed}


def audit_results_dir(results_dir, spec_path=DEFAULT_SPEC):
    """Audit every (scenario, policy) in a results directory written by confirmatory.py."""
    spec = load_spec(spec_path); d = Path(results_dir)
    def rd(name):
        with (d / name).open(newline='') as f: return list(csv.DictReader(f))
    veh, evt, met = rd('vehicle_records.csv'), rd('edge_event_records.csv'), rd('confirmatory_metrics.csv')
    gv, ge = defaultdict(list), defaultdict(list)
    for r in veh: gv[(r['scenario'], r['policy'])].append(r)
    for r in evt: ge[(r['scenario'], r['policy'])].append(r)
    out = []
    for m in met:
        key = (m['scenario'], m['policy']); sc = spec['scenarios'][m['scenario']]
        res = audit_run(spec, ge[key], gv[key], scale=sc['branch_capacity_scale'], expected_vehicles=sc['vehicles'],
                        spacing_s=sc['spacing_s'], reported={k: m[k] for k in (
                            'total_fleet_travel_time_vehicle_min', 'mean_travel_time_min', 'median_travel_time_min',
                            'p95_nearest_rank_min', 'completed', 'incomplete')})
        out.append({'scenario': key[0], 'policy': key[1], **res})
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--results', required=True); ap.add_argument('--spec', default=str(DEFAULT_SPEC))
    a = ap.parse_args()
    res = audit_results_dir(a.results, a.spec)
    allpass = all(r['pass'] for r in res)
    print(json.dumps({'runs_audited': len(res), 'all_pass': allpass,
                      'events_checked': sum(r['events_checked'] for r in res),
                      'violations': [{'scenario': r['scenario'], 'policy': r['policy'], 'counts': r['violation_counts']}
                                     for r in res if not r['pass']]}, indent=2))
    sys.exit(0 if allpass else 1)
