import * as THREE from 'three';
import type { Kit } from '../kit/kit';
import { KitBatcher, type Tint } from '../kit/batch';
import type { Bound, BuildingSpec, BuildingType } from './blocks';
import { CURB_H } from './roads';
import { GeoBuilder } from './builder';

/* Building specifications to kit models. Kit buildings are scaled to the specified footprint and
   height within the kit's tolerance; taller towers get extra storeys in their shaft (the lobby and
   crown keep their proportions). The two landmarks are generic towers from the kit's skyline set,
   scaled, with their window grid kept near real size. Facilities (hospital, mall, office campus,
   operations building, cooling plant) are placed at real size. Without the kit, every building
   falls back to a plain massing box. */

export interface Placed {
  spec: BuildingSpec;
  node: string;
  top: number;
  bound: Bound;
}

// per-building colour variety on top of the kit's baked stone tints
const FACADE: Tint[] = [
  [1.08, 1.07, 1.06],
  [1.04, 1.03, 1.02],
  [1.0, 0.98, 0.95],
  [0.97, 0.94, 0.9],
  [1.06, 1.06, 1.08],
  [0.94, 0.95, 0.98],
];
const ALT: Tint[] = [
  [1.0, 1.0, 1.0],
  [1.06, 1.04, 1.0],
  [0.95, 0.93, 0.9],
  [0.9, 0.86, 0.8],
];
const GLAZING: Tint[] = [
  [1.0, 1.0, 1.0],
  [0.78, 0.9, 1.06],
  [0.84, 1.0, 0.98],
  [0.66, 0.7, 0.76],
  [1.02, 0.95, 0.86],
  [0.72, 0.82, 0.95],
];
const TRIM: Tint[] = [
  [1.0, 1.0, 1.0],
  [1.35, 1.12, 0.85],
  [0.8, 0.82, 0.86],
];

const FACILITY: Partial<Record<BuildingType, string>> = {
  hospital: 'hospital_v0',
  mall: 'mall_v0',
  'office-complex': 'office-complex_v0',
  ops: 'emergency-ops_v0',
  cooling: 'cooling-plant_v0',
  'landmark-spire': 'skyline_spire',
  'landmark-twist': 'skyline_twist',
};

const KIND: Partial<Record<BuildingType, string>> = {
  'tower-glass': 'tower-office',
  'tower-office': 'tower-office',
  'tower-residential': 'tower-residential',
  midrise: 'midrise-residential',
  lowrise: 'lowrise-residential',
  villa: 'villa',
  podium: 'commercial-podium',
};

const pick = <T,>(list: T[], seed: number, salt = 0): T => list[Math.abs(Math.imul(seed + salt * 977, 2654435761) >>> 7) % list.length];

function footprint(x: number, y: number, w: number, d: number, face: number, h: number): Bound {
  const c = Math.abs(Math.cos(face));
  const s = Math.abs(Math.sin(face));
  const hx = (w * c + d * s) / 2;
  const hy = (w * s + d * c) / 2;
  return { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy, h };
}

export interface BuildingsOutput {
  group: THREE.Group;
  placed: Placed[];
  bounds: Bound[];
  /** rooftops where solar arrays can go (kit low and mid-rise): position, yaw, width, depth */
  roofs: Array<{ x: number; y: number; z: number; face: number; w: number; d: number }>;
}

export function buildBuildings(specs: BuildingSpec[], kit: Kit | null, fallback: THREE.Material): BuildingsOutput {
  const group = new THREE.Group();
  group.name = 'buildings';
  const placed: Placed[] = [];
  const bounds: Bound[] = [];
  const roofs: BuildingsOutput['roofs'] = [];
  const boxes = new GeoBuilder();
  const batch = kit ? new KitBatcher(kit) : null;
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sizeCache = new Map<string, THREE.Vector3>();
  const sizeOf = (node: string) => {
    let s = sizeCache.get(node);
    if (!s) sizeCache.set(node, (s = kit!.sizeOf(node)));
    return s;
  };

  for (const sp of specs) {
    let node: string | null = null;
    let scale = new THREE.Vector3(1, 1, 1);
    let grid: [number, number] | undefined;
    let stretch: { y0: number; y1: number; k: number; storey: number } | undefined;
    let top = sp.h;
    let bw = sp.w;
    let bd = sp.d;
    if (kit) {
      const fac = FACILITY[sp.type];
      const kind = KIND[sp.type];
      if (fac && kit.has(fac)) {
        node = fac;
        const size = sizeOf(fac);
        if (sp.type === 'landmark-spire' || sp.type === 'landmark-twist') {
          const s = sp.h / size.y;
          scale.set(s, s, s);
          grid = [s, s];
        } else if (sp.type === 'mall') {
          scale.set(sp.w / size.x, sp.h / size.y, sp.d / size.z);
        }
        top = size.y * scale.y;
        bw = size.x * scale.x;
        bd = size.z * scale.z;
      } else if (kind) {
        const tower = sp.type.startsWith('tower');
        // residential towers keep their balconies close to storey height: very tall ones become glass
        const k0 = kind === 'tower-residential' && sp.h > 120 ? 'tower-office' : kind;
        const vars = kit.variants(k0);
        if (vars.length) {
          const a = pick(vars, sp.seed, 1);
          node = a.node;
          const ns = a.nominalSize ?? [sp.w, sp.d, sp.h];
          const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
          const wide = tower && sp.h > 90 ? 1.45 : 1.3;
          scale = new THREE.Vector3(clamp(sp.w / ns[0], 0.8, wide), clamp(sp.h / ns[2], 0.78, 1.25), clamp(sp.d / ns[1], 0.8, wide));
          if (sp.type === 'villa') scale.set(1, 1, 1);
          top = ns[2] * scale.y;
          const lobby = a.lobbyHeight ?? 0;
          const roofY = a.roofY ?? ns[2];
          if ((tower || sp.type === 'midrise') && sp.h > ns[2] * 1.25 && a.storeyHeight && roofY > lobby + 6) {
            // taller than a stretched kit building: add storeys to the shaft instead
            const k = clamp((sp.h - (ns[2] - roofY) - lobby) / (roofY - lobby), 1, tower ? 4.2 : 1.7);
            scale.y = 1;
            stretch = { y0: lobby, y1: roofY, k, storey: a.storeyHeight };
            top = ns[2] + (roofY - lobby) * (k - 1);
          }
          bw = ns[0] * scale.x;
          bd = ns[1] * scale.z;
          const roofTop = (roofY + (stretch ? (roofY - lobby) * (stretch.k - 1) : 0)) * scale.y;
          if ((sp.type === 'midrise' || sp.type === 'lowrise' || sp.type === 'podium') && sp.seed % 3 !== 0)
            roofs.push({ x: sp.x, y: sp.y, z: roofTop, face: sp.face, w: bw * 0.62, d: bd * 0.5 });
        }
      }
    }
    if (node && batch) {
      q.setFromAxisAngle(up, sp.face);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(sp.x, CURB_H - 0.02, -sp.y), q, scale);
      const s = sp.seed;
      const facility = !!FACILITY[sp.type] && !sp.type.startsWith('landmark');
      batch.add({
        node,
        matrix: m,
        seed: s,
        grid,
        stretch,
        tints: facility
          ? { trim: pick(TRIM, s, 4) }
          : { facade: pick(FACADE, s, 2), facade_alt: pick(ALT, s, 3), glazing: pick(GLAZING, s, 5), trim: pick(TRIM, s, 4) },
      });
      const b = footprint(sp.x, sp.y, bw, bd, sp.face, top);
      bounds.push(b);
      placed.push({ spec: sp, node, top, bound: b });
      continue;
    }
    // fallback massing: a pale box at the specified size
    boxes.setColor(sp.type.startsWith('tower') || sp.type.startsWith('landmark') ? 0xc9d6df : 0xeee6d8);
    // a three.js yaw of `face` is a counter-clockwise turn by the same angle in simulation coordinates
    boxes.box(sp.x, sp.y, sp.w, sp.d, CURB_H, CURB_H + sp.h, sp.face, 1, 1, true);
    const b = footprint(sp.x, sp.y, sp.w, sp.d, sp.face, sp.h);
    bounds.push(b);
    placed.push({ spec: sp, node: 'box', top: sp.h, bound: b });
  }
  if (batch) group.add(batch.build('kit-buildings'));
  if (!boxes.empty) {
    const m = new THREE.Mesh(boxes.build(), fallback);
    m.name = 'fallback-buildings';
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  group.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return { group, placed, bounds, roofs };
}
