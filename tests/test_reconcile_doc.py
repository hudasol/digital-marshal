"""The reconciliation document must agree with the result files it quotes."""
import subprocess, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


class DocAgreesWithSources(unittest.TestCase):
    def test_generated_tables_are_current(self):
        r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'reconcile.py'), '--check'])
        self.assertEqual(r.returncode, 0, 'run: python tools/reconcile.py and paste into docs/CROSS_MODEL_RECONCILIATION.md')

    def test_check_fails_when_a_number_is_edited(self):
        doc = ROOT / 'docs' / 'CROSS_MODEL_RECONCILIATION.md'
        original = doc.read_text()
        try:
            doc.write_text(original.replace('| near_branch_capacity | 1.70 |', '| near_branch_capacity | 9.99 |', 1))
            r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'reconcile.py'), '--check'])
            self.assertEqual(r.returncode, 1)
        finally:
            doc.write_text(original)


if __name__ == '__main__':
    unittest.main()
