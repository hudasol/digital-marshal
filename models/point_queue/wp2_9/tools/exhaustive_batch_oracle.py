#!/usr/bin/env python3
"""Exhaustive small batch oracle for the frozen coordinated_batch policy (analysis only; changes nothing).

For every scenario and every 30 s batch of the frozen experiment, replay the production coordinator's committed history and
enumerate ALL 2^m A/B assignments of that batch (the production policy searches only m+1 evenly spread patterns). Each
assignment is scored with the same objective the production policy uses (total travel time of committed plus current batch
vehicles, from the model's own queue simulator). The enumeration here is independent of the production search; the queue
simulator and the objective are shared, so this checks the search restriction, not the model.

usage: python tools/exhaustive_batch_oracle.py [--max-batch 12] [--md OUT.md]      (standard library only)
Batches larger than --max-batch are reported as NOT ENUMERATED, never silently skipped.
Output never goes to results/. Exit 0 always unless the oracle finds production better than the optimum (impossible: a bug)."""
import argparse, itertools, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import confirmatory as c

SCEN = {'manageable_primary': (10, 10.0, 1.0), 'near_branch_capacity': (24, 5.0, 1.0), 'overload_stress': (60, 2.0, 1.0),
        'primary_half_capacity': (10, 10.0, 0.5), 'primary_double_capacity': (10, 10.0, 2.0)}


def analyse(max_batch):
    rows = []
    for name, (n, sp, scale) in SCEN.items():
        vs = c.make_vehicles(n, sp)
        assigned, _, stats = c.assign_policy(vs, scale, 'coordinated_batch')
        before = {}
        for epoch, group in c.batches(vs):
            ids = [v['id'] for v in group]; score_ids = list(before) + ids
            prod = {i: assigned[i] for i in ids}
            ps = c.evaluate_assignment(vs, {**before, **prod}, scale, score_ids)[0]
            if len(group) > max_batch:
                rows.append((name, epoch, len(group), ps, None, None, 'NOT ENUMERATED (batch too large)')); before.update(prod); continue
            best = None; n_opt = 0
            for combo in itertools.product('AB', repeat=len(group)):
                cand = {**before, **dict(zip(ids, combo))}
                s = c.evaluate_assignment(vs, cand, scale, score_ids)[0]
                if best is None or s < best - 1e-9: best, n_opt = s, 1
                elif abs(s - best) <= 1e-9: n_opt += 1
            rows.append((name, epoch, len(group), ps, best, ps - best, f'{n_opt} optimal of {2 ** len(group)}'))
            before.update(prod)
    return rows


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--max-batch', type=int, default=12); ap.add_argument('--md'); a = ap.parse_args()
    rows = analyse(a.max_batch)
    lines = ['| Scenario | Epoch s | Batch | Production score s | Exhaustive optimum s | Gap s | Note |', '|---|---:|---:|---:|---:|---:|---|']
    bug = False
    for r in rows:
        gap = '' if r[5] is None else f'{r[5]:.3f}'; opt = '' if r[4] is None else f'{r[4]:.3f}'
        lines.append(f'| {r[0]} | {r[1]:g} | {r[2]} | {r[3]:.3f} | {opt} | {gap} | {r[6]} |')
        if r[5] is not None and r[5] < -1e-6: bug = True
    enum = [r for r in rows if r[5] is not None]
    lines += ['', f'Batches enumerated: {len(enum)} of {len(rows)}; production equals optimum in {sum(abs(r[5]) <= 1e-6 for r in enum)}; '
              f'largest gap {max((r[5] for r in enum), default=0):.3f} s.']
    text = '\n'.join(lines) + '\n'
    print(text)
    if a.md: Path(a.md).write_text(text)
    sys.exit(2 if bug else 0)


if __name__ == '__main__':
    main()
