import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { WORKS_STAGES } from '../src/core/network/district';
import { createSession, dmFor } from '../src/core/scenarios';
import { INJECTIONS } from '../src/core/dm/inject';
import type { Policy } from '../src/core/dm/types';
import type { SimSession } from '../src/core/sim/session';

const net = buildNetwork();
const LANE = WORKS_STAGES.lane;
const FULL = WORKS_STAGES.full;

/** Lane closure at 20 s, escalation to a full closure at 200 s, works finished at 420 s. */
function worksRun(policy: Policy, until: number, seed = 41): { s: SimSession; maxStop: number } {
  const s = createSession(net, { seed, warmup: 150, dm: { policy } });
  s.intervene('works', { ...LANE, lanes: [...LANE.lanes] }, 20);
  s.intervene('works', { ...FULL, lanes: [...FULL.lanes] }, 200);
  s.intervene('works-lift', {}, 420);
  let maxStop = 0;
  while (s.t < until) {
    s.stepOnce();
    const st = s.engine.state;
    for (const id of st.order) maxStop = Math.max(maxStop, st.vehicles[id].stopT);
  }
  return { s, maxStop };
}

describe('roadworks', () => {
  it('publishes a contractor plan only after the node validates it, ahead of the cones', () => {
    const s = createSession(net, { seed: 43, warmup: 120, dm: { policy: 'B' } });
    s.intervene('works', { ...LANE, lanes: [...LANE.lanes] }, 20);
    s.advanceTo(20 + LANE.lead - 1);
    const dm = dmFor(s.engine).s;
    const msgs = Object.values(dm.messages);
    const sub = msgs.find((m) => m.origin === 'submitted');
    expect(sub?.header.issuer).toBe('WORKS-C07');
    expect(dm.verdicts[sub!.header.msgId].status).toBe('accepted');
    const pub = msgs.find((m) => m.origin === 'published' && m.body.type === 'ROAD_RESTRICTION');
    expect(pub?.header.issuer).toBe('DM-TMC');
    expect(pub?.header.validFrom).toBeCloseTo(20 + LANE.lead, 5);
    // announced, accepted by connected vehicles, but no cones yet
    expect(s.engine.state.road.closures).toHaveLength(0);
    expect(Object.values(dm.knowledge).filter((k) => k.incidents[pub!.header.incidentId]?.active).length).toBeGreaterThan(10);
    s.advanceTo(20 + LANE.lead + 0.5);
    expect(s.engine.state.road.closures.map((c) => c.link)).toEqual([LANE.link]);
  });

  it('refuses a contractor submission outside its permit and publishes nothing', () => {
    const s = createSession(net, { seed: 43, warmup: 120, dm: { policy: 'C' } });
    s.intervene('works', { ...LANE, link: 'J6>J7', lanes: [2] }, 20);
    s.advanceTo(80);
    const dm = dmFor(s.engine).s;
    expect(Object.values(dm.incidents)).toHaveLength(0);
    expect(dm.stats.published).toBe(0);
    expect(s.engine.state.road.closures).toHaveLength(0);
    const ev = s.engine.state.events.find((e) => e.kind === 'works-rejected');
    expect(ev?.p?.code).toBe('OUT_OF_SCOPE');
  });

  it('never lets a vehicle into a closed lane or segment, and traffic keeps moving, under every policy', () => {
    for (const policy of ['A', 'B', 'C'] as Policy[]) {
      const { s, maxStop } = worksRun(policy, 480);
      const st = s.engine.state;
      expect(st.counters.restrictedEntries, policy).toBe(0);
      expect(st.road.closures, policy).toHaveLength(0); // lifted at 420 s
      expect(st.counters.exits, policy).toBeGreaterThan(250);
      expect(maxStop, policy).toBeLessThan(200);
      const kinds = st.events.map((e) => e.kind);
      expect(kinds.filter((k) => k === 'works-active'), policy).toHaveLength(2);
      expect(kinds, policy).toContain('works-lifted');
    }
  });

  it('shared, validated information means fewer vehicles learn of a closure only when they see it', () => {
    const a = worksRun('A', 420).s.engine.state.counters.lateDiscoveries;
    const b = worksRun('B', 420).s.engine.state.counters.lateDiscoveries;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(a);
  });

  it('rejects every crafted message by the expected rule, at the node and at each receiving vehicle', () => {
    const s = createSession(net, { seed: 77, warmup: 120, dm: { policy: 'B' } });
    s.intervene('works', { ...LANE, lanes: [...LANE.lanes] }, 20);
    INJECTIONS.forEach((x, i) => s.intervene('inject', { test: x.id }, 80 + i * 2));
    s.advanceTo(80 + INJECTIONS.length * 2 + 10);
    const dm = dmFor(s.engine).s;
    const injected = Object.values(dm.messages).filter((m) => m.origin === 'injected');
    expect(injected.map((m) => m.test).sort()).toEqual(INJECTIONS.map((x) => x.id).sort());
    for (const m of injected) {
      const spec = INJECTIONS.find((x) => x.id === m.test)!;
      expect(dm.verdicts[m.header.msgId].code, spec.id).toBe(spec.expect);
      const rx = dm.rxTally[m.header.msgId];
      expect(rx, spec.id).toBeTruthy();
      expect(rx.accepted, spec.id).toBe(0);
      expect(Object.keys(rx.codes), spec.id).toEqual([spec.expect]);
    }
    // nothing injected changed what vehicles believe about the works
    const works = Object.values(dm.incidents).find((i) => i.type === 'roadworks')!;
    for (const k of Object.values(dm.knowledge)) {
      const e = k.incidents[works.id];
      if (e) expect(dm.messages[e.msgId].header.issuer).toBe('DM-TMC');
    }
  });

  it('answers a conflicting copy of the live version by re-issuing its state as a new version', () => {
    const s = createSession(net, { seed: 77, warmup: 120, dm: { policy: 'C' } });
    s.intervene('works', { ...LANE, lanes: [...LANE.lanes] }, 20);
    s.intervene('inject', { test: 'conflict' }, 70);
    s.advanceTo(90);
    const dm = dmFor(s.engine).s;
    const works = Object.values(dm.incidents).find((i) => i.type === 'roadworks')!;
    expect(works.version).toBe(2);
    expect(s.engine.state.events.some((e) => e.kind === 'conflict-reasserted')).toBe(true);
    const holders = Object.values(dm.knowledge).filter((k) => k.incidents[works.id]);
    expect(holders.length).toBeGreaterThan(10);
    for (const k of holders) {
      expect(k.incidents[works.id].version).toBe(2);
      expect(k.incidents[works.id].flagged).toBe(false);
    }
  });

  it('replays the roadworks run exactly', () => {
    const digest = (s: SimSession) =>
      JSON.stringify([
        s.engine.state.order.map((id) => [id, s.engine.state.vehicles[id].s.toFixed(4)]),
        s.engine.state.counters,
        Object.keys(dmFor(s.engine).s.messages),
      ]);
    expect(digest(worksRun('C', 260, 47).s)).toBe(digest(worksRun('C', 260, 47).s));
  });
});
