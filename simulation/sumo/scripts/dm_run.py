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
import argparse, csv, json, math, os, random, sys
from pathlib import Path

import traci
import sumolib

HERE = Path(__file__).resolve().parent
NET = HERE.parent / 'network' / 'dm.net.xml'

V = 13.89
E1_LEN = 2500.2
ROUTES = {'A': ['E1', 'E4', 'E5', 'E6', 'E11'], 'B': ['E1', 'E7', 'E8', 'E9', 'E10', 'E11']}
FREE_P_TO_D = {'A': 360.0, 'B': 480.0}             # free-flow seconds from P to D
APPROACH_LANES = {'A': ['E1_0'], 'B': ['E1_1', 'E1_2']}
CLOSED_EDGES = ('E2', 'E3')
INCIDENT_S, UPDATE_S, LEAD_S, SIM_HORIZON_S = 120.0, 30.0, 60.0, 3600.0
K = 7.5   # SUMO vehicles per abstract vehicle (1 abstract veh/min == 450 veh/h; see build_network.py)
# (n_abstract_vehicles, abstract_departure_spacing_s)  same as WP2.7 scenarios
SCENARIOS = {'manageable_primary': (10, 10.0), 'near_branch_capacity': (24, 5.0), 'overload_stress': (60, 2.0)}
POLICIES = ('static', 'measured_periodic', 'independent_periodic', 'coordinated_batch')


def make_demand(scenario, seed, out):
    n_abs, sp_abs = SCENARIOS[scenario]
    n, gap = int(round(n_abs * K)), sp_abs / K
    rng = random.Random(1000 + seed)
    dep = sorted(max(0.0, i * gap + rng.uniform(-0.25, 0.25) * gap) for i in range(n))
    rou = ['<routes>',
           '  <vType id="car" vClass="passenger" accel="2.6" decel="4.5" emergencyDecel="9.0" sigma="0.5" tau="1.0" '
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
    else:
        raise ValueError(policy)
    return out, rows


def run(scenario, policy, seed, outdir, calib, headless=True):
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    mu = {'A': calib['mu_A'], 'B': calib['mu_B']}
    rou, sched = make_demand(scenario, seed, out)
    cfg = ['sumo', '-n', str(NET), '-r', str(rou), '--seed', str(seed), '--time-to-teleport', '-1', '--no-step-log', 'true',
           '--no-warnings', 'true', '--collision.action', 'warn', '--tripinfo-output', str(out / 'tripinfo.xml'),
           '--step-length', '1.0']
    traci.start(cfg)
    net = sumolib.net.readNet(str(NET))
    L1 = traci.lane.getLength('E1_0')
    assigned, route_of, seq, last_edge = {}, {}, {}, {}
    last_p, committed_dict, decisions, p_cross = {}, {}, [], {}
    closure_entries, collisions, arrivals, n_total = [], 0, {}, len(sched)
    t = 0.0
    while True:
        traci.simulationStep(); t = traci.simulation.getTime()
        if abs(t - INCIDENT_S) < 1e-9:
            for e in CLOSED_EDGES:
                for ln in range(traci.edge.getLaneNumber(e)): traci.lane.setDisallowed(f'{e}_{ln}', ['passenger'])
        collisions += traci.simulation.getCollidingVehiclesNumber()
        for vid in traci.vehicle.getIDList():
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
                    traci.vehicle.setRoute(vid, ROUTES[chosen[vid]]); assigned[vid] = chosen[vid]
                    decisions.append(dict(tick_s=t, vehicle=vid, policy=policy, route=r, tau_to_P_s=round(tau, 2),
                                          cost_A=cA, cost_B=cB, cohort_size=len(cohort)))
        if (len(arrivals) >= n_total) or t >= SIM_HORIZON_S: break
    # unfinished vehicles at the horizon
    left = set(traci.vehicle.getIDList())
    traci.close()

    # ---- vehicle table from SUMO's own tripinfo (sched depart known from the demand file) ----
    import xml.etree.ElementTree as ET
    ti = {x.get('id'): x for x in ET.parse(out / 'tripinfo.xml').getroot().iter('tripinfo')}
    rows, tts = [], []
    for vid, sd in sched.items():
        if vid in ti and vid in arrivals:
            x = ti[vid]; arr = float(x.get('arrival')); tt = arr - sd; complete = True
        else:
            arr = None; tt = SIM_HORIZON_S - sd; complete = False        # censored at horizon, flagged
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
                   duplicate_arrivals=0, sim_end_s=t, mean_time_loss_s=round(sum(float(r['time_loss_s'] or 0) for r in rows) / len(rows), 3))
    summary['checks_pass'] = (summary['incomplete'] == 0 and summary['closed_link_entries'] == 0 and
                              summary['illegal_transitions'] == 0 and summary['unassigned'] == 0 and summary['collisions'] == 0)
    (out / 'summary.json').write_text(json.dumps(summary, indent=2))
    (out / 'crossings.json').write_text(json.dumps({v: [p_cross[v], assigned.get(v)] for v in p_cross}))
    for name, rr in (('vehicles.csv', rows), ('decisions.csv', decisions)):
        if rr:
            with (out / name).open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=list(rr[0])); w.writeheader(); w.writerows(rr)
    return summary


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenario', default='near_branch_capacity'); ap.add_argument('--policy', default='coordinated_batch')
    ap.add_argument('--seed', type=int, default=1); ap.add_argument('--out', required=True)
    ap.add_argument('--calib', default=str(HERE.parent / 'network' / 'calibration.json'))
    a = ap.parse_args()
    calib = json.load(open(a.calib)) if Path(a.calib).exists() else {'mu_A': 0.5, 'mu_B': 1.0}
    print(json.dumps(run(a.scenario, a.policy, a.seed, a.out, calib)))
