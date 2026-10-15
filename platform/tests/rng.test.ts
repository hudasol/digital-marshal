import { describe, expect, it } from 'vitest';
import { makeRng, rand, randNormal, pickWeighted, hashString } from '../src/core/rng';

describe('deterministic rng', () => {
  it('repeats exactly for the same seed and stream', () => {
    const a = makeRng(42, 'demand');
    const b = makeRng(42, 'demand');
    const xs = Array.from({ length: 1000 }, () => rand(a));
    const ys = Array.from({ length: 1000 }, () => rand(b));
    expect(xs).toEqual(ys);
  });

  it('separates streams and seeds', () => {
    const a = makeRng(42, 'demand');
    const b = makeRng(42, 'radio');
    const c = makeRng(43, 'demand');
    expect(rand(a)).not.toEqual(rand(b));
    expect(rand(makeRng(42, 'demand'))).not.toEqual(rand(c));
  });

  it('is uniform enough and stays in [0, 1)', () => {
    const r = makeRng(7, 'u');
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) {
      const x = rand(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      bins[Math.floor(x * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 10000)).toBeLessThan(500);
  });

  it('normal approximation has mean ~0 and sd ~1', () => {
    const r = makeRng(9, 'n');
    let s = 0;
    let s2 = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const x = randNormal(r);
      s += x;
      s2 += x * x;
    }
    const mean = s / n;
    const sd = Math.sqrt(s2 / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });

  it('weighted choice respects weights', () => {
    const r = makeRng(3, 'w');
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[pickWeighted(r, [1, 2, 7])]++;
    expect(counts[2] / 30000).toBeGreaterThan(0.67);
    expect(counts[0] / 30000).toBeLessThan(0.13);
  });

  it('string hash is stable', () => {
    expect(hashString('digital-marshal')).toBe(hashString('digital-marshal'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
