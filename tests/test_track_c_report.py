"""The Track C report must agree with the result files it quotes, and the committed results must match their checksums."""
import hashlib, subprocess, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


class TrackCReport(unittest.TestCase):
    def test_generated_tables_are_current(self):
        r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'track_c_report.py'), '--check'])
        self.assertEqual(r.returncode, 0, 'run: python tools/track_c_report.py and paste into docs/TRACK_C_CROSS_MODEL_REPORT.md')

    def test_check_fails_when_a_number_is_edited(self):
        doc = ROOT / 'docs' / 'TRACK_C_CROSS_MODEL_REPORT.md'
        original = doc.read_text()
        try:
            doc.write_text(original.replace('| near_branch_capacity | 1.70 |', '| near_branch_capacity | 9.99 |', 1))
            self.assertEqual(subprocess.run([sys.executable, str(ROOT / 'tools' / 'track_c_report.py'), '--check']).returncode, 1)
        finally:
            doc.write_text(original)

    def test_results_match_checksums(self):
        base = ROOT / 'results' / 'track_c'; n = 0
        for line in (base / 'SHA256SUMS').read_text().splitlines():
            h, name = line.split(maxsplit=1)
            self.assertEqual(hashlib.sha256((base / name).read_bytes()).hexdigest(), h, name); n += 1
        self.assertGreater(n, 600)


if __name__ == '__main__':
    unittest.main()
