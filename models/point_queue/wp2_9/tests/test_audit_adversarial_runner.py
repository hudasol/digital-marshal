"""The standalone adversarial runner (evidence generator) must itself pass on a genuine package and leave it unchanged."""
import subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import confirmatory as c


class Runner(unittest.TestCase):
    def test_every_documented_corruption_is_caught_and_the_fixture_is_untouched(self):
        with tempfile.TemporaryDirectory() as d:
            c.run_all(d)
            r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'audit_adversarial.py'), d], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr[-400:])
        self.assertIn('75/75 cases behaved as expected; fixture unchanged: True', r.stdout)


if __name__ == '__main__':
    unittest.main()
