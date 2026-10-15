"""Provenance records must agree with what is actually committed, and the archive checker must be able to fail."""
import csv, hashlib, json, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import verify_archive as va

sha = lambda b: hashlib.sha256(b).hexdigest()
REC = ROOT / 'docs/provenance/archive-reconciliation.csv'


def load(path):
    with open(path, newline='') as f: return list(csv.DictReader(f))


def tracked():
    return set(subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).split('\n')) - {''}


class CommittedManifest(unittest.TestCase):
    def test_every_manifest_line_is_a_tracked_file_with_the_right_hash(self):
        t = tracked(); lines = [l for l in (ROOT / 'docs/provenance/sha256-manifest.txt').read_text().splitlines() if l.strip()]
        self.assertGreater(len(lines), 10)
        for l in lines:
            h, p = l.split('  ', 1)
            self.assertIn(p, t, f'{p} is listed as committed but is not tracked by git')
            self.assertEqual(sha((ROOT / p).read_bytes()), h, p)

    def test_no_bytecode_is_represented_as_committed(self):
        text = (ROOT / 'docs/provenance/sha256-manifest.txt').read_text()
        self.assertNotIn('.pyc', text); self.assertNotIn('__pycache__', text)
        self.assertFalse([p for p in tracked() if p.endswith('.pyc') or '__pycache__' in p])

    def test_every_tracked_imported_file_is_in_the_manifest(self):
        listed = {l.split('  ', 1)[1] for l in (ROOT / 'docs/provenance/sha256-manifest.txt').read_text().splitlines() if l.strip()}
        want = {p for p in tracked() if p.startswith(('models/point_queue/baseline_wp2_7/', 'results/historical/wp2_7_reported/', 'docs/decisions/source/'))}
        self.assertEqual(listed, want)


class Reconciliation(unittest.TestCase):
    def setUp(self): self.rows = load(REC)

    def test_all_21_original_members_are_accounted_for(self):
        self.assertEqual(len(self.rows), 21); self.assertEqual(len({r['original_path'] for r in self.rows}), 21)

    def test_committed_rows_match_actual_files_and_uncommitted_rows_are_not_in_git(self):
        t = tracked(); committed = 0
        for r in self.rows:
            if r['destination_path']:
                committed += 1
                self.assertIn(r['destination_path'], t)
                self.assertEqual(sha((ROOT / r['destination_path']).read_bytes()), r['committed_file_hash_recomputed'])
                self.assertEqual(r['committed_file_hash_recomputed'], r['original_member_hash_recorded'], r['original_path'])
            else:
                self.assertTrue(r['disposition'].startswith('NOT IMPORTED'))
                self.assertEqual(r['committed_file_hash_recomputed'], '')
        self.assertEqual(committed, 17)
        self.assertEqual(sorted(r['original_path'] for r in self.rows if not r['destination_path']),
                         ['results/run_manifest.json', 'src/__pycache__/canonical_model.cpython-313.pyc',
                          'src/__pycache__/confirmatory.cpython-313.pyc', 'tests/__pycache__/test_confirmatory.cpython-313.pyc'])


class ArchiveChecker(unittest.TestCase):
    """Builds a synthetic archive from the committed files plus stand in extras; no real archive is needed."""
    def make(self, d, tamper=None, drop=None, top='Digital_Marshal_WP2_7/'):
        rows = load(REC); z = Path(d) / 'a.zip'; recpath = Path(d) / 'rec.csv'
        members = {}
        for r in rows:
            if r['destination_path']: members[r['original_path']] = (ROOT / r['destination_path']).read_bytes()
            else: members[r['original_path']] = ('stand in for ' + r['original_path'] + ' /mnt/data/x contact a@b.com').encode()
        for r in rows:
            if not r['destination_path']: r['original_member_hash_recorded'] = sha(members[r['original_path']])
        with recpath.open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
        if tamper: members[tamper] = members[tamper] + b'x'
        if drop: del members[drop]
        with zipfile.ZipFile(z, 'w') as zf:
            for p, b in members.items(): zf.writestr(top + p, b)
        return z, recpath

    def test_consistent_archive_passes_and_flags_risks_in_the_run_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            z, rec = self.make(d); rep = va.run(z, sha(z.read_bytes()), rec)
            self.assertTrue(rep['pass'], rep['problems']); self.assertEqual(rep['member_count'], 21)
            self.assertTrue(rep['run_manifest']['risks']['absolute_path']); self.assertTrue(rep['run_manifest']['risks']['email'])

    def test_wrong_archive_hash_fails(self):
        with tempfile.TemporaryDirectory() as d:
            z, rec = self.make(d); self.assertFalse(va.run(z, 'ab' * 32, rec)['pass'])

    def test_tampered_member_fails_hash_and_committed_comparison(self):
        with tempfile.TemporaryDirectory() as d:
            z, rec = self.make(d, tamper='src/canonical_model.py'); rep = va.run(z, sha(z.read_bytes()), rec)
            self.assertFalse(rep['pass']); self.assertFalse(rep['checks']['member_hashes_match_record'])
            self.assertFalse(rep['checks']['committed_files_equal_members'])

    def test_missing_member_fails(self):
        with tempfile.TemporaryDirectory() as d:
            z, rec = self.make(d, drop='results/run_manifest.json'); rep = va.run(z, sha(z.read_bytes()), rec)
            self.assertFalse(rep['pass']); self.assertFalse(rep['checks']['member_set_matches_record'])

    def test_cli_exit_status_and_unchanged_extraction(self):
        with tempfile.TemporaryDirectory() as d:
            z, rec = self.make(d); out = Path(d) / 'out'
            r = subprocess.run([sys.executable, str(ROOT / 'tools/verify_archive.py'), str(z), '--expected-sha', sha(z.read_bytes()),
                                '--record', str(rec), '--extract-run-manifest', str(out)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout[-500:])
            with zipfile.ZipFile(z) as zf: orig = zf.read('Digital_Marshal_WP2_7/results/run_manifest.json')
            self.assertEqual((out / 'run_manifest.json').read_bytes(), orig)
            r = subprocess.run([sys.executable, str(ROOT / 'tools/verify_archive.py'), str(z), '--record', str(rec)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)


if __name__ == '__main__':
    unittest.main()
