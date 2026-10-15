import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { Engine } from '../src/core/sim/engine';

const net = buildNetwork();

function digest(e: Engine): string {
  const st = e.state;
  return JSON.stringify(
    st.order.map((id) => {
      const v = st.vehicles[id];
      return [v.id, v.seg.id, v.seg.lane, v.s.toFixed(6), v.v.toFixed(6), v.route.length];
    }),
  );
}

function run(e: Engine, seconds: number) {
  const n = Math.round(seconds / 0.1);
  for (let i = 0; i < n; i++) e.step();
}

describe('traffic engine', () => {
  it('is deterministic: same seed, same state', () => {
    const a = new Engine(net, { seed: 7, warmup: 60 });
    const b = new Engine(net, { seed: 7, warmup: 60 });
    a.warmUp();
    b.warmUp();
    run(a, 90);
    run(b, 90);
    expect(digest(a)).toBe(digest(b));
    expect(a.state.order.length).toBeGreaterThan(40);
  });

  it('replays exactly from a snapshot (the basis of timeline scrubbing)', () => {
    const e = new Engine(net, { seed: 11, warmup: 60 });
    e.warmUp();
    run(e, 30);
    const snap = structuredClone(e.state);
    run(e, 40);
    const first = digest(e);
    e.state = structuredClone(snap);
    run(e, 40);
    expect(digest(e)).toBe(first);
  });

  it('different seeds give different traffic', () => {
    const a = new Engine(net, { seed: 1, warmup: 60 });
    const b = new Engine(net, { seed: 2, warmup: 60 });
    a.warmUp();
    b.warmUp();
    expect(digest(a)).not.toBe(digest(b));
  });

  it('keeps vehicles apart and never enters a junction box against a conflicting movement', () => {
    const e = new Engine(net, { seed: 3, warmup: 120 });
    e.warmUp();
    let minGap = Infinity;
    for (let i = 0; i < 1800; i++) {
      e.step();
      if (i % 5 !== 0) continue;
      for (const key of Object.keys(e.state.lanes)) {
        const list = e.state.lanes[key];
        for (let k = 1; k < list.length; k++) {
          const back = e.state.vehicles[list[k - 1]];
          const front = e.state.vehicles[list[k]];
          minGap = Math.min(minGap, front.s - front.len - back.s);
        }
      }
      // two conflicting connectors are never occupied at the same time
      for (const jid of net.junctionIds) {
        for (const cid of net.junctions[jid].connectors) {
          if (!e.state.conns[cid].length) continue;
          for (const other of net.connectors[cid].conflicts) expect(e.state.conns[other].length, `${cid} vs ${other}`).toBe(0);
        }
      }
    }
    expect(minGap).toBeGreaterThan(-0.05);
    expect(e.state.counters.boxViolations).toBe(0);
  });

  it('serves demand: trips complete and the network does not lock up', () => {
    const e = new Engine(net, { seed: 5 });
    e.warmUp();
    run(e, 300);
    const st = e.state;
    expect(st.counters.exits).toBeGreaterThan(120);
    const pending = Object.values(st.pending).reduce((a, q) => a + q.length, 0);
    expect(pending).toBeLessThan(25);
    const moving = st.order.filter((id) => st.vehicles[id].v > 1).length;
    expect(moving / st.order.length).toBeGreaterThan(0.3);
    // every trip has a sane record
    for (const t of st.trips) {
      expect(t.t1).toBeGreaterThan(t.t0);
      expect(t.ffT).toBeGreaterThan(10);
    }
  });

  it('stops for red and records the reason', () => {
    const e = new Engine(net, { seed: 9 });
    e.warmUp();
    run(e, 60);
    const st = e.state;
    const waiting = st.order.map((id) => st.vehicles[id]).filter((v) => v.bind.kind === 'signal' && v.v < 0.3);
    expect(waiting.length).toBeGreaterThan(3);
    for (const v of waiting) {
      expect(net.junctions[v.bind.ref]).toBeDefined();
      expect(v.bind.extra).toBeGreaterThan(0); // seconds to green are known
    }
  });
});
