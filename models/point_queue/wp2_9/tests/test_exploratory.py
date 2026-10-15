"""WP2.9: exploratory baselines stay separate from, and cannot disturb, the frozen experiment."""
import sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import canonical_model as m
import confirmatory as c
import exploratory as e


class Separation(unittest.TestCase):
    def test_frozen_matrix_still_has_exactly_three_policies(self):
        with tempfile.TemporaryDirectory() as d:
            metrics, _ = c.run_all(d)
        self.assertEqual({r['policy'] for r in metrics}, {'static', 'independent_periodic', 'coordinated_batch'})
        self.assertTrue(set(e.EXPLORATORY_POLICIES).isdisjoint({r['policy'] for r in metrics}))

    def test_refuses_to_write_into_results(self):
        with self.assertRaises(SystemExit):
            e.run_exploratory(ROOT / 'results')

    def test_output_is_labelled_exploratory(self):
        with tempfile.TemporaryDirectory() as d:
            rows, audits = e.run_exploratory(d)
            self.assertTrue((Path(d) / 'EXPLORATORY_NOT_CONFIRMATORY.txt').exists())
        self.assertEqual({r['status'] for r in rows if r['policy'] in e.EXPLORATORY_POLICIES}, {'EXPLORATORY'})
        self.assertEqual({r['status'] for r in rows if r['policy'] in e.FROZEN_POLICIES}, {'frozen'})
        self.assertTrue(all(a['overall_pass'] for a in audits))


class PolicyBehaviour(unittest.TestCase):
    def setUp(self):
        self.vs = c.make_vehicles(24, 5)

    def test_first_vehicle_of_the_first_batch_decides_identically_under_both_variants(self):
        # Empty history and no earlier peers: the two information tiers cannot differ yet. (Later batches can differ,
        # because the commitment histories produced by the two policies differ.)
        r1, _, _ = e.assign_exploratory(self.vs, 1.0, 'independent_each_vehicle')
        r2, _, _ = e.assign_exploratory(self.vs, 1.0, 'peer_aware_sequential')
        first = c.batches(self.vs)[0][1][0]['id']
        self.assertEqual(r1[first], r2[first])
        self.assertEqual(r1[first], 'A')

    def test_independent_each_vehicle_matches_frozen_independent_at_default_timing(self):
        frozen, _, _ = c.assign_policy(self.vs, 1.0, 'independent_periodic')
        each, _, _ = e.assign_exploratory(self.vs, 1.0, 'independent_each_vehicle')
        self.assertEqual(frozen, each)

    def test_peer_aware_sequential_pinned_result_and_ordering(self):
        routes, dec, bat = e.assign_exploratory(self.vs, 1.0, 'peer_aware_sequential')
        met, *_ = c.summarize(self.vs, routes, 1.0, 'peer_aware_sequential', dec, bat)
        self.assertAlmostEqual(met['total_fleet_travel_time_vehicle_min'], 251.191667, places=5)
        self.assertEqual((met['route_A_count'], met['route_B_count']), (16, 8))
        # ordered between the frozen independent (254.275) and the frozen coordinated (249.95) policies
        self.assertLess(met['total_fleet_travel_time_vehicle_min'], 254.275)
        self.assertGreater(met['total_fleet_travel_time_vehicle_min'], 249.95)

    def test_peer_aware_batches_can_split_while_frozen_independent_never_does(self):
        _, _, bat_peer = e.assign_exploratory(self.vs, 1.0, 'peer_aware_sequential')
        _, _, bat_ind = c.assign_policy(self.vs, 1.0, 'independent_periodic')
        self.assertEqual(max(b['dominant_route_share'] for b in bat_ind), 1.0)

    def test_decision_log_states_the_information_contract(self):
        _, dec, _ = e.assign_exploratory(self.vs, 1.0, 'peer_aware_sequential')
        self.assertTrue(all('same batch' in d['available_info'] and d['route_switches'] == 0 for d in dec))
        _, dec, _ = e.assign_exploratory(self.vs, 1.0, 'independent_each_vehicle')
        self.assertTrue(all('no peers' in d['available_info'] for d in dec))

    def test_unknown_policy_rejected(self):
        with self.assertRaises(ValueError): e.assign_exploratory(self.vs, 1.0, 'coordinated_batch')


class ProbeSensitivity(unittest.TestCase):
    """The frozen independent policy lets batch[0] probe the costs and copies the choice to the whole batch. At the frozen
    timing the choice of probe makes no difference (verified: outputs identical if batch[-1] probes instead), but once the epoch
    grid shifts it does (5 of 40 timing cells differ). These pins fix the batch[0] behaviour and document the sensitivity."""
    def total(self, sc_name, offset):
        sc = next(s for s in c.SCENARIOS if s['name'] == sc_name)
        vs = c.make_vehicles(sc['n'], sc['spacing_s'])
        r, d, b = c.assign_policy(vs, sc['scale'], 'independent_periodic', 30.0, offset)
        return c.summarize(vs, r, sc['scale'], 'x', d, b)[0]['total_fleet_travel_time_vehicle_min']

    def test_pinned_totals_under_shifted_epoch_grids(self):
        self.assertAlmostEqual(self.total('near_branch_capacity', 5.0), 251.65, places=5)
        self.assertAlmostEqual(self.total('near_branch_capacity', 10.0), 252.15, places=5)
        self.assertAlmostEqual(self.total('primary_half_capacity', 5.0), 103.25, places=5)
        self.assertAlmostEqual(self.total('near_branch_capacity', 0.0), 254.275, places=5)       # frozen timing


class EpochGrid(unittest.TestCase):
    def test_epoch_anchor_literal_equals_e1_free_flow_time(self):
        # batches() hard-codes 180.0 as 'the first possible P arrival'. That is only true while E1 takes 180 s free-flow.
        e1 = next(x for x in m.EDGES if x['id'] == 'E1')
        self.assertEqual(180.0, e1['free_min'] * 60)
        self.assertEqual(min(v['p_arrival_s'] for v in c.make_vehicles(10, 10)), 180.0)

    def test_default_and_explicit_zero_offset_are_identical(self):
        vs = c.make_vehicles(60, 2)
        self.assertEqual(c.batches(vs), c.batches(vs, 30.0, 0.0))

    def test_no_decision_is_ever_made_after_the_vehicle_reaches_p(self):
        for sc in c.SCENARIOS:
            vs = c.make_vehicles(sc['n'], sc['spacing_s'])
            for upd in (10.0, 15.0, 30.0, 45.0, 60.0):
                for off in (0.0, upd / 6, upd / 3, upd / 2, upd * 0.9):
                    got = c.batches(vs, upd, off)
                    self.assertEqual(sum(len(g) for _, g in got), sc['n'])
                    for epoch, group in got:
                        self.assertLessEqual(epoch, min(v['p_arrival_s'] for v in group) + 1e-9, (sc['name'], upd, off))
                        self.assertGreaterEqual(epoch, m.INCIDENT_S)

    def test_offset_outside_period_is_rejected(self):
        with self.assertRaises(AssertionError): c.batches(c.make_vehicles(10, 10), 30.0, 30.0)


if __name__ == '__main__':
    unittest.main()
