"""WP2.9 B-01: the raw audit must validate the COMPLETE expected scenario by policy matrix and fail closed.
Every test mutates a copy of a genuine results folder and runs the real command line tool, checking exit status and diagnostic."""
import csv, json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import confirmatory as c
import raw_audit as ra

FILES = ra.RESULT_FILES
KEY = ('near_branch_capacity', 'coordinated_batch')


def read(p):
    with open(p, newline='') as f: r = list(csv.reader(f))
    return r[0], r[1:]


def write(p, header, rows):
    with open(p, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(header); w.writerows(rows)


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.good = tempfile.TemporaryDirectory(); c.run_all(cls.good.name)

    @classmethod
    def tearDownClass(cls): cls.good.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.d = Path(self.tmp.name)
        for f in FILES: shutil.copy(Path(self.good.name) / f, self.d / f)

    def tearDown(self): self.tmp.cleanup()

    def cli(self):
        r = subprocess.run([sys.executable, str(ROOT / 'src' / 'raw_audit.py'), '--results', str(self.d)], capture_output=True, text=True)
        return r.returncode, (json.loads(r.stdout) if r.stdout.strip().startswith('{') else None), r

    def cols(self, f):
        h, rows = read(self.d / f); return h, rows, h.index('scenario'), h.index('policy')

    def drop_group(self, f, key):
        h, rows, si, pi = self.cols(f)
        write(self.d / f, h, [r for r in rows if (r[si], r[pi]) != key])

    def checks(self, out):
        return {(v['scenario'], v['policy']): set(v['counts']) for v in out['violations']}


class Control(Base):
    def test_complete_package_passes_with_exit_zero(self):
        code, out, _ = self.cli()
        self.assertEqual(code, 0); self.assertTrue(out['all_pass'])
        self.assertEqual((out['expected_runs'], out['runs_audited']), (15, 15))

    def test_spec_policies_match_the_experiment(self):
        with open(Path(self.good.name) / FILES[0], newline='') as f:
            self.assertEqual(set(ra.load_spec()['policies']), {r['policy'] for r in csv.DictReader(f)})
        self.assertEqual(set(ra.load_spec()['scenarios']), {s['name'] for s in c.SCENARIOS})


class MissingRuns(Base):
    def test_reviewer_probe_one_metrics_row_removed_for_every_run(self):
        for sc in ra.load_spec()['scenarios']:
            for pol in ra.load_spec()['policies']:
                with self.subTest(sc=sc, pol=pol):
                    shutil.copy(Path(self.good.name) / FILES[0], self.d / FILES[0])
                    self.drop_group(FILES[0], (sc, pol))
                    code, out, _ = self.cli()
                    self.assertEqual(code, 1); self.assertFalse(out['all_pass']); self.assertEqual(out['runs_audited'], 14)
                    self.assertIn('missing_run', self.checks(out)[(sc, pol)])

    def test_missing_group_in_each_other_file_fails_closed_and_names_the_file(self):
        for f in FILES[1:]:
            with self.subTest(file=f):
                shutil.copy(Path(self.good.name) / f, self.d / f)
                self.drop_group(f, KEY)
                code, out, _ = self.cli()
                self.assertEqual(code, 1)
                v = next(x for x in out['violations'] if (x['scenario'], x['policy']) == KEY)
                self.assertIn('missing_run', v['counts'])
                self.assertTrue(any(d.get('file') == f for d in v['detail']), v['detail'])

    def test_partially_missing_vehicle_rows_fail(self):
        h, rows, si, pi = self.cols('vehicle_records.csv')
        i = next(k for k, r in enumerate(rows) if (r[si], r[pi]) == KEY); del rows[i]
        write(self.d / 'vehicle_records.csv', h, rows)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('vehicle_conservation', self.checks(out)[KEY])

    def test_missing_decision_rows_fail(self):
        h, rows, si, pi = self.cols('decision_log.csv')
        i = next(k for k, r in enumerate(rows) if (r[si], r[pi]) == KEY); del rows[i]
        write(self.d / 'decision_log.csv', h, rows)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('decision_log_row_count', self.checks(out)[KEY])

    def test_batch_log_total_mismatch_fails(self):
        h, rows, si, pi = self.cols('batch_allocation_log.csv')
        i = next(k for k, r in enumerate(rows) if (r[si], r[pi]) == KEY); del rows[i]
        write(self.d / 'batch_allocation_log.csv', h, rows)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('batch_log_total_mismatch', self.checks(out)[KEY])


class MissingOrBrokenFiles(Base):
    def test_missing_file_fails(self):
        for f in FILES:
            with self.subTest(file=f):
                (self.d / f).unlink()
                code, out, _ = self.cli()
                self.assertEqual(code, 1); self.assertFalse(out['all_pass'])
                self.assertIn('results_file_missing', self.checks(out)[('(package)', '(package)')])
                shutil.copy(Path(self.good.name) / f, self.d / f)

    def test_empty_file_and_header_only_file_fail(self):
        write(self.d / 'confirmatory_metrics.csv', read(self.d / 'confirmatory_metrics.csv')[0], [])
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('results_file_empty', self.checks(out)[('(package)', '(package)')])

    def test_file_without_scenario_column_fails(self):
        h, rows = read(self.d / 'decision_log.csv'); i = h.index('scenario')
        write(self.d / 'decision_log.csv', [x for k, x in enumerate(h) if k != i], [[x for k, x in enumerate(r) if k != i] for r in rows])
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('missing_required_columns', self.checks(out)[('(package)', '(package)')])

    def test_empty_directory_fails(self):
        for f in FILES: (self.d / f).unlink()
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertEqual(out['runs_audited'], 0); self.assertFalse(out['all_pass'])


class Duplicates(Base):
    def test_duplicated_metrics_row_fails(self):
        h, rows, si, pi = self.cols(FILES[0])
        rows.append(next(r for r in rows if (r[si], r[pi]) == KEY)); write(self.d / FILES[0], h, rows)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('duplicate_metrics_row', self.checks(out)[KEY])

    def test_duplicated_vehicle_group_fails(self):
        h, rows, si, pi = self.cols('vehicle_records.csv')
        rows += [r for r in rows if (r[si], r[pi]) == KEY]; write(self.d / 'vehicle_records.csv', h, rows)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('duplicate_vehicle_rows', self.checks(out)[KEY])

    def test_duplicated_event_group_fails(self):
        h, rows, si, pi = self.cols('edge_event_records.csv')
        rows += [r for r in rows if (r[si], r[pi]) == KEY]; write(self.d / 'edge_event_records.csv', h, rows)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('edge_visited_twice', self.checks(out)[KEY])


class UnexpectedOrRenamed(Base):
    def rename(self, files, old, new, column):
        for f in files:
            h, rows, si, pi = self.cols(f); idx = si if column == 'scenario' else pi
            for r in rows:
                if r[idx] == old: r[idx] = new
            write(self.d / f, h, rows)

    def test_renamed_scenario_in_all_files_fails_with_missing_and_unexpected(self):
        self.rename(FILES, 'overload_stress', 'overload_stress_v2', 'scenario')
        code, out, _ = self.cli(); chk = self.checks(out)
        self.assertEqual(code, 1)
        self.assertIn('unexpected_run', chk[('overload_stress_v2', 'static')])
        self.assertIn('missing_run', chk[('overload_stress', 'static')])

    def test_renamed_policy_in_metrics_only_fails(self):
        self.rename(FILES[:1], 'coordinated_batch', 'coordinated_batch2', 'policy')
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertEqual(out['runs_audited'] < 15, True)
        self.assertIn('unexpected_run', self.checks(out)[('near_branch_capacity', 'coordinated_batch2')])

    def test_whitespace_or_case_variants_are_not_accepted(self):
        for variant in ('static ', 'Static', ' static'):
            with self.subTest(variant=variant):
                shutil.copy(Path(self.good.name) / FILES[0], self.d / FILES[0])
                self.rename(FILES[:1], 'static', variant, 'policy')
                code, out, _ = self.cli()
                self.assertEqual(code, 1)

    def test_extra_exploratory_policy_in_a_frozen_package_fails(self):
        for f in FILES:
            h, rows, si, pi = self.cols(f)
            extra = [list(r) for r in rows if (r[si], r[pi]) == KEY]
            for r in extra: r[pi] = 'peer_aware_sequential'
            write(self.d / f, h, rows + extra)
        code, out, _ = self.cli()
        self.assertEqual(code, 1); self.assertIn('unexpected_run', self.checks(out)[('near_branch_capacity', 'peer_aware_sequential')])

    def test_extra_unknown_scenario_fails(self):
        for f in FILES:
            h, rows, si, pi = self.cols(f)
            extra = [list(r) for r in rows if r[si] == 'manageable_primary']
            for r in extra: r[si] = 'surprise_scenario'
            write(self.d / f, h, rows + extra)
        code, out, _ = self.cli()
        self.assertEqual(code, 1)
        self.assertTrue(any(k[0] == 'surprise_scenario' for k in self.checks(out)))


class MalformedValuesAndConsistency(Base):
    """Values that would crash a naive parser, or pass silently, must produce a specific diagnostic and exit 1 (never a traceback)."""
    def set_cell(self, f, col, value, key=KEY, nth=0):
        h, rows, si, pi = self.cols(f); ci = h.index(col)
        hits = [r for r in rows if (r[si], r[pi]) == key]; hits[nth][ci] = value
        write(self.d / f, h, rows)

    def expect(self, check, key=KEY):
        code, out, r = self.cli()
        self.assertIsNotNone(out, 'no JSON diagnostic produced: ' + r.stderr[-300:])
        self.assertEqual(code, 1, r.stdout[-400:]); self.assertFalse(out['all_pass'])
        self.assertIn(check, self.checks(out).get(key, set()), out['violations'][:2])
        return out

    def test_non_numeric_and_non_finite_values_are_diagnosed_not_crashed(self):
        for f, col, bad in (('confirmatory_metrics.csv', 'total_fleet_travel_time_vehicle_min', 'abc'),
                            ('confirmatory_metrics.csv', 'mean_travel_time_min', 'nan'),
                            ('vehicle_records.csv', 'travel_time_s', 'inf'),
                            ('vehicle_records.csv', 'arrival_s', ''),
                            ('edge_event_records.csv', 'exit_s', 'x1'),
                            ('batch_allocation_log.csv', 'epoch_s', 'later')):
            with self.subTest(file=f, column=col, value=bad):
                shutil.copy(Path(self.good.name) / f, self.d / f)
                self.set_cell(f, col, bad); self.expect('malformed_value')

    def test_counts_must_be_non_negative_integers(self):
        for col, bad in (('completed', '-1'), ('route_A_count', '3.5'), ('vehicles', 'ten')):
            with self.subTest(col=col):
                shutil.copy(Path(self.good.name) / FILES[0], self.d / FILES[0])
                self.set_cell(FILES[0], col, bad); self.expect('malformed_value')

    def test_completion_flag_must_be_a_boolean_literal(self):
        self.set_cell('vehicle_records.csv', 'complete', 'maybe'); self.expect('malformed_value')

    def test_empty_identifiers_are_rejected(self):
        self.set_cell('vehicle_records.csv', 'vehicle', ''); self.expect('malformed_value')

    def test_short_and_long_rows_are_rejected(self):
        p = self.d / 'edge_event_records.csv'; lines = p.read_text().splitlines()
        lines[3] = ','.join(lines[3].split(',')[:4])                       # truncated record
        p.write_text('\n'.join(lines) + '\n')
        code, out, r = self.cli(); self.assertEqual(code, 1); self.assertIsNotNone(out)
        shutil.copy(Path(self.good.name) / 'edge_event_records.csv', p)
        lines = p.read_text().splitlines(); lines[3] += ',extra'          # extra field
        p.write_text('\n'.join(lines) + '\n')
        code, out, r = self.cli(); self.assertEqual(code, 1); self.assertIsNotNone(out)

    def test_missing_required_column_in_each_file_is_diagnosed(self):
        for f, col in (('vehicle_records.csv', 'arrival_s'), ('edge_event_records.csv', 'exit_s'),
                       (FILES[0], 'route_A_count'), ('batch_allocation_log.csv', 'batch_size'), ('decision_log.csv', 'vehicle')):
            with self.subTest(file=f, col=col):
                shutil.copy(Path(self.good.name) / f, self.d / f)
                h, rows = read(self.d / f); i = h.index(col)
                write(self.d / f, [x for k, x in enumerate(h) if k != i], [[x for k, x in enumerate(r) if k != i] for r in rows])
                code, out, _ = self.cli(); self.assertEqual(code, 1)
                self.assertIn('missing_required_columns', self.checks(out)[('(package)', '(package)')])

    def test_binary_garbage_file_is_diagnosed(self):
        (self.d / 'decision_log.csv').write_bytes(b'\xff\xfe\x00garbage\x80')
        code, out, _ = self.cli(); self.assertEqual(code, 1); self.assertIn('results_file_unreadable', self.checks(out)[('(package)', '(package)')])

    def test_a_directory_in_place_of_a_result_file_is_diagnosed(self):
        (self.d / 'decision_log.csv').unlink(); (self.d / 'decision_log.csv').mkdir()
        code, out, _ = self.cli(); self.assertEqual(code, 1); self.assertIn('results_file_unreadable', self.checks(out)[('(package)', '(package)')])

    def test_an_internal_error_is_reported_as_a_failure_with_a_diagnostic_never_a_pass(self):
        spec = json.loads((ROOT / 'config' / 'graph_spec.json').read_text())
        del spec['scenarios']['overload_stress']['vehicles']                      # corrupt specification forces an internal KeyError
        sp = self.d / 'broken_spec.json'; sp.write_text(json.dumps(spec))
        r = subprocess.run([sys.executable, str(ROOT / 'src' / 'raw_audit.py'), '--results', str(self.d), '--spec', str(sp)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2); out = json.loads(r.stdout)
        self.assertFalse(out['all_pass']); self.assertEqual(out['error'], 'audit_crashed')

    def test_metrics_vehicle_count_disagreeing_with_the_scenario_spec(self):
        self.set_cell(FILES[0], 'vehicles', '23'); self.expect('metrics_vehicle_count')

    def test_metrics_route_counts_not_summing_to_the_fleet(self):
        self.set_cell(FILES[0], 'route_B_count', '9'); self.expect('metrics_route_counts_do_not_sum')

    def test_reported_total_that_disagrees_with_raw_records(self):
        self.set_cell(FILES[0], 'total_fleet_travel_time_vehicle_min', '240.0'); self.expect('metric_mismatch')

    def test_decision_log_listing_the_wrong_vehicle(self):
        self.set_cell('decision_log.csv', 'vehicle', 'V999'); self.expect('decision_vehicle_ids_mismatch')

    def test_duplicate_decision_record(self):
        h, rows, si, pi = self.cols('decision_log.csv')
        rows.append(next(r for r in rows if (r[si], r[pi]) == KEY)); write(self.d / 'decision_log.csv', h, rows)
        out = self.expect('duplicate_decision_rows'); self.assertIn('decision_log_row_count', self.checks(out)[KEY])

    def test_batch_row_whose_split_does_not_add_up(self):
        self.set_cell('batch_allocation_log.csv', 'A_count', '99'); self.expect('batch_row_counts_do_not_sum')

    def test_removing_one_metrics_row_from_an_otherwise_plausible_package_is_the_original_defect(self):
        # Every other file is untouched and internally consistent; only the metrics row is gone.
        self.drop_group(FILES[0], ('primary_half_capacity', 'independent_periodic'))
        code, out, _ = self.cli()
        self.assertEqual((code, out['all_pass'], out['runs_audited']), (1, False, 14))
        self.assertEqual(self.checks(out), {('primary_half_capacity', 'independent_periodic'): {'missing_run'}})


class LibraryApiFailsClosedToo(Base):
    def test_audit_results_dir_returns_a_failing_entry_for_every_missing_run(self):
        self.drop_group(FILES[0], KEY)
        res = ra.audit_results_dir(self.d)
        self.assertEqual(len(res), 15)
        self.assertFalse(all(r['pass'] for r in res))
        self.assertEqual([(r['scenario'], r['policy']) for r in res if not r['pass']], [KEY])


if __name__ == '__main__':
    unittest.main()
