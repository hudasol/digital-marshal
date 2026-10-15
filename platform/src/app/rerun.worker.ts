import { buildNetwork } from '../core/network/build';
import { EXPERIMENTS, runOne } from '../core/experiments';

/* Re-runs one seed of one benchmark experiment in a background thread, variant by variant, so the
   Evidence view can compare the results with the committed numbers. */

const net = buildNetwork();
const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent<{ experiment: string; seed: number; variants: string[] }>) => void) | null;
};

ctx.onmessage = (e) => {
  try {
    const exp = EXPERIMENTS.find((x) => x.id === e.data.experiment);
    if (!exp) throw new Error(`unknown experiment ${e.data.experiment}`);
    const ids = e.data.variants;
    for (let i = 0; i < ids.length; i++) {
      const v = exp.variants.find((x) => x.id === ids[i]);
      if (!v) continue;
      const t0 = performance.now();
      const metrics = runOne(net, exp, v, e.data.seed);
      ctx.postMessage({ variant: v.id, metrics, ms: performance.now() - t0, next: ids[i + 1] ?? null });
    }
    ctx.postMessage({ done: true });
  } catch (err) {
    ctx.postMessage({ error: String(err) });
  }
};
