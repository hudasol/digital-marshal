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
  independent_batch_copy (Track C, sensitivity comparator) the first vehicle of the cohort (closest to P) is scored on the
                         SHARED predictor against committed vehicles only and the whole cohort copies its choice. This is the
                         decision rule of the frozen point-queue 'independent_periodic'; the cohort rule is still SUMO's.
Decision timing: ticks every UPDATE_S from the incident; a vehicle is decided at the first tick at which its free-flow
time to P is <= LEAD_S, and the route is then locked (no switching, as in WP2.7).
Branch capacity scale (Track C): the WP2.7 scale multiplies the capacity of E4..E10. SUMO has no service-rate knob, so
  scale 2.0 -> branch lane counts doubled (network/branch_x2/dm.net.xml; same lengths and speeds),
  scale 0.5 -> same network, and a vehicle's car-following headway tau is raised to the calibrated branch_tau while it is
               on E4..E10 (free-flow time unchanged; discharge rate measured by calibrate.py, calibration_branch_x0_5.json).
The realised scale is the measured discharge-rate ratio, not the nominal one.
usage: dm_run.py --scenario near_branch_capacity --policy coordinated_batch --seed 1 --out DIR
                 [--calib calibration.json] [--horizon-s 3600]
"""
import argparse, csv, hashlib, json, math, os, platform, random, sys
from pathlib import Path

try:
    import traci
    import sumolib
except ImportError:      # the pure helpers below (tests, aggregation) work without SUMO; run() needs it
    traci = sumolib = None

HERE = Path(__file__).resolve().parent
NETWORK_DIR = HERE.parent / 'network'
NET = NETWORK_DIR / 'dm.net.xml'

V = 13.89
E1_LEN = 2500.2
ROUTES = {'A': ['E1', 'E4', 'E5', 'E6', 'E11'], 'B': ['E1', 'E7', 'E8', 'E9', 'E10', 'E11']}
FREE_P_TO_D = {'A': 360.0, 'B': 480.0}             # free-flow seconds from P to D
APPROACH_LANES = {'A': ['E1_0'], 'B': ['E1_1', 'E1_2']}
CLOSED_EDGES = ('E2', 'E3')
BRANCH_EDGES = ('E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10')   # == graph_spec.json branch_scaled_edges
BASE_TAU = 1.0                                               # vType tau in make_demand
INCIDENT_S, UPDATE_S, LEAD_S, SIM_HORIZON_S = 120.0, 30.0, 60.0, 3600.0
# SIM_HORIZON_S is the historical default only. The point-queue contract is 7200 s (ADR-0001); which one SUMO uses is
# owner decision D1, still pending. Every run records the horizon it used.
K = 7.5   # SUMO vehicles per abstract vehicle (1 abstract veh/min == 450 veh/h; see build_network.py)
# (n_abstract_vehicles, abstract_departure_spacing_s, branch_capacity_scale)  same as the WP2.7 scenario table
SCENARIOS = {'manageable_primary': (10, 10.0, 1.0), 'near_branch_capacity': (24, 5.0, 1.0), 'overload_stress': (60, 2.0, 1.0),
             'primary_half_capacity': (10, 10.0, 0.5), 'primary_double_capacity': (10, 10.0, 2.0)}
# branch_capacity_scale -> how SUMO realises it
VARIANTS = {1.0: dict(net=NET, branch_tau=False, calib=NETWORK_DIR / 'calibration.json'),
            2.0: dict(net=NETWORK_DIR / 'branch_x2' / 'dm.net.xml', branch_tau=False,
                      calib=NETWORK_DIR / 'calibration_branch_x2.json'),
            0.5: dict(net=NET, branch_tau=True, calib=NETWORK_DIR / 'calibration_branch_x0_5.json')}
POLICIES = ('static', 'measured_periodic', 'independent_periodic', 'coordinated_batch')
TRACK_C_POLICIES = POLICIES + ('independent_batch_copy',)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def variant(scale):
    if scale not in VARIANTS: raise ValueError(f'no SUMO realisation for branch capacity scale {scale}')
    return VARIANTS[scale]


def load_calib(scale):
    p = variant(scale)['calib']
    if not p.exists(): raise FileNotFoundError(f'{p} missing: run calibrate.py for branch scale {scale} first')
    return json.loads(p.read_text())


def branch_tau(scale, calib):
    """Headway a vehicle uses while it is on a branch edge (None = unchanged)."""
    return float(calib['branch_tau']) if variant(scale)['branch_tau'] else None


def approach_lanes(net):
    """E1 lanes that connect to the first edge of each route at P, read from the network (base: the APPROACH_LANES constant)."""
    first = {ROUTES[r][1]: r for r in ROUTES}
    out = {r: [] for r in ROUTES}
    for lane in net.getEdge('E1').getLanes():
        for con in lane.getOutgoing():
            r = first.get(con.getToLane().getEdge().getID())
            if r and lane.getID() not in out[r]: out[r].append(lane.getID())
    return out


def apply_closure():
    """The incident: no passenger vehicle may enter a lane of E2 or E3 from now on (vehicles already routed there are
    stopped at the end of E1; new routes through them are rejected by SUMO at assignment)."""
    for e in CLOSED_EDGES:
        for ln in range(traci.edge.getLaneNumber(e)): traci.lane.setDisallowed(f'{e}_{ln}', ['passenger'])


def feasible_prefix(edges):
    """True if an observed edge sequence is a prefix of a post-closure route (A or B)."""
    return any(list(edges) == r[:len(edges)] for r in ROUTES.values())


def make_demand(scenario, seed, out):
    n_abs, sp_abs = SCENARIOS[scenario][:2]
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


def decide(policy, now, cohort, committed, last_p, mu, approach=APPROACH_LANES):
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
        q = {r: sum(traci.lane.getLastStepHaltingNumber(l) for l in ls) for r, ls in approach.items()}
        cost = {r: FREE_P_TO_D[r] + q[r] / mu[r] for r in ROUTES}
        r = min(('A', 'B'), key=lambda x: (cost[x], x))
        for vid, tau in cohort:
            out[vid] = r; rows.append((vid, tau, r, round(cost['A'], 2), round(cost['B'], 2)))
    elif policy == 'independent_periodic':
        for vid, tau in cohort:
            cA = pred.completion(now, tau, 'A', avail0['A'])[1]; cB = pred.completion(now, tau, 'B', avail0['B'])[1]
            r = min(('A', 'B'), key=lambda x: ({'A': cA, 'B': cB}[x], x))
            out[vid] = r; rows.append((vid, tau, r, round(cA - now, 2), round(cB - now, 2)))
    elif policy == 'independent_batch_copy':
        _, tau0 = cohort[0]                        # probe = the cohort vehicle closest to P
        cA = pred.completion(now, tau0, 'A', avail0['A'])[1]; cB = pred.completion(now, tau0, 'B', avail0['B'])[1]
        r = min(('A', 'B'), key=lambda x: ({'A': cA, 'B': cB}[x], x))
        for vid, tau in cohort:
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


def vehicle_table(sched, ti, arrivals, assigned, seq, horizon_s):
    """One row per scheduled vehicle. A vehicle without a SUMO arrival is incomplete and censored at the horizon.
    Returns (rows, unrounded travel times in minutes); totals are summed from the unrounded values, as before Track C."""
    rows, tts = [], []
    for vid, sd in sched.items():
        if vid in ti and vid in arrivals:
            x = ti[vid]; arr = float(x.get('arrival')); tt = arr - sd; complete = True
        else:
            arr = None; tt = horizon_s - sd; complete = False        # censored at horizon, flagged
        tts.append(tt / 60.0)
        rows.append(dict(vehicle=vid, sched_depart_s=sd, actual_depart_s=ti[vid].get('depart') if vid in ti else '',
                         route=assigned.get(vid, ''), arrival_s=arr if arr is not None else '', travel_time_s=round(tt, 2),
                         complete=complete, time_loss_s=ti[vid].get('timeLoss') if vid in ti else '',
                         waiting_s=ti[vid].get('waitingTime') if vid in ti else '', edges=' '.join(seq.get(vid, []))))
    return rows, tts


def termination_reason(n_arrived, n_total, t, horizon_s):
    if n_arrived >= n_total: return 'all_arrived'
    if t >= horizon_s: return 'horizon'
    return 'unknown'


def run(scenario, policy, seed, outdir, calib=None, headless=True, horizon_s=SIM_HORIZON_S, branch_scale=None):
    """branch_scale overrides the scenario's scale (calibration only)."""
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    scale = SCENARIOS[scenario][2] if branch_scale is None else branch_scale
    var = variant(scale); net_path = var['net']
    calib_source = 'argument'
    if calib is None: calib = load_calib(scale); calib_source = str(var['calib'].relative_to(HERE.parent))
    tau_b = branch_tau(scale, calib)
    mu = {'A': calib['mu_A'], 'B': calib['mu_B']}
    rou, sched = make_demand(scenario, seed, out)
    cfg = ['sumo', '-n', str(net_path), '-r', str(rou), '--seed', str(seed), '--time-to-teleport', '-1', '--no-step-log', 'true',
           '--no-warnings', 'true', '--collision.action', 'warn', '--tripinfo-output', str(out / 'tripinfo.xml'),
           '--step-length', '1.0']
    traci.start(cfg)
    sumo_version = traci.getVersion()[1]
    net = sumolib.net.readNet(str(net_path))
    approach = approach_lanes(net)
    L1 = traci.lane.getLength('E1_0')
    assigned, route_of, seq, last_edge = {}, {}, {}, {}
    last_p, committed_dict, decisions, p_cross = {}, {}, [], {}
    closure_entries, collisions, arrivals, n_total = [], 0, {}, len(sched)
    t = 0.0
    while True:
        traci.simulationStep(); t = traci.simulation.getTime()
        if abs(t - INCIDENT_S) < 1e-9: apply_closure()
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
                if tau_b is not None:
                    if rid in ('E4', 'E7'): traci.vehicle.setTau(vid, tau_b)
                    elif rid == 'E11': traci.vehicle.setTau(vid, BASE_TAU)
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
                chosen, rows = decide(policy, t, cohort, committed, last_p, mu, approach)
                for (vid, tau, r, cA, cB) in rows:
                    traci.vehicle.setRoute(vid, ROUTES[chosen[vid]]); assigned[vid] = chosen[vid]
                    decisions.append(dict(tick_s=t, vehicle=vid, policy=policy, route=r, tau_to_P_s=round(tau, 2),
                                          cost_A=cA, cost_B=cB, cohort_size=len(cohort)))
        if (len(arrivals) >= n_total) or t >= horizon_s: break
    termination = termination_reason(len(arrivals), n_total, t, horizon_s)
    traci.close()

    # ---- vehicle table from SUMO's own tripinfo (sched depart known from the demand file) ----
    import xml.etree.ElementTree as ET
    ti = {x.get('id'): x for x in ET.parse(out / 'tripinfo.xml').getroot().iter('tripinfo')}
    rows, tts = vehicle_table(sched, ti, arrivals, assigned, seq, horizon_s)
    # ---- audits computed from the trace (not constants) ----
    bad_trans = []
    for vid, s in seq.items():
        for a, b in zip(s, s[1:]):
            if net.getEdge(b) not in net.getEdge(a).getOutgoing(): bad_trans.append((vid, a, b))
    infeasible = [vid for vid, s in seq.items() if not feasible_prefix(s)]
    s_t = sorted(tts); p95 = s_t[math.ceil(.95 * len(s_t)) - 1]
    arr_times = [float(r['arrival_s']) for r in rows if r['complete']]
    summary = dict(scenario=scenario, policy=policy, seed=seed, vehicles=n_total, completed=sum(r['complete'] for r in rows),
                   incomplete=sum(not r['complete'] for r in rows), total_vehicle_min=round(sum(tts), 4),
                   mean_min=round(sum(tts) / len(tts), 4), p95_min=round(p95, 4), n_A=sum(1 for r in rows if r['route'] == 'A'),
                   n_B=sum(1 for r in rows if r['route'] == 'B'), unassigned=sum(1 for r in rows if not r['route']),
                   closed_link_entries=len(closure_entries), illegal_transitions=len(bad_trans), collisions=int(collisions),
                   duplicate_arrivals=0, sim_end_s=t, mean_time_loss_s=round(sum(float(r['time_loss_s'] or 0) for r in rows) / len(rows), 3),
                   branch_capacity_scale=scale, horizon_s=horizon_s, termination=termination,
                   route_feasibility_violations=len(infeasible), max_arrival_s=max(arr_times) if arr_times else None,
                   arrivals_after_3600_s=sum(a > 3600.0 for a in arr_times))
    summary['checks_pass'] = (summary['incomplete'] == 0 and summary['closed_link_entries'] == 0 and
                              summary['illegal_transitions'] == 0 and summary['unassigned'] == 0 and summary['collisions'] == 0
                              and summary['route_feasibility_violations'] == 0 and termination == 'all_arrived')
    config = dict(scenario=scenario, scenario_params=dict(zip(('n_abstract', 'spacing_abstract_s', 'branch_capacity_scale'),
                                                              SCENARIOS[scenario])),
                  policy=policy, seed=seed, sumo_vehicles=n_total, k_sumo_per_abstract=K, horizon_s=horizon_s,
                  incident_s=INCIDENT_S, closed_edges=list(CLOSED_EDGES), update_s=UPDATE_S, lead_s=LEAD_S,
                  branch_capacity_scale=scale, network=str(Path(net_path).relative_to(HERE.parent)),
                  network_sha256=sha256(net_path), approach_lanes=approach, branch_tau=tau_b, base_tau=BASE_TAU,
                  calibration_source=calib_source, mu_A=mu['A'], mu_B=mu['B'], demand_sha256=sha256(rou),
                  sumo_version=sumo_version, sumo_command=[Path(c).name if os.sep in c or '/' in c else c for c in cfg],
                  python=platform.python_version())
    (out / 'run_config.json').write_text(json.dumps(config, indent=2))
    (out / 'summary.json').write_text(json.dumps(summary, indent=2))
    (out / 'crossings.json').write_text(json.dumps({v: [p_cross[v], assigned.get(v)] for v in p_cross}))
    for name, rr in (('vehicles.csv', rows), ('decisions.csv', decisions)):
        if rr:
            with (out / name).open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=list(rr[0])); w.writeheader(); w.writerows(rr)
    return summary


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenario', default='near_branch_capacity', choices=sorted(SCENARIOS))
    ap.add_argument('--policy', default='coordinated_batch', choices=TRACK_C_POLICIES)
    ap.add_argument('--seed', type=int, default=1); ap.add_argument('--out', required=True)
    ap.add_argument('--calib', default=None, help='calibration JSON; default: the file for the scenario branch scale')
    ap.add_argument('--horizon-s', type=float, default=SIM_HORIZON_S)
    a = ap.parse_args()
    calib = json.load(open(a.calib)) if a.calib else None
    print(json.dumps(run(a.scenario, a.policy, a.seed, a.out, calib, horizon_s=a.horizon_s)))
