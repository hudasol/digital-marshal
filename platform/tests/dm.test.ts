import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { createSession, dmFor } from '../src/core/scenarios';
import type { Policy } from '../src/core/dm/types';
import type { SimSession } from '../src/core/sim/session';

const net = buildNetwork();
const CLUSTER = ['J6', 'J7', 'J10', 'J11'];

function blackoutRun(policy: Policy, until = 300, seed = 31): SimSession {
  const s = createSession(net, { seed, warmup: 120, dm: { policy } });
  s.intervene('blackout', { junctions: CLUSTER }, 30);
  s.advanceTo(until);
  return s;
}

describe('Digital Marshal blackout coordination', () => {
  it('policy A detects the outage but shares nothing with vehicles', () => {
    const s = blackoutRun('A', 200);
    const dm = dmFor(s.engine).s;
    expect(Object.keys(dm.incidents)).toHaveLength(1);
    expect(dm.stats.delivered).toBe(0);
    for (const k of Object.values(dm.knowledge)) expect(Object.keys(k.incidents)).toHaveLength(0);
  });

  it('policy B delivers a signed outage message that connected vehicles validate and accept', () => {
    const s = blackoutRun('B', 120);
    const dm = dmFor(s.engine).s;
    const inc = Object.values(dm.incidents)[0];
    expect(inc.createdAt).toBeCloseTo(30 + dm.params.detectionDelay, 5);
    expect(dm.stats.delivered).toBeGreaterThan(20);
    expect(dm.stats.rejected).toBe(0);
    const accepted = Object.values(dm.knowledge).filter((k) => k.incidents[inc.id]?.active).length;
    expect(accepted).toBeGreaterThan(20);
    // unconnected vehicles never hold knowledge
    for (const id of Object.keys(dm.knowledge)) {
      const v = s.engine.state.vehicles[id];
      if (v) expect(v.connected).toBe(true);
    }
    expect(dm.stats.latencyN).toBeGreaterThan(0);
    expect(dm.stats.latencySum / dm.stats.latencyN).toBeLessThan(1.2);
  });

  it('policy C resolves grouped requests with junction-scoped authorisations', () => {
    const s = blackoutRun('C', 330);
    const dm = dmFor(s.engine).s;
    const tasks = Object.values(dm.tasks);
    expect(tasks.some((t) => t.kind === 'group')).toBe(true);
    expect(Object.keys(dm.junctionAuth).length).toBeGreaterThan(0);
    const ex = Object.values(dm.exceptions);
    expect(ex.filter((e) => e.status === 'resolved' || e.status === 'auto_resolved').length).toBeGreaterThan(0);
  });

  it('never lets an AV cross a dark junction outside its domain without an authorisation', () => {
    for (const policy of ['A', 'B', 'C'] as Policy[]) {
      const s = createSession(net, { seed: 41, warmup: 120, dm: { policy } });
      s.intervene('blackout', { junctions: CLUSTER }, 30);
      const dm = () => dmFor(s.engine);
      let checked = 0;
      while (s.t < 260) {
        s.stepOnce();
        const st = s.engine.state;
        for (const id of st.order) {
          const v = st.vehicles[id];
          if (!v.av || v.seg.k !== 'C' || v.s > 2) continue; // just entered a junction box
          const j = net.connectors[v.seg.id].junction;
          if (!st.road.dark.includes(j) || net.junctions[j].maxApproachLanes <= s.engine.cfg.oddMaxLanes) continue;
          checked++;
          expect(dm().authorized(v, j), `${policy} ${v.tag} at ${j}`).toBe(true);
        }
      }
      if (policy !== 'A') expect(checked).toBeGreaterThan(0);
    }
  });

  it('replays the coordinated run exactly', () => {
    const a = blackoutRun('C', 200, 51);
    const b = blackoutRun('C', 200, 51);
    const digest = (s: SimSession) =>
      JSON.stringify([
        s.engine.state.order.map((id) => [id, s.engine.state.vehicles[id].s.toFixed(4)]),
        Object.keys(dmFor(s.engine).s.messages),
        Object.values(dmFor(s.engine).s.exceptions).map((e) => [e.id, e.status]),
      ]);
    expect(digest(a)).toBe(digest(b));
  });
});
