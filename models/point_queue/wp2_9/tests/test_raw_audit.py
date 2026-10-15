"""WP2.9: the independent raw-record audit. Checks (1) it is genuinely independent of the model, (2) its spec has not drifted
from the model, (3) it passes on real output, and (4) every check fires on an injected fault (mutation tests)."""
import ast, copy, json, math, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import canonical_model as m
import confirmatory as c
import raw_audit as ra

SPEC = ra.load_spec()
STDLIB_OK = {'hashlib', 'argparse', 'csv', 'json', 'math', 'sys', 'collections', 'pathlib'}


def real_run(policy='coordinated_batch', n=24, spacing=5, scale=1.0):
    vs = c.make_vehicles(n, spacing)
    routes, _, _ = c.assign_policy(vs, scale, policy)
    rows, logs = m.run_fixed_routes(vs, routes, scale)
    events = [e for L in logs.values() for e in L]
    return vs, rows, events


def audit(rows, events, n=24, spacing=5.0, scale=1.0, **kw):
    return ra.audit_run(SPEC, copy.deepcopy(events), copy.deepcopy(rows), scale=scale, expected_vehicles=n, spacing_s=spacing, **kw)


class Independence(unittest.TestCase):
    def test_raw_audit_imports_only_the_standard_library(self):
        tree = ast.parse((ROOT / 'src' / 'raw_audit.py').read_text())
        mods = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import): mods |= {a.name.split('.')[0] for a in node.names}
            if isinstance(node, ast.ImportFrom): mods.add(node.module.split('.')[0])
        self.assertLessEqual(mods, STDLIB_OK, mods)
        self.assertNotIn('canonical_model', mods); self.assertNotIn('confirmatory', mods)

    def test_audit_does_not_reapply_the_service_recurrence(self):
        src = (ROOT / 'src' / 'raw_audit.py').read_text()
        self.assertNotIn('prev+head', src.replace(' ', '')); self.assertNotIn("max(ev['arrival_s']", src)


class SpecDrift(unittest.TestCase):
    def test_edges_capacities_and_free_flow_match_the_model(self):
        spec_edges = [(e['id'], e['src'], e['dst'], e['free_min'], e['cap_vpm']) for e in SPEC['edges']]
        model_edges = [(e['id'], e['src'], e['dst'], e['free_min'], e['cap_vpm']) for e in m.EDGES]
        self.assertEqual(spec_edges, model_edges)
        self.assertEqual(set(SPEC['nodes']), set(m.NODES))

    def test_closure_horizon_routes_and_scaling_match_the_model(self):
        self.assertEqual(set(SPEC['closed_edges']), m.CLOSED)
        self.assertEqual(SPEC['incident_s'], m.INCIDENT_S)
        self.assertEqual(SPEC['horizon_s'], m.HORIZON_S)
        self.assertEqual(set(SPEC['branch_scaled_edges']), c.BRANCH_IDS)
        self.assertEqual({tuple(p) for p in SPEC['allowed_paths']}, {tuple(v) for v in m.ROUTES.values()})

    def test_scenario_table_matches_the_experiment(self):
        got = {s['name']: (s['n'], s['spacing_s'], s['scale']) for s in c.SCENARIOS}
        want = {k: (v['vehicles'], v['spacing_s'], v['branch_capacity_scale']) for k, v in SPEC['scenarios'].items()}
        self.assertEqual(got, want)


class RealOutputPasses(unittest.TestCase):
    def test_all_fifteen_frozen_runs_pass_from_csv(self):
        with tempfile.TemporaryDirectory() as d:
            c.run_all(d)
            res = ra.audit_results_dir(d)
        self.assertEqual(len(res), 15)
        self.assertTrue(all(r['pass'] for r in res), [r['violation_counts'] for r in res if not r['pass']])
        self.assertEqual(sum(r['events_checked'] for r in res), 1792)

    def test_recomputed_metrics_match_reported_to_rounding(self):
        vs, rows, events = real_run()
        r = audit(rows, events, reported={'total_fleet_travel_time_vehicle_min': 249.95, 'p95_nearest_rank_min': 11.041667,
                                          'completed': 24, 'incomplete': 0})
        self.assertTrue(r['pass'], r['violations'][:2])
        self.assertAlmostEqual(r['recomputed']['total_fleet_travel_time_vehicle_min'], 249.95, places=5)


class MutationTests(unittest.TestCase):
    """Each fault is injected into real model output; the audit must fail and name the right check."""
    @classmethod
    def setUpClass(cls):
        cls.vs, cls.rows, cls.events = real_run()
        assert audit(cls.rows, cls.events)['pass'], 'control run must be clean'

    def run_mut(self, mutate_events=None, mutate_rows=None, expect=None, **kw):
        ev, rw = copy.deepcopy(self.events), copy.deepcopy(self.rows)
        if mutate_events: mutate_events(ev)
        if mutate_rows: mutate_rows(rw)
        res = ra.audit_run(SPEC, ev, rw, scale=1.0, expected_vehicles=24, spacing_s=5.0, **kw)
        self.assertFalse(res['pass'], f'audit missed a {expect} fault')
        self.assertIn(expect, res['violation_counts'], res['violation_counts'])

    def pick(self, ev, edge, key=lambda e: True):
        return next(e for e in ev if e['edge'] == edge and key(e))

    def test_teleport_between_edges(self):
        def f(ev): self.pick(ev, 'E5')['arrival_s'] += 5.0
        self.run_mut(f, expect='handoff_gap_or_teleport')

    def test_faster_than_free_flow(self):
        def f(ev):
            e = self.pick(ev, 'E5'); e['exit_s'] -= 3.0; e['queue_wait_s'] -= 3.0
        self.run_mut(f, expect='faster_than_free_flow')

    def test_overtaking(self):
        def f(ev):
            q = sorted((e for e in ev if e['edge'] == 'E4'), key=lambda e: e['arrival_s'])
            a, b = q[3], q[4]
            self.assertGreater(b['arrival_s'], a['arrival_s'])
            a['exit_s'], b['exit_s'] = b['exit_s'], a['exit_s']
            a['queue_wait_s'], b['queue_wait_s'] = a['exit_s'] - a['arrival_s'] - 60, b['exit_s'] - b['arrival_s'] - 60
        self.run_mut(f, expect='overtaking')

    def test_headway_below_service_time(self):
        def f(ev):
            q = sorted((e for e in ev if e['edge'] == 'E4' and e['queue_wait_s'] > 10), key=lambda e: e['exit_s'])
            q[0]['exit_s'] -= 5.0; q[0]['queue_wait_s'] -= 5.0
        self.run_mut(f, expect='headway_below_service_time')

    def test_server_idle_while_vehicle_waited(self):
        def f(ev):
            q = sorted((e for e in ev if e['edge'] == 'E4' and e['queue_wait_s'] > 0), key=lambda e: e['exit_s'])
            q[-1]['exit_s'] += 4.0; q[-1]['queue_wait_s'] += 4.0
        self.run_mut(f, expect='server_idle_while_vehicle_waited')

    def test_wait_bookkeeping(self):
        def f(ev): self.pick(ev, 'E4', lambda e: e['queue_wait_s'] > 0)['queue_wait_s'] += 1.0
        self.run_mut(f, expect='wait_bookkeeping')

    def test_disconnected_path(self):
        def f(ev): self.pick(ev, 'E5')['edge'] = 'E8'
        self.run_mut(f, expect='path_disconnected')

    def test_duplicate_vehicle_row(self):
        self.run_mut(mutate_rows=lambda rw: rw.append(copy.deepcopy(rw[0])), expect='duplicate_vehicle_rows')

    def test_missing_vehicle(self):
        def f(rw): rw.pop()
        def g(ev): ev[:] = [e for e in ev if e['vehicle'] != 'V024']
        self.run_mut(g, f, expect='vehicle_conservation')

    def test_travel_time_mismatch(self):
        def f(rw): rw[3]['travel_time_s'] += 10.0
        self.run_mut(mutate_rows=f, expect='travel_time_mismatch')

    def test_completion_flag_contradicts_horizon(self):
        def f(rw): rw[0]['complete'] = False
        self.run_mut(mutate_rows=f, expect='completion_flag_vs_horizon')

    def test_wrong_departure_schedule(self):
        def f(rw): rw[5]['depart_s'] += 1.0
        self.run_mut(mutate_rows=f, expect='departure_schedule')

    def test_reported_metric_that_disagrees_with_raw_rows(self):
        self.run_mut(expect='metric_mismatch', reported={'total_fleet_travel_time_vehicle_min': 250.95})

    def test_closed_link_entry_detected_from_raw_events_only(self):
        vs = c.make_vehicles(24, 5)
        routes = {v['id']: 'A' for v in vs}; routes['V010'] = 'critical'
        rows, logs = m.run_fixed_routes(vs, routes)
        ev = [e for L in logs.values() for e in L]
        res = ra.audit_run(SPEC, ev, rows, scale=1.0, expected_vehicles=24, spacing_s=5.0)
        self.assertFalse(res['pass'])
        self.assertEqual(res['violation_counts']['closed_link_entry'], 2)            # E2 and E3
        ok = ra.audit_run(SPEC, ev, rows, scale=1.0, expected_vehicles=24, spacing_s=5.0, incident_s=None)
        self.assertNotIn('closed_link_entry', ok['violation_counts'])                # check can be disabled for no-incident controls


if __name__ == '__main__':
    unittest.main()
