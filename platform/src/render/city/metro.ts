import * as THREE from 'three';
import { coastDistance } from '../env/coast';

/* The city around the simulated district. Scenery only: none of it is simulated and none of it is
   a real place. An invented street grid carries the district's own roads on into the haze and a
   coast road runs behind the beach; every superblock between the main roads gets a land use:
   towers along the coast and the boulevard, mid-rise apartment blocks, villa neighbourhoods with
   gardens and pools, parks, and warehouses to the south-east, thinning out toward the desert far
   away. The layout is plain data shared by the ground shader (which paints the roads, plots,
   gardens and parking: metroGround.ts) and the placement of buildings, traffic and lamps
   (outskirts.ts), so the two always agree. Coordinates: simulation metres (x east, y north). */

export interface RoadClass {
  hw: number; // centre line to kerb, m
  median: number; // median width, m
  lanes: number; // lanes per direction
  walk: number; // sidewalk (or verge) width, m
}

export const LOCAL = 0;
export const COLLECTOR = 1;
export const ARTERIAL = 2;
export const HIGHWAY = 3;

/** Cross-sections: local street, collector and arterial (the district's own), urban highway. */
export const ROAD_CLASSES: RoadClass[] = [
  { hw: 3.5, median: 0, lanes: 1, walk: 3 },
  { hw: 7.8, median: 1.6, lanes: 2, walk: 3.5 },
  { hw: 14.5, median: 8, lanes: 3, walk: 4.5 },
  { hw: 22, median: 6, lanes: 5, walk: 7 },
];

export const ZONE = { none: 0, towers: 1, mid: 2, villas: 3, park: 4, industry: 5, district: 255 } as const;

/** The simulated district's ground, which the city never paints over or builds on. */
export const DISTRICT = { x0: -860, x1: 860, y0: -680, y1: 680 };
/** The grid runs this far out (into the haze); buildings thin out to nothing before CITY_R. */
export const EXTENT = 12500;
export const CITY_R = 7800;
/** Coast road: centre line at this signed distance from the shoreline (negative = inland). */
export const COAST_ROAD = { sd: -235, hw: 9.5, walk: 6 };
/** Lots and buildings stay inland of this signed coast distance. */
export const COAST_LIMIT = COAST_ROAD.sd - COAST_ROAD.hw - COAST_ROAD.walk - 6;

export interface Line {
  c: number; // x of a north–south road, y of an east–west road
  cls: number;
}

/** The grid: the district's own roads and its perimeter street near the centre, then regular
    spacing outward (the ground shader finds a cell from these numbers without searching). */
export const GRID = {
  xInner: [
    { c: -866, cls: LOCAL },
    { c: -400, cls: COLLECTOR },
    { c: -130, cls: LOCAL },
    { c: 140, cls: COLLECTOR },
    { c: 410, cls: LOCAL },
    { c: 866, cls: LOCAL },
  ] as Line[],
  yInner: [
    { c: -686, cls: LOCAL },
    { c: -240, cls: COLLECTOR },
    { c: 0, cls: ARTERIAL },
    { c: 250, cls: COLLECTOR },
    { c: 686, cls: LOCAL },
  ] as Line[],
  /** north-south roads east and west of the centre, alternately arterial and collector */
  x: { first: 1180, step: 340, count: Math.ceil((EXTENT - 1180) / 340) },
  /** east-west roads north of the centre, alternately collector and arterial */
  n: { first: 1000, step: 330, count: Math.ceil((EXTENT - 1000) / 330) },
  /** east-west roads south of the centre; the third is an urban highway */
  s: { first: 1000, step: 350, count: Math.ceil((EXTENT - 1000) / 350) },
};
export const xCls = (k: number) => (k % 2 === 0 ? ARTERIAL : COLLECTOR);
export const nCls = (k: number) => (k % 2 === 0 ? COLLECTOR : ARTERIAL);
export const sCls = (k: number) => (k === 2 ? HIGHWAY : k % 2 === 0 ? COLLECTOR : ARTERIAL);

/** North–south roads, west to east. */
export const XL: Line[] = (() => {
  const out: Line[] = [...GRID.xInner];
  for (let k = 0; k < GRID.x.count; k++) {
    const c = GRID.x.first + k * GRID.x.step;
    out.push({ c, cls: xCls(k) }, { c: -c, cls: xCls(k) });
  }
  return out.sort((a, b) => a.c - b.c);
})();

/** East–west roads, south to north. */
export const YL: Line[] = (() => {
  const out: Line[] = [...GRID.yInner];
  for (let k = 0; k < GRID.n.count; k++) out.push({ c: GRID.n.first + k * GRID.n.step, cls: nCls(k) });
  for (let k = 0; k < GRID.s.count; k++) out.push({ c: -(GRID.s.first + k * GRID.s.step), cls: sCls(k) });
  return out.sort((a, b) => a.c - b.c);
})();

/** Integer hash shared bit for bit with the ground shader (dmHashU). */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

export interface Cell {
  ix: number;
  iy: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zone: number;
  nx: number; // lots across (local streets between them)
  ny: number;
}

export interface Lot {
  cell: Cell;
  lx: number;
  ly: number;
  /** buildable area: inside the sidewalks */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  hash: number;
  /** a surface car park (the ground shader paints the bays; nothing is built) */
  parking: boolean;
}

const LOT_SIZE: Record<number, [number, number]> = {
  [ZONE.towers]: [175, 170],
  [ZONE.mid]: [135, 125],
  [ZONE.villas]: [150, 105],
  [ZONE.industry]: [215, 190],
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function zoneOf(ix: number, iy: number, cx: number, cy: number): number {
  if (cx > DISTRICT.x0 && cx < DISTRICT.x1 && cy > DISTRICT.y0 && cy < DISTRICT.y1) return ZONE.district;
  const r = Math.hypot(cx / 1.15, cy);
  const h = hash3(ix, iy, 11) / 4294967296;
  // the city thins out toward the desert: whole superblocks drop out, then everything
  if (r > CITY_R || h < smooth(CITY_R - 2800, CITY_R, r) * 0.95) return ZONE.none;
  const sd = coastDistance(cx, cy);
  if (h > 0.93 && r < 6200) return ZONE.park;
  if (sd > -1150 && cy > 300) return ZONE.towers; // the coastal strip
  if (Math.abs(cy) < 300 && r < 5200) return ZONE.towers; // along the boulevard
  if (cy < -2300 && cx > 1000) return ZONE.industry;
  if (cy < -760 || (cx < -1400 && cy < 800)) return ZONE.villas;
  return ZONE.mid;
}

let cells: Cell[] | null = null;

/** Every superblock between neighbouring main roads, with its land use. */
export function metroCells(): Cell[] {
  if (cells) return cells;
  cells = [];
  for (let iy = 0; iy + 1 < YL.length; iy++) {
    for (let ix = 0; ix + 1 < XL.length; ix++) {
      const x0 = XL[ix].c;
      const x1 = XL[ix + 1].c;
      const y0 = YL[iy].c;
      const y1 = YL[iy + 1].c;
      const zone = zoneOf(ix, iy, (x0 + x1) / 2, (y0 + y1) / 2);
      const size = LOT_SIZE[zone];
      const nx = size ? THREE.MathUtils.clamp(Math.round((x1 - x0) / size[0]), 1, 12) : 1;
      const ny = size ? THREE.MathUtils.clamp(Math.round((y1 - y0) / size[1]), 1, 12) : 1;
      cells.push({ ix, iy, x0, x1, y0, y1, zone, nx, ny });
    }
  }
  return cells;
}

/** Distance from a street centre line to the edge of the buildable lot behind its sidewalk. */
export function inset(cls: number): number {
  return ROAD_CLASSES[cls].hw + ROAD_CLASSES[cls].walk;
}

/** Lot (lx, ly) of a cell; identical arithmetic in the ground shader. */
export function lotOf(cell: Cell, lx: number, ly: number): Lot {
  const sx = (cell.x1 - cell.x0) / cell.nx;
  const sy = (cell.y1 - cell.y0) / cell.ny;
  const loc = inset(LOCAL);
  const x0 = cell.x0 + lx * sx + (lx === 0 ? inset(XL[cell.ix].cls) : loc);
  const x1 = cell.x0 + (lx + 1) * sx - (lx === cell.nx - 1 ? inset(XL[cell.ix + 1].cls) : loc);
  const y0 = cell.y0 + ly * sy + (ly === 0 ? inset(YL[cell.iy].cls) : loc);
  const y1 = cell.y0 + (ly + 1) * sy - (ly === cell.ny - 1 ? inset(YL[cell.iy + 1].cls) : loc);
  const hash = hash3(cell.ix * 4096 + cell.iy, lx * 64 + ly, 5);
  const parking = (cell.zone === ZONE.towers || cell.zone === ZONE.mid) && hash % 11 === 0;
  return { cell, lx, ly, x0, x1, y0, y1, hash, parking };
}

/** Every buildable lot inland of the coast road, in a city zone. */
export function metroLots(): Lot[] {
  const out: Lot[] = [];
  for (const cell of metroCells()) {
    if (cell.zone === ZONE.none || cell.zone === ZONE.district) continue;
    for (let ly = 0; ly < cell.ny; ly++) {
      for (let lx = 0; lx < cell.nx; lx++) {
        const lot = lotOf(cell, lx, ly);
        if (lot.x1 - lot.x0 < 12 || lot.y1 - lot.y0 < 12) continue;
        out.push(lot);
      }
    }
  }
  return out;
}

/** True when a footprint stays inland of the coast road and clear of the district. */
export function buildable(x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 > DISTRICT.x0 - 4 && x0 < DISTRICT.x1 + 4 && y1 > DISTRICT.y0 - 4 && y0 < DISTRICT.y1 + 4) return false;
  return (
    coastDistance(x0, y0) < COAST_LIMIT &&
    coastDistance(x1, y0) < COAST_LIMIT &&
    coastDistance(x0, y1) < COAST_LIMIT &&
    coastDistance(x1, y1) < COAST_LIMIT
  );
}

export interface Plot {
  x0: number;
  y0: number;
  w: number;
  h: number;
  pool: boolean;
  hash: number;
}

/** Villa plots of a lot (about 30 x 34 m); the ground shader draws their walls, gardens and pools. */
export function villaPlots(lot: Lot): Plot[] {
  const pnx = Math.max(1, Math.round((lot.x1 - lot.x0) / 30));
  const pny = Math.max(1, Math.round((lot.y1 - lot.y0) / 34));
  const w = (lot.x1 - lot.x0) / pnx;
  const h = (lot.y1 - lot.y0) / pny;
  const out: Plot[] = [];
  for (let py = 0; py < pny; py++) {
    for (let px = 0; px < pnx; px++) {
      const hash = hash3(lot.cell.ix * 4096 + lot.cell.iy, lot.lx * 64 + lot.ly, px * 64 + py);
      out.push({ x0: lot.x0 + px * w, y0: lot.y0 + py * h, w, h, pool: (hash & 3) !== 0, hash });
    }
  }
  return out;
}

/** Land use and lot counts per superblock for the ground shader: R zone, G lots across, B lots down. */
export function metroZoneTexture(): THREE.DataTexture {
  const w = XL.length - 1;
  const h = YL.length - 1;
  const data = new Uint8Array(w * h * 4);
  for (const c of metroCells()) {
    const i = (c.iy * w + c.ix) * 4;
    data[i] = c.zone;
    data[i + 1] = c.nx;
    data[i + 2] = c.ny;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
