#!/usr/bin/env python3
"""Independent audit of Digital Marshal SUMO run directories (standard library only; imports neither dm_run nor traci).

usage: python sumo_audit.py RUN_DIR [RUN_DIR ...]            audit each run directory
       python sumo_audit.py --pair BASELINE_DIR TREATMENT_DIR  also check the two runs are a matched comparison
Exit 0 only if every audit passes; 1 otherwise; 2 if the auditor itself crashed. Prints JSON with check names and details.

A run directory must contain run_manifest.json (run_status COMPLETE), summary.json, vehicles.csv, decisions.csv, crossings.json,
tripinfo.xml and demand.rou.xml. Missing, empty, malformed or inconsistent evidence is a violation, never a default. The audit
checks properties of the raw per vehicle records and the decision log; it does not re-run any policy. The hard gates reported
by the run (closed link entries, illegal transitions, incomplete trips, infeasible routes) are RECOMPUTED here from vehicles.csv
where possible."""
import csv, hashlib, json, math, sys
from pathlib import Path

REQUIRED = ('run_manifest.json', 'summary.json', 'vehicles.csv', 'decisions.csv', 'crossings.json', 'tripinfo.xml', 'demand.rou.xml')
ALLOWED = {('E1', 'E4', 'E5', 'E6', 'E11'): 'A', ('E1', 'E7', 'E8', 'E9', 'E10', 'E11'): 'B'}
CLOSED = {'E2', 'E3'}
TOL = 0.011
MATCH_KEYS = ('scenario', 'seed', 'capacity_variant', 'capacity_scale', 'driver_tau_s', 'network_file', 'k_sumo_per_abstract', 'abstract_vehicles',
              'abstract_spacing_s', 'sumo_vehicles', 'step_length_s', 'incident_s', 'closed_edges', 'update_s', 'lead_s', 'horizon_s',
              'measurement_window_s', 'unfinished_trip_convention', 'mu_A', 'mu_B')


def sha(p):
    h = hashlib.sha256(); h.update(Path(p).read_bytes()); return h.hexdigest()


def load(d):
    """Return (data, violations). data is None if a required file is unusable."""
    d = Path(d); V = []
    def bad(check, **kw): V.append({'check': check, 'run': d.name, **kw})
    for n in REQUIRED:
        p = d / n
        if not p.exists(): bad('missing_file', file=n)
        elif p.stat().st_size == 0: bad('empty_file', file=n)
    if V: return None, V
    try:
        man = json.loads((d / 'run_manifest.json').read_text()); summ = json.loads((d / 'summary.json').read_text())
        cross = json.loads((d / 'crossings.json').read_text())
        with (d / 'vehicles.csv').open(newline='') as f: veh = list(csv.DictReader(f))
        with (d / 'decisions.csv').open(newline='') as f: dec = list(csv.DictReader(f))
    except (ValueError, OSError, csv.Error, UnicodeDecodeError) as e:
        bad('unreadable_file', error=str(e)[:150]); return None, V
    need_v = {'vehicle', 'sched_depart_s', 'route', 'arrival_s', 'travel_time_s', 'complete', 'edges'}
    need_d = {'tick_s', 'vehicle', 'policy', 'route', 'tau_to_P_s', 'cohort_size'}
    if not veh or not need_v <= set(veh[0]): bad('missing_columns', file='vehicles.csv', missing=sorted(need_v - set(veh[0] if veh else [])))
    if not dec or not need_d <= set(dec[0]): bad('missing_columns', file='decisions.csv', missing=sorted(need_d - set(dec[0] if dec else [])))
    if V: return None, V
    return dict(man=man, summ=summ, cross=cross, veh=veh, dec=dec), V


def audit_run(d):
    d = Path(d); data, V = load(d)
    if data is None: return V
    man, summ, cross, veh, dec = (data[k] for k in ('man', 'summ', 'cross', 'veh', 'dec'))
    def bad(check, **kw): V.append({'check': check, 'run': d.name, **kw})
    if man.get('run_status') != 'COMPLETE': bad('run_status_not_complete', status=man.get('run_status'), reasons=man.get('invalid_reasons'))
    for n, h in (man.get('output_sha256') or {}).items():
        if not (d / n).exists() or sha(d / n) != h: bad('output_hash_mismatch', file=n)
    for n in REQUIRED:
        if n not in (man.get('output_sha256') or {}) and n not in ('run_manifest.json',): bad('file_not_hashed_in_manifest', file=n)
    if man.get('input_sha256', {}).get('demand') != sha(d / 'demand.rou.xml'): bad('demand_hash_mismatch')
    H = man.get('horizon_s'); inc = man.get('incident_s'); upd = man.get('update_s'); lead = man.get('lead_s')
    try:
        if summ.get('horizon_s') != H: bad('horizon_metadata_mismatch', summary=summ.get('horizon_s'), manifest=H)
        if man.get('measurement_window_s') != [0.0, H]: bad('measurement_window_mismatch', window=man.get('measurement_window_s'))
        # ---- per vehicle records
        ids = [r['vehicle'] for r in veh]
        if len(ids) != len(set(ids)): bad('duplicate_vehicle_rows')
        if len(veh) != summ.get('vehicles') or len(veh) != man.get('sumo_vehicles'): bad('vehicle_count', rows=len(veh), summary=summ.get('vehicles'), manifest=man.get('sumo_vehicles'))
        tot = 0.0; ncomp = 0; nA = nB = nun = closed_n = badpath = 0
        for r in veh:
            sd, tt = float(r['sched_depart_s']), float(r['travel_time_s']); comp = r['complete'] == 'True'
            if r['complete'] not in ('True', 'False'): bad('complete_flag_malformed', vehicle=r['vehicle'])
            tot += tt / 60.0; ncomp += comp
            if comp:
                if r['arrival_s'] == '' or abs(float(r['arrival_s']) - sd - tt) > TOL: bad('travel_time_accounting', vehicle=r['vehicle'])
                elif float(r['arrival_s']) > H + 1e-9: bad('completed_after_horizon', vehicle=r['vehicle'])
            else:
                if r['arrival_s'] != '' or abs(tt - (H - sd)) > TOL: bad('censoring_accounting', vehicle=r['vehicle'])
            path = tuple(r['edges'].split())
            closed_n += sum(e in CLOSED for e in path)
            lab = ALLOWED.get(path)
            if lab is None and r['complete'] == 'True': badpath += 1; bad('path_not_allowed', vehicle=r['vehicle'], path=' '.join(path))
            if r['route'] and lab is not None and lab != r['route']: bad('route_label_vs_path', vehicle=r['vehicle'], label=r['route'], driven=lab)
            if not r['route']: nun += 1
            nA += r['route'] == 'A'; nB += r['route'] == 'B'
        for k, v in (('completed', ncomp), ('incomplete', len(veh) - ncomp), ('n_A', nA), ('n_B', nB), ('unassigned', nun), ('closed_link_entries', closed_n)):
            if summ.get(k) != v: bad('summary_vs_vehicles', field=k, summary=summ.get(k), recomputed=v)
        if abs(summ.get('total_vehicle_min', -1) - tot) > 1e-5 * len(veh) + 1e-3: bad('summary_vs_vehicles', field='total_vehicle_min', summary=summ.get('total_vehicle_min'), recomputed=round(tot, 4))
        # ---- unfinished accounting and termination
        inc_n = len(veh) - ncomp
        if inc_n != man.get('in_network_at_end', -1) + man.get('not_inserted_at_end', -1): bad('unfinished_accounting', incomplete=inc_n, in_network=man.get('in_network_at_end'), not_inserted=man.get('not_inserted_at_end'))
        if man.get('termination_reason') == 'all_arrived' and inc_n: bad('termination_reason_inconsistent', reason='all_arrived', incomplete=inc_n)
        if man.get('termination_reason') == 'horizon' and not inc_n and man.get('sim_end_s', 0) < H: bad('termination_reason_inconsistent', reason='horizon', incomplete=0, sim_end=man.get('sim_end_s'))
        if man.get('termination_reason') not in ('all_arrived', 'horizon'): bad('termination_reason_unknown', reason=man.get('termination_reason'))
        # ---- decisions
        dv = [r['vehicle'] for r in dec]
        if len(dv) != len(set(dv)): bad('duplicate_decisions')
        assigned = {r['vehicle']: r['route'] for r in veh if r['route']}
        if set(dv) != set(assigned): bad('decision_vehicle_set', decided_not_assigned=sorted(set(dv) - set(assigned))[:5], assigned_not_decided=sorted(set(assigned) - set(dv))[:5])
        per_tick = {}
        for r in dec:
            t = float(r['tick_s']); per_tick[t] = per_tick.get(t, 0) + 1
            if assigned.get(r['vehicle']) not in (None, r['route']): bad('decision_route_vs_vehicle_record', vehicle=r['vehicle'], decision=r['route'], record=assigned.get(r['vehicle']))
            if t < inc or abs(((t - inc) / upd) - round((t - inc) / upd)) > 1e-9: bad('decision_tick_off_grid', vehicle=r['vehicle'], tick_s=t)
            if float(r['tau_to_P_s']) > lead + 1e-9: bad('decision_outside_lead_time', vehicle=r['vehicle'], tau=r['tau_to_P_s'])
            c = cross.get(r['vehicle'])
            if c is not None and c[0] < t - 1e-9: bad('decision_after_P_crossing', vehicle=r['vehicle'], tick_s=t, crossed=c[0])
            if c is not None and c[1] != r['route']: bad('crossing_route_vs_decision', vehicle=r['vehicle'])
            if r['policy'] != man.get('policy'): bad('decision_policy_vs_manifest', vehicle=r['vehicle'])
        for r in dec:
            if per_tick[float(r['tick_s'])] != int(r['cohort_size']): bad('cohort_size_vs_rows', tick_s=r['tick_s']); break
        # ---- gates as reported
        recomputed_fail = [k for k, v in (('incomplete_trips', inc_n), ('closed_link_entries', closed_n), ('unassigned_vehicles', nun)) if v]
        if badpath: recomputed_fail.append('illegal_paths')
        reported = set(summ.get('failed_gates') or [])
        for g in recomputed_fail:
            if g != 'illegal_paths' and g not in reported: bad('gate_not_reported', gate=g)
        if summ.get('checks_pass') and recomputed_fail: bad('checks_pass_contradicted', recomputed=recomputed_fail)
        if bool(summ.get('checks_pass')) != bool(man.get('checks_pass')): bad('checks_pass_summary_vs_manifest')
    except (KeyError, ValueError, TypeError) as e:
        bad('malformed_record', error=f'{type(e).__name__}: {str(e)[:120]}')
    return V


def audit_pair(base, treat):
    base, treat = Path(base), Path(treat); V = []
    def bad(check, **kw): V.append({'check': check, 'run': f'{base.name} vs {treat.name}', **kw})
    try:
        a = json.loads((base / 'run_manifest.json').read_text()); b = json.loads((treat / 'run_manifest.json').read_text())
    except (OSError, ValueError) as e:
        bad('pair_manifest_unreadable', error=str(e)[:100]); return V
    for k in MATCH_KEYS:
        if a.get(k) != b.get(k): bad('pair_mismatch', field=k, baseline=a.get(k), treatment=b.get(k))
    for k in ('network', 'demand', 'calibration'):
        if a.get('input_sha256', {}).get(k) != b.get('input_sha256', {}).get(k): bad('pair_input_hash_mismatch', input=k)
    if a.get('versions', {}).get('sumo') != b.get('versions', {}).get('sumo'): bad('pair_sumo_version_mismatch')
    if a.get('policy') == b.get('policy'): bad('pair_same_policy', policy=a.get('policy'))
    for m in (a, b):
        if m.get('run_status') != 'COMPLETE': bad('pair_run_not_complete', policy=m.get('policy'))
    return V


def main(argv):
    pair = None
    if argv and argv[0] == '--pair':
        pair, argv = argv[1:3], argv[3:]
    dirs = argv + (pair or [])
    if not dirs: print('usage: sumo_audit.py RUN_DIR... | --pair BASE TREAT'); return 2
    allv = []
    for d in dirs: allv += audit_run(d)
    if pair: allv += audit_pair(*pair)
    print(json.dumps({'runs_audited': len(dirs), 'all_pass': not allv, 'violations': allv[:40]}, indent=2))
    return 0 if not allv else 1


if __name__ == '__main__':
    try: sys.exit(main(sys.argv[1:]))
    except Exception as e:
        print(json.dumps({'all_pass': False, 'error': 'audit_crashed', 'detail': f'{type(e).__name__}: {str(e)[:200]}'})); sys.exit(2)
