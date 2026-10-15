import * as THREE from 'three';
import type { LinkDef, Network, Side, Turn } from '../../core/network/types';
import { CROSSWALK, LANE_W } from '../../core/network/district';
import { GeoBuilder } from './builder';
import { asphaltTexture, grassTexture } from './textures';
import { GLSL_COMMON } from '../env/uniforms';

/* Road surfaces, markings and medians, all generated from the network definition so the drawing
   cannot drift from the geometry the simulation uses. */

export const ASPHALT_H = 0.02;
const MARK_H = 0.045;
export const CURB_H = 0.15;
// the road continues past the gateway to the far kerb of the perimeter street; the surrounding
// city's ground (city/metroGround.ts) carries it on from there
const EXTEND = 170;

interface Segment {
  a: { x: number; y: number };
  b: { x: number; y: number };
  dir: { x: number; y: number };
  hw: number;
  median: number;
  link: LinkDef; // the a->b link
}

function segmentsOf(net: Network): Segment[] {
  const seen = new Set<string>();
  const out: Segment[] = [];
  for (const id of net.linkIds) {
    const l = net.links[id];
    const key = [l.from, l.to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const road = net.roads[l.road];
    out.push({ a: l.start, b: l.end, dir: l.dir, hw: l.halfWidth, median: road.median, link: l });
  }
  return out;
}

export interface RoadLayer {
  group: THREE.Group;
  materials: THREE.Material[];
}

export function buildRoads(net: Network, anisotropy: number): RoadLayer {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = new GeoBuilder();
  const white = new GeoBuilder();
  const yellow = new GeoBuilder();
  const medianTop = new GeoBuilder();
  const curbs = new GeoBuilder();
  const concrete = new GeoBuilder();

  const segs = segmentsOf(net);

  // ---------------------------------------------------------------- asphalt
  for (const s of segs) {
    const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    let ax = s.a.x;
    let ay = s.a.y;
    let bx = s.b.x;
    let by = s.b.y;
    // extend past gateways
    if (net.nodes[s.link.from].kind === 'gateway') {
      ax -= s.dir.x * EXTEND;
      ay -= s.dir.y * EXTEND;
    }
    if (net.nodes[s.link.to].kind === 'gateway') {
      bx += s.dir.x * EXTEND;
      by += s.dir.y * EXTEND;
    }
    const len = Math.hypot(bx - ax, by - ay);
    asphalt.rectH((ax + bx) / 2, (ay + by) / 2, s.dir.x, s.dir.y, len, s.hw * 2, ASPHALT_H, 8);
    void L;
  }
  for (const jid of net.junctionIds) {
    const j = net.junctions[jid];
    asphalt.quadH(
      [
        [j.x - j.boxHalfX, j.y - j.boxHalfY],
        [j.x + j.boxHalfX, j.y - j.boxHalfY],
        [j.x + j.boxHalfX, j.y + j.boxHalfY],
        [j.x - j.boxHalfX, j.y + j.boxHalfY],
      ],
      ASPHALT_H,
      8,
    );
  }

  // ---------------------------------------------------------------- lane markings per directed link
  const dash = (b: GeoBuilder, l: LinkDef, off: number, from: number, to: number, dashLen: number, gap: number, w: number) => {
    for (let s = from; s < to; s += dashLen + gap) {
      const e = Math.min(to, s + dashLen);
      const mid = (s + e) / 2;
      const cx = l.start.x + l.dir.x * mid + l.right.x * off;
      const cy = l.start.y + l.dir.y * mid + l.right.y * off;
      b.rectH(cx, cy, l.dir.x, l.dir.y, e - s, w, MARK_H);
    }
  };
  const solid = (b: GeoBuilder, l: LinkDef, off: number, from: number, to: number, w: number, extendBack = 0, extendFwd = 0) => {
    const s0 = from - extendBack;
    const s1 = to + extendFwd;
    const mid = (s0 + s1) / 2;
    const cx = l.start.x + l.dir.x * mid + l.right.x * off;
    const cy = l.start.y + l.dir.y * mid + l.right.y * off;
    b.rectH(cx, cy, l.dir.x, l.dir.y, s1 - s0, w, MARK_H);
  };

  for (const id of net.linkIds) {
    const l = net.links[id];
    const road = net.roads[l.road];
    const back = net.nodes[l.from].kind === 'gateway' ? EXTEND : 0;
    const fwd = net.nodes[l.to].kind === 'gateway' ? EXTEND : 0;
    const solidZone = l.endsAtJunction ? Math.min(30, l.length * 0.3) : 0;
    // lane separators
    for (let i = 0; i < l.lanes - 1; i++) {
      const off = l.laneOffsets[i] + LANE_W / 2;
      dash(white, l, off, -back, l.length - solidZone + fwd, 3, 6, 0.15);
      if (solidZone > 0) solid(white, l, off, l.length - solidZone, l.length, 0.15);
    }
    // curb edge line
    solid(white, l, l.halfWidth - 0.35, 0, l.length, 0.15, back, fwd);
    // median side: yellow edge for divided roads, half of a double centre line otherwise
    if (road.median > 0) solid(yellow, l, road.median / 2 + 0.3, 0, l.length, 0.15, back, fwd);
    else solid(yellow, l, 0.16, 0, l.length, 0.12, back, fwd);

    if (l.endsAtJunction) {
      // stop line across this direction's lanes
      const inner = road.median / 2 + 0.2;
      const outer = l.halfWidth - 0.2;
      const s = l.length - 0.35;
      const off = (inner + outer) / 2;
      white.rectH(
        l.start.x + l.dir.x * s + l.right.x * off,
        l.start.y + l.dir.y * s + l.right.y * off,
        l.right.x,
        l.right.y,
        outer - inner,
        0.5,
        MARK_H,
      );
      // turn arrows ~9 m before the stop line
      for (let lane = 0; lane < l.lanes; lane++) {
        arrow(white, l, lane, l.length - 9.5, l.laneTurns[lane]);
      }
    }
  }

  // crosswalks: one band per junction leg, across the full road width
  for (const jid of net.junctionIds) {
    const j = net.junctions[jid];
    const legs: Array<[Side, number, number, number, number]> = [
      ['N', 0, 1, j.boxHalfY, j.nsHalf],
      ['S', 0, -1, j.boxHalfY, j.nsHalf],
      ['E', 1, 0, j.boxHalfX, j.ewHalf],
      ['W', -1, 0, j.boxHalfX, j.ewHalf],
    ];
    for (const [, dx, dy, boxHalf, roadHalf] of legs) {
      const centre = boxHalf - CROSSWALK / 2 - 0.2;
      const cx = j.x + dx * centre;
      const cy = j.y + dy * centre;
      // across direction
      const ax = -dy;
      const ay = dx;
      for (let k = -roadHalf + 0.6; k <= roadHalf - 0.6; k += 1.25) {
        white.rectH(cx + ax * k, cy + ay * k, dx, dy, CROSSWALK - 1.2, 0.62, MARK_H);
      }
    }
  }

  // ---------------------------------------------------------------- medians
  for (const s of segs) {
    if (s.median <= 0) continue;
    const l = s.link;
    let a0 = 0;
    let a1 = l.length;
    if (l.endsAtJunction) a1 -= 1.0;
    if (!l.startsAtGateway) a0 += 1.0;
    else a0 -= EXTEND;
    if (net.nodes[l.to].kind === 'gateway') a1 += EXTEND;
    // the median centre line is the road centre line: link offset 0
    const mid = (a0 + a1) / 2;
    const cx = l.start.x + l.dir.x * mid;
    const cy = l.start.y + l.dir.y * mid;
    const len = a1 - a0;
    const w = s.median - 0.3;
    const h = s.median >= 4 ? 0.22 : 0.18;
    const top = s.median >= 4 ? medianTop : concrete;
    top.rectH(cx, cy, l.dir.x, l.dir.y, len, w, h, s.median >= 4 ? 6 : 4);
    // curb faces on both long sides and the noses
    const hx = l.dir.x * (len / 2);
    const hy = l.dir.y * (len / 2);
    const rx = l.right.x * (w / 2);
    const ry = l.right.y * (w / 2);
    const p0: [number, number] = [cx - hx + rx, cy - hy + ry];
    const p1: [number, number] = [cx + hx + rx, cy + hy + ry];
    const p2: [number, number] = [cx + hx - rx, cy + hy - ry];
    const p3: [number, number] = [cx - hx - rx, cy - hy - ry];
    curbs.wall(p0[0], p0[1], p1[0], p1[1], 0, h);
    curbs.wall(p2[0], p2[1], p3[0], p3[1], 0, h);
    curbs.wall(p1[0], p1[1], p2[0], p2[1], 0, h);
    curbs.wall(p3[0], p3[1], p0[0], p0[1], 0, h);
  }

  // ---------------------------------------------------------------- materials and meshes
  const asphaltTex = asphaltTexture();
  asphaltTex.anisotropy = anisotropy;
  const mAsphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0xb0b2b6, roughness: 0.86, metalness: 0 });
  // weathering in world space, so the 8 m texture never visibly repeats: broad sun-bleached and
  // darker areas, resurfaced patches and a slightly varying sheen
  mAsphalt.customProgramCacheKey = () => 'dm-asphalt';
  mAsphalt.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vAWP;`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vAWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAWP;
${GLSL_COMMON}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 aw = vAWP.xz;
float big = dmNoise(aw * 0.018) * 0.6 + dmNoise(aw * 0.05) * 0.4;
diffuseColor.rgb *= 0.86 + 0.26 * big;
float patchM = smoothstep(0.66, 0.7, dmNoise(aw * 0.011 + 3.1)) * step(0.5, dmNoise(aw * 0.09 + 7.7));
diffuseColor.rgb *= mix(1.0, 0.72, patchM);
float dmARough = mix(0.8, 0.94, dmNoise(aw * 0.4)) - patchM * 0.1;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = dmARough;`,
      );
  };
  const markProps = { roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const mWhite = new THREE.MeshStandardMaterial({ color: 0xdedbd2, ...markProps });
  const mYellow = new THREE.MeshStandardMaterial({ color: 0xd9a531, ...markProps });
  const grass = grassTexture();
  grass.anisotropy = anisotropy;
  const mMedian = new THREE.MeshStandardMaterial({ map: grass, color: 0xb6c49a, roughness: 0.95 });
  const mCurb = new THREE.MeshStandardMaterial({ color: 0xbdb4a6, roughness: 0.85 });
  const mConcrete = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.9 });

  const add = (b: GeoBuilder, m: THREE.Material, name: string, shadow = true) => {
    if (b.empty) return;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.name = name;
    mesh.receiveShadow = shadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  };
  add(asphalt, mAsphalt, 'asphalt');
  add(white, mWhite, 'markings-white');
  add(yellow, mYellow, 'markings-yellow');
  add(medianTop, mMedian, 'median-planted');
  add(concrete, mConcrete, 'median-concrete');
  add(curbs, mCurb, 'median-curbs');
  return { group, materials: [mAsphalt, mWhite, mYellow, mMedian, mCurb, mConcrete] };
}

/** Painted turn arrow(s) for one lane; `s` is the arrow tail position along the link. */
function arrow(b: GeoBuilder, l: LinkDef, lane: number, s: number, turns: Turn[]): void {
  const off = l.laneOffsets[lane];
  const P = (along: number, across: number): [number, number] => [
    l.start.x + l.dir.x * (s + along) + l.right.x * (off + across),
    l.start.y + l.dir.y * (s + along) + l.right.y * (off + across),
  ];
  const quad = (pts: Array<[number, number]>) => {
    const ccw =
      (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]) >= 0;
    b.quadH(ccw ? pts : [...pts].reverse(), MARK_H, 1);
  };
  const tri = (pts: Array<[number, number]>) => quad([pts[0], pts[1], pts[2], pts[2]]);
  const stem = 0.16;
  // shaft
  quad([P(0, -stem), P(3.2, -stem), P(3.2, stem), P(0, stem)]);
  if (turns.includes('S')) {
    quad([P(3.2, -stem), P(4.6, -stem), P(4.6, stem), P(3.2, stem)]);
    tri([P(4.6, -0.55), P(6.1, 0), P(4.6, 0.55)]);
  }
  // across is to the right; a left turn bends to negative across
  if (turns.includes('L')) {
    quad([P(2.7, -stem), P(3.2, -stem), P(3.2, -1.2), P(2.7, -1.2)]);
    tri([P(2.4, -1.2), P(2.95, -1.95), P(3.5, -1.2)]);
  }
  if (turns.includes('R')) {
    quad([P(2.7, stem), P(3.2, stem), P(3.2, 1.2), P(2.7, 1.2)]);
    tri([P(2.4, 1.2), P(2.95, 1.95), P(3.5, 1.2)]);
  }
}
