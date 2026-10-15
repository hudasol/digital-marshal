import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { connectorPose, lanePose } from '../src/core/network/geometry';

const net = buildNetwork();

describe('district network', () => {
  it('has the expected size', () => {
    expect(net.junctionIds).toHaveLength(12);
    expect(net.gatewayIds).toHaveLength(14);
    expect(net.linkIds).toHaveLength(62);
    expect(Object.keys(net.gatewayIn)).toHaveLength(14);
    expect(Object.keys(net.gatewayOut)).toHaveLength(14);
  });

  it('is deterministic, including the map version', () => {
    const again = buildNetwork();
    expect(again.version).toBe(net.version);
    expect(JSON.stringify(again.connectors)).toBe(JSON.stringify(net.connectors));
  });

  it('gives every lane that ends at a junction at least one way out, and each turn its lanes', () => {
    for (const id of net.linkIds) {
      const l = net.links[id];
      if (!l.endsAtJunction) continue;
      for (let lane = 0; lane < l.lanes; lane++) {
        expect(net.fromLane[`${id}#${lane}`]?.length ?? 0, `${id}#${lane}`).toBeGreaterThan(0);
      }
      const turns = new Set(net.connectorIds.filter((c) => net.connectors[c].inLink === id).map((c) => net.connectors[c].turn));
      expect([...turns].sort()).toEqual(['L', 'R', 'S']);
    }
  });

  it('connectors join the stop line of the in-lane to the start of the out-lane', () => {
    for (const cid of net.connectorIds) {
      const c = net.connectors[cid];
      const a = lanePose(net.links[c.inLink], c.inLane, net.links[c.inLink].length);
      const b = lanePose(net.links[c.outLink], c.outLane, 0);
      const s = connectorPose(c, 0);
      const e = connectorPose(c, c.length);
      expect(Math.hypot(a.x - s.x, a.y - s.y)).toBeLessThan(1e-6);
      expect(Math.hypot(b.x - e.x, b.y - e.y)).toBeLessThan(1e-6);
      expect(c.speedLimit).toBeGreaterThan(3);
    }
  });

  it('never lets movements of one approach conflict with each other (split phasing is conflict free)', () => {
    for (const cid of net.connectorIds) {
      const c = net.connectors[cid];
      for (const other of c.conflicts) {
        expect(net.connectors[other].approach, `${cid} vs ${other}`).not.toBe(c.approach);
        expect(net.connectors[other].conflicts).toContain(cid);
      }
    }
  });

  it('marks crossing movements of different approaches as conflicting', () => {
    const j = net.junctions.J7;
    const nsStraight = j.connectors.find((id) => net.connectors[id].approach === 'S' && net.connectors[id].turn === 'S')!;
    const ewStraight = j.connectors.find((id) => net.connectors[id].approach === 'W' && net.connectors[id].turn === 'S')!;
    expect(net.connectors[nsStraight].conflicts).toContain(ewStraight);
  });

  it('builds a signal plan whose phases cover every approach once', () => {
    for (const jid of net.junctionIds) {
      const p = net.junctions[jid].plan;
      expect(p.phases).toHaveLength(4);
      expect(new Set(p.phases.map((x) => x.approach)).size).toBe(4);
      expect(p.cycle).toBe(p.phases.reduce((a, x) => a + x.green + p.amber + p.allRed, 0));
      expect(p.offset).toBeGreaterThanOrEqual(0);
      expect(p.offset).toBeLessThan(p.cycle);
    }
  });

  it('keeps lanes on the right-hand side of travel', () => {
    const eb = net.links['J6>J7'];
    expect(eb.dir.x).toBeCloseTo(1);
    const p = lanePose(eb, 0, 10);
    expect(p.y).toBeLessThan(0); // eastbound lanes sit south of the boulevard centre line
    const wb = net.links['J7>J6'];
    expect(lanePose(wb, 0, 10).y).toBeGreaterThan(0);
  });
});
