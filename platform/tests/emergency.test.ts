import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { createSession, dmFor } from '../src/core/scenarios';
import { aspectFor } from '../src/core/sim/signals';
import type { Policy } from '../src/core/dm/types';

const net = buildNetwork();
const REASONS = new Set(['single_lane_no_shoulder', 'held_at_red_signal', 'adjacent_lane_occupied', 'stopped_minimal_risk']);

function evRun(policy: Policy, seed = 61, until = 360) {
  const s = createSession(net, { seed, warmup: 150, dm: { policy } });
  s.intervene('dispatch', { from: 'hospital', to: 'scene' }, 20);
  const preemptAspects: string[] = [];
  while (s.t < until) {
    s.stepOnce();
    // while a junction is pre-empted, only the emergency approach may show green
    const st = s.engine.state;
    for (const [j, p] of Object.entries(st.road.preempt)) {
      const jd = net.junctions[j];
      const sig = s.engine.signal(j);
      for (const cid of jd.connectors) {
        const c = net.connectors[cid];
        const a = aspectFor(jd, sig, c.inLink, c.turn);
        if (a === 'G' && c.inLink !== p.inLink) preemptAspects.push(`${j}:${cid}`);
      }
    }
  }
  return { s, rec: dmFor(s.engine).s.ev!, preemptAspects };
}

describe('emergency vehicle corridor', () => {
  it('dispatches an ambulance that reaches the call under every policy', () => {
    for (const policy of ['A', 'B', 'C'] as Policy[]) {
      const { rec } = evRun(policy);
      expect(rec, policy).toBeTruthy();
      expect(rec.arrivedAt, policy).not.toBeNull();
      expect(rec.arrivedAt! - rec.dispatchedAt).toBeGreaterThan(rec.ffT * 0.95);
    }
  });

  it('records every yield decision with a defined outcome and never a forced move', () => {
    const { s, rec } = evRun('B');
    expect(rec.yields.ok + rec.yields.infeasible).toBeGreaterThan(0);
    for (const reason of Object.keys(rec.yields.byReason)) expect(REASONS.has(reason), reason).toBe(true);
    // the vehicles that yielded logged the lane they moved to; infeasible ones logged why
    const logs = Object.values(s.engine.state.vehicles).flatMap((v) => v.log.filter((l) => l.code === 'YIELD' || l.code === 'YIELD_INFEASIBLE'));
    for (const l of logs) {
      if (l.code === 'YIELD_INFEASIBLE') expect(REASONS.has(String(l.p.reason))).toBe(true);
      else expect(Number(l.p.to)).toBeGreaterThan(0);
    }
  });

  it('requests signal priority only under policy C, and pre-emption never gives a conflicting movement green', () => {
    const a = evRun('A');
    const b = evRun('B');
    const c = evRun('C');
    expect(a.rec.preempts).toBe(0);
    expect(b.rec.preempts).toBe(0);
    expect(c.rec.preempts).toBeGreaterThan(0);
    expect(c.preemptAspects).toEqual([]);
    // pre-emption is released after the ambulance arrives
    expect(Object.keys(c.s.engine.state.road.preempt)).toHaveLength(0);
  });

  it('publishes corridor messages under B and C but not A', () => {
    expect(dmFor(evRun('A', 62, 120).s.engine).s.stats.delivered).toBe(0);
    const b = dmFor(evRun('B', 62, 120).s.engine).s;
    const msgs = Object.values(b.messages).filter((m) => m.body.type === 'EMERGENCY_CORRIDOR');
    expect(msgs.length).toBeGreaterThan(1); // updated as the route shortens
    expect(new Set(msgs.map((m) => m.header.version)).size).toBe(msgs.length);
  });
});
