import { hashString } from '../rng';
import { buildLut, bezierPoint, minRadius, type Bezier } from './geometry';
import {
  ALL_RED,
  AMBER,
  CROSSWALK,
  GREEN_BY_CLASS,
  LANE_W,
  NODES,
  PLACES,
  ROADS,
  X_EDGE,
  Y_EDGE,
} from './district';
import type {
  ConnectorDef,
  JunctionDef,
  LinkDef,
  Network,
  NodeDef,
  PhaseDef,
  RoadDef,
  Side,
  Turn,
  Vec2,
} from './types';

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
const LAT_ACCEL = 2.4; // comfortable lateral acceleration used to derive turning speeds, m/s^2

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
function mul(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}
function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}
function norm(a: Vec2): Vec2 {
  const l = len(a);
  return { x: a.x / l, y: a.y / l };
}

/** Side of a junction that a unit direction points toward. */
function sideOf(d: Vec2): Side {
  if (Math.abs(d.x) >= Math.abs(d.y)) return d.x > 0 ? 'E' : 'W';
  return d.y > 0 ? 'N' : 'S';
}

function opposite(s: Side): Side {
  return s === 'N' ? 'S' : s === 'S' ? 'N' : s === 'E' ? 'W' : 'E';
}

export function halfWidth(r: RoadDef): number {
  return r.median / 2 + r.lanesPerDir * LANE_W;
}

/** Turns permitted from each lane of an approach with n lanes (driving on the right). */
export function laneTurnsFor(n: number): Turn[][] {
  if (n === 1) return [['L', 'S', 'R']];
  if (n === 2) return [['L', 'S'], ['S', 'R']];
  const out: Turn[][] = [['L']];
  for (let i = 1; i < n - 1; i++) out.push(['S']);
  out.push(['S', 'R']);
  return out;
}

function classifyTurn(dIn: Vec2, dOut: Vec2): Turn {
  const dot = dIn.x * dOut.x + dIn.y * dOut.y;
  if (dot > 0.7) return 'S';
  const cross = dIn.x * dOut.y - dIn.y * dOut.x;
  return cross > 0 ? 'L' : 'R';
}

/** Lines p + a*d and q - b*e meet at a point; return distances a and b (both positive for turns). */
function cornerDistances(p: Vec2, d: Vec2, q: Vec2, e: Vec2): { a: number; b: number } {
  // p + a d = q - b e  ->  a d + b e = q - p
  const r = sub(q, p);
  const det = d.x * e.y - d.y * e.x;
  if (Math.abs(det) < 1e-9) return { a: len(r) / 3, b: len(r) / 3 };
  const a = (r.x * e.y - r.y * e.x) / det;
  const b = (d.x * r.y - d.y * r.x) / det;
  return { a: Math.max(1, a), b: Math.max(1, b) };
}

function minDistance(a: Bezier, b: Bezier): number {
  const N = 20;
  const pa: Vec2[] = [];
  const pb: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    pa.push(bezierPoint(a, i / N));
    pb.push(bezierPoint(b, i / N));
  }
  let best = Infinity;
  for (const x of pa) {
    for (const y of pb) {
      const dx = x.x - y.x;
      const dy = x.y - y.y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function buildNetwork(): Network {
  const nodes: Record<string, NodeDef> = {};
  for (const n of NODES) nodes[n.id] = { ...n };
  const roads: Record<string, RoadDef> = {};
  for (const r of ROADS) roads[r.id] = r;

  // which roads cross at each junction: the N-S road and the E-W road
  const nsRoadAt: Record<string, RoadDef> = {};
  const ewRoadAt: Record<string, RoadDef> = {};
  for (const r of ROADS) {
    const a = nodes[r.nodes[0]];
    const b = nodes[r.nodes[r.nodes.length - 1]];
    const isNS = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    for (const id of r.nodes) {
      if (nodes[id].kind !== 'junction') continue;
      if (isNS) nsRoadAt[id] = r;
      else ewRoadAt[id] = r;
    }
  }

  /** Distance from a junction centre to the stop line / link start, for a link along direction d. */
  const setback = (junction: string, d: Vec2): number => {
    const crossing = Math.abs(d.x) > Math.abs(d.y) ? nsRoadAt[junction] : ewRoadAt[junction];
    return halfWidth(crossing) + CROSSWALK;
  };

  // ---------------------------------------------------------------- links
  const links: Record<string, LinkDef> = {};
  const linkIds: string[] = [];
  for (const r of ROADS) {
    const hw = halfWidth(r);
    for (let i = 0; i + 1 < r.nodes.length; i++) {
      for (const [fromId, toId] of [
        [r.nodes[i], r.nodes[i + 1]],
        [r.nodes[i + 1], r.nodes[i]],
      ]) {
        const a = nodes[fromId];
        const b = nodes[toId];
        const dir = norm(sub(b, a));
        const right = { x: dir.y, y: -dir.x };
        const startOff = a.kind === 'junction' ? setback(fromId, dir) : 0;
        const endOff = b.kind === 'junction' ? setback(toId, dir) : 0;
        const start = add(a, mul(dir, startOff));
        const end = sub(b, mul(dir, endOff));
        const id = `${fromId}>${toId}`;
        const laneOffsets: number[] = [];
        for (let k = 0; k < r.lanesPerDir; k++) laneOffsets.push(r.median / 2 + (k + 0.5) * LANE_W);
        links[id] = {
          id,
          from: fromId,
          to: toId,
          road: r.id,
          roadName: r.name,
          cls: r.cls,
          lanes: r.lanesPerDir,
          speed: r.speedKmh / 3.6,
          dir,
          right,
          start,
          end,
          length: len(sub(end, start)),
          laneOffsets,
          halfWidth: hw,
          reverse: `${toId}>${fromId}`,
          endsAtJunction: b.kind === 'junction',
          startsAtGateway: a.kind === 'gateway',
          laneTurns: b.kind === 'junction' ? laneTurnsFor(r.lanesPerDir) : laneTurnsFor(r.lanesPerDir).map(() => []),
          approachSide: b.kind === 'junction' ? opposite(sideOf(dir)) : null,
        };
        linkIds.push(id);
      }
    }
  }

  // ---------------------------------------------------------------- junctions and connectors
  const junctions: Record<string, JunctionDef> = {};
  const connectors: Record<string, ConnectorDef> = {};
  const connectorIds: string[] = [];
  const fromLane: Record<string, string[]> = {};
  const junctionIds = NODES.filter((n) => n.kind === 'junction').map((n) => n.id);

  for (const jid of junctionIds) {
    const j = nodes[jid];
    const ns = nsRoadAt[jid];
    const ew = ewRoadAt[jid];
    const inLinks: Partial<Record<Side, string>> = {};
    const outLinks: Partial<Record<Side, string>> = {};
    for (const id of linkIds) {
      const l = links[id];
      if (l.to === jid) inLinks[l.approachSide!] = id;
      if (l.from === jid) outLinks[sideOf(l.dir)] = id;
    }
    const conns: string[] = [];
    for (const side of SIDES) {
      const inId = inLinks[side];
      if (!inId) continue;
      const li = links[inId];
      for (const oside of SIDES) {
        const outId = outLinks[oside];
        if (!outId || outId === li.reverse) continue;
        const lo = links[outId];
        const turn = classifyTurn(li.dir, lo.dir);
        // lane pairs for this movement
        const pairs: Array<[number, number]> = [];
        for (let lane = 0; lane < li.lanes; lane++) {
          if (!li.laneTurns[lane].includes(turn)) continue;
          let outLane: number;
          if (turn === 'L') outLane = 0;
          else if (turn === 'R') outLane = lo.lanes - 1;
          else outLane = Math.min(lane, lo.lanes - 1);
          pairs.push([lane, outLane]);
        }
        for (const [lane, outLane] of pairs) {
          const p0 = add(li.end, mul(li.right, li.laneOffsets[lane]));
          const p3 = add(lo.start, mul(lo.right, lo.laneOffsets[outLane]));
          let p1: Vec2;
          let p2: Vec2;
          if (turn === 'S') {
            const L = len(sub(p3, p0));
            p1 = add(p0, mul(li.dir, L / 3));
            p2 = sub(p3, mul(lo.dir, L / 3));
          } else {
            const { a, b } = cornerDistances(p0, li.dir, p3, lo.dir);
            p1 = add(p0, mul(li.dir, a * 0.5523));
            p2 = sub(p3, mul(lo.dir, b * 0.5523));
          }
          const bez = { p0, p1, p2, p3 };
          const lut = buildLut(bez);
          const r = minRadius(bez);
          const curveSpeed = r === Infinity ? 99 : Math.sqrt(LAT_ACCEL * r);
          const id = `${inId}#${lane}>${outId}#${outLane}`;
          connectors[id] = {
            id,
            junction: jid,
            inLink: inId,
            inLane: lane,
            outLink: outId,
            outLane,
            turn,
            ...bez,
            length: lut[lut.length - 1],
            lut,
            speedLimit: Math.min(li.speed, lo.speed, curveSpeed),
            conflicts: [],
            siblings: [],
            approach: side,
          };
          conns.push(id);
          connectorIds.push(id);
          const key = `${inId}#${lane}`;
          (fromLane[key] ??= []).push(id);
        }
      }
    }

    // conflicts: merging into the same lane, or paths that come within a vehicle width
    for (let a = 0; a < conns.length; a++) {
      for (let b = a + 1; b < conns.length; b++) {
        const ca = connectors[conns[a]];
        const cb = connectors[conns[b]];
        if (ca.inLink === cb.inLink && ca.inLane === cb.inLane) {
          ca.siblings.push(cb.id);
          cb.siblings.push(ca.id);
          continue;
        }
        const merge = ca.outLink === cb.outLink && ca.outLane === cb.outLane;
        if (merge || minDistance(ca, cb) < 2.6) {
          ca.conflicts.push(cb.id);
          cb.conflicts.push(ca.id);
        }
      }
    }

    // split-phase signal plan: one approach at a time, clockwise from north
    const phases: PhaseDef[] = [];
    for (const side of SIDES) {
      const inId = inLinks[side];
      if (!inId) continue;
      phases.push({ approach: side, inLinks: [inId], green: GREEN_BY_CLASS[links[inId].cls] });
    }
    const cycle = phases.reduce((acc, p) => acc + p.green + AMBER + ALL_RED, 0);
    // a simple deterministic offset that staggers neighbouring junctions
    const offset = Math.round((j.x + X_EDGE) / 11 + (j.y + Y_EDGE) / 7) % cycle;
    const nsHalf = halfWidth(ns);
    const ewHalf = halfWidth(ew);
    junctions[jid] = {
      id: jid,
      label: j.label,
      x: j.x,
      y: j.y,
      boxHalfX: nsHalf + CROSSWALK,
      boxHalfY: ewHalf + CROSSWALK,
      nsHalf,
      ewHalf,
      inLinks,
      outLinks,
      connectors: conns,
      plan: { phases, amber: AMBER, allRed: ALL_RED, cycle, offset },
      maxApproachLanes: Math.max(ns.lanesPerDir, ew.lanesPerDir),
      // roadside unit on the north-east corner of the junction
      rsu: { id: `RSU-${jid}`, x: j.x + nsHalf + 3, y: j.y + ewHalf + 3, range: 320 },
    };
  }

  const gatewayIds = NODES.filter((n) => n.kind === 'gateway').map((n) => n.id);
  const gatewayIn: Record<string, string> = {};
  const gatewayOut: Record<string, string> = {};
  for (const id of linkIds) {
    const l = links[id];
    if (nodes[l.from].kind === 'gateway') gatewayIn[l.from] = id;
    if (nodes[l.to].kind === 'gateway') gatewayOut[l.to] = id;
  }

  const places: Network['places'] = {};
  for (const p of PLACES) places[p.id] = { ...p };

  // map version: hash of the defining data, so messages can be checked against the map in use
  const canon = JSON.stringify({ NODES, ROADS, LANE_W, CROSSWALK, GREEN_BY_CLASS, AMBER, ALL_RED });
  const version = `DMD-1.${(hashString(canon) >>> 0).toString(16).padStart(8, '0')}`;

  return {
    version,
    roads,
    nodes,
    links,
    connectors,
    junctions,
    linkIds,
    connectorIds,
    junctionIds,
    gatewayIds,
    gatewayIn,
    gatewayOut,
    fromLane,
    bounds: { minX: -X_EDGE, maxX: X_EDGE, minY: -Y_EDGE, maxY: Y_EDGE },
    places,
  };
}

let cached: Network | null = null;
/** The district network (built once; immutable by convention). */
export function getNetwork(): Network {
  if (!cached) cached = buildNetwork();
  return cached;
}
