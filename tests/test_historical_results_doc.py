"""docs/historical-results.md must agree with the baseline results file it quotes."""
import csv, re, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / 'models/point_queue/baseline_wp2_7/results/confirmatory_metrics.csv'
DOC = ROOT / 'docs/historical-results.md'
LABEL = {'Manageable demand': 'manageable_primary', 'Near capacity': 'near_branch_capacity', 'Overload stress': 'overload_stress',
         'Half branch capacity': 'primary_half_capacity', 'Double branch capacity': 'primary_double_capacity'}


def table(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r'\| (.+?) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|$', line)
        if m and m.group(1) in LABEL: out[LABEL[m.group(1)]] = [float(x) for x in m.groups()[1:]]
    return out


class Doc(unittest.TestCase):
    def setUp(self):
        self.rows = {(r['scenario'], r['policy']): float(r['total_fleet_travel_time_vehicle_min']) for r in csv.DictReader(CSV.open())}

    def test_table_matches_source(self):
        got = table(DOC.read_text()); self.assertEqual(set(got), set(LABEL.values()))
        for s, (st, ind, co, imp) in got.items():
            self.assertAlmostEqual(st, self.rows[s, 'static'], delta=0.0006)
            self.assertAlmostEqual(ind, self.rows[s, 'independent_periodic'], delta=0.0006)
            self.assertAlmostEqual(co, self.rows[s, 'coordinated_batch'], delta=0.0006)
            i, c = self.rows[s, 'independent_periodic'], self.rows[s, 'coordinated_batch']
            self.assertAlmostEqual(imp, 100 * (i - c) / i, delta=0.006)

    def test_a_wrong_number_is_detected(self):
        bad = DOC.read_text().replace('254.275', '250.000', 1)
        got = table(bad)
        self.assertNotAlmostEqual(got['near_branch_capacity'][1], self.rows['near_branch_capacity', 'independent_periodic'], delta=0.0006)

    def test_historical_values_in_task_brief_are_present(self):
        text = DOC.read_text()
        for v in ('93.750', '254.275', '249.950', '719.875', '701.492', '104.050', '102.800', '90.000', '1.70', '2.55', '1.20'):
            self.assertIn(v, text)


if __name__ == '__main__':
    unittest.main()
