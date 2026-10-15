import * as THREE from 'three';
import type { Network } from '../../core/network/types';
import { X_EDGE, Y_EDGE } from '../../core/network/district';
import { makeRng, rand, randRange, type RngState } from '../../core/rng';
import { GeoBuilder, roundedRect } from './builder';
import { CURB_H } from './roads';

/* City blocks between the roads: raised sidewalks, plots and the buildings on them.
   Land use is art-directed per block (towers to the north, low-rise to the south so the default
   camera keeps the streets in view) and the details are seeded, so the city is identical on every
   load. */

export interface Spot {
  x: number;
  y: number;
  h?: number; // base height
  s?: number; // scale
  a?: number; // rotation (rad)
  kind?: string;
}

export interface BlockOutput {
  group: THREE.Group;
  trees: Spot[]; // shade trees
  palms: Spot[];
  parked: Spot[]; // parked car positions with heading
  bounds: Array<{ x0: number; y0: number; x1: number; y1: number; h: number }>; // building boxes for camera collision
  materials: Record<string, THREE.Material>;
}

export interface FacadeSet {
  glass: { map: THREE.Texture; emissive: THREE.Texture; tileW: number; tileH: number };
  stone: { map: THREE.Texture; emissive: THREE.Texture; tileW: number; tileH: number };
  office: { map: THREE.Texture; emissive: THREE.Texture; tileW: number; tileH: number };
  podium: { map: THREE.Texture; emissive: THREE.Texture; tileW: number; tileH: number };
  paving: THREE.Texture;
  plot: THREE.Texture;
  grass: THREE.Texture;
  asphalt: THREE.Texture;
  helipad: THREE.Texture;
  hospital: THREE.Texture;
}

const SIDEWALK = 5.5;

type ParcelKind = 'tower' | 'slabs' | 'courtyard' | 'deck' | 'garden' | 'retail' | 'villas';

type Program =
  | 'hospital'
  | 'towers-tall'
  | 'towers-landmark'
  | 'towers-spire'
  | 'boulevard-towers'
  | 'mixed-mid'
  | 'residential-mid'
  | 'mall'
  | 'mosque-park'
  | 'villas'
  | 'park'
  | 'school'
  | 'clinic';

// [column][row], column 0 = west, row 0 = south
const PROGRAMS: Program[][] = [
  ['villas', 'residential-mid', 'mixed-mid', 'hospital'],
  ['park', 'mosque-park', 'boulevard-towers', 'towers-tall'],
  ['school', 'mall', 'boulevard-towers', 'towers-landmark'],
  ['clinic', 'residential-mid', 'boulevard-towers', 'towers-spire'],
  ['villas', 'residential-mid', 'mixed-mid', 'towers-tall'],
];

const GLASS_TINTS = [0xe8f1f8, 0xd8e8ef, 0xf3e6d6, 0xdfeee4, 0xc9d6e6, 0xf6efe6];
const STONE_TINTS = [0xfff7ea, 0xf3e3c8, 0xe9d4b3, 0xfaf3ec, 0xe2c9a6, 0xf1e9dc];

export function buildBlocks(net: Network, tex: FacadeSet): BlockOutput {
  const group = new THREE.Group();
  group.name = 'blocks';
  const r = makeRng(2027, 'city-blocks');

  const sidewalk = new GeoBuilder();
  const plot = new GeoBuilder();
  const curb = new GeoBuilder();
  const glass = new GeoBuilder();
  const stone = new GeoBuilder();
  const office = new GeoBuilder();
  const podium = new GeoBuilder();
  const roof = new GeoBuilder();
  const white = new GeoBuilder();
  const grass = new GeoBuilder();
  const parking = new GeoBuilder();
  const lanes = new GeoBuilder();
  const stall = new GeoBuilder();
  const water = new GeoBuilder();
  const dark = new GeoBuilder();
  const accent = new GeoBuilder();
  const helipad = new GeoBuilder();
  const sign = new GeoBuilder();
  const domeB = new GeoBuilder();

  const trees: Spot[] = [];
  const palms: Spot[] = [];
  const parked: Spot[] = [];
  const bounds: BlockOutput['bounds'] = [];

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

  // ---------------------------------------------------------------- building helpers
  const tint = (b: GeoBuilder, list: number[]) => b.setColor(list[Math.floor(rand(r) * list.length)]);

  /** A tower: shaft with optional setbacks, a crown band and rooftop plant. Returns the top height. */
  const tower = (
    cx: number,
    cy: number,
    w: number,
    d: number,
    h: number,
    mat: 'glass' | 'office' | 'stone',
    opts: { setbacks?: number; rot?: number; crown?: boolean; podiumH?: number } = {},
  ): number => {
    const b = mat === 'glass' ? glass : mat === 'office' ? office : stone;
    const t = mat === 'glass' ? tex.glass : mat === 'office' ? tex.office : tex.stone;
    tint(b, mat === 'glass' ? GLASS_TINTS : STONE_TINTS);
    const rot = opts.rot ?? 0;
    let z = 0;
    if (opts.podiumH) {
      podium.setColor(0xffffff);
      podium.box(cx, cy, w + 14, d + 14, 0, opts.podiumH, rot, tex.podium.tileW, tex.podium.tileH, false);
      roof.setColor(0xb7b1a7).box(cx, cy, w + 14, d + 14, opts.podiumH - 0.01, opts.podiumH, rot, 1, 1, true);
      z = opts.podiumH;
    }
    const tiers = opts.setbacks ?? 0;
    let cw = w;
    let cd = d;
    const tierH = (h - z) / (tiers + 1);
    for (let i = 0; i <= tiers; i++) {
      const top = i === tiers ? h : z + tierH;
      b.box(cx, cy, cw, cd, z, top, rot, t.tileW, t.tileH, false);
      roof.setColor(0xaaa49a).box(cx, cy, cw, cd, top - 0.01, top, rot, 1, 1, true);
      z = top;
      cw *= 0.82;
      cd *= 0.82;
    }
    if (opts.crown !== false) {
      // crown: a lighter band and a parapet
      accent.setColor(0xe9edf1).box(cx, cy, cw / 0.82 + 0.6, cd / 0.82 + 0.6, z - 3.5, z + 1.2, rot, 1, 1, false);
      dark.setColor(0x5b636d).box(cx + cw * 0.15, cy - cd * 0.1, cw * 0.35, cd * 0.3, z, z + 3.2, rot);
    }
    bounds.push({ x0: cx - w / 2 - 7, y0: cy - d / 2 - 7, x1: cx + w / 2 + 7, y1: cy + d / 2 + 7, h });
    return z;
  };

  const slab = (cx: number, cy: number, w: number, d: number, h: number, rot = 0, balconies = true) => {
    const b = balconies ? stone : office;
    const t = balconies ? tex.stone : tex.office;
    tint(b, STONE_TINTS);
    b.box(cx, cy, w, d, 0, h, rot, t.tileW, t.tileH, false);
    roof.setColor(0xb3ada3).box(cx, cy, w, d, h - 0.01, h, rot, 1, 1, true);
    // rooftop units
    dark.setColor(0x7b8188).box(cx - w * 0.2, cy, Math.min(8, w * 0.25), Math.min(6, d * 0.3), h, h + 2.4, rot);
    bounds.push({ x0: cx - w / 2, y0: cy - d / 2, x1: cx + w / 2, y1: cy + d / 2, h });
  };

  const villa = (cx: number, cy: number, rot: number) => {
    white.setColor(STONE_TINTS[Math.floor(rand(r) * STONE_TINTS.length)]);
    const w = randRange(r, 13, 17);
    const d = randRange(r, 10, 13);
    white.box(cx, cy, w, d, 0, 7.2, rot, 1, 1, true);
    white.box(cx + Math.cos(rot) * (w * 0.32), cy + Math.sin(rot) * (w * 0.32), w * 0.4, d * 0.7, 7.2, 10, rot, 1, 1, true);
    // boundary wall and pool
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const px = cx - c * 0 - s * (d * 0.95);
    const py = cy - s * 0 + c * (d * 0.95);
    water.setColor(0x58b9d6).box(px, py, 8, 4, 0.02, 0.1, rot);
    trees.push({ x: cx + c * (w * 0.7), y: cy + s * (w * 0.7), s: randRange(r, 0.7, 1.0) });
    if (rand(r) > 0.5) palms.push({ x: cx - c * (w * 0.7), y: cy - s * (w * 0.7), s: randRange(r, 0.8, 1.1), a: rand(r) * 6.28 });
  };

  const parkingLot = (x0: number, y0: number, x1: number, y1: number, fill: number) => {
    parking.setColor(0xffffff).quadH(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      CURB_H + 0.02,
      8,
    );
    // rows of stalls along x, aisles between double rows
    const rowsY: number[] = [];
    for (let y = y0 + 3; y + 5 < y1; y += 16) {
      rowsY.push(y);
      if (y + 11 < y1) rowsY.push(y + 11);
    }
    for (const y of rowsY) {
      for (let x = x0 + 2; x + 2.6 < x1; x += 2.6) {
        stall.rectH(x, y + 2.5, 0, 1, 5, 0.12, CURB_H + 0.04);
        if (rand(r) < fill) {
          parked.push({ x: x + 1.3, y: y + 2.5, a: Math.PI / 2 + (rand(r) > 0.5 ? Math.PI : 0), h: CURB_H + 0.02 });
        }
      }
    }
  };

  const lawn = (x0: number, y0: number, x1: number, y1: number, rad = 4) => {
    grass.setColor(0xffffff).capH(roundedRect(x0, y0, x1, y1, rad), CURB_H + 0.03, 6);
  };

  const scatterTrees = (x0: number, y0: number, x1: number, y1: number, n: number, palmShare = 0.3) => {
    for (let i = 0; i < n; i++) {
      const x = randRange(r, x0, x1);
      const y = randRange(r, y0, y1);
      if (rand(r) < palmShare) palms.push({ x, y, s: randRange(r, 0.8, 1.15), a: rand(r) * 6.28 });
      else trees.push({ x, y, s: randRange(r, 0.7, 1.25) });
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

  const gardenRing = (pc: [number, number, number, number]) => {
    const [a, b, c, d] = pc;
    lawn(a + 3, b + 3, c - 3, d - 3, 8);
    scatterTrees(a + 6, b + 6, c - 6, d - 6, 9, 0.6);
  };

  /** Fill one parcel. `front` is the side facing the main road, where towers lean. */
  const fillParcel = (kind: ParcelKind, pc: [number, number, number, number], minH: number, maxH: number, front?: 'N' | 'S') => {
    const [a, b, c, d] = pc;
    const w = c - a;
    const h = d - b;
    const cx = (a + c) / 2;
    const cy = (b + d) / 2;
    switch (kind) {
      case 'tower': {
        const pod = randRange(r, 7, 11);
        podium.setColor(0xffffff).box(cx, cy, w - 8, h - 8, 0, pod, 0, tex.podium.tileW, tex.podium.tileH, false);
        roof.setColor(0xb9b3a9).box(cx, cy, w - 8, h - 8, pod - 0.01, pod, 0, 1, 1, true);
        const side = Math.min(44, Math.min(w, h) * 0.55);
        const tw = side * randRange(r, 0.82, 1);
        const td = side * randRange(r, 0.82, 1);
        const shift = front === 'S' ? -(h - td) * 0.22 : front === 'N' ? (h - td) * 0.22 : 0;
        const mat = rand(r) > 0.32 ? 'glass' : 'office';
        tower(cx + (rand(r) - 0.5) * (w - tw) * 0.3, cy + shift, tw, td, randRange(r, minH, maxH), mat, {
          setbacks: rand(r) > 0.5 ? 1 : 2,
          rot: rand(r) > 0.75 ? Math.PI / 4 : 0,
        });
        if (rand(r) > 0.4) scatterTrees(a + 8, b + 8, c - 8, d - 8, 4, 0.6);
        break;
      }
      case 'slabs': {
        const along = w >= h;
        const len = (along ? w : h) - 12;
        const depth = randRange(r, 15, 19);
        const gap = Math.max(14, (along ? h : w) - depth * 2 - 14);
        for (const sgn of [-1, 1]) {
          const off = sgn * (gap / 2 + depth / 2);
          const sx = along ? cx : cx + off;
          const sy = along ? cy + off : cy;
          slab(sx, sy, along ? len : depth, along ? depth : len, randRange(r, minH, maxH), 0, true);
        }
        const gx = along ? len / 2 : gap / 2 - 2;
        const gy = along ? gap / 2 - 2 : len / 2;
        lawn(cx - gx, cy - gy, cx + gx, cy + gy, 3);
        scatterTrees(cx - 10, cy - 6, cx + 10, cy + 6, 4, 0.5);
        break;
      }
      case 'courtyard': {
        const ht = randRange(r, minH, maxH);
        const dep = 16;
        slab(cx, b + 6 + dep / 2, w - 12, dep, ht, 0, true);
        slab(cx, d - 6 - dep / 2, w - 12, dep, ht * randRange(r, 0.8, 1), 0, true);
        slab(a + 6 + dep / 2, cy, dep, h - 12 - dep * 2, ht * randRange(r, 0.7, 0.95), 0, true);
        slab(c - 6 - dep / 2, cy, dep, h - 12 - dep * 2, ht * randRange(r, 0.7, 0.95), 0, true);
        lawn(a + 6 + dep + 2, b + 6 + dep + 2, c - 6 - dep - 2, d - 6 - dep - 2, 4);
        water.setColor(0x58b9d6).box(cx, cy, Math.min(14, w * 0.2), Math.min(7, h * 0.12), CURB_H + 0.04, CURB_H + 0.12);
        scatterTrees(a + 26, b + 26, c - 26, d - 26, 6, 0.5);
        break;
      }
      case 'deck': {
        const hh = randRange(r, minH, maxH);
        office.setColor(0xcfc9be).box(cx, cy, w - 10, h - 10, 0, hh, 0, tex.office.tileW, tex.office.tileH * 0.6, false);
        roof.setColor(0x8f9399).box(cx, cy, w - 10, h - 10, hh - 0.01, hh, 0, 1, 1, true);
        bounds.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, h: hh });
        break;
      }
      case 'garden':
        gardenRing(pc);
        white.setColor(0xf1ebde).box(cx, cy, 12, 8, 0, 4.5, 0.4, 1, 1, true);
        break;
      case 'retail': {
        const hh = randRange(r, minH, maxH);
        podium.setColor(0xffffff).box(cx, cy + h * 0.12, w - 10, h * 0.5, 0, hh, 0, tex.podium.tileW, tex.podium.tileH, false);
        roof.setColor(0xb9b3a9).box(cx, cy + h * 0.12, w - 10, h * 0.5, hh - 0.01, hh, 0, 1, 1, true);
        bounds.push({ x0: a, y0: cy - h * 0.13, x1: c, y1: cy + h * 0.37, h: hh });
        parkingLot(a + 4, b + 3, c - 4, cy - h * 0.16, 0.55);
        break;
      }
      case 'villas': {
        const nx = Math.max(1, Math.floor((w - 8) / 32));
        const ny = Math.max(1, Math.floor((h - 8) / 30));
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < ny; j++) {
            if (rand(r) < 0.1) continue;
            villa(a + 4 + (i + 0.5) * ((w - 8) / nx), b + 4 + (j + 0.5) * ((h - 8) / ny), 0);
          }
        }
        break;
      }
    }
  };

  // ---------------------------------------------------------------- programs
  const build = (prog: Program, x0: number, y0: number, x1: number, y1: number, ci: number) => {
    const W = x1 - x0;
    const H = y1 - y0;
    const at = (u: number, v: number): [number, number] => [x0 + u * W, y0 + v * H];
    switch (prog) {
      case 'hospital': {
        // main block near West Road (east side of this cell), ambulance bay to the road
        const [hx, hy] = at(0.72, 0.42);
        white.setColor(0xf7f6f2);
        white.box(hx, hy, 46, 96, 0, 26, 0, 1, 1, true);
        glass.setColor(0xcfe3ef).box(hx, hy, 46.4, 96.4, 6, 9, 0, tex.glass.tileW, tex.glass.tileH, false);
        glass.box(hx, hy, 46.4, 96.4, 15, 18, 0, tex.glass.tileW, tex.glass.tileH, false);
        white.box(hx - 46, hy + 22, 50, 34, 0, 18, 0, 1, 1, true);
        helipad.setColor(0xffffff).quadH(
          [
            [hx - 14, hy - 14],
            [hx + 14, hy - 14],
            [hx + 14, hy + 14],
            [hx - 14, hy + 14],
          ],
          26.05,
          28,
        );
        // illuminated H sign on the road-facing wall
        sign.setColor(0xffffff);
        sign.wall(hx + 23.3, hy - 42, hx + 23.3, hy - 30, 18, 30, 12, 12);
        // ambulance canopy
        dark.setColor(0x8a939c).box(hx + 30, hy - 20, 14, 22, 5, 5.6);
        bounds.push({ x0: hx - 73, y0: hy - 48, x1: hx + 23, y1: hy + 48, h: 26 });
        parkingLot(x0 + 12, y0 + 12, x0 + W * 0.45, y0 + H * 0.3, 0.7);
        scatterTrees(x0 + 10, y1 - 70, x0 + W * 0.5, y1 - 10, 14, 0.5);
        break;
      }
      case 'towers-tall':
      case 'towers-landmark':
      case 'towers-spire': {
        // 2 x 2 parcels of towers on podiums; landmarks take one parcel each
        const ps = parcels(x0, y0, x1, y1, 2, 2, 10);
        ps.forEach((pc, i) => {
          if (prog === 'towers-landmark' && i === 2) {
            twisted((pc[0] + pc[2]) / 2, (pc[1] + pc[3]) / 2, 34, 176);
            gardenRing(pc);
            return;
          }
          if (prog === 'towers-spire' && i === 3) {
            spire((pc[0] + pc[2]) / 2, (pc[1] + pc[3]) / 2);
            gardenRing(pc);
            return;
          }
          if (i === 1 && prog === 'towers-tall') {
            fillParcel('deck', pc, 12, 16);
            return;
          }
          fillParcel('tower', pc, 110, 175, 'S');
        });
        break;
      }
      case 'boulevard-towers': {
        // front row on the boulevard (south side of this cell): towers; back row: mid-rise
        const ps = parcels(x0, y0, x1, y1, 3, 2, 9);
        ps.forEach((pc, i) => {
          const front = i < 3;
          if (front) fillParcel('tower', pc, 72, 138, 'S');
          else fillParcel((i + ci) % 2 === 0 ? 'courtyard' : 'slabs', pc, 18, 30);
        });
        break;
      }
      case 'mixed-mid': {
        const ps = parcels(x0, y0, x1, y1, 2, 3, 9);
        ps.forEach((pc, i) => {
          const kinds: ParcelKind[] = ['tower', 'slabs', 'courtyard', 'deck', 'slabs', 'tower'];
          fillParcel(kinds[(i + ci) % kinds.length], pc, 24, 62, 'S');
        });
        break;
      }
      case 'residential-mid': {
        // the boulevard is the north edge of this cell: keep its frontage low so it stays visible
        const ps = parcels(x0, y0, x1, y1, 3, 2, 9);
        ps.forEach((pc, i) => {
          const nearBlvd = i >= 3;
          if (nearBlvd) fillParcel((i + ci) % 3 === 0 ? 'garden' : 'retail', pc, 6, 11);
          else fillParcel((i + ci) % 2 === 0 ? 'courtyard' : 'slabs', pc, 18, 40);
        });
        break;
      }
      case 'mall': {
        const [cx, cy] = at(0.5, 0.64);
        podium.setColor(0xffffff).box(cx, cy, 200, 92, 0, 16, 0, tex.podium.tileW, tex.podium.tileH * 1.45, false);
        roof.setColor(0xbcb6ac).box(cx, cy, 200, 92, 15.99, 16, 0, 1, 1, true);
        glass.setColor(0xdbe9f0).box(cx, cy, 70, 30, 16, 22, 0, tex.glass.tileW, tex.glass.tileH, true);
        accent.setColor(0xece6da).box(cx, cy - 50, 60, 10, 6, 7, 0);
        bounds.push({ x0: cx - 100, y0: cy - 46, x1: cx + 100, y1: cy + 46, h: 22 });
        parkingLot(x0 + 14, y0 + 12, x1 - 14, y0 + H * 0.36, 0.62);
        for (let i = 0; i < 12; i++) palms.push({ x: x0 + 20 + i * ((W - 40) / 11), y: y0 + H * 0.4, s: 1, a: rand(r) * 6.28 });
        break;
      }
      case 'mosque-park': {
        const [cx, cy] = at(0.36, 0.52);
        white.setColor(0xf5efe3);
        white.box(cx, cy, 40, 40, 0, 11, 0, 1, 1, true);
        white.box(cx, cy - 30, 54, 18, 0, 7, 0, 1, 1, true); // courtyard arcade
        // drum and dome
        const drum = new THREE.CylinderGeometry(11, 11, 4, 32, 1, true);
        domeB.setColor(0xf4eee2).addGeometry(drum, new THREE.Matrix4().makeTranslation(cx, 13, -cy));
        const dome = new THREE.SphereGeometry(11, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2);
        domeB.addGeometry(dome, new THREE.Matrix4().makeTranslation(cx, 15, -cy));
        const finial = new THREE.ConeGeometry(0.8, 4, 8);
        accent.setColor(0xc8a35a).addGeometry(finial, new THREE.Matrix4().makeTranslation(cx, 27.5, -cy));
        for (const sx of [-1, 1]) {
          const mx = cx + sx * 27;
          const my = cy - 38;
          const shaft = new THREE.CylinderGeometry(1.6, 2.0, 40, 12);
          white.addGeometry(shaft, new THREE.Matrix4().makeTranslation(mx, 20, -my));
          const balcony = new THREE.CylinderGeometry(2.6, 2.6, 1.2, 12);
          white.addGeometry(balcony, new THREE.Matrix4().makeTranslation(mx, 31, -my));
          const cap = new THREE.ConeGeometry(1.9, 6, 12);
          domeB.addGeometry(cap, new THREE.Matrix4().makeTranslation(mx, 43, -my));
        }
        bounds.push({ x0: cx - 30, y0: cy - 42, x1: cx + 30, y1: cy + 22, h: 46 });
        lawn(x0 + W * 0.6, y0 + 14, x1 - 12, y1 - 14, 12);
        scatterTrees(x0 + W * 0.62, y0 + 18, x1 - 16, y1 - 18, 26, 0.6);
        parkingLot(x0 + 12, y0 + 12, x0 + W * 0.5, y0 + H * 0.2, 0.5);
        break;
      }
      case 'villas': {
        const ps = parcels(x0, y0, x1, y1, 2, 2, 8);
        ps.forEach((pc) => fillParcel('villas', pc, 7, 10));
        break;
      }
      case 'park': {
        lawn(x0 + 8, y0 + 8, x1 - 8, y1 - 8, 16);
        // paths cross the park diagonally
        plot.setColor(0xffffff);
        plot.rectH((x0 + x1) / 2, (y0 + y1) / 2, 0.75, 0.66, Math.hypot(W, H) * 0.92, 4, CURB_H + 0.05, 24);
        plot.rectH((x0 + x1) / 2, (y0 + y1) / 2, 0.75, -0.66, Math.hypot(W, H) * 0.92, 4, CURB_H + 0.05, 24);
        water.setColor(0x4fb0cc).capH(roundedRect((x0 + x1) / 2 - 14, (y0 + y1) / 2 - 9, (x0 + x1) / 2 + 14, (y0 + y1) / 2 + 9, 9, 8), CURB_H + 0.07, 6);
        scatterTrees(x0 + 16, y0 + 16, x1 - 16, y1 - 16, 70, 0.35);
        white.setColor(0xf2ece0).box(x0 + W * 0.8, y0 + H * 0.78, 16, 10, 0, 5, 0.3, 1, 1, true);
        break;
      }
      case 'school': {
        // north parcels on South Street: school buildings and a sports field; south parcels: homes
        const ps = parcels(x0, y0, x1, y1, 2, 2, 9);
        const [sa, sb, sc, sd] = ps[2];
        const cx = (sa + sc) / 2;
        const cy = (sb + sd) / 2;
        white.setColor(0xf3e6cf);
        white.box(cx, cy + 22, sc - sa - 24, 18, 0, 9, 0, 1, 1, true);
        white.box(sa + 20, cy - 8, 18, sd - sb - 70, 0, 9, 0, 1, 1, true);
        white.box(sc - 22, cy - 14, 26, 30, 0, 12, 0, 1, 1, true);
        bounds.push({ x0: sa + 10, y0: sb + 10, x1: sc - 10, y1: sd - 10, h: 12 });
        scatterTrees(cx - 30, cy - 34, cx + 20, cy + 6, 10, 0.5);
        const [fa, fb, fc, fd] = ps[3];
        const fx = (fa + fc) / 2;
        const fy = (fb + fd) / 2;
        const fw = Math.min(90, fc - fa - 16);
        const fh = Math.min(56, fd - fb - 16);
        grass.setColor(0x9ac27a).capH(roundedRect(fx - fw / 2, fy - fh / 2, fx + fw / 2, fy + fh / 2, 2), CURB_H + 0.04, 6);
        stall.setColor(0xffffff);
        stall.rectH(fx, fy, 1, 0, 0.3, fh, CURB_H + 0.06);
        stall.rectH(fx - fw / 2, fy, 0, 1, fh, 0.3, CURB_H + 0.06);
        stall.rectH(fx + fw / 2, fy, 0, 1, fh, 0.3, CURB_H + 0.06);
        stall.rectH(fx, fy - fh / 2, 1, 0, fw, 0.3, CURB_H + 0.06);
        stall.rectH(fx, fy + fh / 2, 1, 0, fw, 0.3, CURB_H + 0.06);
        fillParcel('villas', ps[0], 7, 10);
        fillParcel('garden', ps[1], 4, 5);
        break;
      }
      case 'clinic': {
        // frontage on South Street (north edge of this cell): clinic and pharmacy retail; homes behind
        const ps = parcels(x0, y0, x1, y1, 2, 2, 9);
        const [ca, cb, cc, cd] = ps[2];
        const cx = (ca + cc) / 2;
        const cy = (cb + cd) / 2 + 18;
        white.setColor(0xf7f5f0);
        white.box(cx, cy, cc - ca - 20, 22, 0, 11, 0, 1, 1, true);
        glass.setColor(0xd6e6ee).box(cx, cy, cc - ca - 19.6, 22.4, 3, 7.5, 0, tex.glass.tileW, tex.glass.tileH, false);
        bounds.push({ x0: ca + 10, y0: cy - 11, x1: cc - 10, y1: cy + 11, h: 11 });
        parkingLot(ca + 6, cb + 6, cc - 6, cy - 16, 0.5);
        fillParcel('retail', ps[3], 7, 10);
        fillParcel('villas', ps[0], 7, 10);
        fillParcel('villas', ps[1], 7, 10);
        break;
      }
    }
  };

  /** Twisting glass tower (landmark): stacked floor plates each rotated a little. */
  const twisted = (cx: number, cy: number, w: number, h: number) => {
    const floors = 44;
    const fh = h / floors;
    glass.setColor(0xdff0f7);
    for (let i = 0; i < floors; i++) {
      const a = (i / floors) * (Math.PI / 2);
      glass.box(cx, cy, w, w, i * fh, (i + 1) * fh + 0.05, a, tex.glass.tileW, tex.glass.tileH, false);
    }
    roof.setColor(0xaca69c).box(cx, cy, w, w, h, h + 0.1, Math.PI / 2);
    accent.setColor(0xf2f5f8).box(cx, cy, w * 0.5, w * 0.5, h, h + 9, Math.PI / 2 + 0.2);
    bounds.push({ x0: cx - w * 0.72, y0: cy - w * 0.72, x1: cx + w * 0.72, y1: cy + w * 0.72, h });
  };

  /** Stepped spire tower (the district's tallest), a Dubai-inspired silhouette, not a replica. */
  const spire = (cx: number, cy: number) => {
    let z = 0;
    const tiers: Array<[number, number]> = [
      [46, 62],
      [38, 48],
      [30, 40],
      [22, 30],
      [14, 22],
    ];
    glass.setColor(0xe6eef4);
    for (const [w, th] of tiers) {
      glass.box(cx, cy, w, w, z, z + th, Math.PI / 4, tex.glass.tileW, tex.glass.tileH, false);
      roof.setColor(0xb0aaa0).box(cx, cy, w, w, z + th - 0.01, z + th, Math.PI / 4, 1, 1, true);
      z += th;
    }
    const sp = new THREE.CylinderGeometry(0.6, 3.2, 48, 10);
    accent.setColor(0xf5f7f9).addGeometry(sp, new THREE.Matrix4().makeTranslation(cx, z + 24, -cy));
    bounds.push({ x0: cx - 33, y0: cy - 33, x1: cx + 33, y1: cy + 33, h: z });
  };

  // ---------------------------------------------------------------- blocks
  for (let ci = 0; ci < xs.length; ci++) {
    for (let ri = 0; ri < ys.length; ri++) {
      const [bx0, bx1] = xs[ci];
      const [by0, by1] = ys[ri];
      const outer = roundedRect(bx0, by0, bx1, by1, 7, 6);
      const inner = roundedRect(bx0 + SIDEWALK, by0 + SIDEWALK, bx1 - SIDEWALK, by1 - SIDEWALK, 3, 4);
      curb.setColor(0xffffff).prism(outer, 0, CURB_H, 1, 1, false);
      sidewalk.setColor(0xffffff).shapeH(outer, [inner], CURB_H, 4.8);
      plot.setColor(0xffffff).capH(inner, CURB_H, 24);
      const prog = PROGRAMS[ci]?.[ri];
      if (prog) build(prog, bx0 + SIDEWALK + 6, by0 + SIDEWALK + 6, bx1 - SIDEWALK - 6, by1 - SIDEWALK - 6, ci);
      // sidewalk trees every ~24 m along the inner edge of the sidewalk
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
  const materials: Record<string, THREE.Material> = {
    sidewalk: std({ map: tex.paving, roughness: 0.9 }),
    plot: std({ map: tex.paving, roughness: 0.92, color: 0xd5cfc4 }),
    curb: std({ color: 0xc9c1b3, roughness: 0.85 }),
    glass: std({
      map: tex.glass.map,
      emissiveMap: tex.glass.emissive,
      emissive: 0x000000,
      metalness: 0.5,
      roughness: 0.1,
      envMapIntensity: 2.1,
    }),
    stone: std({ map: tex.stone.map, emissiveMap: tex.stone.emissive, emissive: 0x000000, roughness: 0.82 }),
    office: std({ map: tex.office.map, emissiveMap: tex.office.emissive, emissive: 0x000000, roughness: 0.72, metalness: 0.1 }),
    podium: std({ map: tex.podium.map, emissiveMap: tex.podium.emissive, emissive: 0x000000, roughness: 0.7 }),
    roof: std({ roughness: 0.95 }),
    white: std({ roughness: 0.78 }),
    dome: std({ roughness: 0.42, metalness: 0.05 }),
    grass: std({ map: tex.grass, roughness: 0.96, color: 0xc8d6a8 }),
    parking: std({ map: tex.asphalt, roughness: 0.92, color: 0x777b80 }),
    lanes: std({ map: tex.plot, roughness: 0.94, color: 0xa9a297 }),
    stall: std({ roughness: 0.7, color: 0xe8e6df, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    water: std({ roughness: 0.06, metalness: 0.3, envMapIntensity: 1.6 }),
    dark: std({ roughness: 0.6, metalness: 0.3 }),
    accent: std({ roughness: 0.35, metalness: 0.55 }),
    helipad: std({ map: tex.helipad, roughness: 0.8 }),
    sign: new THREE.MeshStandardMaterial({ map: tex.hospital, emissiveMap: tex.hospital, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }),
  };
  // the helipad and sign quads need UVs 0..1 across the decal
  fitUv(helipad, 28);
  fitUv(sign, 12, true);

  const add = (b: GeoBuilder, m: THREE.Material, name: string, cast: boolean, receive = true) => {
    if (b.empty) return;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  };
  add(curb, materials.curb, 'curbs', false);
  add(sidewalk, materials.sidewalk, 'sidewalks', false);
  add(plot, materials.plot, 'plots', false);
  add(grass, materials.grass, 'lawns', false);
  add(parking, materials.parking, 'parking', false);
  add(lanes, materials.lanes, 'access-lanes', false);
  add(stall, materials.stall, 'stalls', false);
  add(water, materials.water, 'water', false);
  add(glass, materials.glass, 'glass-buildings', true);
  add(stone, materials.stone, 'stone-buildings', true);
  add(office, materials.office, 'office-buildings', true);
  add(podium, materials.podium, 'podiums', true);
  add(roof, materials.roof, 'roofs', true);
  add(white, materials.white, 'white-buildings', true);
  add(domeB, materials.dome, 'domes', true);
  add(dark, materials.dark, 'plant', true);
  add(accent, materials.accent, 'accents', true);
  add(helipad, materials.helipad, 'helipad', false);
  add(sign, materials.sign, 'signs', false, false);

  return { group, trees, palms, parked, bounds, materials };
}

/** Remap the UVs of a builder that holds one decal quad to 0..1 (planar, by size in metres). */
function fitUv(b: GeoBuilder, size: number, wall = false): void {
  if (b.empty) return;
  // positions are in three.js coordinates; use x and -z (or y for a wall)
  let minA = Infinity;
  let minB = Infinity;
  for (let i = 0; i < b.pos.length; i += 3) {
    const a = wall ? -b.pos[i + 2] : b.pos[i];
    const c = wall ? b.pos[i + 1] : -b.pos[i + 2];
    minA = Math.min(minA, a);
    minB = Math.min(minB, c);
  }
  for (let i = 0, k = 0; i < b.pos.length; i += 3, k += 2) {
    const a = wall ? -b.pos[i + 2] : b.pos[i];
    const c = wall ? b.pos[i + 1] : -b.pos[i + 2];
    b.uv[k] = (a - minA) / size;
    b.uv[k + 1] = (c - minB) / size;
  }
}

export type { RngState };
