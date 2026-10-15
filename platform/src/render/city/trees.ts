import * as THREE from 'three';
import { makeRng, rand, randRange } from '../../core/rng';

/* Broadleaf shade trees and shrubs as "leaf clouds": a trunk with a few limbs, and a canopy of
   small cards cut out by a painted leaf-cluster texture. Card normals point away from the canopy
   centre, so the cloud shades like a soft ball and reads as foliage from street level and from
   the air, and the cut-out leaves cast dappled shadows. Everything is generated: the texture is
   drawn once on a canvas. */

/** Leaf-cluster texture: hundreds of small leaves, lighter on the upper side, transparent between. */
export function leafTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const r = makeRng(31, 'leaf-texture');
  g.clearRect(0, 0, n, n);
  for (let i = 0; i < 700; i++) {
    // denser toward the middle so a card fades out at its edges
    const a = rand(r) * Math.PI * 2;
    const d = Math.pow(rand(r), 0.85) * n * 0.46;
    const x = n / 2 + Math.cos(a) * d;
    const y = n / 2 + Math.sin(a) * d * 0.92;
    const up = 1 - y / n; // 1 at the top of the card
    const h = 88 + rand(r) * 30;
    const s = 32 + rand(r) * 22;
    const l = 16 + up * 18 + rand(r) * 12;
    g.fillStyle = `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
    g.save();
    g.translate(x, y);
    g.rotate(rand(r) * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, 4.5 + rand(r) * 4, 2.2 + rand(r) * 2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Canopy of cards in an ellipsoid; returns geometry with outward normals, UVs and occlusion colours. */
export function leafCloud(rx: number, ry: number, cy: number, cards: number, size: [number, number], seed: number): THREE.BufferGeometry {
  const r = makeRng(seed, 'leaf-cloud');
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const corner = new THREE.Vector3();
  const centre = new THREE.Vector3(0, cy, 0);
  for (let i = 0; i < cards; i++) {
    // points spread through the volume, biased to the shell so the silhouette is full
    const u = rand(r) * 2 - 1;
    const th = rand(r) * Math.PI * 2;
    const k = 0.55 + 0.45 * Math.pow(rand(r), 0.5);
    const sx = Math.sqrt(1 - u * u) * Math.cos(th);
    const sz = Math.sqrt(1 - u * u) * Math.sin(th);
    const p = new THREE.Vector3(sx * rx * k, cy + u * ry * k, sz * rx * k);
    const s = randRange(r, size[0], size[1]);
    e.set(randRange(r, -0.9, 0.9), rand(r) * Math.PI * 2, randRange(r, -0.6, 0.6));
    q.setFromEuler(e);
    const out = p.clone().sub(centre);
    out.y *= rx / Math.max(0.1, ry);
    out.normalize();
    // lower and inner cards sit in shade
    const ao = THREE.MathUtils.clamp(0.5 + 0.35 * (u * 0.5 + 0.5) + 0.25 * k - 0.15, 0.35, 1);
    const quad: Array<[number, number, number, number]> = [
      [-0.5, -0.5, 0, 0],
      [0.5, -0.5, 1, 0],
      [0.5, 0.5, 1, 1],
      [-0.5, 0.5, 0, 1],
    ];
    for (const ix of [0, 1, 2, 0, 2, 3]) {
      const [cx, cyy, cu, cv] = quad[ix];
      corner.set(cx * s, cyy * s, 0).applyQuaternion(q).add(p);
      pos.push(corner.x, corner.y, corner.z);
      // bend card normals toward the outward direction: soft, ball-like shading
      nor.push(out.x, out.y, out.z);
      uv.push(cu, cv);
      col.push(ao, ao, ao);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Trunk with two limbs into the canopy (about 6 m tree at scale 1). */
export function trunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.13, 0.24, 3.2, 7, 1, true);
  main.translate(0, 1.6, 0);
  parts.push(main);
  for (const [a, tilt] of [
    [0.4, 0.55],
    [2.6, 0.5],
    [4.4, 0.6],
  ]) {
    const limb = new THREE.CylinderGeometry(0.06, 0.1, 1.9, 5, 1, true);
    limb.translate(0, 0.95, 0);
    limb.rotateZ(tilt);
    limb.rotateY(a);
    limb.translate(0, 2.7, 0);
    parts.push(limb);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export interface TreeSpot {
  x: number;
  y: number;
  h?: number;
  s?: number;
}

/** Instanced shade trees (trunk + leaf cloud) and shrubs sharing one leaf texture. */
export function buildTrees(trees: TreeSpot[], shrubs: TreeSpot[], baseH: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const tex = leafTexture();
  const leafMat = new THREE.MeshStandardMaterial({
    name: 'leaves',
    map: tex,
    alphaTest: 0.42,
    // smooth cut-out edges where the scene is multisampled
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  // cut-out leaves in the shadow map too
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
  const barkMat = new THREE.MeshStandardMaterial({ name: 'bark', color: 0x5e4a38, roughness: 0.92 });
  const r = makeRng(41, 'trees');
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();

  const canopy = leafCloud(2.9, 2.0, 4.6, 26, [2.0, 2.8], 7);
  const trunk = trunkGeometry();
  const tMesh = new THREE.InstancedMesh(trunk, barkMat, Math.max(1, trees.length));
  const cMesh = new THREE.InstancedMesh(canopy, leafMat, Math.max(1, trees.length));
  trees.forEach((p, i) => {
    q.setFromAxisAngle(up, rand(r) * Math.PI * 2);
    const k = p.s ?? 1;
    m.compose(new THREE.Vector3(p.x, p.h ?? baseH, -p.y), q, new THREE.Vector3(k, k * randRange(r, 0.88, 1.12), k));
    tMesh.setMatrixAt(i, m);
    cMesh.setMatrixAt(i, m);
    c.setHSL(0.24 + rand(r) * 0.05, 0.25 + rand(r) * 0.25, 0.62 + rand(r) * 0.22);
    cMesh.setColorAt(i, c);
  });
  tMesh.count = cMesh.count = trees.length;
  for (const im of [tMesh, cMesh]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
  }
  cMesh.customDepthMaterial = leafDepth;
  tMesh.name = 'tree-trunks';
  cMesh.name = 'tree-canopies';
  group.add(tMesh, cMesh);

  if (shrubs.length) {
    const bush = leafCloud(1.3, 0.75, 0.75, 9, [1.0, 1.5], 9);
    const sMesh = new THREE.InstancedMesh(bush, leafMat, shrubs.length);
    shrubs.forEach((p, i) => {
      q.setFromAxisAngle(up, rand(r) * Math.PI * 2);
      const k = p.s ?? 1;
      m.compose(new THREE.Vector3(p.x, p.h ?? baseH, -p.y), q, new THREE.Vector3(k * randRange(r, 0.8, 1.3), k, k * randRange(r, 0.8, 1.3)));
      sMesh.setMatrixAt(i, m);
      c.setHSL(0.22 + rand(r) * 0.07, 0.3 + rand(r) * 0.25, 0.55 + rand(r) * 0.2);
      sMesh.setColorAt(i, c);
    });
    sMesh.castShadow = true;
    sMesh.receiveShadow = true;
    sMesh.customDepthMaterial = leafDepth;
    sMesh.name = 'shrubs';
    sMesh.computeBoundingSphere();
    group.add(sMesh);
  }
  return group;
}
