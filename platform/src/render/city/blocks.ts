import * as THREE from 'three';
import type { Network } from '../../core/network/types';
import { X_EDGE, Y_EDGE } from '../../core/network/district';
import { makeRng, rand, randRange, type RngState } from '../../core/rng';
import { GeoBuilder, roundedRect } from './builder';
import { CURB_H } from './roads';

/* City blocks between the roads: raised sidewalks, landscaped plots, plazas, lawns, pools,
   parking with solar carports, a mosque, and the specifications of every building, which
   buildings.ts turns into kit models. Land use is art-directed per block (downtown towers and the
   landmarks to the north, the boulevard lined with towers, a mosque, a park, a mall, a school and
   villa neighbourhoods to the south so the default camera keeps the streets in view). Details are
   seeded, so the city is identical on every load. Coordinates: simulation metres (x east, y north). */

export interface Spot {
  x: number;
  y: number;
  h?: number; // base height
  s?: number; // scale
  a?: number; // rotation (rad)
  kind?: string;
}

export type BuildingType =
  | 'tower-glass'
  | 'tower-office'
  | 'tower-residential'
  | 'midrise'
  | 'lowrise'
  | 'villa'
  | 'podium'
  | 'hospital'
  | 'mall'
  | 'office-complex'
  | 'ops'
  | 'cooling'
  | 'landmark-spire'
  | 'landmark-twist';

export interface BuildingSpec {
  type: BuildingType;
  x: number;
  y: number;
  /** three.js yaw of the front: 0 faces south, PI/2 east, PI north, -PI/2 west */
  face: number;
  w: number; // facade width
  d: number; // depth
  h: number; // height
  seed: number;
}

export interface Bound {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
}

export interface BlockOutput {
  group: THREE.Group;
  specs: BuildingSpec[];
  trees: Spot[]; // shade trees
  palms: Spot[];
  parked: Spot[]; // parked car positions with heading
  benches: Spot[];
  bounds: Bound[]; // procedural structures (buildings add their own)
  materials: Record<string, THREE.Material>;
}

export interface GroundTextures {
  paving: THREE.Texture;
  plaza: THREE.Texture;
  ground: THREE.Texture;
  grass: THREE.Texture;
  asphalt: THREE.Texture;
}

const SIDEWALK = 5.5;
export const FACE = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 } as const;
type Side = keyof typeof FACE;

type Program =
  | 'hospital'
  | 'downtown'
  | 'landmark'
  | 'spire'
  | 'boulevard'
  | 'mixed'
  | 'residential'
  | 'mall'
  | 'mosque-park'
  | 'villas'
  | 'park'
  | 'school'
  | 'clinic';

// [column][row], column 0 = west, row 0 = south
const PROGRAMS: Program[][] = [
  ['villas', 'residential', 'mixed', 'hospital'],
  ['park', 'mosque-park', 'boulevard', 'downtown'],
  ['school', 'mall', 'boulevard', 'landmark'],
  ['clinic', 'residential', 'boulevard', 'spire'],
  ['villas', 'residential', 'mixed', 'downtown'],
];

export function buildBlocks(net: Network, tex: GroundTextures): BlockOutput {
  const group = new THREE.Group();
  group.name = 'blocks';
  const r = makeRng(2027, 'city-blocks');

  const sidewalk = new GeoBuilder();
  const curb = new GeoBuilder();
  const ground = new GeoBuilder();
  const plaza = new GeoBuilder();
  const grass = new GeoBuilder();
  const parking = new GeoBuilder();
  const stall = new GeoBuilder();
  const lanes = new GeoBuilder();
  const water = new GeoBuilder();
  const white = new GeoBuilder();
  const domeB = new GeoBuilder();
  const accent = new GeoBuilder();
  const dark = new GeoBuilder();
  const solar = new GeoBuilder();
  const wall = new GeoBuilder();

  const specs: BuildingSpec[] = [];
  const trees: Spot[] = [];
  const palms: Spot[] = [];
  const parked: Spot[] = [];
  const benches: Spot[] = [];
  const bounds: Bound[] = [];
  let seed = 1;

  // ---------------------------------------------------------------- cells from road curb lines
  const isNS = (rd: { nodes: string[] }) => {
    const a = net.nodes[rd.nodes[0]];
    const b = net.nodes[rd.nodes[rd.nodes.length - 1]];
    return Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
  };
  const hwOf = (rd: { median: number; lanesPerDir: number }) => rd.median / 2 + rd.lanesPerDir * 3.5;
  const nsRoads = Object.values(net.roads)
    .filter(isNS)
    .map((rd) => ({ c: net.nodes[rd.nodes[1]].x, hw: hwOf(rd) }))
    .sort((a, b) => a.c - b.c);
  const ewRoads = Object.values(net.roads)
    .filter((rd) => !isNS(rd))
    .map((rd) => ({ c: net.nodes[rd.nodes[1]].y, hw: hwOf(rd) }))
    .sort((a, b) => a.c - b.c);
  const XMIN = -X_EDGE - 160;
  const XMAX = X_EDGE + 160;
  const YMIN = -Y_EDGE - 160;
  const YMAX = Y_EDGE + 160;
  const xs: Array<[number, number]> = [];
  for (let i = 0; i <= nsRoads.length; i++) {
    xs.push([i === 0 ? XMIN : nsRoads[i - 1].c + nsRoads[i - 1].hw, i === nsRoads.length ? XMAX : nsRoads[i].c - nsRoads[i].hw]);
  }
  const ys: Array<[number, number]> = [];
  for (let i = 0; i <= ewRoads.length; i++) {
    ys.push([i === 0 ? YMIN : ewRoads[i - 1].c + ewRoads[i - 1].hw, i === ewRoads.length ? YMAX : ewRoads[i].c - ewRoads[i].hw]);
  }

  // ---------------------------------------------------------------- primitives
  const add = (type: BuildingType, x: number, y: number, face: number, w: number, d: number, h: number) =>
    specs.push({ type, x, y, face, w, d, h, seed: seed++ });

  const rect = (b: GeoBuilder, x0: number, y0: number, x1: number, y1: number, h: number, uv: number, rad = 0) => {
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return;
    if (rad > 0) b.capH(roundedRect(x0, y0, x1, y1, rad, 5), h, uv);
    else
      b.quadH(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
        h,
        uv,
      );
  };
  const lawn = (x0: number, y0: number, x1: number, y1: number, rad = 4) => rect(grass.setColor(0xffffff), x0, y0, x1, y1, CURB_H + 0.03, 6, rad);
  const plazaAt = (x0: number, y0: number, x1: number, y1: number, rad = 2) => rect(plaza.setColor(0xffffff), x0, y0, x1, y1, CURB_H + 0.015, 9.6, rad);
  const pool = (cx: number, cy: number, w: number, d: number, h = CURB_H + 0.08) => {
    // coping then water, slightly recessed look
    white.setColor(0xf1ece2).box(cx, cy, w + 1.2, d + 1.2, CURB_H, h + 0.05, 0, 1, 1, true);
    rect(water.setColor(0xffffff), cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, h + 0.07, 4);
  };
  const scatter = (x0: number, y0: number, x1: number, y1: number, n: number, palmShare = 0.35) => {
    for (let i = 0; i < n; i++) {
      const x = randRange(r, x0, x1);
      const y = randRange(r, y0, y1);
      if (rand(r) < palmShare) palms.push({ x, y, s: randRange(r, 0.85, 1.2), a: rand(r) * 6.28 });
      else trees.push({ x, y, s: randRange(r, 0.7, 1.2) });
    }
  };
  const palmRow = (ax: number, ay: number, bx: number, by: number, spacing: number, s = 1) => {
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.floor(L / spacing));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      palms.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, s: s * randRange(r, 0.92, 1.08), a: rand(r) * 6.28 });
    }
  };

  /** Asphalt lot with marked bays, parked cars and optional solar carports over the rows. */
  const parkingLot = (x0: number, y0: number, x1: number, y1: number, fill: number, carports = false) => {
    if (x1 - x0 < 14 || y1 - y0 < 12) return;
    rect(parking.setColor(0xffffff), x0, y0, x1, y1, CURB_H + 0.02, 8);
    const rowsY: number[] = [];
    for (let y = y0 + 2; y + 5.2 < y1; y += 16.5) {
      rowsY.push(y);
      if (y + 10.6 < y1) rowsY.push(y + 10.6);
    }
    stall.setColor(0xffffff);
    for (const y of rowsY) {
      for (let x = x0 + 2; x + 2.6 < x1; x += 2.6) {
        stall.rectH(x, y + 2.5, 0, 1, 5, 0.12, CURB_H + 0.04);
        if (rand(r) < fill) parked.push({ x: x + 1.3, y: y + 2.5, a: Math.PI / 2 + (rand(r) > 0.5 ? Math.PI : 0), h: CURB_H + 0.02 });
      }
    }
    if (carports) {
      // shade structures: a sloped PV canopy on posts over each pair of bay rows
      for (let i = 0; i + 1 < rowsY.length; i += 2) {
        const ya = rowsY[i] + 0.5;
        const yb = rowsY[i + 1] + 4.5;
        const yc = (ya + yb) / 2;
        for (let x = x0 + 2; x + 20 < x1; x += 23) {
          solar.setColor(0xffffff).box(x + 10.5, yc, 21, yb - ya, CURB_H + 3.6, CURB_H + 3.75, 0, 1, 1, true);
          dark.setColor(0x6b7178);
          for (const px of [x + 2, x + 19]) dark.box(px, yc, 0.25, 0.25, CURB_H, CURB_H + 3.6);
        }
      }
    }
  };

  /** Split a plot into nx x ny parcels separated by paved access lanes. */
  const parcels = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, lane: number) => {
    const out: Array<[number, number, number, number]> = [];
    const pw = (x1 - x0 - lane * (nx - 1)) / nx;
    const ph = (y1 - y0 - lane * (ny - 1)) / ny;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const px0 = x0 + i * (pw + lane);
        const py0 = y0 + j * (ph + lane);
        out.push([px0, py0, px0 + pw, py0 + ph]);
      }
    }
    lanes.setColor(0xffffff);
    for (let i = 1; i < nx; i++) {
      const lx = x0 + i * (pw + lane) - lane / 2;
      lanes.rectH(lx, (y0 + y1) / 2, 0, 1, y1 - y0, lane - 1, CURB_H + 0.012, 6);
    }
    for (let j = 1; j < ny; j++) {
      const ly = y0 + j * (ph + lane) - lane / 2;
      lanes.rectH((x0 + x1) / 2, ly, 1, 0, x1 - x0, lane - 1, CURB_H + 0.012, 6);
    }
    return out;
  };

  /** Side of a rectangle nearest to the given point, used to face buildings to the street. */
  const nearestSide = (cx: number, cy: number, b: [number, number, number, number]): Side => {
    const d = { S: cy - b[1], N: b[3] - cy, W: cx - b[0], E: b[2] - cx };
    return (Object.keys(d) as Side[]).reduce((m, k) => (d[k] < d[m] ? k : m), 'S');
  };

  // ---------------------------------------------------------------- building groups

  /** Tower on a landscaped plaza: water feature, lawn corners and palms. */
  const towerLot = (x0: number, y0: number, x1: number, y1: number, h: number, face: Side, style: BuildingType) => {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    plazaAt(x0, y0, x1, y1, 3);
    const tw = randRange(r, 23, 29);
    const td = randRange(r, 20, 25);
    add(style, cx, cy, FACE[face], tw, td, h);
    // a drop-off fountain in front and lawn pads at the corners
    const fx = face === 'E' ? cx + td / 2 + 10 : face === 'W' ? cx - td / 2 - 10 : cx;
    const fy = face === 'S' ? cy - td / 2 - 10 : face === 'N' ? cy + td / 2 + 10 : cy;
    if (x1 - x0 > 44 && y1 - y0 > 50 && rand(r) > 0.35) pool(fx, fy, 8, 4.5);
    const m = 4;
    const lw = Math.min(14, (x1 - x0) * 0.22);
    const lh = Math.min(14, (y1 - y0) * 0.22);
    for (const [ax, ay] of [
      [x0 + m, y0 + m],
      [x1 - m - lw, y0 + m],
      [x0 + m, y1 - m - lh],
      [x1 - m - lw, y1 - m - lh],
    ]) {
      if (rand(r) > 0.3) {
        lawn(ax, ay, ax + lw, ay + lh, 3);
        palms.push({ x: ax + lw / 2, y: ay + lh / 2, s: randRange(r, 0.95, 1.2), a: rand(r) * 6.28 });
      }
    }
  };

  /** A row of mid-rise or low-rise kit buildings along one side of a strip. */
  const row = (x0: number, y0: number, x1: number, y1: number, h: number, face: Side, type: BuildingType = 'midrise') => {
    const alongX = x1 - x0 >= y1 - y0;
    const len = alongX ? x1 - x0 : y1 - y0;
    const depth = alongX ? y1 - y0 : x1 - x0;
    const unit = type === 'podium' ? 22 : type === 'lowrise' ? 20.5 : 22;
    const n = Math.max(1, Math.round(len / (unit + 4)));
    const step = len / n;
    for (let k = 0; k < n; k++) {
      const c = (alongX ? x0 : y0) + step * (k + 0.5);
      const w = Math.min(step - 3, unit * 1.2);
      const d = Math.min(depth, unit * 1.05);
      const hh = h * randRange(r, 0.92, 1.08);
      if (alongX) add(type, c, (y0 + y1) / 2, FACE[face], w, d, hh);
      else add(type, (x0 + x1) / 2, c, FACE[face], w, d, hh);
    }
  };

  /** A generic urban lot grid: towers, mid-rise, podiums and gardens by the given mix. */
  const urban = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    o: {
      tower: [number, number];
      towerP: number;
      midP: number;
      mid?: [number, number];
      style?: BuildingType;
      edge?: [number, number, number, number];
      /** lot size [x, y] in metres */
      lot?: [number, number];
    },
  ) => {
    const [lotX, lotY] = o.lot ?? [58, 74];
    const nx = Math.max(1, Math.round((x1 - x0) / lotX));
    const ny = Math.max(1, Math.round((y1 - y0) / lotY));
    const lw = (x1 - x0) / nx;
    const lh = (y1 - y0) / ny;
    const edge = o.edge ?? [x0, y0, x1, y1];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = x0 + i * lw + 3;
        const b = y0 + j * lh + 3;
        const c = x0 + (i + 1) * lw - 3;
        const d = y0 + (j + 1) * lh - 3;
        const cx = (a + c) / 2;
        const cy = (b + d) / 2;
        const side = nearestSide(cx, cy, edge);
        const k = rand(r);
        if (k < o.towerP) {
          const style = o.style ?? (rand(r) < 0.5 ? 'tower-glass' : rand(r) < 0.5 ? 'tower-office' : 'tower-residential');
          towerLot(a, b, c, d, randRange(r, o.tower[0], o.tower[1]), side, style);
        } else if (k < o.towerP + o.midP) {
          const [m0, m1] = o.mid ?? [24, 34];
          rect(ground.setColor(0xffffff), a, b, c, d, CURB_H + 0.01, 12);
          const twoUp = c - a > 48;
          const h = randRange(r, m0, m1);
          const type: BuildingType = h < 18 ? 'lowrise' : 'midrise';
          if (twoUp) {
            add(type, cx - (c - a) / 4, cy, FACE[side], Math.min(24, (c - a) / 2 - 4), Math.min(22, d - b - 16), h);
            add(type, cx + (c - a) / 4, cy, FACE[side], Math.min(24, (c - a) / 2 - 4), Math.min(22, d - b - 16), h * randRange(r, 0.85, 1.1));
          } else add(type, cx, cy, FACE[side], Math.min(25, c - a - 8), Math.min(22, d - b - 16), h);
          // garden behind the building and a planted strip along the street
          const back = side === 'S' ? [d - 13, d - 2] : side === 'N' ? [b + 2, b + 13] : [b + 2, d - 2];
          lawn(a + 2, back[0], c - 2, back[1], 3);
          scatter(a + 5, back[0] + 2, c - 5, back[1] - 2, 5, 0.35);
          const front = side === 'S' ? b + 4 : side === 'N' ? d - 4 : cy;
          if (side === 'S' || side === 'N') {
            lawn(a + 3, front - 2.5, c - 3, front + 2.5, 2);
            for (let x = a + 7; x < c - 4; x += 9) trees.push({ x, y: front, s: randRange(r, 0.6, 0.8) });
          }
        } else if (k < o.towerP + o.midP + 0.12) {
          plazaAt(a, b, c, d, 2);
          row(a + 2, cy - 9, c - 2, cy + 9, randRange(r, 14, 17), side, 'podium');
        } else {
          lawn(a + 1, b + 1, c - 1, d - 1, 6);
          scatter(a + 6, b + 6, c - 6, d - 6, 7, 0.55);
          if (rand(r) > 0.5) benches.push({ x: cx, y: cy, a: rand(r) * 6.28 });
        }
      }
    }
  };

  /** Villas on plots with boundary walls, pools, gardens and a palm or two. */
  const villas = (x0: number, y0: number, x1: number, y1: number, edge: [number, number, number, number]) => {
    rect(ground.setColor(0xffffff), x0, y0, x1, y1, CURB_H + 0.01, 12);
    const nx = Math.max(1, Math.floor((x1 - x0) / 34));
    const ny = Math.max(1, Math.floor((y1 - y0) / 32));
    const pw = (x1 - x0) / nx;
    const ph = (y1 - y0) / ny;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if (rand(r) < 0.06) continue;
        const a = x0 + i * pw + 1.5;
        const b = y0 + j * ph + 1.5;
        const c = a + pw - 3;
        const d = b + ph - 3;
        const cx = (a + c) / 2;
        const cy = (b + d) / 2;
        // villas on the two rows of a street block face outward, others face the nearest edge
        const side: Side = j === 0 ? 'S' : j === ny - 1 ? 'N' : nearestSide(cx, cy, edge);
        const back = side === 'S' ? 1 : side === 'N' ? -1 : 0;
        add('villa', cx, cy + back * 2.5, FACE[side], 15, 14.5, 8);
        // boundary wall (a low cream wall around the plot)
        wall.setColor(0xece2d0);
        wall.box((a + c) / 2, b + 0.15, c - a, 0.3, CURB_H, CURB_H + 1.8);
        wall.box((a + c) / 2, d - 0.15, c - a, 0.3, CURB_H, CURB_H + 1.8);
        wall.box(a + 0.15, (b + d) / 2, 0.3, d - b, CURB_H, CURB_H + 1.8);
        wall.box(c - 0.15, (b + d) / 2, 0.3, d - b, CURB_H, CURB_H + 1.8);
        // garden behind the house with a pool
        const gy = side === 'S' ? d - 6.5 : side === 'N' ? b + 6.5 : cy;
        lawn(a + 1.2, gy - 4.8, c - 1.2, gy + 4.8, 1.5);
        if (rand(r) > 0.35) pool(cx + randRange(r, -4, 4), gy, 7.5, 3.6);
        if (rand(r) > 0.3) palms.push({ x: a + 3, y: gy, s: randRange(r, 0.75, 1.0), a: rand(r) * 6.28 });
        if (rand(r) > 0.55) trees.push({ x: c - 3, y: gy, s: randRange(r, 0.6, 0.85) });
        // driveway with a car
        if (rand(r) > 0.45) {
          const dy = side === 'S' ? b + 3 : side === 'N' ? d - 3 : cy;
          parked.push({ x: c - 4.5, y: dy, a: Math.PI / 2, h: CURB_H + 0.02 });
        }
      }
    }
  };

  /** Garden courtyard ring of mid-rise buildings. */
  const courtyard = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    rect(ground.setColor(0xffffff), x0, y0, x1, y1, CURB_H + 0.01, 12);
    const dep = 20;
    row(x0 + 4, y0 + 2, x1 - 4, y0 + 2 + dep, h, 'S');
    row(x0 + 4, y1 - 2 - dep, x1 - 4, y1 - 2, h * randRange(r, 0.85, 1.05), 'N');
    if (y1 - y0 > 110) {
      row(x0 + 2, y0 + dep + 12, x0 + 2 + dep, y1 - dep - 12, h * 0.9, 'W');
      row(x1 - 2 - dep, y0 + dep + 12, x1 - 2, y1 - dep - 12, h * 0.9, 'E');
    }
    const ix0 = x0 + (y1 - y0 > 110 ? dep + 8 : 6);
    const ix1 = x1 - (y1 - y0 > 110 ? dep + 8 : 6);
    lawn(ix0, y0 + dep + 8, ix1, y1 - dep - 8, 6);
    pool((x0 + x1) / 2, (y0 + y1) / 2, Math.min(18, (ix1 - ix0) * 0.4), 6);
    scatter(ix0 + 4, y0 + dep + 12, ix1 - 4, y1 - dep - 12, 8, 0.5);
  };

  // ---------------------------------------------------------------- programs
  const build = (prog: Program, x0: number, y0: number, x1: number, y1: number, ci: number) => {
    const W = x1 - x0;
    const H = y1 - y0;
    const edge: [number, number, number, number] = [x0, y0, x1, y1];
    const at = (u: number, v: number): [number, number] => [x0 + u * W, y0 + v * H];
    switch (prog) {
      case 'hospital': {
        // the hospital faces West Road (east edge of this cell): its emergency bay opens to the road
        const hx = x1 - 34;
        const hy = 425;
        plazaAt(hx - 36, hy - 52, x1, hy + 52, 3);
        add('hospital', hx, hy, FACE.E, 52, 40, 40);
        parkingLot(hx - 30, y0 + 6, x1 - 4, hy - 60, 0.75, true);
        parkingLot(hx - 30, hy + 60, x1 - 4, y1 - 120, 0.6, true);
        lawn(hx - 100, hy - 50, hx - 44, hy + 50, 10);
        scatter(hx - 96, hy - 46, hx - 48, hy + 46, 16, 0.6);
        palmRow(x1 - 3, y0 + 4, x1 - 3, y1 - 4, 14);
        // west of the hospital: a residential neighbourhood fading toward the desert
        urban(x0, y0, hx - 108, y1, { tower: [44, 66], towerP: 0.12, midP: 0.6, mid: [16, 30], edge });
        break;
      }
      case 'downtown': {
        const ps = parcels(x0, y0, x1, y1, 2, 2, 10);
        ps.forEach((pc, i) => {
          if (ci === 1 && i === 1) {
            // office campus with two towers and a sky bridge
            plazaAt(pc[0], pc[1], pc[2], pc[3], 3);
            add('office-complex', (pc[0] + pc[2]) / 2, pc[1] + 34, FACE.S, 48, 40, 66);
            urban(pc[0], pc[1] + 70, pc[2], pc[3], { tower: [96, 150], towerP: 0.5, midP: 0.25, edge: pc, lot: [84, 92] });
            return;
          }
          urban(pc[0], pc[1], pc[2], pc[3], { tower: ci === 4 ? [70, 130] : [90, 185], towerP: ci === 4 ? 0.4 : 0.62, midP: 0.22, edge: pc, lot: [84, 94] });
        });
        break;
      }
      case 'landmark':
      case 'spire': {
        const ps = parcels(x0, y0, x1, y1, 2, 2, 10);
        ps.forEach((pc, i) => {
          const hero = prog === 'landmark' ? i === 2 : i === 3;
          if (hero) {
            const cx = (pc[0] + pc[2]) / 2;
            const cy = (pc[1] + pc[3]) / 2;
            // the landmark on a round plaza inside a garden, with a ring of palms and fountains
            lawn(pc[0] + 2, pc[1] + 2, pc[2] - 2, pc[3] - 2, 18);
            plaza.setColor(0xffffff).capH(circle(cx, cy, 46, 48), CURB_H + 0.04, 9.6);
            for (let k = 0; k < 18; k++) {
              const a = (k / 18) * Math.PI * 2;
              palms.push({ x: cx + Math.cos(a) * 52, y: cy + Math.sin(a) * 52, s: 1.1, a: a * 3 });
            }
            for (const [px, py] of [
              [cx, cy - 62],
              [cx, cy + 62],
            ])
              pool(px, py, 22, 7);
            scatter(pc[0] + 8, pc[1] + 8, pc[2] - 8, pc[3] - 8, 18, 0.5);
            if (prog === 'spire') add('landmark-spire', cx, cy, 0.35, 76, 70, 420);
            else add('landmark-twist', cx, cy, 0.2, 47, 47, 230);
            return;
          }
          urban(pc[0], pc[1], pc[2], pc[3], { tower: [100, 190], towerP: 0.6, midP: 0.2, edge: pc, lot: [84, 94] });
        });
        break;
      }
      case 'boulevard': {
        // the boulevard is the south edge: a front row of towers on plazas, mid-rise courtyards behind
        const split = y0 + H * 0.48;
        plazaAt(x0, y0, x1, y0 + 8, 1);
        palmRow(x0 + 4, y0 + 4, x1 - 4, y0 + 4, 12, 1.05);
        urban(x0, y0 + 9, x1, split, { tower: [72, 150], towerP: 0.72, midP: 0.14, edge: [x0, y0 - 200, x1, split + 200], lot: [66, 90] });
        courtyard(x0, split + 6, x1, y1, randRange(r, 22, 30));
        break;
      }
      case 'mixed': {
        urban(x0, y0, x1, y1, { tower: [60, 120], towerP: 0.35, midP: 0.42, edge });
        if (ci === 4) {
          // a district cooling plant and the city operations building on the eastern block
          rect(ground.setColor(0xffffff), x1 - 60, y0 + 6, x1 - 6, y0 + 58, CURB_H + 0.012, 12);
          add('cooling', x1 - 33, y0 + 32, FACE.W, 36, 30, 18);
        } else {
          add('ops', x1 - 40, y0 + 34, FACE.S, 40, 30, 40);
        }
        break;
      }
      case 'residential': {
        // the boulevard is the north edge: low frontage keeps it visible from the default camera
        const split = y1 - H * 0.36;
        urban(x0, split, x1, y1, { tower: [30, 40], towerP: 0, midP: 0.45, mid: [12, 17], edge: [x0, split - 300, x1, y1] });
        if (W > 300) {
          urban(x0, y0, x1, split - 6, { tower: [40, 70], towerP: 0.12, midP: 0.62, mid: [18, 34], edge });
        } else courtyard(x0, y0, x1, split - 6, randRange(r, 20, 30));
        break;
      }
      case 'mall': {
        const [cx, cy] = at(0.5, 0.6);
        rect(ground.setColor(0xffffff), x0, cy - 54, x1, y1, CURB_H + 0.01, 12);
        plazaAt(cx - 60, cy - 54, cx + 60, cy - 30, 3);
        plazaAt(x0, cy + 36, x1, y1, 3);
        for (const sx of [-1, 1]) {
          const gx0 = sx < 0 ? x0 + 4 : cx + 62;
          const gx1 = sx < 0 ? cx - 62 : x1 - 4;
          lawn(gx0, cy - 52, gx1, cy - 30, 6);
          scatter(gx0 + 4, cy - 49, gx1 - 4, cy - 33, 9, 0.7);
        }
        add('mall', cx, cy, FACE.S, 84, 66, 25);
        for (const sx of [-1, 1]) row(cx + sx * 74 - 22, cy - 8, cx + sx * 74 + 22, cy + 18, 15, 'S', 'podium');
        parkingLot(x0 + 8, y0 + 8, x1 - 8, cy - 62, 0.66, true);
        palmRow(x0 + 10, cy - 58, x1 - 10, cy - 58, 13, 1.1);
        pool(cx, cy - 48, 30, 6);
        break;
      }
      case 'mosque-park': {
        const [cx, cy] = at(0.32, 0.55);
        mosque(cx, cy);
        plazaAt(cx - 48, cy - 64, cx + 48, cy + 34, 4);
        lawn(x0 + W * 0.62, y0 + 12, x1 - 10, y1 - 12, 14);
        scatter(x0 + W * 0.64, y0 + 16, x1 - 14, y1 - 16, 30, 0.6);
        palmRow(cx - 44, cy - 60, cx + 44, cy - 60, 11, 1);
        parkingLot(x0 + 8, y0 + 8, x0 + W * 0.5, y0 + H * 0.2, 0.5, true);
        break;
      }
      case 'villas': {
        const ps = parcels(x0, y0, x1, y1, 3, 3, 9);
        ps.forEach((pc) => villas(pc[0], pc[1], pc[2], pc[3], edge));
        break;
      }
      case 'park': {
        park(x0, y0, x1, y1);
        break;
      }
      case 'school': {
        const ps = parcels(x0, y0, x1, y1, 2, 2, 9);
        // school buildings and a sports field toward South Street, homes to the south
        const [sa, sb, sc, sd] = ps[2];
        plazaAt(sa, sb, sc, sd, 3);
        row(sa + 6, sd - 26, sc - 6, sd - 4, 12, 'N', 'lowrise');
        row(sa + 4, sb + 30, sa + 24, sd - 32, 12, 'W', 'lowrise');
        lawn(sa + 30, sb + 6, sc - 6, sd - 34, 4);
        scatter(sa + 34, sb + 8, sc - 10, sd - 38, 8, 0.4);
        const [fa, fb, fc, fd] = ps[3];
        const fx = (fa + fc) / 2;
        const fy = (fb + fd) / 2;
        const fw = Math.min(96, fc - fa - 14);
        const fh = Math.min(60, fd - fb - 14);
        rect(ground.setColor(0xffffff), fa, fb, fc, fd, CURB_H + 0.01, 12);
        grass.setColor(0x9bd27a).capH(roundedRect(fx - fw / 2, fy - fh / 2, fx + fw / 2, fy + fh / 2, 2), CURB_H + 0.04, 6);
        stall.setColor(0xffffff);
        stall.rectH(fx, fy, 1, 0, 0.3, fh, CURB_H + 0.06);
        stall.rectH(fx - fw / 2, fy, 0, 1, fh, 0.3, CURB_H + 0.06);
        stall.rectH(fx + fw / 2, fy, 0, 1, fh, 0.3, CURB_H + 0.06);
        stall.rectH(fx, fy - fh / 2, 1, 0, fw, 0.3, CURB_H + 0.06);
        stall.rectH(fx, fy + fh / 2, 1, 0, fw, 0.3, CURB_H + 0.06);
        palmRow(fa + 4, fb + 4, fc - 4, fb + 4, 12, 0.95);
        villas(ps[0][0], ps[0][1], ps[0][2], ps[0][3], edge);
        villas(ps[1][0], ps[1][1], ps[1][2], ps[1][3], edge);
        break;
      }
      case 'clinic': {
        const ps = parcels(x0, y0, x1, y1, 2, 2, 9);
        const [ca, cb, cc, cd] = ps[2];
        plazaAt(ca, cb, cc, cd, 3);
        row(ca + 4, cd - 24, cc - 4, cd - 4, 13, 'N', 'podium');
        parkingLot(ca + 6, cb + 6, cc - 6, cd - 32, 0.5, true);
        const [ra, rb, rc, rd] = ps[3];
        plazaAt(ra, rb, rc, rd, 3);
        row(ra + 4, rd - 24, rc - 4, rd - 4, 15, 'N', 'podium');
        parkingLot(ra + 6, rb + 6, rc - 6, rd - 32, 0.45, false);
        villas(ps[0][0], ps[0][1], ps[0][2], ps[0][3], edge);
        villas(ps[1][0], ps[1][1], ps[1][2], ps[1][3], edge);
        break;
      }
    }
  };

  /** Mosque: prayer hall with a drum and dome, an arcaded courtyard and two minarets. */
  function mosque(cx: number, cy: number) {
    white.setColor(0xf6f0e4);
    white.box(cx, cy, 42, 42, CURB_H, 12.5, 0, 1, 1, true);
    white.box(cx, cy, 44, 44, 12.5, 13.6, 0, 1, 1, true); // parapet cornice
    // arcaded courtyard in front (south): perimeter arcade and an open court
    for (const [ax, ay, aw, ad] of [
      [cx, cy - 50, 48, 4],
      [cx - 22, cy - 35, 4, 30],
      [cx + 22, cy - 35, 4, 30],
    ] as Array<[number, number, number, number]>) {
      white.box(ax, ay, aw, ad, CURB_H, 7.5, 0, 1, 1, true);
    }
    plaza.setColor(0xffffff).quadH(
      [
        [cx - 20, cy - 48],
        [cx + 20, cy - 48],
        [cx + 20, cy - 21],
        [cx - 20, cy - 21],
      ],
      CURB_H + 0.05,
      9.6,
    );
    pool(cx, cy - 34, 6, 6);
    // drum and dome
    const drum = new THREE.CylinderGeometry(12, 12, 4.5, 40, 1, true);
    domeB.setColor(0xf3ecdf).addGeometry(drum, new THREE.Matrix4().makeTranslation(cx, 15.8, -cy));
    const dome = new THREE.SphereGeometry(12.4, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 1.18, 1);
    domeB.addGeometry(dome, new THREE.Matrix4().makeTranslation(cx, 18, -cy));
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const d2 = new THREE.SphereGeometry(4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      domeB.addGeometry(d2, new THREE.Matrix4().makeTranslation(cx + sx * 14, 13.6, -(cy + sy * 14)));
    }
    accent.setColor(0xc9a45c).addGeometry(new THREE.ConeGeometry(0.7, 5, 10), new THREE.Matrix4().makeTranslation(cx, 35.2, -cy));
    accent.addGeometry(new THREE.SphereGeometry(0.9, 12, 8), new THREE.Matrix4().makeTranslation(cx, 33, -cy));
    for (const sx of [-1, 1]) {
      const mx = cx + sx * 27;
      const my = cy - 54;
      white.addGeometry(new THREE.CylinderGeometry(1.7, 2.2, 44, 16), new THREE.Matrix4().makeTranslation(mx, 22, -my));
      white.addGeometry(new THREE.CylinderGeometry(2.9, 2.9, 1.3, 16), new THREE.Matrix4().makeTranslation(mx, 32, -my));
      white.addGeometry(new THREE.CylinderGeometry(2.4, 2.4, 1.0, 16), new THREE.Matrix4().makeTranslation(mx, 41, -my));
      white.addGeometry(new THREE.CylinderGeometry(1.4, 1.4, 4.5, 12), new THREE.Matrix4().makeTranslation(mx, 46.2, -my));
      domeB.addGeometry(new THREE.ConeGeometry(1.8, 5.5, 16), new THREE.Matrix4().makeTranslation(mx, 51.2, -my));
      accent.addGeometry(new THREE.ConeGeometry(0.3, 2.2, 8), new THREE.Matrix4().makeTranslation(mx, 55, -my));
    }
    bounds.push({ x0: cx - 30, y0: cy - 58, x1: cx + 30, y1: cy + 22, h: 52 });
  }

  /** Park: radial paths to a central fountain, lawns, groves, benches and a pavilion. */
  function park(x0: number, y0: number, x1: number, y1: number) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const W = x1 - x0;
    const H = y1 - y0;
    lawn(x0 + 6, y0 + 6, x1 - 6, y1 - 6, 18);
    // radial and ring paths
    const pathAt = (ax: number, ay: number, bx: number, by: number, w: number) => {
      const L = Math.hypot(bx - ax, by - ay);
      plaza.setColor(0xffffff).rectH((ax + bx) / 2, (ay + by) / 2, (bx - ax) / L, (by - ay) / L, L, w, CURB_H + 0.05, 9.6);
    };
    for (const [ex, ey] of [
      [x0 + 10, y0 + 10],
      [x1 - 10, y0 + 10],
      [x0 + 10, y1 - 10],
      [x1 - 10, y1 - 10],
      [cx, y0 + 6],
      [cx, y1 - 6],
      [x0 + 6, cy],
      [x1 - 6, cy],
    ])
      pathAt(cx, cy, ex, ey, 4.5);
    const ring = 0.3 * Math.min(W, H);
    plaza.capH(circle(cx, cy, ring + 3, 64), CURB_H + 0.045, 9.6);
    grass.setColor(0xffffff).capH(circle(cx, cy, ring - 3, 64), CURB_H + 0.055, 6);
    // central fountain: basin, rim and a jet column
    plaza.capH(circle(cx, cy, 20, 48), CURB_H + 0.06, 9.6);
    white.setColor(0xf2ece1).addGeometry(new THREE.CylinderGeometry(15.6, 15.6, 0.8, 48, 1, true), new THREE.Matrix4().makeTranslation(cx, CURB_H + 0.4, -cy));
    water.setColor(0xffffff).capH(circle(cx, cy, 15.5, 48), CURB_H + 0.55, 4);
    white.addGeometry(new THREE.CylinderGeometry(3.2, 4, 1.6, 24), new THREE.Matrix4().makeTranslation(cx, CURB_H + 1.2, -cy));
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      if (k % 2 === 0) palms.push({ x: cx + Math.cos(a) * (ring + 9), y: cy + Math.sin(a) * (ring + 9), s: 1.05, a });
    }
    // groves in the four quarters
    for (const [qx, qy] of [
      [x0 + W * 0.2, y0 + H * 0.22],
      [x1 - W * 0.2, y0 + H * 0.22],
      [x0 + W * 0.2, y1 - H * 0.22],
      [x1 - W * 0.2, y1 - H * 0.22],
    ]) {
      for (let k = 0; k < 14; k++) {
        const a = rand(r) * Math.PI * 2;
        const d = Math.sqrt(rand(r)) * 34;
        if (rand(r) < 0.45) palms.push({ x: qx + Math.cos(a) * d, y: qy + Math.sin(a) * d, s: randRange(r, 0.8, 1.15), a });
        else trees.push({ x: qx + Math.cos(a) * d, y: qy + Math.sin(a) * d, s: randRange(r, 0.8, 1.3) });
      }
    }
    // pavilion and benches
    white.setColor(0xf3eee4).box(x1 - W * 0.16, y1 - H * 0.1, 16, 9, CURB_H, 4.4, 0, 1, 1, true);
    dark.setColor(0x5b5f63).box(x1 - W * 0.16, y1 - H * 0.1, 19, 12, CURB_H + 4.4, CURB_H + 4.75, 0, 1, 1, true);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.13;
      benches.push({ x: cx + Math.cos(a) * (ring + 5.5), y: cy + Math.sin(a) * (ring + 5.5), a: a + Math.PI / 2 });
    }
  }

  // ---------------------------------------------------------------- blocks
  for (let ci = 0; ci < xs.length; ci++) {
    for (let ri = 0; ri < ys.length; ri++) {
      const [bx0, bx1] = xs[ci];
      const [by0, by1] = ys[ri];
      const outer = roundedRect(bx0, by0, bx1, by1, 7, 6);
      const inner = roundedRect(bx0 + SIDEWALK, by0 + SIDEWALK, bx1 - SIDEWALK, by1 - SIDEWALK, 3, 4);
      curb.setColor(0xffffff).prism(outer, 0, CURB_H, 1, 1, false);
      sidewalk.setColor(0xffffff).shapeH(outer, [inner], CURB_H, 4.8);
      ground.setColor(0xffffff).capH(inner, CURB_H, 12);
      const prog = PROGRAMS[ci]?.[ri];
      if (prog) build(prog, bx0 + SIDEWALK + 6, by0 + SIDEWALK + 6, bx1 - SIDEWALK - 6, by1 - SIDEWALK - 6, ci);
      // street trees every ~24 m along the inner edge of the sidewalk: palms and shade trees
      const per = 24;
      const edges: Array<[number, number, number, number]> = [
        [bx0 + 12, by0 + 2.6, bx1 - 12, by0 + 2.6],
        [bx0 + 12, by1 - 2.6, bx1 - 12, by1 - 2.6],
        [bx0 + 2.6, by0 + 12, bx0 + 2.6, by1 - 12],
        [bx1 - 2.6, by0 + 12, bx1 - 2.6, by1 - 12],
      ];
      for (const [ax, ay, ex, ey] of edges) {
        const L = Math.hypot(ex - ax, ey - ay);
        const n = Math.floor(L / per);
        for (let k = 0; k <= n; k++) {
          const f = n === 0 ? 0.5 : k / n;
          const x = ax + (ex - ax) * f;
          const y = ay + (ey - ay) * f;
          if (Math.abs(x) > X_EDGE + 120 || Math.abs(y) > Y_EDGE + 120) continue;
          if ((k + ci + ri) % 2 === 0) palms.push({ x, y, s: 0.95, a: rand(r) * 6.28, h: CURB_H });
          else trees.push({ x, y, s: 0.75, h: CURB_H });
        }
      }
    }
  }

  // ---------------------------------------------------------------- materials
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
  const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const materials: Record<string, THREE.Material> = {
    sidewalk: std({ map: tex.paving, roughness: 0.88 }),
    ground: std({ map: tex.ground, roughness: 0.96 }),
    plaza: std({ map: tex.plaza, roughness: 0.78, ...decal }),
    curb: std({ color: 0xd2cabd, roughness: 0.82 }),
    grass: std({ map: tex.grass, roughness: 0.94, color: 0xb9cf8f, ...decal }),
    parking: std({ map: tex.asphalt, roughness: 0.9, color: 0x8d9094, ...decal }),
    lanes: std({ map: tex.asphalt, roughness: 0.92, color: 0xa7a8aa, ...decal }),
    stall: std({ roughness: 0.7, color: 0xeeece6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    water: std({ color: 0x2c8fb0, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.6, emissive: 0x062a3a, ...decal }),
    white: std({ roughness: 0.72 }),
    wall: std({ roughness: 0.85 }),
    dome: std({ roughness: 0.38, metalness: 0.08 }),
    accent: std({ roughness: 0.28, metalness: 0.85 }),
    dark: std({ roughness: 0.55, metalness: 0.4 }),
    solar: std({ color: 0x3a5582, roughness: 0.22, metalness: 0.6, envMapIntensity: 1.5 }),
  };

  const mesh = (b: GeoBuilder, m: THREE.Material, name: string, cast: boolean, receive = true) => {
    if (b.empty) return;
    const me = new THREE.Mesh(b.build(), m);
    me.name = name;
    me.castShadow = cast;
    me.receiveShadow = receive;
    me.matrixAutoUpdate = false;
    me.updateMatrix();
    group.add(me);
  };
  mesh(curb, materials.curb, 'curbs', false);
  mesh(sidewalk, materials.sidewalk, 'sidewalks', false);
  mesh(ground, materials.ground, 'plots', false);
  mesh(plaza, materials.plaza, 'plazas', false);
  mesh(grass, materials.grass, 'lawns', false);
  mesh(parking, materials.parking, 'parking', false);
  mesh(lanes, materials.lanes, 'access-lanes', false);
  mesh(stall, materials.stall, 'stalls', false);
  mesh(water, materials.water, 'water', false);
  mesh(white, materials.white, 'white-structures', true);
  mesh(wall, materials.wall, 'garden-walls', true);
  mesh(domeB, materials.dome, 'domes', true);
  mesh(accent, materials.accent, 'accents', true);
  mesh(dark, materials.dark, 'canopy-frames', true);
  mesh(solar, materials.solar, 'solar-carports', true);

  return { group, specs, trees, palms, parked, benches, bounds, materials };
}

/** Circle polygon (counter-clockwise). */
function circle(cx: number, cy: number, rad: number, n: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return pts;
}

export type { RngState };
