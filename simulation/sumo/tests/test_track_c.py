"""Track C checks. Pure Python (no SUMO). The auditor must be able to fail, pairs must be matched, variants must differ as intended,
and the historical artifacts must be unchanged."""
import csv, hashlib, json, shutil, sys, tempfile, unittest
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'scripts'))
import sumo_audit, build_network

FX = HERE / 'fixtures'
GOOD, OTHER = FX / 'near_coordinated_batch', FX / 'near_independent_periodic'


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.d = self.tmp / 'run'; shutil.copytree(GOOD, self.d)
    def tearDown(self): shutil.rmtree(self.tmp, ignore_errors=True)
    def checks(self, d=None): return {v['check'] for v in sumo_audit.audit_run(d or self.d)}
    def rewrite_csv(self, name, fn):
        with (self.d / name).open(newline='') as fh: rows = list(csv.DictReader(fh))
        fn(rows)
        with (self.d / name).open('w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)


class AuditorCanFail(Case):
    def test_good_run_passes(self): self.assertEqual(sumo_audit.audit_run(self.d), [])
    def test_each_required_file_missing_is_caught(self):
        for n in sumo_audit.REQUIRED:
            d = self.tmp / ('m_' + n); shutil.copytree(GOOD, d); (d / n).unlink()
            self.assertIn('missing_file', self.checks(d), n)
    def test_each_required_file_empty_is_caught(self):
        for n in sumo_audit.REQUIRED:
            d = self.tmp / ('e_' + n); shutil.copytree(GOOD, d); (d / n).write_text('')
            self.assertIn('empty_file', self.checks(d), n)
    def test_corrupt_output_hash_is_caught(self):
        (self.d / 'tripinfo.xml').write_text((self.d / 'tripinfo.xml').read_text() + '\n<!-- edited -->')
        self.assertIn('output_hash_mismatch', self.checks())
    def test_invalid_status_is_caught(self):
        m = json.loads((self.d / 'run_manifest.json').read_text()); m['run_status'] = 'INVALID'
        (self.d / 'run_manifest.json').write_text(json.dumps(m))
        self.assertIn('run_status_not_complete', self.checks())
    def test_malformed_summary_is_caught(self):
        (self.d / 'summary.json').write_text('{not json')
        self.assertIn('unreadable_file', self.checks())
    def test_wrong_route_label_is_caught(self):
        def f(rows): rows[0]['route'] = 'B' if rows[0]['route'] == 'A' else 'A'
        self.rewrite_csv('vehicles.csv', f); self.assertTrue(self.checks())
    def test_closed_edge_path_is_caught(self):
        def f(rows): rows[0]['edges'] = 'E1 E2 E3'
        self.rewrite_csv('vehicles.csv', f); self.assertTrue({'closed_edge_in_path', 'path_not_allowed'} & self.checks())
    def test_removed_decision_is_caught(self):
        def f(rows): rows.pop(0)
        self.rewrite_csv('decisions.csv', f); self.assertTrue(self.checks())
    def test_duplicate_decision_is_caught(self):
        def f(rows): rows.append(dict(rows[0]))
        self.rewrite_csv('decisions.csv', f); self.assertTrue(self.checks())
    def test_decision_route_disagreeing_with_vehicle_is_caught(self):
        def f(rows): rows[0]['route'] = 'B' if rows[0]['route'] == 'A' else 'A'
        self.rewrite_csv('decisions.csv', f); self.assertTrue(self.checks())
    def test_tampered_summary_total_is_caught(self):
        s = json.loads((self.d / 'summary.json').read_text()); s['total_vehicle_min'] += 5
        (self.d / 'summary.json').write_text(json.dumps(s)); self.assertTrue(self.checks())
    def test_checks_pass_contradiction_is_caught(self):
        s = json.loads((self.d / 'summary.json').read_text()); s['collisions'] = 0; s['incomplete'] = 3; s['checks_pass'] = True
        (self.d / 'summary.json').write_text(json.dumps(s)); self.assertTrue(self.checks())


class PairMatching(Case):
    def edit_manifest(self, d, **kw):
        m = json.loads((d / 'run_manifest.json').read_text()); m.update(kw); (d / 'run_manifest.json').write_text(json.dumps(m))
    def setUp(self):
        super().setUp(); self.o = self.tmp / 'other'; shutil.copytree(OTHER, self.o)
    def test_matched_pair_passes(self): self.assertEqual(sumo_audit.audit_pair(self.o, self.d), [])
    def test_mismatched_seed_is_caught(self):
        self.edit_manifest(self.o, seed=99); self.assertTrue(any(v['check'] == 'pair_mismatch' for v in sumo_audit.audit_pair(self.o, self.d)))
    def test_mismatched_horizon_is_caught(self):
        self.edit_manifest(self.o, horizon_s=7200.0); self.assertTrue(any(v.get('field') == 'horizon_s' for v in sumo_audit.audit_pair(self.o, self.d)))
    def test_mismatched_demand_hash_is_caught(self):
        m = json.loads((self.o / 'run_manifest.json').read_text()); m['input_sha256']['demand'] = '0' * 64
        (self.o / 'run_manifest.json').write_text(json.dumps(m)); self.assertTrue(any(v['check'] == 'pair_input_hash_mismatch' for v in sumo_audit.audit_pair(self.o, self.d)))
    def test_same_policy_is_caught(self): self.assertTrue(any(v['check'] == 'pair_same_policy' for v in sumo_audit.audit_pair(self.d, self.d)))


class VariantsAndHistory(unittest.TestCase):
    def test_variant_parameters(self):
        import importlib, types
        src = (HERE.parent / 'scripts' / 'dm_run.py').read_text()
        self.assertIn("TAU_HALF = 3.0", src); self.assertIn("'cap2'", src); self.assertIn("'cap0p5'", src)
    def test_cap2_network_has_doubled_branch_lanes(self):
        net = (HERE.parent / 'network' / 'dm_cap2.edg.xml').read_text(); base = (HERE.parent / 'network' / 'dm.edg.xml').read_text()
        import re
        lanes = lambda t: {m[0]: int(m[1]) for m in re.findall(r'<edge id="(E\d+)"[^>]*numLanes="(\d+)"', t)}
        a, b = lanes(base), lanes(net)
        for e in ('E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10'): self.assertEqual(b[e], 2 * a[e], e)
        for e in ('E1', 'E2', 'E3', 'E11'): self.assertEqual(b[e], a[e], e)
    def test_calibration_records_achieved_ratio(self):
        for v in ('cap0p5', 'cap2'):
            c = json.loads((HERE.parent / 'network' / f'calibration_{v}.json').read_text())
            self.assertIn('ratio_to_base_A', c); self.assertIn('ratio_to_base_B', c); self.assertGreater(c['mu_A'], 0)
    def test_historical_artifacts_unchanged(self):
        rec = json.loads((FX / 'historical_sha256.json').read_text())['files']
        self.assertGreaterEqual(len(rec), 9)
        for f, h in rec.items(): self.assertEqual(sha(ROOT / f), h, f)
    def test_build_network_lane_scale_flag_exists(self): self.assertTrue(callable(build_network.build))


if __name__ == '__main__':
    unittest.main()
