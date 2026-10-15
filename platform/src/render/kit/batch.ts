import * as THREE from 'three';
import type { Kit } from './kit';
import { kitCastsShadow, kitMaterial } from './materials';

/* Static batching of kit placements: every (node, transform) is baked into one geometry per
   material and map tile, so the whole district costs a few dozen draw calls and the tiles outside
   the view are culled. Vertex colours carry the kit's baked occlusion times a per-building tint;
   aSeed identifies the building (window patterns); aGrid is the glazing window grid: u = facade
   bay, v = storey (the kit's v, which glTF stores flipped as 1 - v). */

export type Tint = [number, number, number];

export interface KitPlacement {
  node: string;
  /** world transform (three.js coordinates) */
  matrix: THREE.Matrix4;
  /** building identity for the window pattern */
  seed: number;
  /** multiplier per material name */
  tints?: Partial<Record<string, Tint>>;
  /** scale applied to the glazing grid (keeps window cells near real size on scaled landmarks) */
  grid?: [number, number];
  /**
   * Make a kit building taller by stretching only its shaft (node-local metres): heights between
   * y0 and y1 scale by k, everything above moves up, so the lobby and the crown keep their
   * proportions. The glazing grid gains storeys of the original height `storey`.
   */
  stretch?: { y0: number; y1: number; k: number; storey: number };
  shadow?: boolean;
}

interface Item {
  geometry: THREE.BufferGeometry;
  part: THREE.Matrix4;
  place: THREE.Matrix4;
  seed: number;
  tint: Tint;
  grid: [number, number];
  stretch?: KitPlacement['stretch'];
}

export class KitBatcher {
  private groups = new Map<string, { material: string; shadow: boolean; items: Item[] }>();
  count = 0;

  /** `tile`: size of the square map tiles batches are split into (m), so off-screen tiles are culled */
  constructor(
    private readonly kit: Kit,
    private readonly tile = 900,
  ) {}

  add(p: KitPlacement): boolean {
    const parts = this.kit.partsOf(p.node);
    if (!parts.length) return false;
    const pos = new THREE.Vector3().setFromMatrixPosition(p.matrix);
    const tile = `${Math.floor(pos.x / this.tile)},${Math.floor(pos.z / this.tile)}`;
    for (const part of parts) {
      const shadow = p.shadow !== false && kitCastsShadow(part.material);
      const key = `${part.material}|${tile}|${shadow ? 1 : 0}`;
      let g = this.groups.get(key);
      if (!g) {
        g = { material: part.material, shadow, items: [] };
        this.groups.set(key, g);
      }
      g.items.push({
        geometry: part.geometry,
        part: part.matrix,
        place: p.matrix,
        seed: p.seed,
        tint: p.tints?.[part.material] ?? [1, 1, 1],
        grid: p.grid ?? [1, 1],
        stretch: p.stretch,
      });
    }
    this.count++;
    return true;
  }

  /** Build the batched meshes into a group. */
  build(name: string): THREE.Group {
    const out = new THREE.Group();
    out.name = name;
    for (const [key, g] of this.groups) {
      const geo = merge(g.items);
      if (!geo) continue;
      const mat = kitMaterial(g.material, this.kit.pbr[g.material]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${name}:${key}`;
      mesh.castShadow = g.shadow;
      mesh.receiveShadow = g.material !== 'light_emissive' && g.material !== 'emissive_sign';
      mesh.matrixAutoUpdate = false;
      if (mat.transparent) mesh.renderOrder = 4;
      out.add(mesh);
    }
    return out;
  }
}

function merge(items: Item[]): THREE.BufferGeometry | null {
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    const p = it.geometry.getAttribute('position');
    if (!p) continue;
    nv += p.count;
    ni += it.geometry.index ? it.geometry.index.count : p.count;
  }
  if (!nv) return null;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const grid = new Float32Array(nv * 2);
  const seed = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nPart = new THREE.Matrix3();
  const nPlace = new THREE.Matrix3();
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const g = it.geometry;
    const P = g.getAttribute('position');
    if (!P) continue;
    const N = g.getAttribute('normal');
    const UV = g.getAttribute('uv');
    const C = g.getAttribute('color');
    nPart.getNormalMatrix(it.part);
    nPlace.getNormalMatrix(it.place);
    const flip = it.part.determinant() * it.place.determinant() < 0;
    const st = it.stretch;
    for (let i = 0; i < P.count; i++) {
      const o = vo + i;
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(it.part);
      if (N) n.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nPart);
      else n.set(0, 1, 0);
      let dv = 0;
      if (st) {
        const y = v.y;
        if (y > st.y1) v.y = y + (st.y1 - st.y0) * (st.k - 1);
        else if (y > st.y0) {
          v.y = st.y0 + (y - st.y0) * st.k;
          n.y /= st.k;
        }
        dv = (v.y - y) / st.storey;
      }
      v.applyMatrix4(it.place);
      n.applyMatrix3(nPlace).normalize();
      pos[o * 3] = v.x;
      pos[o * 3 + 1] = v.y;
      pos[o * 3 + 2] = v.z;
      nor[o * 3] = n.x;
      nor[o * 3 + 1] = n.y;
      nor[o * 3 + 2] = n.z;
      const ar = C ? C.getX(i) : 1;
      const ag = C ? C.getY(i) : 1;
      const ab = C ? C.getZ(i) : 1;
      col[o * 3] = ar * it.tint[0];
      col[o * 3 + 1] = ag * it.tint[1];
      col[o * 3 + 2] = ab * it.tint[2];
      if (UV) {
        grid[o * 2] = UV.getX(i) * it.grid[0];
        grid[o * 2 + 1] = (1 - UV.getY(i) + dv) * it.grid[1];
      }
      seed[o] = it.seed;
    }
    if (g.index) {
      const I = g.index;
      for (let k = 0; k < I.count; k += 3) {
        const a = I.getX(k) + vo;
        const b = I.getX(k + 1) + vo;
        const c = I.getX(k + 2) + vo;
        idx[io++] = a;
        idx[io++] = flip ? c : b;
        idx[io++] = flip ? b : c;
      }
    } else {
      for (let k = 0; k < P.count; k += 3) {
        idx[io++] = vo + k;
        idx[io++] = vo + (flip ? k + 2 : k + 1);
        idx[io++] = vo + (flip ? k + 1 : k + 2);
      }
    }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
  out.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  out.setIndex(new THREE.BufferAttribute(idx.subarray(0, io), 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Instanced copies of a kit node (props: palms, street lights, benches), one InstancedMesh per material. */
export function kitInstances(kit: Kit, node: string, matrices: THREE.Matrix4[], name: string, shadow = true): THREE.Group {
  const out = new THREE.Group();
  out.name = name;
  if (!matrices.length) return out;
  for (const part of kit.partsOf(node)) {
    const geo = part.geometry.clone();
    geo.applyMatrix4(part.matrix);
    // instanced props carry no baked occlusion: give the shader neutral colours and grid
    const n = geo.getAttribute('position').count;
    if (!geo.getAttribute('color')) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const uv = geo.getAttribute('uv');
    const grid = new Float32Array(n * 2);
    if (uv) for (let i = 0; i < n; i++) {
      grid[i * 2] = uv.getX(i);
      grid[i * 2 + 1] = 1 - uv.getY(i);
    }
    geo.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = kitMaterial(part.material, kit.pbr[part.material], true);
    const im = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow && kitCastsShadow(part.material);
    im.receiveShadow = true;
    im.name = `${name}:${part.material}`;
    im.computeBoundingSphere();
    out.add(im);
  }
  return out;
}
