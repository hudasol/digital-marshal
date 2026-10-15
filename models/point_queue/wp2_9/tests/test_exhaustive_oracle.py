"""Exhaustive small batch oracle (analysis only). Batches up to 6 vehicles are enumerated here; the 15 vehicle batches of
overload_stress take about 35 s and are run by tools/exhaustive_batch_oracle.py --max-batch 16 instead."""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src')); sys.path.insert(0, str(ROOT / 'tools'))
import exhaustive_batch_oracle as o


class Oracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.rows = o.analyse(max_batch=6)

    def test_production_is_never_better_than_the_exhaustive_optimum(self):
        for r in self.rows:
            if r[5] is not None: self.assertGreaterEqual(r[5], -1e-6, r)          # a negative gap would mean the oracle is wrong

    def test_oversized_batches_are_reported_not_skipped(self):
        skipped = [r for r in self.rows if r[5] is None]
        self.assertTrue(skipped and all(r[0] == 'overload_stress' for r in skipped))
        self.assertTrue(all('NOT ENUMERATED' in r[6] for r in skipped))

    def test_the_restricted_optimiser_is_not_globally_optimal_in_one_small_batch(self):
        gaps = {(r[0], r[1]): round(r[5], 3) for r in self.rows if r[5] is not None and abs(r[5]) > 1e-6}
        self.assertEqual(gaps, {('near_branch_capacity', 240.0): 4.5})                 # pinned: the limitation is real and small


if __name__ == '__main__':
    unittest.main()
