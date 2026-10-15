"""Track C: half and double branch capacity, the closure, the horizon and run classification.
Pure tests need only the standard library. Tests marked SUMO need eclipse-sumo, traci and sumolib and are skipped without them."""
import csv, json, shutil, sys, tempfile, unittest
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / 'scripts'))
import dm_run, run_matrix, build_network

ROOT = HERE.parents[1]
SPEC = json.loads((ROOT / 'models/point_queue/wp2_9/config/graph_spec.json').read_text())
NETS = {1.0: HERE / 'network/dm.net.xml', 2.0: HERE / 'network/branch_x2/dm.net.xml'}
EVIDENCE = ROOT / 'results/exploratory/track_c'
HAVE_SUMO = dm_run.traci is not None and shutil.which('sumo') is not None


def net_edges(path):
    """Normal (non-internal) edges: id -> (from, to, lane count, length, speed)."""
    out = {}
    for e in ET.parse(path).getroot().iter('edge'):
        if e.get('function') == 'internal': continue
        ln = e.findall('lane')
        out[e.get('id')] = (e.get('from'), e.get('to'), len(ln), float(ln[0].get('length')), float(ln[0].get('speed')))
    return out


def p_connections(path):
    return sorted((int(c.get('fromLane')), c.get('to'), int(c.get('toLane'))) for c in ET.parse(path).getroot().iter('connection')
                  if c.get('from') == 'E1' and not c.get('to').startswith(':'))


def od_paths(edges, closed):
    adj = {}
    for eid, (a, b, *_) in edges.items():
        if eid not in closed: adj.setdefault(a, []).append((eid, b))
    found = []
    def dfs(node, seen, seq):
        if node == 'D': found.append(seq); return
        for eid, b in adj.get(node, []):
            if b not in seen: dfs(b, seen | {b}, seq + [eid])
    dfs('O', {'O'}, [])
    return sorted(found)


class ScenarioTableMatchesPointQueue(unittest.TestCase):
    def test_same_five_scenarios_vehicles_spacing_and_scale(self):
        want = {k: (v['vehicles'], v['spacing_s'], v['branch_capacity_scale']) for k, v in SPEC['scenarios'].items()}
        self.assertEqual(dm_run.SCENARIOS, want)

    def test_scaled_edges_closure_and_incident_match_the_spec(self):
        self.assertEqual(list(dm_run.BRANCH_EDGES), SPEC['branch_scaled_edges'])
        self.assertEqual(list(dm_run.CLOSED_EDGES), SPEC['closed_edges'])
        self.assertEqual(dm_run.INCIDENT_S, SPEC['incident_s'])

    def test_every_scale_has_a_realisation(self):
        for name, (_, _, scale) in dm_run.SCENARIOS.items():
            self.assertTrue(dm_run.variant(scale)['net'].exists(), name)
        with self.assertRaises(ValueError): dm_run.variant(3.0)

    def test_branch_tau_only_for_half_capacity(self):
        self.assertEqual(dm_run.branch_tau(0.5, {'branch_tau': 3.0}), 3.0)
        self.assertIsNone(dm_run.branch_tau(1.0, {'branch_tau': 3.0}))
        self.assertIsNone(dm_run.branch_tau(2.0, {}))


class NetworkVariants(unittest.TestCase):
    def setUp(self): self.base, self.x2 = net_edges(NETS[1.0]), net_edges(NETS[2.0])

    def test_lengths_speeds_and_nodes_are_unchanged(self):
        self.assertEqual(set(self.base), set(self.x2))
        for e in self.base:
            self.assertEqual(self.base[e][:2], self.x2[e][:2], e)
            self.assertAlmostEqual(self.base[e][3], self.x2[e][3], places=2, msg=e)
            self.assertEqual(self.base[e][4], self.x2[e][4], e)

    def test_branch_lanes_double_and_nothing_else_changes_except_the_approach(self):
        for e in self.base:
            if e in dm_run.BRANCH_EDGES: self.assertEqual(self.x2[e][2], 2 * self.base[e][2], e)
            elif e == 'E1': self.assertEqual(self.x2[e][2], self.x2['E4'][2] + self.x2['E7'][2] + self.x2['E2'][2])
            else: self.assertEqual(self.x2[e][2], self.base[e][2], e)

    def test_base_follows_the_same_approach_rule(self):
        self.assertEqual(self.base['E1'][2], self.base['E4'][2] + self.base['E7'][2] + self.base['E2'][2])

    def test_each_approach_lane_feeds_exactly_one_outgoing_lane(self):
        for scale, path in NETS.items():
            cons = p_connections(path); edges = net_edges(path)
            self.assertEqual([c[0] for c in cons], list(range(edges['E1'][2])), scale)   # one connection per E1 lane
            for e in ('E4', 'E7', 'E2'):
                self.assertEqual(sorted(c[2] for c in cons if c[1] == e), list(range(edges[e][2])), (scale, e))

    def test_builder_connection_rule_matches_the_committed_files(self):
        self.assertEqual(sorted((fl, b, tl) for _, b, fl, tl in build_network.p_connections(2)), p_connections(NETS[2.0]))
        self.assertEqual(sorted((fl, b, tl) for _, b, fl, tl in build_network.p_connections(1)), p_connections(NETS[1.0]))

    def test_closure_leaves_exactly_routes_a_and_b(self):
        for scale, path in NETS.items():
            edges = net_edges(path)
            self.assertEqual(od_paths(edges, set()), sorted([['E1', 'E2', 'E3'], dm_run.ROUTES['A'], dm_run.ROUTES['B']]), scale)
            self.assertEqual(od_paths(edges, set(dm_run.CLOSED_EDGES)), sorted(dm_run.ROUTES.values()), scale)


class CalibrationEvidence(unittest.TestCase):
    """The realised scale is measured. These fail if a calibration file is missing, stale or off target."""
    def test_realised_scale_within_ten_percent_of_nominal(self):
        for scale in (0.5, 2.0):
            c = dm_run.load_calib(scale)
            for r in ('A', 'B'):
                self.assertLess(abs(c[f'realised_scale_{r}'] / scale - 1), 0.10, (scale, r, c[f'realised_scale_{r}']))

    def test_calibration_was_measured_on_the_committed_network(self):
        for scale in (0.5, 2.0):
            c = dm_run.load_calib(scale)
            self.assertEqual(c['network_sha256'], dm_run.sha256(dm_run.variant(scale)['net']), scale)
            self.assertEqual(c['branch_capacity_scale'], scale)

    def test_free_flow_time_is_not_changed_by_the_capacity_mechanism(self):
        base = json.loads((EVIDENCE / 'calibration/base_reproduction.json').read_text())['fastest_P_to_D_s']
        for scale in (0.5, 2.0):
            ff = dm_run.load_calib(scale)['fastest_P_to_D_s']
            for r in ('A', 'B'): self.assertLessEqual(abs(ff[r] - base[r]), 5.0, (scale, r))


class PureHelpers(unittest.TestCase):
    def test_route_feasibility(self):
        self.assertTrue(dm_run.feasible_prefix(['E1']))
        self.assertTrue(dm_run.feasible_prefix(dm_run.ROUTES['B']))
        self.assertTrue(dm_run.feasible_prefix(['E1', 'E4', 'E5']))
        self.assertFalse(dm_run.feasible_prefix(['E1', 'E2']))
        self.assertFalse(dm_run.feasible_prefix(['E1', 'E4', 'E8']))

    def test_termination_reason(self):
        self.assertEqual(dm_run.termination_reason(10, 10, 900.0, 3600.0), 'all_arrived')
        self.assertEqual(dm_run.termination_reason(9, 10, 3600.0, 3600.0), 'horizon')
        self.assertEqual(dm_run.termination_reason(9, 10, 7200.0, 7200.0), 'horizon')

    def test_unfinished_trip_is_incomplete_and_censored_at_the_configured_horizon(self):
        ti = {'v000': ET.fromstring('<tripinfo id="v000" depart="0.00" arrival="400.00" timeLoss="1" waitingTime="0"/>')}
        for h in (3600.0, 7200.0):
            rows, tts = dm_run.vehicle_table({'v000': 0.0, 'v001': 100.0}, ti, {'v000': 400.0}, {'v000': 'A'}, {}, h)
            self.assertTrue(rows[0]['complete']); self.assertEqual(rows[0]['travel_time_s'], 400.0)
            self.assertFalse(rows[1]['complete']); self.assertEqual(rows[1]['travel_time_s'], h - 100.0)
            self.assertAlmostEqual(sum(tts), (400.0 + h - 100.0) / 60)


class BatchCopyComparator(unittest.TestCase):
    """independent_batch_copy is the frozen point-queue decision rule: the probe's choice is copied to the cohort."""
    MU = {'A': 0.5, 'B': 1.0}

    def test_cohort_copies_the_probe_and_differs_from_per_vehicle_choice(self):
        now = 300.0; cohort = [('v1', 5.0), ('v2', 50.0)]; last_p = {'A': now + 150.0}
        copy, _ = dm_run.decide('independent_batch_copy', now, cohort, [], last_p, self.MU)
        each, _ = dm_run.decide('independent_periodic', now, cohort, [], last_p, self.MU)
        self.assertEqual(copy, {'v1': 'B', 'v2': 'B'})
        self.assertEqual(each, {'v1': 'B', 'v2': 'A'})

    def test_single_vehicle_cohort_agrees_with_independent_periodic(self):
        for last_p in ({}, {'A': 450.0}, {'B': 500.0}):
            a, _ = dm_run.decide('independent_batch_copy', 300.0, [('v1', 20.0)], [], last_p, self.MU)
            b, _ = dm_run.decide('independent_periodic', 300.0, [('v1', 20.0)], [], last_p, self.MU)
            self.assertEqual(a, b, last_p)


class RunClassification(unittest.TestCase):
    def make(self, d, summary=None, rows=3, skip=()):
        s = dict(vehicles=3, termination='all_arrived', checks_pass=True); s.update(summary or {})
        for f in run_matrix.REQUIRED:
            if f in skip: continue
            if f == 'summary.json': (d / f).write_text(json.dumps(s))
            elif f == 'vehicles.csv':
                with (d / f).open('w', newline='') as fh:
                    w = csv.writer(fh); w.writerow(['vehicle']); [w.writerow([f'v{i}']) for i in range(rows)]
            else: (d / f).write_text('x')

    def status(self, rc=0, **kw):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); self.make(d, **kw); return run_matrix.classify(rc, d)[0]

    def test_clean_run_is_ok(self): self.assertEqual(self.status(), 'ok')
    def test_nonzero_exit_is_failed(self): self.assertEqual(self.status(rc=1), 'failed')
    def test_missing_output_is_failed(self):
        for f in run_matrix.REQUIRED: self.assertEqual(self.status(skip=(f,)), 'failed', f)
    def test_failed_gate_is_invalid(self): self.assertEqual(self.status(summary={'checks_pass': False}), 'invalid')
    def test_horizon_termination_is_invalid(self): self.assertEqual(self.status(summary={'termination': 'horizon'}), 'invalid')
    def test_row_count_mismatch_is_invalid(self): self.assertEqual(self.status(rows=2), 'invalid')

    def test_track_c_plan_covers_five_scenarios_and_five_policies(self):
        js = run_matrix.jobs('track_c')
        self.assertEqual({j[0] for j in js}, set(dm_run.SCENARIOS)); self.assertEqual({j[1] for j in js}, set(dm_run.TRACK_C_POLICIES))
        self.assertEqual(len(js), (20 + 4 * 10) * 5)


@unittest.skipUnless(HAVE_SUMO, 'needs SUMO (pip install -r environment/requirements.txt)')
class SumoClosureAndApproach(unittest.TestCase):
    def test_approach_lanes_from_the_network(self):
        self.assertEqual(dm_run.approach_lanes(dm_run.sumolib.net.readNet(str(NETS[1.0]))), dm_run.APPROACH_LANES)
        self.assertEqual(dm_run.approach_lanes(dm_run.sumolib.net.readNet(str(NETS[2.0]))),
                         {'A': ['E1_0', 'E1_1'], 'B': ['E1_2', 'E1_3', 'E1_4', 'E1_5']})

    def test_critical_route_open_before_and_rejected_after_the_closure(self):
        traci = dm_run.traci
        for scale, net in NETS.items():
            with tempfile.TemporaryDirectory() as t:
                rou, _ = dm_run.make_demand('manageable_primary', 1, t)
                traci.start(['sumo', '-n', str(net), '-r', str(rou), '--no-step-log', 'true', '--no-warnings', 'true'])
                try:
                    while traci.simulation.getTime() < 60: traci.simulationStep()
                    v1, v2 = traci.vehicle.getIDList()[:2]
                    traci.vehicle.setRoute(v1, ['E1', 'E2', 'E3'])           # legal before the incident
                    self.assertEqual(list(traci.vehicle.getRoute(v1)), ['E1', 'E2', 'E3'])
                    dm_run.apply_closure()
                    for e in dm_run.CLOSED_EDGES:
                        for ln in range(traci.edge.getLaneNumber(e)):
                            self.assertIn('passenger', traci.lane.getDisallowed(f'{e}_{ln}'), (scale, e))
                    with self.assertRaises(traci.TraCIException): traci.vehicle.setRoute(v2, ['E1', 'E2', 'E3'])
                    traci.vehicle.setRoute(v2, dm_run.ROUTES['B'])            # detours stay open
                    self.assertEqual(list(traci.vehicle.getRoute(v2)), dm_run.ROUTES['B'])
                finally:
                    traci.close()


if __name__ == '__main__':
    unittest.main()
