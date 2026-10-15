import * as THREE from 'three';
import { makeRng, rand, randRange } from '../../core/rng';
import { GeoBuilder } from './builder';

/* Context beyond the simulated district: a ring of lower-detail towers, a coastline with the sea
   to the north-west, and two Dubai-inspired landmark silhouettes. None of it is simulated, and
   none of it is a replica of a real building. */

const COAST: Array<[number, number]> = [
  [-9000, -3200],
  [-2200, 900],
  [-900, 1700],
  [1200, 3100],
  [6000, 6400],
];

/** True when a point lies on the sea side (north-west) of the coastline. */
export function inSea(x: number, y: number): boolean {
  for (let i = 0; i + 1 < COAST.length; i++) {
    const [ax, ay] = COAST[i];
    const [bx, by] = COAST[i + 1];
    if (x >= ax && x <= bx) {
      const t = (x - ax) / (bx - ax);
      return y > ay + (by - ay) * t;
    }
  }
  return false;
}

export interface SkylineLayer {
  group: THREE.Group;
  far: THREE.Object3D; // hidden on the lowest quality tier
}

export function buildSkyline(glassMat: THREE.Material, officeMat: THREE.Material, roofMat: THREE.Material, glassTile: [number, number]): SkylineLayer {
  const group = new THREE.Group();
  group.name = 'skyline';
  const far = new THREE.Group();
  far.name = 'skyline-far';
  const r = makeRng(99, 'skyline');
  const glass = new GeoBuilder();
  const office = new GeoBuilder();
  const roof = new GeoBuilder();

  // ---------------------------------------------------------------- sea and beach
  const seaPoly: Array<[number, number]> = [...COAST, [6000, 12000], [-9000, 12000]];
  const sea = new GeoBuilder();
  sea.setColor(0xffffff).capH(seaPoly, 0.05, 50);
  const seaMesh = new THREE.Mesh(
    sea.build(),
    new THREE.MeshStandardMaterial({ color: 0x1d5468, roughness: 0.1, metalness: 0.35, envMapIntensity: 1.5, vertexColors: true }),
  );
  seaMesh.name = 'sea';
  seaMesh.receiveShadow = false;
  group.add(seaMesh);
  // lighter shallow-water band along the shore
  const shore = new GeoBuilder();
  shore.setColor(0xffffff);
  for (let i = 0; i + 1 < COAST.length; i++) {
    const [ax, ay] = COAST[i];
    const [bx, by] = COAST[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy);
    shore.rectH((ax + bx) / 2 - (dy / L) * -18, (ay + by) / 2 + (dx / L) * 18, dx / L, dy / L, L, 36, 0.07, 40);
  }
  const shoreMesh = new THREE.Mesh(
    shore.build(),
    new THREE.MeshStandardMaterial({ color: 0x5fa9b3, roughness: 0.2, metalness: 0.1, vertexColors: true, transparent: true, opacity: 0.85 }),
  );
  shoreMesh.name = 'shore';
  group.add(shoreMesh);

  // ---------------------------------------------------------------- tower ring
  const n = 230;
  for (let i = 0; i < n; i++) {
    const ang = rand(r) * Math.PI * 2;
    const rad = randRange(r, 1050, 3300);
    const x = Math.cos(ang) * rad * 1.15;
    const y = Math.sin(ang) * rad;
    if (inSea(x, y) || inSea(x + 40, y + 40)) continue;
    // keep a clear corridor where the simulated roads leave the district
    if (Math.abs(y) < 60 || Math.abs(y - 250) < 40 || Math.abs(y + 240) < 40) {
      if (Math.abs(x) < 1600) continue;
    }
    if (Math.abs(x - 140) < 40 || Math.abs(x + 400) < 40) {
      if (Math.abs(y) < 1300) continue;
    }
    // denser and taller toward the north and north-east, low toward the desert in the south
    const north = Math.max(0, Math.sin(ang));
    const h = (35 + rand(r) * rand(r) * 230) * (0.55 + north * 0.9);
    const w = randRange(r, 24, 52);
    const d = randRange(r, 24, 52);
    const mat = rand(r) > 0.42 ? glass : office;
    mat.setColor(new THREE.Color().setHSL(0.08 + rand(r) * 0.5, 0.08, 0.82 + rand(r) * 0.12));
    mat.box(x, y, w, d, 0, h, rand(r) * 0.6, glassTile[0], glassTile[1], false);
    roof.setColor(0xbdb5a8).box(x, y, w, d, h - 0.02, h, 0, 1, 1, true);
    if (h > 160 && rand(r) > 0.4) {
      mat.box(x, y, w * 0.6, d * 0.6, h, h + h * 0.18, rand(r) * 0.6, glassTile[0], glassTile[1], false);
    }
  }

  // ---------------------------------------------------------------- landmark 1: stepped super-tall spire
  {
    const cx = 620;
    const cy = 2300;
    let z = 0;
    let w = 66;
    for (let i = 0; i < 14; i++) {
      const th = i < 4 ? 40 : 34;
      glass.setColor(0xf0f4f8).box(cx, cy, w, w, z, z + th, (i % 2) * (Math.PI / 4), glassTile[0], glassTile[1], false);
      roof.box(cx, cy, w, w, z + th - 0.02, z + th, (i % 2) * (Math.PI / 4), 1, 1, true);
      z += th;
      w *= 0.87;
    }
    const sp = new GeoBuilder();
    sp.setColor(0xf3f6f9).addGeometry(new THREE.CylinderGeometry(0.8, 5, 110, 10), new THREE.Matrix4().makeTranslation(cx, z + 55, -cy));
    glass.pos.push(...sp.pos);
    glass.nor.push(...sp.nor);
    glass.uv.push(...sp.uv.map(() => 0));
    glass.col.push(...sp.col);
  }

  // ---------------------------------------------------------------- landmark 2: sail-shaped hotel on an island
  {
    const cx = -1720;
    const cy = 1460;
    const island = new GeoBuilder();
    island.setColor(0xe2cfa8);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * 95, cy + Math.sin(a) * 80]);
    }
    island.prism(pts, 0, 3, 1, 1, true);
    const islandMesh = new THREE.Mesh(island.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    islandMesh.name = 'island';
    group.add(islandMesh);
    // loft of triangular slices: a curved "sail" back and a straight mast edge
    const levels = 30;
    const H = 300;
    for (let i = 0; i < levels; i++) {
      const t0 = i / levels;
      const t1 = (i + 1) / levels;
      const shape = (t: number): Array<[number, number]> => {
        const belly = Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.9 + 0.1;
        const depth = 64 * (1 - t) * belly + 6;
        const width = 54 * (1 - t * 0.85);
        return [
          [cx + 30 * (1 - t), cy - width / 2],
          [cx + 30 * (1 - t), cy + width / 2],
          [cx + 30 * (1 - t) - depth, cy],
        ];
      };
      const a = shape(t0);
      const b = shape(t1);
      const z0 = t0 * H + 3;
      const z1 = t1 * H + 3;
      glass.setColor(0xf6f8fa);
      for (let k = 0; k < 3; k++) {
        const p = a[k];
        const q = a[(k + 1) % 3];
        const p1 = b[k];
        const q1 = b[(k + 1) % 3];
        // quad between the two slices (two triangles, approximate normals from the lower edge)
        const nx = q[1] - p[1];
        const ny = -(q[0] - p[0]);
        const nl = Math.hypot(nx, ny) || 1;
        pushTri(glass, [p[0], p[1], z0], [q[0], q[1], z0], [q1[0], q1[1], z1], nx / nl, ny / nl);
        pushTri(glass, [p[0], p[1], z0], [q1[0], q1[1], z1], [p1[0], p1[1], z1], nx / nl, ny / nl);
      }
    }
    // mast
    const mast = new GeoBuilder();
    mast.setColor(0xf3f6f9).addGeometry(new THREE.CylinderGeometry(1.6, 3.4, 330, 8), new THREE.Matrix4().makeTranslation(cx + 34, 165, -cy));
    glass.pos.push(...mast.pos);
    glass.nor.push(...mast.nor);
    glass.uv.push(...mast.uv.map(() => 0));
    glass.col.push(...mast.col);
  }

  // ---------------------------------------------------------------- low-rise urban fabric around the district
  {
    const spots: Array<[number, number, number, number, number]> = [];
    const step = 46;
    for (let gx = -2600; gx <= 2600; gx += step) {
      for (let gy = -2000; gy <= 2600; gy += step) {
        const x = gx + (rand(r) - 0.5) * 14;
        const y = gy + (rand(r) - 0.5) * 14;
        // outside the simulated district and its road corridors, on land
        if (Math.abs(x) < 900 && Math.abs(y) < 700) continue;
        if (inSea(x, y) || inSea(x + 30, y + 30)) continue;
        if (Math.abs(y) < 40 || Math.abs(y - 250) < 30 || Math.abs(y + 240) < 30) continue;
        if (Math.abs(x + 400) < 30 || Math.abs(x + 130) < 26 || Math.abs(x - 140) < 30 || Math.abs(x - 410) < 26) continue;
        const d = Math.hypot(x / 1.2, y);
        if (rand(r) < Math.min(0.75, (d - 800) / 3000)) continue; // thins out toward the desert
        const h = 6 + rand(r) * rand(r) * (y > 0 ? 34 : 18);
        spots.push([x, y, randRange(r, 16, 34), randRange(r, 14, 30), h]);
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    spots.forEach(([x, y, w, d, h], i) => {
      m.makeScale(w, h, d).setPosition(x, 0, -y);
      im.setMatrixAt(i, m);
      c.setHSL(0.08 + rand(r) * 0.04, 0.1 + rand(r) * 0.08, 0.5 + rand(r) * 0.12);
      im.setColorAt(i, c);
    });
    im.name = 'urban-ring';
    im.castShadow = false;
    im.receiveShadow = false;
    far.add(im);
  }

  const add = (b: GeoBuilder, m: THREE.Material, name: string, parent: THREE.Object3D) => {
    if (b.empty) return;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
  };
  add(glass, glassMat, 'skyline-glass', far);
  add(office, officeMat, 'skyline-office', far);
  add(roof, roofMat, 'skyline-roofs', far);
  group.add(far);
  return { group, far };
}

function pushTri(b: GeoBuilder, a: number[], c: number[], d: number[], nx: number, ny: number): void {
  for (const p of [a, c, d]) {
    b.pos.push(p[0], p[2], -p[1]);
    b.nor.push(nx, 0, -ny);
    b.uv.push(0, 0);
    b.col.push(0.96, 0.97, 0.98);
  }
}
