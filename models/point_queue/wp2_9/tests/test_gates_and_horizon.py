"""WP2.9: the hard gates must be able to FAIL. Adversarial closed-route tests and horizon enforcement tests.
These were written to fail on the WP2.7 baseline (closed_link_entries was a hard-coded 0; the model enforced 3600 s while
the docs and metric_spec said 7200 s)."""
import json, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import canonical_model as m
import confirmatory as c


class ClosureGate(unittest.TestCase):
    def test_every_vehicle_on_closed_critical_route_is_flagged(self):
        vs = c.make_vehicles(10, 10)
        routes = {v['id']: 'critical' for v in vs}               # adversarial: ignore the closure
        met, rows, logs, fifo = c.summarize(vs, routes, 1, 'adversarial', [], [])
        self.assertTrue(all(r['closure_violation'] for r in rows))
        self.assertEqual(met['closed_link_entries'], 10)
        self.assertFalse(met['checks_pass'])
        # the independent audit must see it too, from raw edge events alone
        self.assertEqual(fifo['audit']['violation_counts'].get('closed_link_entry'), 20)   # E2 and E3 per vehicle

    def test_single_leaking_vehicle_is_counted_once(self):
        vs = c.make_vehicles(10, 10)
        routes = {v['id']: 'A' for v in vs}; routes['V004'] = 'critical'
        met, rows, _, _ = c.summarize(vs, routes, 1, 'adversarial', [], [])
        self.assertEqual(met['closed_link_entries'], 1)
        self.assertEqual([r['vehicle'] for r in rows if r['closure_violation']], ['V004'])
        self.assertFalse(met['checks_pass'])

    def test_pipeline_gate_fails_end_to_end_when_a_policy_leaks(self):
        real = c.assign_policy
        c.assign_policy = lambda vs, scale, policy, *a, **k: ({v['id']: 'critical' for v in vs}, [], [])
        try:
            with tempfile.TemporaryDirectory() as d:
                metrics, audits = c.run_all(d)
        finally:
            c.assign_policy = real
        self.assertTrue(all(not r['checks_pass'] for r in metrics))
        self.assertTrue(all(not a['overall_pass'] for a in audits))
        self.assertTrue(all(not a['zero_closed_link_entries'] for a in audits))

    def test_legal_policies_have_zero_entries_computed_not_constant(self):
        vs = c.make_vehicles(24, 5)
        for pol in ('static', 'independent_periodic', 'coordinated_batch'):
            routes, d, b = c.assign_policy(vs, 1, pol)
            met, rows, _, _ = c.summarize(vs, routes, 1, pol, d, b)
            self.assertEqual(met['closed_link_entries'], 0)
            self.assertTrue(all(r['closure_violation'] is False for r in rows))

    def test_no_closure_control_allows_critical_route(self):
        vs = m.vehicles(5, 10)
        rows, _ = m.run_fixed_routes(vs, {v['id']: 'critical' for v in vs}, closure_start_s=None)
        self.assertFalse(any(r['closure_violation'] for r in rows))
        res = m.simulate(n=10, spacing=30., incident=False, policy='static')
        self.assertEqual(res['closed_link_entries'], 0)
        self.assertEqual(res['route_counts']['critical'], 10)

    def test_closure_boundary_entry_exactly_at_closure_counts(self):
        vs = [{'id': 'V001', 'depart_s': 0.0}]
        rows, logs = m.run_fixed_routes(vs, {'V001': 'critical'})
        e2, e3 = logs['E2'][0]['arrival_s'], logs['E3'][0]['arrival_s']       # entries at 180 s and 300 s
        self.assertEqual((e2, e3), (180.0, 300.0))
        run = lambda t: m.run_fixed_routes(vs, {'V001': 'critical'}, closure_start_s=t)[0][0]['closure_violation']
        self.assertTrue(run(e2))                  # E2 entry exactly at closure counts
        self.assertTrue(run(e2 + 0.001))          # still violated through E3 (entered at 300 s)
        self.assertTrue(run(e3))                  # E3 entry exactly at closure counts
        self.assertFalse(run(e3 + 0.001))         # both entries precede the closure: legal


class HorizonEnforcement(unittest.TestCase):
    def test_single_source_of_truth_is_7200(self):
        self.assertEqual(m.HORIZON_S, 7200.0)
        self.assertIs(c.HORIZON_S, m.HORIZON_S)

    def test_metric_spec_declares_the_horizon_that_is_enforced(self):
        with tempfile.TemporaryDirectory() as d:
            c.run_all(d)
            spec = json.loads((Path(d) / 'metric_spec.json').read_text())
            audits = json.loads((Path(d) / 'invariant_audit.json').read_text())
        self.assertEqual(spec['horizon_s'], m.HORIZON_S)
        self.assertTrue(all(a['horizon_s'] == m.HORIZON_S for a in audits))

    def test_trip_finishing_between_3600_and_7200_is_complete(self):
        vs = m.vehicles(400, 2.0)                                 # 400 vehicles all on A: last arrives ~6525 s
        rows, _ = m.run_fixed_routes(vs, {v['id']: 'A' for v in vs})
        late = [r for r in rows if 3600.0 < r['arrival_s'] <= 7200.0]
        self.assertGreater(len(late), 100, 'test premise: many trips finish after the old 3600 s horizon')
        self.assertTrue(all(r['complete'] for r in rows))
        self.assertAlmostEqual(max(r['arrival_s'] for r in rows), 6525.0, places=6)

    def test_trip_after_horizon_is_incomplete_and_censored_not_dropped(self):
        vs = m.vehicles(600, 2.0)
        rows, _ = m.run_fixed_routes(vs, {v['id']: 'A' for v in vs})
        self.assertEqual(len(rows), 600)                          # nobody silently omitted
        inc = [r for r in rows if not r['complete']]
        self.assertTrue(inc)
        for r in rows:
            if r['arrival_s'] > 7200.0:
                self.assertFalse(r['complete'])
                self.assertEqual(r['travel_time_s'], 7200.0 - r['depart_s'])     # censored at the horizon
            else:
                self.assertTrue(r['complete'])
                self.assertEqual(r['travel_time_s'], r['arrival_s'] - r['depart_s'])

    def test_horizon_boundary_is_inclusive(self):
        vs = [{'id': 'V001', 'depart_s': 0.0}]
        t = m.run_fixed_routes(vs, {'V001': 'A'})[0][0]['arrival_s']          # 540 s
        self.assertTrue(m.run_fixed_routes(vs, {'V001': 'A'}, horizon_s=t)[0][0]['complete'])
        self.assertFalse(m.run_fixed_routes(vs, {'V001': 'A'}, horizon_s=t - 0.001)[0][0]['complete'])

    def test_incomplete_trips_fail_the_gate_but_audit_stays_self_consistent(self):
        vs = c.make_vehicles(600, 2)
        routes = {v['id']: 'A' for v in vs}
        met, rows, _, fifo = c.summarize(vs, routes, 1, 'overflow', [], [])
        self.assertGreater(met['incomplete'], 0)
        self.assertFalse(met['all_trips_complete'])
        self.assertFalse(met['checks_pass'])
        self.assertTrue(fifo['audit']['pass'], fifo['audit']['violations'][:2])   # flags/censoring agree with the horizon


if __name__ == '__main__':
    unittest.main()
