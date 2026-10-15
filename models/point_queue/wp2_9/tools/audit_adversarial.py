#!/usr/bin/env python3
"""Adversarial run of the REAL audit command line tool on disposable copies of a genuine results package.

usage: python tools/audit_adversarial.py GOOD_RESULTS_DIR [--md OUT.md]      (standard library only)

The case table below is written by hand: for each corruption it states the exit code and the diagnostic check name the
audit is expected to give. The expectations do not come from the audit implementation. The original package is hashed
before and after and is never modified. Exit 0 only if the control passes and every corruption behaves as expected."""
import argparse, csv, hashlib, json, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ['confirmatory_metrics.csv', 'vehicle_records.csv', 'edge_event_records.csv', 'decision_log.csv', 'batch_allocation_log.csv']
SC = ['manageable_primary', 'near_branch_capacity', 'overload_stress', 'primary_half_capacity', 'primary_double_capacity']
PO = ['static', 'independent_periodic', 'coordinated_batch']
KEY = ('near_branch_capacity', 'coordinated_batch')


def rd(p):
    with open(p, newline='') as f: r = list(csv.reader(f))
    return r[0], r[1:]


def wr(p, h, rows):
    with open(p, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(h); w.writerows(rows)


def drop(d, f, key):
    h, r = rd(d / f); s, p = h.index('scenario'), h.index('policy'); wr(d / f, h, [x for x in r if (x[s], x[p]) != key])


def setcell(d, f, col, val, key=KEY):
    h, r = rd(d / f); s, p, c = h.index('scenario'), h.index('policy'), h.index(col)
    next(x for x in r if (x[s], x[p]) == key)[c] = val; wr(d / f, h, r)


def dup(d, f, key):
    h, r = rd(d / f); s, p = h.index('scenario'), h.index('policy'); wr(d / f, h, r + [x for x in r if (x[s], x[p]) == key])


def rename(d, files, col, old, new):
    for f in files:
        h, r = rd(d / f); i = h.index(col)
        for x in r:
            if x[i] == old: x[i] = new
        wr(d / f, h, r)


def dropcol(d, f, col):
    h, r = rd(d / f); i = h.index(col); wr(d / f, [x for k, x in enumerate(h) if k != i], [[x for k, x in enumerate(y) if k != i] for y in r])


def addgroup(d, key_from, new_key):
    for f in FILES:
        h, r = rd(d / f); s, p = h.index('scenario'), h.index('policy'); extra = []
        for x in r:
            if (x[s], x[p]) == key_from: y = list(x); y[s], y[p] = new_key; extra.append(y)
        wr(d / f, h, r + extra)


def case_list():
    C = []
    C.append(('CONTROL complete valid package', 0, None, lambda d: None))
    for s in SC:
        for p in PO:
            C.append((f'metrics row removed: {s} / {p}', 1, 'missing_run', lambda d, s=s, p=p: drop(d, FILES[0], (s, p))))
    for f in FILES[1:]:
        C.append((f'scenario policy group removed from {f}', 1, 'missing_run', lambda d, f=f: drop(d, f, KEY)))
    C.append(('metrics row duplicated', 1, 'duplicate_metrics_row', lambda d: dup(d, FILES[0], KEY)))
    C.append(('vehicle record group duplicated', 1, 'duplicate_vehicle_rows', lambda d: dup(d, FILES[1], KEY)))
    C.append(('edge event group duplicated', 1, 'edge_visited_twice', lambda d: dup(d, FILES[2], KEY)))
    C.append(('decision record duplicated', 1, 'duplicate_decision_rows', lambda d: dup(d, FILES[3], KEY)))
    C.append(('scenario renamed in all files', 1, 'unexpected_run', lambda d: rename(d, FILES, 'scenario', 'overload_stress', 'overload_stress_v2')))
    C.append(('policy renamed in metrics only', 1, 'unexpected_run', lambda d: rename(d, FILES[:1], 'policy', 'coordinated_batch', 'coordinated_batch2')))
    for v in ('static ', ' static', 'Static', 'STATIC'):
        C.append((f'non canonical policy identifier {v!r}', 1, 'unexpected_run', lambda d, v=v: rename(d, FILES, 'policy', 'static', v)))
    C.append(('non canonical scenario identifier (case)', 1, 'unexpected_run', lambda d: rename(d, FILES, 'scenario', 'manageable_primary', 'Manageable_Primary')))
    C.append(('extra exploratory policy in a frozen package', 1, 'unexpected_run', lambda d: addgroup(d, KEY, (KEY[0], 'peer_aware_sequential'))))
    C.append(('extra unknown scenario', 1, 'unexpected_run', lambda d: addgroup(d, ('manageable_primary', 'static'), ('surprise_scenario', 'static'))))
    for f in FILES:
        C.append((f'file missing: {f}', 1, 'results_file_missing', lambda d, f=f: (d / f).unlink()))
    C.append(('file empty (header only): metrics', 1, 'results_file_empty', lambda d: wr(d / FILES[0], rd(d / FILES[0])[0], [])))
    C.append(('zero byte file: edge events', 1, 'results_file_empty', lambda d: (d / FILES[2]).write_text('')))
    C.append(('empty results directory', 1, 'results_file_missing', lambda d: [(d / f).unlink() for f in FILES]))
    C.append(('binary garbage in decision log', 1, 'results_file_unreadable', lambda d: (d / FILES[3]).write_bytes(b'\xff\xfe\x00garbage\x80')))
    C.append(('directory in place of a file', 1, 'results_file_unreadable', lambda d: ((d / FILES[3]).unlink(), (d / FILES[3]).mkdir())))
    for f, col in ((FILES[1], 'arrival_s'), (FILES[2], 'exit_s'), (FILES[0], 'route_A_count'), (FILES[4], 'batch_size'), (FILES[3], 'vehicle'),
                   (FILES[0], 'scenario'), (FILES[1], 'policy')):
        C.append((f'required column {col!r} removed from {f}', 1, 'missing_required_columns', lambda d, f=f, col=col: dropcol(d, f, col)))
    C.append(('metrics vehicle count 23 instead of 24', 1, 'metrics_vehicle_count', lambda d: setcell(d, FILES[0], 'vehicles', '23')))
    C.append(('vehicle record removed (23 of 24)', 1, 'vehicle_conservation', lambda d: (lambda h, r: wr(d / FILES[1], h, r[:0] + [x for i, x in enumerate(r) if not (x[h.index('scenario')], x[h.index('policy')]) == KEY or i != next(j for j, y in enumerate(r) if (y[h.index('scenario')], y[h.index('policy')]) == KEY)]))(*rd(d / FILES[1]))))
    C.append(('decision log lists the wrong vehicle', 1, 'decision_vehicle_ids_mismatch', lambda d: setcell(d, FILES[3], 'vehicle', 'V999')))
    C.append(('batch log split does not add up', 1, 'batch_row_counts_do_not_sum', lambda d: setcell(d, FILES[4], 'A_count', '99')))
    C.append(('metrics route counts do not sum to the fleet', 1, 'metrics_route_counts_do_not_sum', lambda d: setcell(d, FILES[0], 'route_B_count', '9')))
    C.append(('reported total disagrees with raw records', 1, 'metric_mismatch', lambda d: setcell(d, FILES[0], 'total_fleet_travel_time_vehicle_min', '240.0')))
    for f, col, v in ((FILES[0], 'total_fleet_travel_time_vehicle_min', 'abc'), (FILES[0], 'mean_travel_time_min', 'nan'),
                      (FILES[1], 'travel_time_s', 'inf'), (FILES[1], 'arrival_s', ''), (FILES[2], 'exit_s', 'x1'), (FILES[4], 'epoch_s', 'later'),
                      (FILES[0], 'completed', '-1'), (FILES[0], 'route_A_count', '3.5'), (FILES[1], 'complete', 'maybe'), (FILES[1], 'vehicle', '')):
        C.append((f'malformed value {col}={v!r} in {f}', 1, 'malformed_value', lambda d, f=f, col=col, v=v: setcell(d, f, col, v)))
    def flip(d, f, col):
        h, r = rd(d / f); s, p, i = h.index('scenario'), h.index('policy'), h.index(col)
        x = next(x for x in r if (x[s], x[p]) == KEY); x[i] = 'B' if x[i] == 'A' else 'A'; wr(d / f, h, r)
    def swap_counts(d):
        h, r = rd(d / FILES[0]); s, p = h.index('scenario'), h.index('policy'); a, b = h.index('route_A_count'), h.index('route_B_count')
        x = next(x for x in r if (x[s], x[p]) == KEY); x[a], x[b] = x[b], x[a]; wr(d / FILES[0], h, r)
    def shift_batch(d):
        h, r = rd(d / FILES[4]); s, p = h.index('scenario'), h.index('policy'); a, b = h.index('A_count'), h.index('B_count')
        x = next(x for x in r if (x[s], x[p]) == KEY and int(x[a]) > 0); x[a], x[b] = str(int(x[a]) - 1), str(int(x[b]) + 1); wr(d / FILES[4], h, r)
    C.append(('route counts swapped in metrics (sum unchanged)', 1, 'metrics_route_counts_vs_paths', swap_counts))
    C.append(('route label flipped in vehicle records', 1, 'vehicle_route_label_mismatch', lambda d: flip(d, FILES[1], 'route')))
    C.append(('chosen route flipped in decision log', 1, 'decision_route_mismatch', lambda d: flip(d, FILES[3], 'chosen_route')))
    C.append(('batch log moves a vehicle between routes (row sum unchanged)', 1, 'batch_route_totals_vs_paths', shift_batch))
    def epoch_shift(d):
        h, r = rd(d / FILES[4]); s, p = h.index('scenario'), h.index('policy')
        next(x for x in r if (x[s], x[p]) == KEY)[h.index('epoch_s')] = '181.0'; wr(d / FILES[4], h, r)
    def move_between_epochs(d):
        h, r = rd(d / FILES[4]); s, p = h.index('scenario'), h.index('policy'); b, a = h.index('batch_size'), h.index('A_count')
        m = [x for x in r if (x[s], x[p]) == KEY]
        m[0][b], m[0][a] = str(int(m[0][b]) - 1), str(int(m[0][a]) - 1); m[1][b], m[1][a] = str(int(m[1][b]) + 1), str(int(m[1][a]) + 1); wr(d / FILES[4], h, r)
    C.append(('batch log row with the wrong epoch', 1, 'batch_epoch_mismatch', epoch_shift))
    C.append(('vehicle moved between epochs in the batch log (totals unchanged)', 1, 'batch_epoch_mismatch', move_between_epochs))
    C.append(('decision log p_arrival_s differs from vehicle record', 1, 'decision_field_mismatch', lambda d: setcell(d, FILES[3], 'p_arrival_s', '999.0')))
    C.append(('decision epoch after the P arrival (retroactive)', 1, 'decision_field_mismatch', lambda d: setcell(d, FILES[3], 'decision_epoch_s', '9999.0')))
    def leak(d):          # relabel a post incident Route A event as the closed edge E3: a vehicle 'entered' E3 after 120 s
        h, r = rd(d / FILES[2]); s, p, e = h.index('scenario'), h.index('policy'), h.index('edge')
        next(x for x in r if (x[s], x[p]) == KEY and x[e] == 'E4')[e] = 'E3'; wr(d / FILES[2], h, r)
    C.append(('FAULT in records: entry to closed edge E3 after the incident', 1, 'closed_link_entry', leak))
    return C


def run_cli(d):
    r = subprocess.run([sys.executable, str(ROOT / 'src/raw_audit.py'), '--results', str(d)], capture_output=True, text=True)
    try: out = json.loads(r.stdout)
    except ValueError: out = None
    return r.returncode, out, r.stderr


def tree_hash(d):
    h = hashlib.sha256()
    for f in sorted(Path(d).iterdir()): h.update(f.name.encode()); h.update(f.read_bytes() if f.is_file() else b'DIR')
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('good'); ap.add_argument('--md'); a = ap.parse_args()
    good = Path(a.good); before = tree_hash(good); rows = []; ok_all = True
    for name, want_code, want_check, mutate in case_list():
        with tempfile.TemporaryDirectory() as t:
            d = Path(t) / 'pkg'; d.mkdir()
            for f in FILES: shutil.copy(good / f, d / f)
            mutate(d)
            code, out, err = run_cli(d)
            checks = set()
            for v in (out or {}).get('violations', []):
                checks |= set(v.get('counts', {}))
            diag = ''
            if out and out.get('violations'):
                v0 = next((v for v in out['violations'] if want_check in v.get('counts', {})), out['violations'][0])
                dd = next((x for x in v0['detail'] if x.get('check') == want_check), v0['detail'][0] if v0['detail'] else {})
                diag = f"{v0['scenario']} / {v0['policy']}: {json.dumps(dd)[:110]}"
            ok = code == want_code and out is not None and (want_check is None and out.get('all_pass') is True or want_check in checks)
            ok_all &= ok
            rows.append((name, want_code, want_check or 'all_pass', code, 'PASS' if ok else 'FAIL', diag))
    after = tree_hash(good); fixture_ok = before == after
    n_ok = sum(r[4] == 'PASS' for r in rows)
    lines = ['# Audit adversarial results', '', f'Generated by `tools/audit_adversarial.py` against the real `src/raw_audit.py` command line tool. Original package hash before: `{before}`; after: `{after}` ({"unchanged" if fixture_ok else "CHANGED"}).', '',
             f'Cases: {len(rows)}; behaved as expected: {n_ok}.', '', '| Case | Expected exit | Expected diagnostic | Actual exit | Result | Diagnostic seen |', '|---|---:|---|---:|---|---|']
    for r in rows: lines.append(f'| {r[0]} | {r[1]} | `{r[2]}` | {r[3]} | {r[4]} | {r[5].replace("|", "/")} |')
    text = '\n'.join(lines) + '\n'
    if a.md: Path(a.md).write_text(text)
    print(f'{n_ok}/{len(rows)} cases behaved as expected; fixture unchanged: {fixture_ok}')
    sys.exit(0 if ok_all and fixture_ok else 1)


if __name__ == '__main__':
    main()
