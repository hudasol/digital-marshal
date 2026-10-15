import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { EXPERIMENTS, paired, runOne, summarise, type ExperimentDef, type RunMetrics } from '../src/core/experiments';
import results from '../src/data/experiments.json';

const net = buildNetwork();

/** The benchmark's blackout, shortened so the test stays quick. */
const SHORT_BLACKOUT: ExperimentDef = { ...EXPERIMENTS.find((e) => e.id === 'blackout')!, horizon: 240 };

describe('benchmark runner', () => {
  it('is deterministic: the same job gives identical metrics', () => {
    const v = SHORT_BLACKOUT.variants.find((x) => x.id === 'C')!;
    expect(runOne(net, SHORT_BLACKOUT, v, 7)).toEqual(runOne(net, SHORT_BLACKOUT, v, 7));
  });

  it('holds the safety invariants through the onset of a blackout under every policy', () => {
    for (const seed of [20271001, 20271002, 20271003]) {
      for (const v of SHORT_BLACKOUT.variants.filter((x) => !x.ablation)) {
        const m = runOne(net, SHORT_BLACKOUT, v, seed);
        expect(m.unauthorisedCrossings, `${v.id} ${seed}`).toBe(0);
        expect(m.boxConflicts, `${v.id} ${seed}`).toBe(0);
        expect(m.restrictedEntries, `${v.id} ${seed}`).toBe(0);
      }
    }
  });

  it('summarises with a t interval and pairs differences by seed', () => {
    const s = summarise([1, 2, 3, 4])!;
    expect(s.mean).toBe(2.5);
    expect(s.sd).toBeCloseTo(1.290994, 5);
    expect(s.ci).toBeCloseTo((3.182 * 1.290994) / 2, 4);
    const run = (variant: string, seed: number, x: number) => ({ experiment: 'blackout', variant, seed, systemTimeVehH: x }) as unknown as RunMetrics;
    const runs = [run('A', 1, 10), run('A', 2, 12), run('C', 1, 9), run('C', 2, 12.5)];
    const d = paired(runs, 'C', 'A', 'systemTimeVehH')!;
    expect(d.diff.mean).toBeCloseTo(-0.25, 9);
    expect([d.lower, d.higher, d.equal]).toEqual([1, 1, 0]);
  });

  it('ships committed results that cover every experiment, variant and seed, with no safety violation', () => {
    const doc = results as unknown as { seeds: number[]; experiments: Array<{ id: string; variants: Array<{ id: string }>; runs: RunMetrics[] }> };
    expect(doc.experiments.map((e) => e.id).sort()).toEqual(EXPERIMENTS.map((e) => e.id).sort());
    for (const e of doc.experiments) {
      const def = EXPERIMENTS.find((x) => x.id === e.id)!;
      expect(e.variants.map((v) => v.id)).toEqual(def.variants.map((v) => v.id));
      expect(e.runs).toHaveLength(def.variants.length * doc.seeds.length);
      for (const r of e.runs) {
        expect(r.unauthorisedCrossings, `${e.id} ${r.variant} ${r.seed}`).toBe(0);
        expect(r.boxConflicts, `${e.id} ${r.variant} ${r.seed}`).toBe(0);
        expect(r.restrictedEntries, `${e.id} ${r.variant} ${r.seed}`).toBe(0);
      }
    }
  });
});
