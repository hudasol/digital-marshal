#!/usr/bin/env python3
"""Check an original WP2.7 archive against the provenance records in this repository (standard library only).

usage: python tools/verify_archive.py ARCHIVE.zip [--expected-sha HEX] [--record docs/provenance/archive-reconciliation.csv]
                                      [--extract-run-manifest OUTDIR]

What it does, in order:
  1. SHA 256 of the archive against the expected value.
  2. Lists the file members (directories ignored; one common top level folder is stripped) and compares them with the 21
     paths in the reconciliation record.
  3. Recomputes each member hash and compares it with the recorded original hash.
  4. Compares each committed destination file with its member, byte for byte.
  5. Scans results/run_manifest.json for publication risks (absolute paths, e mail addresses, token like strings).
  6. With --extract-run-manifest, writes that member UNCHANGED into OUTDIR. It never edits the repository and never commits.
Prints a JSON report. Exit 0 only if steps 1 to 4 fully agree. The scan in step 5 is advisory: a human decides what to publish."""
import argparse, csv, hashlib, json, re, sys, zipfile
from pathlib import Path

EXPECTED_SHA = '28a24168e7b22c2e1f9c88b5dcdd79cdc18f0d26a4f40551d670d2869dc80d3e'
ROOT = Path(__file__).resolve().parents[1]
RISKS = {'absolute_path': re.compile(r'(?<![A-Za-z0-9_.])(/(?:mnt|home|tmp|root|Users|var)/[^\s"\']+|[A-Za-z]:\\[^\s"\']+)'),
         'email': re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
         'token_like': re.compile(r'(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)'),
         'credential_word': re.compile(r'(?i)(password|passwd|secret|api[_-]?key|access[_-]?token)\s*["\':=]')}


def sha(b): return hashlib.sha256(b).hexdigest()


def run(archive, expected, record, repo=ROOT):
    rep = {'archive': str(archive), 'checks': {}, 'problems': []}
    raw = Path(archive).read_bytes(); h = sha(raw)
    rep['archive_sha256'] = h; rep['checks']['archive_hash_matches'] = (h == expected)
    if h != expected: rep['problems'].append(f'archive hash {h} != expected {expected}')
    with zipfile.ZipFile(archive) as z:
        bad = z.testzip(); rep['checks']['zip_integrity'] = bad is None
        names = [n for n in z.namelist() if not n.endswith('/')]
        tops = {n.split('/')[0] for n in names}
        strip = (len(tops) == 1 and all('/' in n for n in names))
        members = {(n.split('/', 1)[1] if strip else n): z.read(n) for n in names}
    with open(record, newline='') as f: rec = {r['original_path']: r for r in csv.DictReader(f)}
    rep['member_count'] = len(members); rep['record_count'] = len(rec)
    missing, extra = sorted(set(rec) - set(members)), sorted(set(members) - set(rec))
    rep['checks']['member_set_matches_record'] = not missing and not extra
    if missing: rep['problems'].append(f'members missing from archive: {missing}')
    if extra: rep['problems'].append(f'members not in record: {extra}')
    mism, cmism = [], []
    for p, r in rec.items():
        if p not in members: continue
        if sha(members[p]) != r['original_member_hash_recorded']: mism.append(p)
        d = r['destination_path']
        if d and (repo / d).exists() and (repo / d).read_bytes() != members[p]: cmism.append(p)
    rep['checks']['member_hashes_match_record'] = not mism
    rep['checks']['committed_files_equal_members'] = not cmism
    if mism: rep['problems'].append(f'member hash differs from record: {mism}')
    if cmism: rep['problems'].append(f'committed file differs from member: {cmism}')
    rm = members.get('results/run_manifest.json')
    if rm is not None:
        text = rm.decode('utf-8', 'replace')
        rep['run_manifest'] = {'sha256': sha(rm), 'bytes': len(rm),
                               'risks': {k: sorted(set(m if isinstance(m, str) else m[0] for m in rx.findall(text)))[:20] for k, rx in RISKS.items()}}
    rep['_run_manifest_bytes'] = rm
    rep['pass'] = all(rep['checks'].values())
    return rep


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('archive'); ap.add_argument('--expected-sha', default=EXPECTED_SHA)
    ap.add_argument('--record', default=str(ROOT / 'docs/provenance/archive-reconciliation.csv')); ap.add_argument('--extract-run-manifest')
    a = ap.parse_args()
    rep = run(a.archive, a.expected_sha, a.record)
    rm = rep.pop('_run_manifest_bytes')
    if a.extract_run_manifest and rm is not None:
        out = Path(a.extract_run_manifest); out.mkdir(parents=True, exist_ok=True); (out / 'run_manifest.json').write_bytes(rm)
        rep['extracted_to'] = str(out / 'run_manifest.json')
    print(json.dumps(rep, indent=2)); sys.exit(0 if rep['pass'] else 1)
