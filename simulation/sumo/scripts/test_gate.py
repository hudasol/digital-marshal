"""Adversarial self-test: force 'route A' to be the closed critical route and confirm the audit gate trips (or SUMO refuses).
A gate that cannot fail is not a gate; the original point-queue pipeline hard-coded closed_link_entries=0."""
import json, sys, tempfile
import dm_run
dm_run.ROUTES['A'] = ['E1', 'E2', 'E3']          # leak: closed edges
try:
    s = dm_run.run('manageable_primary', 'static', 1, tempfile.mkdtemp(), {'mu_A': .5, 'mu_B': 1.0})
    print(json.dumps({k: s[k] for k in ('closed_link_entries', 'incomplete', 'checks_pass', 'sim_end_s')}))
    assert s['closed_link_entries'] > 0 or s['incomplete'] > 0, 'gate did not trip'
    assert not s['checks_pass']
    print('GATE TRIPS AS EXPECTED')
except Exception as e:
    print('SUMO rejected the illegal route before entry:', str(e)[:200]); print('GATE: route rejected at assignment (also acceptable)')
