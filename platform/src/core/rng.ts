/* Deterministic pseudo random numbers for the simulation core.
   Integer-only arithmetic (no Math.random, no transcendental functions), so a run is reproducible
   from its seed on any JavaScript engine. Each subsystem gets its own stream so that, for example,
   changing radio loss does not change which vehicles are generated. */

/** Mix a 32-bit integer (splitmix-style finaliser). */
export function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Hash a string to 32 bits (FNV-1a then mixed). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return hash32(h);
}

/** Serializable generator state: a single 32-bit integer (mulberry32). */
export interface RngState {
  s: number;
}

export function makeRng(seed: number, stream: string): RngState {
  return { s: hash32((seed >>> 0) ^ hashString(stream)) };
}

/** Uniform in [0, 1). Advances the state in place. */
export function rand(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(r: RngState, n: number): number {
  return Math.floor(rand(r) * n);
}

export function randRange(r: RngState, a: number, b: number): number {
  return a + (b - a) * rand(r);
}

/** Weighted choice by index; weights need not sum to one. */
export function pickWeighted(r: RngState, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let x = rand(r) * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** Approximately normal (Irwin-Hall with 6 terms): mean 0, sd 1, bounded to +/-4.24. No logs or trig. */
export function randNormal(r: RngState): number {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rand(r);
  return (s - 3) * Math.SQRT2;
}
