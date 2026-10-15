import sys, unittest, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
import confirmatory as c

class ConfirmatoryTests(unittest.TestCase):
    def test_three_demand_regimes_prepositioned(self):
        for sc in c.SCENARIOS:
            vs=c.make_vehicles(sc['n'],sc['spacing_s'])
            self.assertLess(max(v['depart_s'] for v in vs),120)
            self.assertGreaterEqual(min(v['p_arrival_s'] for v in vs),120)
    def test_periodic_independent_batches_are_explicit(self):
        vs=c.make_vehicles(60,2)
        bs=c.batches(vs)
        self.assertTrue(all(t%30==0 for t,_ in bs))
        self.assertEqual(sum(len(g) for _,g in bs),60)
    def test_same_information_contract_recorded(self):
        vs=c.make_vehicles(24,5)
        routes,decisions,_=c.assign_policy(vs,1,'independent_periodic')
        self.assertEqual(len(routes),24)
        self.assertTrue(all('same synthetic graph' in d['available_info'] for d in decisions))
    def test_coordination_uses_same_batches_and_assigns_every_vehicle(self):
        vs=c.make_vehicles(24,5)
        routes,decisions,batches=c.assign_policy(vs,1,'coordinated_batch')
        self.assertEqual(len(routes),24); self.assertEqual(len(decisions),24)
        self.assertEqual(sum(b['batch_size'] for b in batches),24)
    def test_metric_definitions_and_p95(self):
        vs=c.make_vehicles(10,10)
        routes,decisions,batches=c.assign_policy(vs,1,'independent_periodic')
        metrics,*_=c.summarize(vs,routes,1,'independent_periodic',decisions,batches)
        self.assertIn('p95_nearest_rank_min',metrics)
        self.assertEqual(metrics['completed'],10)
        self.assertEqual(metrics['route_switches_total'],0)
    def test_all_policy_runs_have_zero_fifo_violations(self):
        vs=c.make_vehicles(10,10)
        for p in ('static','independent_periodic','coordinated_batch'):
            routes,d,b=c.assign_policy(vs,1,p)
            met,rows,logs,fifo=c.summarize(vs,routes,1,p,d,b)
            self.assertTrue(fifo['pass'],fifo['violations'][:1])
            self.assertTrue(met['checks_pass'])

if __name__=='__main__': unittest.main()
