#!/usr/bin/env python3
"""Digital Marshal SUMO cross-check, single run.

Policies (same network, same demand, same closure, same decision cohort rule):
  static                 every cohort vehicle -> route A (shortest free-flow after closure)
  measured_periodic      each vehicle, independently, picks the route with the lower
                         free-flow + halting-queue estimate read from the approach lanes (SUMO-observable state only)
  independent_periodic   each vehicle, independently, picks argmin of the SHARED predictor evaluated on the pre-batch
                         snapshot (committed vehicles only, no peer reservation)   == WP2.7 'independent_periodic'
  coordinated_batch      the batch is allocated jointly: all A/B counts k, A assignments spread evenly across the batch,
                         minimise predicted total completion time on the SAME shared predictor == WP2.7 'coordinated_batch'
Decision timing: ticks every UPDATE_S from the incident; a vehicle is decided at the first tick at which its free-flow
time to P is <= LEAD_S, and the route is then locked (no switching, as in WP2.7).
usage: dm_run.py --scenario near_branch_capacity --policy coordinated_batch --seed 1 --out DIR [--calib calibration.json]
"""
import argparse, csv, hashlib, json, math, os, platform, random, sys
from pathlib import Path

import traci
import sumolib

HERE = Path(__file__).resolve().parent
NETDIR = HERE.parent / 'network'
NET = NETDIR / 'dm.net.xml'            # baseline network (historical default)

V = 13.89
E1_LEN = 2500.2
ROUTES = {'A': ['E1', 'E4', 'E5', 'E6', 'E11'], 'B': ['E1', 'E7', 'E8', 'E9', 'E10', 'E11']}
FREE_P_TO_D = {'A': 360.0, 'B': 480.0}             # free-flow seconds from P to D
APPROACH_LANES = {'A': ['E1_0'], 'B': ['E1_1', 'E1_2']}
CLOSED_EDGES = ('E2', 'E3')
INCIDENT_S, UPDATE_S, LEAD_S, SIM_HORIZON_S = 120.0, 30.0, 60.0, 3600.0
K = 7.5   # SUMO vehicles per abstract vehicle (1 abstract veh/min == 450 veh/h; see build_network.py)
# (n_abstract_vehicles, abstract_departure_spacing_s)  same as WP2.7 scenarios
SCENARIOS = {'manageable_primary': (10, 10.0), 'near_branch_capacity': (24, 5.0), 'overload_stress': (60, 2.0),
             'primary_half_capacity': (10, 10.0), 'primary_double_capacity': (10, 10.0)}
POLICIES = ('static', 'measured_periodic', 'independent_periodic', 'coordinated_batch')
CONTROL_POLICIES = ('no_reroute_control',)   # negative control only: keeps the pre incident route; never a comparator
CONTROL_ROUTES = {'C': ['E1', 'E2', 'E3']}
SCHEMA_VERSION = 'dm_sumo_run_v2'
# Capacity variants. The point queue multiplies the capacity of E4..E10 by `capacity_scale`. SUMO has no service rate knob:
#   base   : lanes as built (A one lane, B two lanes), driver time headway tau 1.0 (the historical configuration)
#   cap2   : branch lanes doubled (A two lanes, B four lanes) in network/dm_cap2.net.xml  -> structural x2
#   cap0p5 : same lanes as base, driver time headway raised to TAU_HALF for every vehicle -> discharge approximately x0.5
# The achieved discharge ratio is MEASURED by calibrate.py (network/calibration_<variant>.json) and reported, never assumed.
TAU_HALF = 3.0
VARIANTS = {'base': dict(net='dm.net.xml', tau=1.0, capacity_scale=1.0, calib='calibration.json'),
            'cap2': dict(net='dm_cap2.net.xml', tau=1.0, capacity_scale=2.0, calib='calibration_cap2.json'),
            'cap0p5': dict(net='dm.net.xml', tau=TAU_HALF, capacity_scale=0.5, calib='calibration_cap0p5.json')}
SCENARIO_VARIANT = {'primary_half_capacity': 'cap0p5', 'primary_double_capacity': 'cap2'}


def make_demand(scenario, seed, out, tau=1.0):
    n_abs, sp_abs = SCENARIOS[scenario]
    n, gap = int(round(n_abs * K)), sp_abs / K
    rng = random.Random(1000 + seed)
    dep = sorted(max(0.0, i * gap + rng.uniform(-0.25, 0.25) * gap) for i in range(n))
    rou = ['<routes>',
           f'  <vType id="car" vClass="passenger" accel="2.6" decel="4.5" emergencyDecel="9.0" sigma="0.5" tau="{tau}" '
           'length="5.0" minGap="2.5" maxSpeed="13.89" speedFactor="normc(1.0,0.1,0.8,1.2)"/>',
           '  <route id="r_unassigned" edges="E1"/>']
    for i, d in enumerate(dep):
        rou.append(f'  <vehicle id="v{i:03d}" type="car" route="r_unassigned" depart="{d:.2f}" departLane="random" departSpeed="max"/>')
    rou.append('</routes>')
    path = Path(out) / 'demand.rou.xml'
    path.write_text('\n'.join(rou))
    return path, {f'v{i:03d}': d for i, d in enumerate(dep)}


# ---------------- shared predictor (identical for independent_periodic and coordinated_batch) ----------------
class Predictor:
    """FIFO service recurrence at the P diverge, with measured discharge rates mu_r (veh/s). Same structure as the
    WP2.7 edge recurrence exit = max(free_exit, prev_exit + 1/mu), but ONLY the P bottleneck is modelled and mu comes from
    SUMO calibration, not from the abstract table."""
    def __init__(self, mu):
        self.mu = mu

    def snapshot(self, now, last_p, committed):
        """avail[r] = predicted time the last already-committed vehicle leaves P on route r."""
        avail = {r: last_p.get(r, -1e9) for r in ROUTES}
        for tau, r in sorted(committed):                 # ascending distance to P
            if r not in avail: continue                   # control route C is outside the A/B predictor
            avail[r] = max(now + tau, avail[r] + 1.0 / self.mu[r])
        return avail

    def completion(self, now, tau, r, avail_r):
        dep = max(now + tau, avail_r + 1.0 / self.mu[r])
        return dep, dep + FREE_P_TO_D[r]


def decide(policy, now, cohort, committed, last_p, mu):
    """cohort: list of (vid, tau) sorted by tau asc. returns {vid: route}, log rows"""
    pred = Predictor(mu)
    avail0 = pred.snapshot(now, last_p, committed)
    out, rows = {}, []
    if policy in ('static', 'allB'):          # 'allB' is for calibration only, not part of POLICIES
        fixed = 'A' if policy == 'static' else 'B'
        for vid, tau in cohort:
            out[vid] = fixed; rows.append((vid, tau, fixed, '', ''))
    elif policy == 'measured_periodic':
        # information tier: measured halting vehicles on the approach lanes only (no commitments, no peers)
        q = {r: sum(traci.lane.getLastStepHaltingNumber(l) for l in ls) for r, ls in APPROACH_LANES.items()}
        cost = {r: FREE_P_TO_D[r] + q[r] / mu[r] for r in ROUTES}
        r = min(('A', 'B'), key=lambda x: (cost[x], x))
        for vid, tau in cohort:
            out[vid] = r; rows.append((vid, tau, r, round(cost['A'], 2), round(cost['B'], 2)))
    elif policy == 'independent_periodic':
        for vid, tau in cohort:
            cA = pred.completion(now, tau, 'A', avail0['A'])[1]; cB = pred.completion(now, tau, 'B', avail0['B'])[1]
            r = min(('A', 'B'), key=lambda x: ({'A': cA, 'B': cB}[x], x))
            out[vid] = r; rows.append((vid, tau, r, round(cA - now, 2), round(cB - now, 2)))
    elif policy == 'coordinated_batch':
        m = len(cohort); best = None
        for k in range(m + 1):
            av = dict(avail0); total = 0.0; pat = {}
            for i, (vid, tau) in enumerate(cohort):
                r = 'A' if ((i + 1) * k) // m > (i * k) // m else 'B'
                dep, comp = pred.completion(now, tau, r, av[r]); av[r] = dep; total += comp; pat[vid] = r
            key = (total, -k)
            if best is None or key < best[0]: best = (key, pat, k)
        out = best[1]
        for vid, tau in cohort: rows.append((vid, tau, out[vid], '', f'k={best[2]}/{m}'))
    elif policy == 'no_reroute_control':
        # NEGATIVE CONTROL, not a comparator: every vehicle keeps the pre incident (critical) route through the closed edges.
        for vid, tau in cohort:
            out[vid] = 'C'; rows.append((vid, tau, 'C', '', ''))
    else:
        raise ValueError(policy)
    return out, rows


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


REQUIRED_OUTPUTS = ('summary.json', 'vehicles.csv', 'decisions.csv', 'crossings.json', 'tripinfo.xml', 'demand.rou.xml')


def run(scenario, policy, seed, outdir, calib, headless=True, horizon_s=None, variant=None, calib_path=None):
    """Run one scenario x policy x seed and write summary.json, vehicles.csv, decisions.csv, crossings.json, tripinfo.xml,
    demand.rou.xml and, last, run_manifest.json (configuration identity, hashes, horizon, termination, validity).
    A run whose required outputs are missing or inconsistent gets run_status INVALID and raises RunInvalid; it never returns a
    plausible looking summary."""
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    try:
        summary = _run(scenario, policy, seed, out, calib, horizon_s, variant, calib_path)
    except Exception as e:
        (out / 'run_manifest.json').write_text(json.dumps({'schema': SCHEMA_VERSION, 'run_status': 'INVALID', 'scenario': scenario,
            'policy': policy, 'seed': seed, 'invalid_reasons': [f'{type(e).__name__}: {str(e)[:300]}']}, indent=2, sort_keys=True))
        raise
    return summary


class RunInvalid(Exception): pass


def _run(scenario, policy, seed, out, calib, horizon_s, variant, calib_path):
    vname = variant or SCENARIO_VARIANT.get(scenario, 'base'); VAR = VARIANTS[vname]
    horizon = SIM_HORIZON_S if horizon_s is None else float(horizon_s)
    net_path = NETDIR / VAR['net']
    if not net_path.exists(): raise RunInvalid(f'network file missing: {net_path.name}')
    mu = {'A': calib['mu_A'], 'B': calib['mu_B']}
    rou, sched = make_demand(scenario, seed, out, tau=VAR['tau'])
    cfg = ['sumo', '-n', str(net_path), '-r', str(rou), '--seed', str(seed), '--time-to-teleport', '-1', '--no-step-log', 'true',
           '--no-warnings', 'true', '--collision.action', 'warn', '--tripinfo-output', str(out / 'tripinfo.xml'),
           '--step-length', '1.0']
    traci.start(cfg)
    sumo_version = traci.getVersion()[1]
    net = sumolib.net.readNet(str(net_path))
    L1 = traci.lane.getLength('E1_0')
    assigned, route_of, seq, last_edge = {}, {}, {}, {}
    last_p, committed_dict, decisions, p_cross = {}, {}, [], {}
    closure_entries, collisions, arrivals, n_total = [], 0, {}, len(sched)
    feas_fail, ever_seen = [], set()
    t = 0.0
    while True:
        traci.simulationStep(); t = traci.simulation.getTime()
        if abs(t - INCIDENT_S) < 1e-9:
            for e in CLOSED_EDGES:
                for ln in range(traci.edge.getLaneNumber(e)): traci.lane.setDisallowed(f'{e}_{ln}', ['passenger'])
        collisions += traci.simulation.getCollidingVehiclesNumber()
        for vid in traci.vehicle.getIDList():
            ever_seen.add(vid)
            rid = traci.vehicle.getRoadID(vid)
            if rid.startswith(':'): continue
            if last_edge.get(vid) != rid:
                seq.setdefault(vid, []).append(rid)
                if rid in CLOSED_EDGES and t >= INCIDENT_S: closure_entries.append((vid, rid, t))
                if last_edge.get(vid) == 'E1' and rid in ('E4', 'E7'):
                    r = 'A' if rid == 'E4' else 'B'
                    p_cross[vid] = t; last_p[r] = t
                last_edge[vid] = rid
        for vid in traci.simulation.getArrivedIDList(): arrivals[vid] = t
        if t >= INCIDENT_S and (t - INCIDENT_S) % UPDATE_S < 1e-9:
            cohort, committed = [], []
            for vid in traci.vehicle.getIDList():
                if last_edge.get(vid) != 'E1': continue
                tau = (L1 - traci.vehicle.getLanePosition(vid)) / V
                if vid in assigned: committed.append((tau, assigned[vid]))
                elif tau <= LEAD_S: cohort.append((vid, tau))
            cohort.sort(key=lambda x: x[1])
            if cohort:
                chosen, rows = decide(policy, t, cohort, committed, last_p, mu)
                for (vid, tau, r, cA, cB) in rows:
                    edges = (ROUTES | CONTROL_ROUTES)[chosen[vid]]
                    try: traci.vehicle.setRoute(vid, edges)
                    except traci.TraCIException as ex: feas_fail.append((vid, chosen[vid], str(ex)[:100]))
                    assigned[vid] = chosen[vid]
                    decisions.append(dict(tick_s=t, vehicle=vid, policy=policy, route=r, tau_to_P_s=round(tau, 2),
                                          cost_A=cA, cost_B=cB, cohort_size=len(cohort)))
        if (len(arrivals) >= n_total) or t >= horizon: break
    termination = 'all_arrived' if len(arrivals) >= n_total else 'horizon'
    # unfinished vehicles at the end of the measurement window
    in_network = len(traci.vehicle.getIDList())
    not_inserted = n_total - len(ever_seen)
    traci.close()

    # ---- vehicle table from SUMO's own tripinfo (sched depart known from the demand file) ----
    import xml.etree.ElementTree as ET
    ti = {x.get('id'): x for x in ET.parse(out / 'tripinfo.xml').getroot().iter('tripinfo')}
    rows, tts = [], []
    for vid, sd in sched.items():
        if vid in ti and vid in arrivals:
            x = ti[vid]; arr = float(x.get('arrival')); tt = arr - sd; complete = True
        else:
            arr = None; tt = horizon - sd; complete = False        # censored at the horizon, flagged (same convention as the point queue)
        tts.append(tt / 60.0)
        rows.append(dict(vehicle=vid, sched_depart_s=sd, actual_depart_s=ti[vid].get('depart') if vid in ti else '',
                         route=assigned.get(vid, ''), arrival_s=arr if arr is not None else '', travel_time_s=round(tt, 2),
                         complete=complete, time_loss_s=ti[vid].get('timeLoss') if vid in ti else '',
                         waiting_s=ti[vid].get('waitingTime') if vid in ti else '', edges=' '.join(seq.get(vid, []))))
    # ---- audits computed from the trace (not constants) ----
    bad_trans = []
    for vid, s in seq.items():
        for a, b in zip(s, s[1:]):
            if net.getEdge(b) not in net.getEdge(a).getOutgoing(): bad_trans.append((vid, a, b))
    s_t = sorted(tts); p95 = s_t[math.ceil(.95 * len(s_t)) - 1]
    summary = dict(scenario=scenario, policy=policy, seed=seed, vehicles=n_total, completed=sum(r['complete'] for r in rows),
                   incomplete=sum(not r['complete'] for r in rows), total_vehicle_min=round(sum(tts), 4),
                   mean_min=round(sum(tts) / len(tts), 4), p95_min=round(p95, 4), n_A=sum(1 for r in rows if r['route'] == 'A'),
                   n_B=sum(1 for r in rows if r['route'] == 'B'), unassigned=sum(1 for r in rows if not r['route']),
                   closed_link_entries=len(closure_entries), illegal_transitions=len(bad_trans), collisions=int(collisions),
                   duplicate_arrivals=0, sim_end_s=t, mean_time_loss_s=round(sum(float(r['time_loss_s'] or 0) for r in rows) / len(rows), 3),
                   horizon_s=horizon, termination_reason=termination, in_network_at_end=in_network, not_inserted_at_end=not_inserted,
                   route_infeasible=len(feas_fail), capacity_variant=vname, capacity_scale=VAR['capacity_scale'])
    reasons = [k for k, bad in (('incomplete_trips', summary['incomplete']), ('closed_link_entries', summary['closed_link_entries']),
               ('illegal_transitions', summary['illegal_transitions']), ('unassigned_vehicles', summary['unassigned']),
               ('collisions', summary['collisions']), ('route_infeasible', summary['route_infeasible'])) if bad]
    summary['checks_pass'] = not reasons
    summary['failed_gates'] = reasons
    (out / 'summary.json').write_text(json.dumps(summary, indent=2))
    (out / 'crossings.json').write_text(json.dumps({v: [p_cross[v], assigned.get(v)] for v in p_cross}))
    for name, rr in (('vehicles.csv', rows), ('decisions.csv', decisions)):
        with (out / name).open('w', newline='') as f:
            if rr:
                w = csv.DictWriter(f, fieldnames=list(rr[0])); w.writeheader(); w.writerows(rr)
            else:
                f.write('')                       # an empty file is detected as invalid below; never silently skipped
    # ---- validity: required outputs present, non empty and consistent with each other ----
    invalid = []
    for name in REQUIRED_OUTPUTS:
        if not (out / name).exists() or (out / name).stat().st_size == 0: invalid.append(f'missing_or_empty:{name}')
    if len(rows) != n_total: invalid.append(f'vehicle_rows {len(rows)} != {n_total}')
    if not decisions and policy not in ('no_reroute_control',) and n_total: invalid.append('no_decisions_logged')
    if len(decisions) != len({d['vehicle'] for d in decisions}): invalid.append('duplicate_decisions')
    if len(decisions) != len(assigned): invalid.append(f'decisions {len(decisions)} != assigned {len(assigned)}')
    cfg_id = {'schema': SCHEMA_VERSION, 'scenario': scenario, 'policy': policy, 'seed': seed, 'capacity_variant': vname,
              'capacity_scale': VAR['capacity_scale'], 'driver_tau_s': VAR['tau'], 'network_file': VAR['net'], 'k_sumo_per_abstract': K,
              'abstract_vehicles': SCENARIOS[scenario][0], 'abstract_spacing_s': SCENARIOS[scenario][1], 'sumo_vehicles': n_total,
              'step_length_s': 1.0, 'incident_s': INCIDENT_S, 'closed_edges': list(CLOSED_EDGES), 'update_s': UPDATE_S, 'lead_s': LEAD_S,
              'horizon_s': horizon, 'measurement_window_s': [0.0, horizon], 'unfinished_trip_convention': 'travel time censored at horizon_s minus scheduled departure; complete=false',
              'mu_A': mu['A'], 'mu_B': mu['B']}
    manifest = dict(cfg_id, run_status='INVALID' if invalid else 'COMPLETE', invalid_reasons=invalid, checks_pass=summary['checks_pass'],
                    failed_gates=reasons, termination_reason=termination, sim_end_s=t, in_network_at_end=in_network, not_inserted_at_end=not_inserted,
                    versions={'sumo': sumo_version, 'traci': getattr(traci, '__version__', ''), 'python': platform.python_version()},
                    input_sha256={'network': sha256_file(net_path), 'dm_run.py': sha256_file(Path(__file__)),
                                  'calibration': sha256_file(calib_path) if calib_path else 'inline',
                                  'demand': sha256_file(out / 'demand.rou.xml')},
                    output_sha256={n: sha256_file(out / n) for n in REQUIRED_OUTPUTS if (out / n).exists()})
    (out / 'run_manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True))
    if invalid: raise RunInvalid('; '.join(invalid))
    return summary


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenario', default='near_branch_capacity'); ap.add_argument('--policy', default='coordinated_batch')
    ap.add_argument('--seed', type=int, default=1); ap.add_argument('--out', required=True)
    ap.add_argument('--calib', default=None, help='calibration json; default is the one of the capacity variant')
    ap.add_argument('--horizon', type=float, default=None, help=f'measurement horizon in seconds (default {SIM_HORIZON_S:g}, the historical SUMO value; decision D1 is open)')
    ap.add_argument('--variant', default=None, choices=sorted(VARIANTS), help='override the scenario capacity variant (calibration use)')
    a = ap.parse_args()
    vname = a.variant or SCENARIO_VARIANT.get(a.scenario, 'base')
    cpath = Path(a.calib) if a.calib else NETDIR / VARIANTS[vname]['calib']
    if not cpath.exists():
        print(json.dumps({'run_status': 'INVALID', 'reason': f'calibration file missing: {cpath.name}'})); sys.exit(3)
    calib = json.load(open(cpath))
    try:
        print(json.dumps(run(a.scenario, a.policy, a.seed, a.out, calib, horizon_s=a.horizon, variant=a.variant, calib_path=cpath)))
    except RunInvalid as e:
        print(json.dumps({'run_status': 'INVALID', 'reason': str(e)[:300]})); sys.exit(3)
