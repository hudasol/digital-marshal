import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { SimSession } from '../src/core/sim/session';

const net = buildNetwork();

function digest(s: SimSession): string {
  const st = s.engine.state;
  return JSON.stringify([
    st.t.toFixed(3),
    st.order.map((id) => {
      const v = st.vehicles[id];
      return [v.id, v.seg.id, v.seg.lane, v.s.toFixed(5), v.v.toFixed(5)];
    }),
  ]);
}

function session(): SimSession {
  const s = new SimSession(net, { seed: 21, warmup: 60 });
  s.addApplier((engine, iv) => {
    if (iv.kind === 'density') engine.state.densityScale = Number(iv.params.scale);
  });
  return s;
}

describe('simulation session timeline', () => {
  it('scrubbing back and forth reproduces the straight-through run exactly', () => {
    const a = session();
    a.advanceTo(45);
    const at45 = digest(a);
    a.advanceTo(80);
    const at80 = digest(a);

    a.seek(45);
    expect(digest(a)).toBe(at45);
    a.seek(12.3);
    a.seek(80);
    expect(digest(a)).toBe(at80);
  });

  it('replays recorded interventions at the same simulated time', () => {
    const a = session();
    a.advanceTo(30);
    a.intervene('density', { scale: 1.3 });
    a.advanceTo(70);
    const withChange = digest(a);

    a.seek(10);
    a.seek(70);
    expect(digest(a)).toBe(withChange);

    // and the intervention made a difference
    const b = session();
    b.advanceTo(70);
    expect(digest(b)).not.toBe(withChange);
  });

  it('discards history after a new intervention and keeps earlier snapshots', () => {
    const a = session();
    a.advanceTo(60);
    a.seek(25);
    a.intervene('density', { scale: 0.5 });
    expect(a.horizon).toBeLessThanOrEqual(25.0001);
    a.advanceTo(40);
    a.seek(5);
    a.seek(40);
    const d1 = digest(a);
    const b = session();
    b.advanceTo(25);
    b.intervene('density', { scale: 0.5 });
    b.advanceTo(40);
    expect(digest(b)).toBe(d1);
  });
});
