"""WP2.9: value-asserting tests. Hand-computed queue values, pinned headline results, conservation, and a golden
regression that the frozen experiment's raw outputs stay byte-identical to the WP2.7 baseline."""
import csv, hashlib, math, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import canonical_model as m
import confirmatory as c

GOLDEN = ROOT / 'tests' / 'golden'


class HandComputed(unittest.TestCase):
    """Hand arithmetic from the edge table: E1 180 s cap 30 (2 s headway); E4,E5,E6 cap 4 (15 s headway); E11 cap 20 (3 s)."""
    def test_single_vehicle_free_flow_times(self):
        for route, expected in (('A', 540.0), ('B', 660.0)):      # 9 min and 11 min
            r, _ = m.run_fixed_routes([{'id': 'V001', 'depart_s': 0.0}], {'V001': route})
            self.assertEqual(r[0]['travel_time_s'], expected)
        r, _ = m.run_fixed_routes([{'id': 'V001', 'depart_s': 0.0}], {'V001': 'critical'}, closure_start_s=None)
        self.assertEqual(r[0]['travel_time_s'], 420.0)           # 7 min

    def test_two_vehicle_queue_on_route_a(self):
        vs = [{'id': 'V001', 'depart_s': 0.0}, {'id': 'V002', 'depart_s': 2.0}]
        rows, logs = m.run_fixed_routes(vs, {'V001': 'A', 'V002': 'A'})
        self.assertEqual([r['travel_time_s'] for r in rows], [540.0, 553.0])
        ev = {(e['vehicle'], e['edge']): e for L in logs.values() for e in L}
        self.assertEqual((ev['V002', 'E1']['exit_s'], ev['V002', 'E1']['queue_wait_s']), (182.0, 0.0))
        self.assertEqual((ev['V002', 'E4']['exit_s'], ev['V002', 'E4']['queue_wait_s']), (255.0, 13.0))   # 240 + 15 s headway
        self.assertEqual((ev['V002', 'E5']['exit_s'], ev['V002', 'E5']['queue_wait_s']), (375.0, 0.0))
        self.assertEqual((ev['V002', 'E6']['exit_s'], ev['V002', 'E6']['queue_wait_s']), (435.0, 0.0))
        self.assertEqual((ev['V002', 'E11']['exit_s'], ev['V002', 'E11']['queue_wait_s']), (555.0, 0.0))

    def test_capacity_scale_changes_headway_on_branch_edges_only(self):
        vs = [{'id': 'V001', 'depart_s': 0.0}, {'id': 'V002', 'depart_s': 2.0}]
        _, half = m.run_fixed_routes(vs, {'V001': 'A', 'V002': 'A'}, scale=0.5)
        ev = {(e['vehicle'], e['edge']): e for L in half.values() for e in L}
        self.assertEqual(ev['V002', 'E4']['exit_s'], 240.0 + 30.0)       # headway 60/2 = 30 s
        self.assertEqual(ev['V002', 'E1']['exit_s'], 182.0)              # E1 unscaled

    def test_p95_is_nearest_rank(self):
        vs = c.make_vehicles(24, 5)
        for pol in ('static', 'independent_periodic', 'coordinated_batch'):
            routes, d, b = c.assign_policy(vs, 1, pol)
            met, rows, _, _ = c.summarize(vs, routes, 1, pol, d, b)
            t = sorted(r['travel_time_s'] / 60 for r in rows)
            self.assertEqual(len(t), 24)
            self.assertAlmostEqual(met['p95_nearest_rank_min'], t[math.ceil(0.95 * 24) - 1], places=6)   # 23rd of 24
            self.assertAlmostEqual(met['median_travel_time_min'], (t[11] + t[12]) / 2, places=6)
            self.assertAlmostEqual(met['total_fleet_travel_time_vehicle_min'], sum(t), places=5)
        vs10 = c.make_vehicles(10, 10)
        routes, d, b = c.assign_policy(vs10, 1, 'static')
        met, rows, _, _ = c.summarize(vs10, routes, 1, 'static', d, b)
        self.assertAlmostEqual(met['p95_nearest_rank_min'], max(r['travel_time_s'] for r in rows) / 60, places=6)  # ceil(9.5)=10th


class PinnedResults(unittest.TestCase):
    """Headline values and route splits from the WP2.7 baseline. A policy regression changes these."""
    EXPECT = {  # scenario: policy: (total vehicle-min, A, B)
        'manageable_primary': {'static': (93.75, 10, 0), 'independent_periodic': (93.75, 10, 0), 'coordinated_batch': (93.75, 10, 0)},
        'near_branch_capacity': {'static': (262.0, 24, 0), 'independent_periodic': (254.275, 18, 6), 'coordinated_batch': (249.95, 16, 8)},
        'overload_stress': {'static': (923.5, 60, 0), 'independent_periodic': (719.875, 30, 30), 'coordinated_batch': (701.491667, 25, 35)},
        'primary_half_capacity': {'static': (105.0, 10, 0), 'independent_periodic': (104.05, 9, 1), 'coordinated_batch': (102.8, 8, 2)},
        'primary_double_capacity': {'static': (90.0, 10, 0), 'independent_periodic': (90.0, 10, 0), 'coordinated_batch': (90.0, 10, 0)},
    }

    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.TemporaryDirectory(); cls.metrics, cls.audits = c.run_all(cls.d.name)
        cls.by = {(r['scenario'], r['policy']): r for r in cls.metrics}

    @classmethod
    def tearDownClass(cls): cls.d.cleanup()

    def test_totals_and_splits(self):
        for sc, pols in self.EXPECT.items():
            for pol, (total, a, b) in pols.items():
                r = self.by[sc, pol]
                self.assertAlmostEqual(r['total_fleet_travel_time_vehicle_min'], total, places=5, msg=(sc, pol))
                self.assertEqual((r['route_A_count'], r['route_B_count']), (a, b), (sc, pol))

    def test_improvements_match_the_adr_table(self):
        imp = lambda sc: 100 * (self.by[sc, 'independent_periodic']['total_fleet_travel_time_vehicle_min'] -
                                self.by[sc, 'coordinated_batch']['total_fleet_travel_time_vehicle_min']) / \
                         self.by[sc, 'independent_periodic']['total_fleet_travel_time_vehicle_min']
        for sc, expected in (('manageable_primary', 0.0), ('near_branch_capacity', 1.70), ('overload_stress', 2.55),
                             ('primary_half_capacity', 1.20), ('primary_double_capacity', 0.0)):
            self.assertAlmostEqual(imp(sc), expected, delta=0.005, msg=sc)

    def test_p95_guardrail_values_in_primary_scenario(self):
        ind, co = self.by['near_branch_capacity', 'independent_periodic'], self.by['near_branch_capacity', 'coordinated_batch']
        self.assertAlmostEqual(ind['p95_nearest_rank_min'], 11.666667, places=5)
        self.assertAlmostEqual(co['p95_nearest_rank_min'], 11.041667, places=5)
        self.assertLessEqual(co['p95_nearest_rank_min'], ind['p95_nearest_rank_min'])

    def test_frozen_independent_policy_herds_by_construction(self):
        for sc in self.EXPECT:
            self.assertEqual(self.by[sc, 'independent_periodic']['max_30s_batch_dominant_route_share'], 1.0, sc)
        self.assertAlmostEqual(self.by['overload_stress', 'coordinated_batch']['max_30s_batch_dominant_route_share'], 2 / 3, places=5)

    def test_all_runs_pass_all_gates(self):
        self.assertEqual(len(self.metrics), 15)
        self.assertTrue(all(r['checks_pass'] and r['closed_link_entries'] == 0 and r['fifo_violations'] == 0 for r in self.metrics))
        self.assertTrue(all(a['overall_pass'] for a in self.audits))


class Conservation(unittest.TestCase):
    def test_every_vehicle_appears_once_with_one_event_per_route_edge(self):
        for sc in c.SCENARIOS:
            vs = c.make_vehicles(sc['n'], sc['spacing_s'])
            for pol in ('static', 'independent_periodic', 'coordinated_batch'):
                routes, d, b = c.assign_policy(vs, sc['scale'], pol)
                self.assertEqual(sorted(routes), sorted(v['id'] for v in vs))
                self.assertEqual(sum(x['batch_size'] for x in b), sc['n'])
                rows, logs = m.run_fixed_routes(vs, routes, sc['scale'])
                self.assertEqual(len(rows), sc['n'])
                self.assertEqual(sum(len(L) for L in logs.values()), sum(len(m.ROUTES[r['route']]) for r in rows))


class GoldenRegression(unittest.TestCase):
    def test_frozen_outputs_are_byte_identical_to_wp27_baseline(self):
        with tempfile.TemporaryDirectory() as d:
            c.run_all(d)
            for line in (GOLDEN / 'SHA256SUMS').read_text().splitlines():
                digest, name = line.split()
                self.assertEqual(hashlib.sha256((Path(d) / name).read_bytes()).hexdigest(), digest, name)

    def test_metrics_csv_matches_golden_row_by_row(self):
        read = lambda p: list(csv.DictReader(p.read_text().splitlines()))
        with tempfile.TemporaryDirectory() as d:
            c.run_all(d)
            new = read(Path(d) / 'confirmatory_metrics.csv')
        self.assertEqual(new, read(GOLDEN / 'confirmatory_metrics.csv'))


if __name__ == '__main__':
    unittest.main()
