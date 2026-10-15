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


RESULT_FILES = ('confirmatory_metrics.csv', 'vehicle_records.csv', 'edge_event_records.csv', 'decision_log.csv',
                'batch_allocation_log.csv')


REQUIRED = {   # file -> (numeric columns, count columns (non negative integers), text columns that must be non empty)
    'confirmatory_metrics.csv': (['total_fleet_travel_time_vehicle_min', 'mean_travel_time_min', 'median_travel_time_min',
                                  'p95_nearest_rank_min'], ['vehicles', 'completed', 'incomplete', 'route_A_count', 'route_B_count'], []),
    'vehicle_records.csv': (['depart_s', 'p_time_s', 'arrival_s', 'travel_time_s'], [], ['vehicle', 'route']),
    'edge_event_records.csv': (['arrival_s', 'exit_s', 'queue_wait_s'], [], ['edge', 'vehicle']),
    'decision_log.csv': ([], [], ['vehicle', 'chosen_route']),
    'batch_allocation_log.csv': (['epoch_s'], ['batch_size', 'A_count', 'B_count'], []),
}


def _finite(x):
    try: return math.isfinite(float(x))
    except (TypeError, ValueError): return False


def _read(d, name, pkg, bad):
    """Read one result file. File level problems go to pkg; row level malformed values go to bad as (key, detail)."""
    path = d / name
    if not path.exists():
        pkg.append({'check': 'results_file_missing', 'file': name}); return []
    try:
        with path.open(newline='', encoding='utf-8') as f: rows = list(csv.DictReader(f))
    except (UnicodeDecodeError, csv.Error, OSError) as e:
        pkg.append({'check': 'results_file_unreadable', 'file': name, 'error': str(e)[:120]}); return []
    if not rows:
        pkg.append({'check': 'results_file_empty', 'file': name}); return []
    nums, counts, texts = REQUIRED[name]
    need = {'scenario', 'policy'} | set(nums) | set(counts) | set(texts) | ({'complete'} if name == 'vehicle_records.csv' else set())
    miss = sorted(need - set(rows[0]))
    if miss:
        pkg.append({'check': 'missing_required_columns', 'file': name, 'columns': miss}); return []
    for i, r in enumerate(rows, start=2):
        key = (r['scenario'], r['policy'])
        def b(col, why): bad.append((key, {'check': 'malformed_value', 'file': name, 'line': i, 'column': col, 'value': str(r[col])[:40], 'why': why}))
        if None in r or any(v is None for v in r.values()): bad.append((key, {'check': 'malformed_record', 'file': name, 'line': i, 'why': 'wrong number of fields'})); continue
        for c in nums:
            if not _finite(r[c]): b(c, 'not a finite number')
        for c in counts:
            if not _finite(r[c]) or float(r[c]) < 0 or float(r[c]) != int(float(r[c])): b(c, 'not a non negative integer')
        for c in texts:
            if not r[c].strip(): b(c, 'empty')
        if name == 'vehicle_records.csv' and r['complete'] not in ('True', 'False'): b('complete', 'not True or False')
    return rows


def audit_results_dir(results_dir, spec_path=DEFAULT_SPEC):
    """Audit a results directory written by confirmatory.py. FAILS CLOSED on an incomplete package.

    The expected matrix is every scenario in the spec crossed with every policy in the spec (15 runs for the frozen
    experiment). Each of the five result files must contain every expected (scenario, policy) group, the metrics file
    exactly once, and nothing else. A missing, duplicated or unexpected group, or a missing file, makes the returned
    list contain a failing entry that names the file, scenario and policy. One entry per expected run is always returned,
    plus one per unexpected group and one '(package)' entry for file level problems."""
    spec = load_spec(spec_path); d = Path(results_dir)
    expected = [(s, p) for s in spec['scenarios'] for p in spec['policies']]
    pkg = []; bad = []
    data = {name: _read(d, name, pkg, bad) for name in RESULT_FILES}
    groups = {}
    for name, rows in data.items():
        g = defaultdict(list)
        for r in rows: g[(r['scenario'], r['policy'])].append(r)
        groups[name] = g
    per_key = defaultdict(list)
    def flag(key, check, **kw): per_key[key].append({'check': check, **kw})
    for name in RESULT_FILES:
        for key in expected:
            if key not in groups[name]: flag(key, 'missing_run', file=name)
        for key in groups[name]:
            if key not in expected: flag(key, 'unexpected_run', file=name)
    for key, rows in groups['confirmatory_metrics.csv'].items():
        if len(rows) > 1: flag(key, 'duplicate_metrics_row', file='confirmatory_metrics.csv', copies=len(rows))
    for key in expected:
        n = spec['scenarios'][key[0]]['vehicles']
        dl = len(groups['decision_log.csv'].get(key, []))
        if dl and dl != n: flag(key, 'decision_log_row_count', found=dl, expected=n)
        bl = groups['batch_allocation_log.csv'].get(key, [])
        if bl and key not in {k for k, _ in bad} and sum(int(float(r['batch_size'])) for r in bl) != n:
            flag(key, 'batch_log_total_mismatch', found=sum(int(float(r['batch_size'])) for r in bl), expected=n)
    malformed = set()
    for key, detail in bad:
        malformed.add(key); per_key[key].append(detail)
    for key in expected:
        sc = spec['scenarios'][key[0]]; n = sc['vehicles']
        mr = groups['confirmatory_metrics.csv'].get(key)
        if mr and key not in malformed:
            m0 = mr[0]
            if int(float(m0['vehicles'])) != n: flag(key, 'metrics_vehicle_count', file='confirmatory_metrics.csv', found=m0['vehicles'], expected=n)
            if int(float(m0['route_A_count'])) + int(float(m0['route_B_count'])) != n:
                flag(key, 'metrics_route_counts_do_not_sum', file='confirmatory_metrics.csv', found=int(float(m0['route_A_count'])) + int(float(m0['route_B_count'])), expected=n)
        dec = groups['decision_log.csv'].get(key, []); veh = groups['vehicle_records.csv'].get(key, [])
        if dec and veh:
            dids = [r['vehicle'] for r in dec]
            if len(dids) != len(set(dids)): flag(key, 'duplicate_decision_rows', file='decision_log.csv')
            if set(dids) != {r['vehicle'] for r in veh}: flag(key, 'decision_vehicle_ids_mismatch', file='decision_log.csv')
        for r in groups['batch_allocation_log.csv'].get(key, []):
            if key not in malformed and int(float(r['A_count'])) + int(float(r['B_count'])) != int(float(r['batch_size'])):
                flag(key, 'batch_row_counts_do_not_sum', file='batch_allocation_log.csv', epoch_s=r['epoch_s']); break
    # Route labels and route counts are reported in three files; tie them to the path actually driven in the raw edge events.
    labels = {tuple(path): lab for lab, path in spec['route_labels'].items()}
    for key in expected:
        ev = groups['edge_event_records.csv'].get(key)
        if not ev or key in malformed: continue
        by_v = defaultdict(list)
        for e in ev: by_v[e['vehicle']].append(e)
        driven = {v: labels.get(tuple(x['edge'] for x in sorted(L, key=lambda x: float(x['arrival_s'])))) for v, L in by_v.items()}
        for r in groups['vehicle_records.csv'].get(key, []):
            if driven.get(r['vehicle']) != r['route']:
                flag(key, 'vehicle_route_label_mismatch', file='vehicle_records.csv', vehicle=r['vehicle'], label=r['route'], driven=driven.get(r['vehicle'])); break
        for r in groups['decision_log.csv'].get(key, []):
            if driven.get(r['vehicle']) != r['chosen_route']:
                flag(key, 'decision_route_mismatch', file='decision_log.csv', vehicle=r['vehicle'], chosen=r['chosen_route'], driven=driven.get(r['vehicle'])); break
        nA = sum(1 for v in driven.values() if v == 'A'); nB = sum(1 for v in driven.values() if v == 'B')
        mr = groups['confirmatory_metrics.csv'].get(key)
        if mr and (int(float(mr[0]['route_A_count'])), int(float(mr[0]['route_B_count']))) != (nA, nB):
            flag(key, 'metrics_route_counts_vs_paths', file='confirmatory_metrics.csv',
                 reported=(mr[0]['route_A_count'], mr[0]['route_B_count']), driven=(nA, nB))
        bl = groups['batch_allocation_log.csv'].get(key, [])
        if bl and (sum(int(float(r['A_count'])) for r in bl), sum(int(float(r['B_count'])) for r in bl)) != (nA, nB):
            flag(key, 'batch_route_totals_vs_paths', file='batch_allocation_log.csv', driven=(nA, nB))
    out = []
    def entry(key, res):
        counts = defaultdict(int)
        for v in res['violations']: counts[v['check']] += 1
        res['violation_counts'] = dict(counts); res['pass'] = not res['violations']
        out.append({'scenario': key[0], 'policy': key[1], **res})
    empty = {'violations': [], 'events_checked': 0, 'vehicles_checked': 0, 'recomputed': {}}
    for key in expected:
        have = all(key in groups[n] for n in ('confirmatory_metrics.csv', 'vehicle_records.csv', 'edge_event_records.csv'))
        if have and key not in malformed:
            sc = spec['scenarios'][key[0]]; m = groups['confirmatory_metrics.csv'][key][0]
            res = audit_run(spec, groups['edge_event_records.csv'][key], groups['vehicle_records.csv'][key],
                            scale=sc['branch_capacity_scale'], expected_vehicles=sc['vehicles'], spacing_s=sc['spacing_s'],
                            reported={k: m[k] for k in ('total_fleet_travel_time_vehicle_min', 'mean_travel_time_min',
                                                        'median_travel_time_min', 'p95_nearest_rank_min', 'completed', 'incomplete')})
        else:
            res = dict(empty, violations=[])
        res['violations'] = res['violations'] + per_key.get(key, [])
        entry(key, res)
    for key in per_key:
        if key not in expected: entry(key, dict(empty, violations=per_key[key]))
    if pkg: entry(('(package)', '(package)'), dict(empty, violations=pkg))
    return out


COMPLETENESS_CHECKS = ('missing_run', 'unexpected_run', 'duplicate_metrics_row', 'results_file_missing',
                       'results_file_empty', 'results_file_unreadable', 'missing_required_columns')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--results', required=True); ap.add_argument('--spec', default=str(DEFAULT_SPEC))
    a = ap.parse_args()
    spec = load_spec(a.spec); expected = len(spec['scenarios']) * len(spec['policies'])
    try:
        res = audit_results_dir(a.results, a.spec)
    except Exception as e:      # never let a malformed package look like a pass or die without a diagnostic
        print(json.dumps({'all_pass': False, 'error': 'audit_crashed', 'detail': f'{type(e).__name__}: {str(e)[:200]}'}, indent=2)); sys.exit(2)
    audited = [r for r in res if r['scenario'] != '(package)' and not any(v['check'] in COMPLETENESS_CHECKS for v in r['violations'])]
    allpass = all(r['pass'] for r in res) and len(audited) == expected and len(res) == expected
    print(json.dumps({'expected_runs': expected, 'runs_audited': len(audited), 'all_pass': allpass,
                      'events_checked': sum(r['events_checked'] for r in res),
                      'violations': [{'scenario': r['scenario'], 'policy': r['policy'], 'counts': r['violation_counts'],
                                      'detail': r['violations'][:12]} for r in res if not r['pass']]}, indent=2))
    sys.exit(0 if allpass else 1)
