#!/usr/bin/env python3
"""Mutation sanity check: re-break each WP2.9 fix in a scratch copy and confirm the test suite notices.
usage: python tools/mutation_check.py REPO_DIR PYTHON   (standard library only; does not modify REPO_DIR)"""
import re, shutil, subprocess, sys, tempfile
from pathlib import Path
repo, py = Path(sys.argv[1]), sys.argv[2]
MUTANTS = [
 ('closure_violation hard-coded False again', 'src/canonical_model.py',
  "'complete':complete,'closure_violation':closure_violation}", "'complete':complete,'closure_violation':False}"),
 ('closed_link_entries hard-coded 0 again', 'src/confirmatory.py',
  "'closed_link_entries':closed_entries,", "'closed_link_entries':0,"),
 ('horizon back to 3600 s', 'src/canonical_model.py', 'HORIZON_S=7200.0', 'HORIZON_S=3600.0'),
 ('horizon decoupled: confirmatory keeps its own 7200', 'src/confirmatory.py', 'HORIZON_S = m.HORIZON_S', 'HORIZON_S = 3600.0'),
 ('coordinated tie-break flipped', 'src/confirmatory.py', 'key=(score,-k)', 'key=(score,k)'),
 ('independent policy copies a different probe', 'src/confirmatory.py', 'probe=group[0]', 'probe=group[-1]'),
 ('audit: headway check disabled', 'src/raw_audit.py', "if gap + EPS < head:", "if False:"),
 ('audit: overtaking check disabled', 'src/raw_audit.py', "if y['arr'] > x['arr'] + EPS and y['exit'] + EPS < x['exit']:", "if False:"),
 ('audit: closed-link check disabled', 'src/raw_audit.py', "if incident_s is not None and e['edge'] in closed and e['arr'] >= incident_s:", "if False:"),
 ('audit: teleport check disabled', 'src/raw_audit.py', "if abs(y['arr'] - x['exit']) > EPS:", "if False:"),
 ('audit: work-conservation check disabled', 'src/raw_audit.py', "if y['wait'] > EPS and gap > head + EPS:", "if False:"),
 ('audit: horizon completion check disabled', 'src/raw_audit.py', "if r['complete'] != should_complete:", "if False:"),
 ('audit B-01: missing run no longer flagged', 'src/raw_audit.py', "if key not in groups[name]: flag(key, 'missing_run'", "if False: flag(key, 'missing_run'"),
 ('audit B-01: unexpected run no longer flagged', 'src/raw_audit.py', "if key not in expected: flag(key, 'unexpected_run'", "if False: flag(key, 'unexpected_run'"),
 ('audit B-01: duplicate metrics row no longer flagged', 'src/raw_audit.py', "if len(rows) > 1: flag(key, 'duplicate_metrics_row'", "if False: flag(key, 'duplicate_metrics_row'"),
 ('audit B-01: decision log count no longer checked', 'src/raw_audit.py', "if dl and dl != n:", "if False:"),
 ('audit B-01: expected matrix derived from the metrics file again (original defect)', 'src/raw_audit.py',
  "expected = [(s, p) for s in spec['scenarios'] for p in spec['policies']]\n    pkg = []",
  "expected = list(dict.fromkeys((r['scenario'], r['policy']) for r in csv.DictReader(open(Path(results_dir) / 'confirmatory_metrics.csv'))))\n    pkg = []"),
 ('audit B-01: non finite numbers accepted', 'src/raw_audit.py', "if not _finite(r[c]): b(c, 'not a finite number')", "if False: b(c, 'not a finite number')"),
 ('audit B-01: completion flag literal not validated', 'src/raw_audit.py', "if name == 'vehicle_records.csv' and r['complete'] not in ('True', 'False'): b(", 'if False: b('),
 ('audit B-01: missing required columns not diagnosed', 'src/raw_audit.py', '    if miss:', '    if False:'),
 ('audit B-01: metrics vehicle count not checked', 'src/raw_audit.py', "if int(float(m0['vehicles'])) != n:", 'if False:'),
 ('audit B-01: metrics route counts sum not checked', 'src/raw_audit.py', "if int(float(m0['route_A_count'])) + int(float(m0['route_B_count'])) != n:", 'if False:'),
 ('audit B-01: decision vehicle ids not compared with vehicle records', 'src/raw_audit.py', "if set(dids) != {r['vehicle'] for r in veh}:", 'if False:'),
 ('audit B-01: duplicate decision rows not checked', 'src/raw_audit.py', 'if len(dids) != len(set(dids)):', 'if False:'),
 ('audit B-01: batch row split not checked', 'src/raw_audit.py', "if key not in malformed and int(float(r['A_count'])) + int(float(r['B_count'])) != int(float(r['batch_size'])):", 'if False:'),
 ('audit B-01: batch total not checked against the scenario', 'src/raw_audit.py', "sum(int(float(r['batch_size'])) for r in bl) != n:", 'False:'),
 ('audit B-01: unexpected exceptions no longer reported as failures', 'src/raw_audit.py', '    except Exception as e:', '    except KeyboardInterrupt as e:'),
 ('FIFO headway wrong in model (cap*1.1)', 'src/canonical_model.py', "head=60/e['cap_vpm']", "head=60/(e['cap_vpm']*1.1)"),
 ('audit review: vehicle route label not tied to paths', 'src/raw_audit.py', "if driven.get(r['vehicle']) != r['route']:", 'if False:'),
 ('audit review: decision route not tied to paths', 'src/raw_audit.py', "if driven.get(r['vehicle']) != r['chosen_route']:", 'if False:'),
 ('audit review: metrics route counts not tied to paths', 'src/raw_audit.py', "!= (nA, nB):\n            flag(key, 'metrics_route_counts_vs_paths'", "== (-1, -1):\n            flag(key, 'metrics_route_counts_vs_paths'"),
 ('audit review: batch route totals not tied to paths', 'src/raw_audit.py', "for r in bl)) != (nA, nB):\n            flag(key, 'batch_route_totals_vs_paths'", "for r in bl)) == (-1, -1):\n            flag(key, 'batch_route_totals_vs_paths'"),
]
killed = 0
for name, rel, old, new in MUTANTS:
    with tempfile.TemporaryDirectory() as d:
        dst = Path(d) / 'r'; shutil.copytree(repo, dst, ignore=shutil.ignore_patterns('.git', '__pycache__'))
        f = dst / rel; s = f.read_text()
        assert old in s, f'mutation target not found: {name}'
        f.write_text(s.replace(old, new, 1))
        r = subprocess.run([py, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=dst, env={'PYTHONPATH': 'src', 'PATH': '/usr/bin:/bin'},
                           capture_output=True, text=True)
        tail = r.stderr.strip().splitlines()[-1]
        failed = sorted(set(re.findall(r'^(?:FAIL|ERROR): (\w+)', r.stderr, re.M)))
        ok = r.returncode != 0; killed += ok
        print(f"{'KILLED  ' if ok else 'SURVIVED'} {name:55} {tail}  e.g. {failed[:3]}")
print(f'\n{killed}/{len(MUTANTS)} mutants killed')
sys.exit(0 if killed == len(MUTANTS) else 1)
