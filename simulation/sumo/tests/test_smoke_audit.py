"""The smoke audit must be able to fail. Pure Python, no SUMO needed."""
import csv, json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import smoke

GOOD = ('E1', 'E4', 'E5', 'E6', 'E11')


def write(d, edges=GOOD, complete='True', n=75, tt=540.0, total=None):
    rows = [dict(vehicle=f'v{i:03d}', sched_depart_s=0.0, arrival_s=tt, travel_time_s=tt, complete=complete,
                 edges=' '.join(edges)) for i in range(n)]
    with (Path(d) / 'vehicles.csv').open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    (Path(d) / 'summary.json').write_text(json.dumps({'total_vehicle_min': n * tt / 60 if total is None else total}))


class SmokeAuditCanFail(unittest.TestCase):
    def check(self, **kw):
        with tempfile.TemporaryDirectory() as d:
            write(d, **kw); return smoke.audit(Path(d))

    def test_clean_records_pass(self): self.assertEqual(self.check(), [])
    def test_closed_edge_is_caught(self): self.assertTrue(any(b[0] == 'closed_edge_in_path' for b in self.check(edges=('E1', 'E2', 'E3'))))
    def test_unknown_path_is_caught(self): self.assertTrue(any(b[0] == 'path_not_allowed' for b in self.check(edges=('E1', 'E4', 'E11'))))
    def test_incomplete_trip_is_caught(self): self.assertTrue(any(b[0] == 'incomplete' for b in self.check(complete='False')))
    def test_wrong_vehicle_count_is_caught(self): self.assertEqual(self.check(n=74)[0][0], 'vehicle_count')
    def test_total_mismatch_is_caught(self): self.assertTrue(any(b[0] == 'total_mismatch' for b in self.check(total=1.0)))
    def test_travel_time_accounting_is_caught(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, tt=540.0)
            rows = list(csv.DictReader((Path(d) / 'vehicles.csv').open()))
            rows[0]['arrival_s'] = '9999'
            with (Path(d) / 'vehicles.csv').open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
            self.assertTrue(any(b[0] == 'travel_time_accounting' for b in smoke.audit(Path(d))))


if __name__ == '__main__':
    unittest.main()
