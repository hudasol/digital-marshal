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
 ('FIFO headway wrong in model (cap*1.1)', 'src/canonical_model.py', "head=60/e['cap_vpm']", "head=60/(e['cap_vpm']*1.1)"),
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
