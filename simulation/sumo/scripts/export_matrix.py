#!/usr/bin/env python3
"""Copy a Track C matrix into the repository without machine-specific files. Standard library only.
Kept per run: summary.json, run_config.json. Bundled into logs.tar.gz (deterministic: sorted, fixed mtime/owner):
vehicles.csv, decisions.csv, crossings.json of every run. Not kept: tripinfo.xml (its header holds absolute local paths)
and demand.rou.xml (regenerated from the seed); their SHA-256 stay in manifest.jsonl, which is copied with plan.json.
SHA256SUMS.txt covers every exported file and is written last.
usage: export_matrix.py MATRIX_DIR DEST_DIR
"""
import gzip, hashlib, io, json, shutil, sys, tarfile
from pathlib import Path

PER_RUN = ('summary.json', 'run_config.json')
LOGS = ('vehicles.csv', 'decisions.csv', 'crossings.json')


def export(mx, dest):
    dest.mkdir(parents=True, exist_ok=True)
    if any(dest.iterdir()): sys.exit(f'{dest} is not empty')
    runs = [json.loads(l)['run'] for l in (mx / 'manifest.jsonl').read_text().splitlines()]
    for f in ('manifest.jsonl', 'plan.json'): shutil.copyfile(mx / f, dest / f)
    for r in runs:
        (dest / 'runs' / r).mkdir(parents=True)
        for f in PER_RUN:
            if (mx / r / f).exists(): shutil.copyfile(mx / r / f, dest / 'runs' / r / f)
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.PAX_FORMAT) as tar:
        for r in sorted(runs):
            for f in LOGS:
                p = mx / r / f
                if not p.exists(): continue
                data = p.read_bytes(); info = tarfile.TarInfo(f'{r}/{f}')
                info.size, info.mtime, info.mode, info.uid, info.gid, info.uname, info.gname = len(data), 0, 0o644, 0, 0, '', ''
                tar.addfile(info, io.BytesIO(data))
    with (dest / 'logs.tar.gz').open('wb') as fh, gzip.GzipFile(fileobj=fh, mode='wb', mtime=0, filename='') as gz:
        gz.write(raw.getvalue())
    files = sorted(p for p in dest.rglob('*') if p.is_file())
    (dest / 'SHA256SUMS.txt').write_text(''.join(
        f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(dest).as_posix()}\n' for p in files), newline='\n')
    return len(runs), len(files) + 1


if __name__ == '__main__':
    print(export(Path(sys.argv[1]), Path(sys.argv[2])))
