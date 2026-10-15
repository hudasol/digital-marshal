import * as THREE from 'three';
import type { Network, Side, Turn } from '../../core/network/types';
import type { Aspect } from '../../core/sim/signals';
import { makeRng, rand, randRange } from '../../core/rng';
import { GeoBuilder } from './builder';
import { CURB_H } from './roads';
import type { Spot } from './blocks';
import type { Kit } from '../kit/kit';
import { kitInstances } from '../kit/batch';
import { ENV } from '../env/uniforms';
import { buildTrees } from './trees';

/* Street furniture: signal poles with lamp heads, roadside units, street lights with the light
   they cast at night, palms and shade trees, benches and rooftop solar. Lamps and vegetation are
   instanced; signal lamp colours follow the simulation every frame without rebuilding geometry.
   Palms near the camera use the detailed kit model and the rest a light stand-in, re-sorted as the
   camera moves. */

export interface SignalHeadRef {
  junction: string;
  side: Side; // approach side the head faces (traffic coming from this side)
  index: number; // instance index of this head's lamps
}

export interface FurnitureLayer {
  group: THREE.Group;
  setAspects(get: (junction: string, inLink: string, turn: Turn) => Aspect, blink: boolean): void;
  rsuLeds: THREE.InstancedMesh;
  rsuIndex: Record<string, number>;
  headPositions: Array<{ junction: string; side: Side; x: number; y: number; z: number }>;
  /** per frame: palm level of detail around the camera, lamp light on the road */
  update(camera: THREE.Camera, lodRadius: number): void;
  /** lamps of the dark junctions' signals go out with them */
  setPools(on: boolean): void;
}

const LAMP_ON: Record<'R' | 'A' | 'G', THREE.Color> = {
  R: new THREE.Color(9.0, 0.5, 0.3),
  A: new THREE.Color(9.0, 4.6, 0.3),
  G: new THREE.Color(0.35, 8.0, 3.8),
};
const LAMP_OFF: Record<'R' | 'A' | 'G', THREE.Color> = {
  R: new THREE.Color(0.09, 0.025, 0.02),
  A: new THREE.Color(0.09, 0.06, 0.015),
  G: new THREE.Color(0.02, 0.07, 0.045),
};

/** Soft round light pool, drawn white and tinted by the material. */
function poolTexture(): THREE.CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(c);
}

export function buildFurniture(
  net: Network,
  trees: Spot[],
  palms: Spot[],
  benches: Spot[],
  roofs: Array<{ x: number; y: number; z: number; face: number; w: number; d: number }>,
  density: number,
  kit: Kit | null,
): FurnitureLayer {
  const group = new THREE.Group();
  group.name = 'furniture';
  const poles = new GeoBuilder();
  const housings = new GeoBuilder();
  const rsuBoxes = new GeoBuilder();
  const r = makeRng(77, 'furniture');
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  // ---------------------------------------------------------------- signal poles and heads
  interface Head {
    junction: string;
    side: Side;
    inLink: string;
    turn: Turn; // the movement this head controls (left arrow heads over exclusive left lanes)
    x: number;
    y: number;
    z: number;
    facing: number; // radians: direction the lamp faces (toward approaching traffic)
  }
  const heads: Head[] = [];
  for (const jid of net.junctionIds) {
    const j = net.junctions[jid];
    for (const side of ['N', 'E', 'S', 'W'] as Side[]) {
      const inId = j.inLinks[side];
      if (!inId) continue;
      const l = net.links[inId];
      // pole on the near-right corner of the approach, just behind the stop line
      const s = l.length + 1.2;
      const px = l.start.x + l.dir.x * s + l.right.x * (l.halfWidth + 1.4);
      const py = l.start.y + l.dir.y * s + l.right.y * (l.halfWidth + 1.4);
      const facing = Math.atan2(-l.dir.y, -l.dir.x);
      const poleH = 6.4;
      const pole = new THREE.CylinderGeometry(0.16, 0.2, poleH, 10);
      poles.setColor(0x4b5058).addGeometry(pole, new THREE.Matrix4().makeTranslation(px, CURB_H + poleH / 2, -py));
      // mast arm across the lanes toward the centre line
      const armLen = l.halfWidth + 1.4 - (net.roads[l.road].median / 2 + 0.6);
      const ax = px - l.right.x * (armLen / 2);
      const ay = py - l.right.y * (armLen / 2);
      const arm = new THREE.BoxGeometry(armLen, 0.2, 0.2);
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(l.right.y, l.right.x)).setPosition(ax, CURB_H + poleH - 0.3, -ay);
      poles.addGeometry(arm, m);
      // one head per lane over the lane centre, plus one on the pole at eye level
      for (let lane = 0; lane < l.lanes; lane++) {
        const off = l.laneOffsets[lane];
        const hx = l.start.x + l.dir.x * s + l.right.x * off;
        const hy = l.start.y + l.dir.y * s + l.right.y * off;
        const turns = l.laneTurns[lane];
        const turn: Turn = turns.includes('S') ? 'S' : turns[0];
        heads.push({ junction: jid, side, inLink: inId, turn, x: hx, y: hy, z: CURB_H + poleH - 1.15, facing });
      }
      heads.push({ junction: jid, side, inLink: inId, turn: 'S', x: px + l.dir.x * 0.2, y: py + l.dir.y * 0.2, z: CURB_H + 3.0, facing });
    }
    // roadside unit: cabinet and antenna on its own short pole
    const ru = j.rsu;
    const rp = new THREE.CylinderGeometry(0.12, 0.14, 7.2, 8);
    poles.addGeometry(rp, new THREE.Matrix4().makeTranslation(ru.x, CURB_H + 3.6, -ru.y));
    const cab = new THREE.BoxGeometry(0.55, 0.7, 0.35);
    rsuBoxes.setColor(0xd9dee4).addGeometry(cab, new THREE.Matrix4().makeTranslation(ru.x, CURB_H + 6.2, -ru.y));
    const ant = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6);
    rsuBoxes.setColor(0x30353c).addGeometry(ant, new THREE.Matrix4().makeTranslation(ru.x, CURB_H + 7.25, -ru.y));
  }

  // housings (static) and lamps (instanced, recoloured per frame)
  const housingGeo = new THREE.BoxGeometry(0.42, 1.12, 0.34);
  for (const h of heads) {
    const m = new THREE.Matrix4().makeRotationY(h.facing + Math.PI / 2).setPosition(h.x, h.z, -h.y);
    housings.setColor(0x16191d).addGeometry(housingGeo, m);
  }
  const lampGeo = new THREE.CircleGeometry(0.13, 14);
  const lampMat = new THREE.MeshBasicMaterial({ toneMapped: true });
  const lamps: Record<'R' | 'A' | 'G', THREE.InstancedMesh> = {
    R: new THREE.InstancedMesh(lampGeo, lampMat, heads.length),
    A: new THREE.InstancedMesh(lampGeo, lampMat, heads.length),
    G: new THREE.InstancedMesh(lampGeo, lampMat, heads.length),
  };
  const lampY: Record<'R' | 'A' | 'G', number> = { R: 0.34, A: 0, G: -0.34 };
  for (const k of ['R', 'A', 'G'] as const) {
    const im = lamps[k];
    heads.forEach((h, i) => {
      // facing in sim radians (CCW from east) -> three.js rotation about Y; circle faces +z by default
      const fx = Math.cos(h.facing);
      const fy = Math.sin(h.facing);
      const yaw = Math.atan2(fx, -fy); // rotate +z (three) onto the facing direction
      q.setFromAxisAngle(up, yaw);
      tmp.compose(new THREE.Vector3(h.x + fx * 0.18, h.z + lampY[k], -(h.y + fy * 0.18)), q, one);
      im.setMatrixAt(i, tmp);
      im.setColorAt(i, LAMP_OFF[k]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    im.name = `signal-lamps-${k}`;
    im.userData.noAO = true;
    group.add(im);
  }

  // ---------------------------------------------------------------- RSU LED (instanced so it can pulse)
  const ledGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const ledMat = new THREE.MeshBasicMaterial({ toneMapped: true });
  const rsuLeds = new THREE.InstancedMesh(ledGeo, ledMat, net.junctionIds.length);
  const rsuIndex: Record<string, number> = {};
  net.junctionIds.forEach((jid, i) => {
    const ru = net.junctions[jid].rsu;
    rsuIndex[jid] = i;
    rsuLeds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(ru.x, CURB_H + 6.65, -ru.y));
    rsuLeds.setColorAt(i, new THREE.Color(0.6, 4.6, 5.6));
  });
  rsuLeds.name = 'rsu-leds';
  rsuLeds.userData.noAO = true;
  group.add(rsuLeds);

  // ---------------------------------------------------------------- street lights
  const single: THREE.Matrix4[] = [];
  const double: THREE.Matrix4[] = [];
  const pools: Array<{ x: number; y: number; s: number }> = [];
  const seen = new Set<string>();
  for (const id of net.linkIds) {
    const l = net.links[id];
    const key = [l.from, l.to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const road = net.roads[l.road];
    const wide = road.median >= 4;
    const spacing = l.cls === 'arterial' ? 34 : 38;
    const ext = net.nodes[l.from].kind === 'gateway' ? 260 : 0;
    const extEnd = net.nodes[l.to].kind === 'gateway' ? 260 : 0;
    let n = 0;
    for (let s = 14 - ext; s < l.length - 12 + extEnd; s += spacing, n++) {
      if (wide) {
        // twin-arm lights on the planted median of the boulevard
        if (n % 2 === 0) {
          const x = l.start.x + l.dir.x * s;
          const y = l.start.y + l.dir.y * s;
          q.setFromAxisAngle(up, Math.atan2(-l.right.x, l.right.y));
          double.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.22, -y), q, one));
          for (const sd of [1, -1]) pools.push({ x: x + l.right.x * sd * 5.2, y: y + l.right.y * sd * 5.2, s: 13 });
        }
        continue;
      }
      for (const side of [1, -1]) {
        if ((n + (side > 0 ? 0 : 1)) % 2 === 1) continue; // staggered on the two sides
        const off = side * (l.halfWidth + 1.0);
        const x = l.start.x + l.dir.x * s + l.right.x * off;
        const y = l.start.y + l.dir.y * s + l.right.y * off;
        // the arm points across the road (kit arms point along local +Z)
        const rx = -l.right.x * side;
        const ry = -l.right.y * side;
        q.setFromAxisAngle(up, Math.atan2(rx, -ry));
        single.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, -y), q, one));
        pools.push({ x: x + rx * 3.2, y: y + ry * 3.2, s: 12.5 });
      }
    }
  }
  const keepLights = (list: THREE.Matrix4[]) => list.filter((_, i) => (i * 7) % 10 < Math.max(0.5, density) * 10);
  if (kit?.has('streetlight_v0')) {
    group.add(kitInstances(kit, 'streetlight_v0', keepLights(single), 'street-lights'));
    group.add(kitInstances(kit, 'streetlight_v1', keepLights(double), 'median-lights'));
  } else {
    const lightGeo = (() => {
      const b = new GeoBuilder();
      b.setColor(0x5a6068);
      b.addGeometry(new THREE.CylinderGeometry(0.09, 0.13, 9, 8), new THREE.Matrix4().makeTranslation(0, 4.5, 0));
      b.addGeometry(new THREE.BoxGeometry(0.12, 0.12, 2.2), new THREE.Matrix4().makeTranslation(0, 8.9, 1.05));
      b.setColor(0xb9bfc6);
      b.addGeometry(new THREE.BoxGeometry(0.32, 0.16, 0.7), new THREE.Matrix4().makeTranslation(0, 8.8, 2.05));
      return b.build();
    })();
    const all = [...keepLights(single), ...keepLights(double)];
    const lights = new THREE.InstancedMesh(lightGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }), all.length);
    all.forEach((m, i) => lights.setMatrixAt(i, m));
    lights.castShadow = true;
    lights.name = 'street-lights';
    group.add(lights);
  }
  // light pools on the road: additive, scaled by the lamp level every frame
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTexture(),
    color: new THREE.Color(0, 0, 0),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -12,
  });
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, pools.length);
  pools.forEach((p, i) => {
    tmp.compose(new THREE.Vector3(p.x, 0.06, -p.y), q.identity(), new THREE.Vector3(p.s * 2, 1, p.s * 2));
    poolMesh.setMatrixAt(i, tmp);
  });
  poolMesh.name = 'lamp-pools';
  poolMesh.renderOrder = 3;
  poolMesh.frustumCulled = false;
  poolMesh.userData.noAO = true;
  group.add(poolMesh);
  let poolsOn = true;

  // ---------------------------------------------------------------- boulevard median palms
  for (const id of net.linkIds) {
    const l = net.links[id];
    const road = net.roads[l.road];
    if (road.median < 4 || l.dir.x < 0) continue; // once per segment, eastbound only
    for (let s = 6; s < l.length - 6; s += 13) {
      // centre line of the road is at offset 0 from the link start
      palms.push({ x: l.start.x + l.dir.x * s, y: l.start.y + l.dir.y * s, s: randRange(r, 1.0, 1.2), a: rand(r) * 6.28, h: 0.22 });
    }
  }

  // ---------------------------------------------------------------- vegetation
  const palmList = palms.filter((_, i) => (i * 7919) % 100 < density * 100 + 20);
  const palmMatrices = palmList.map((p) => {
    q.setFromAxisAngle(up, p.a ?? 0);
    const k = (p.s ?? 1) * 0.95;
    return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.h ?? CURB_H, -p.y), q, new THREE.Vector3(k, k, k));
  });
  const palmPos = palmList.map((p) => new THREE.Vector3(p.x, 6, -p.y));
  // the stand-in is shorter than the kit palms: stretch it so the swap does not pop
  const loMatrices = palmList.map((p) => {
    q.setFromAxisAngle(up, p.a ?? 0);
    const k = (p.s ?? 1) * 1.05;
    return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.h ?? CURB_H, -p.y), q, new THREE.Vector3(k, k * 1.18, k));
  });
  // far stand-in for every palm, detailed kit palms for those near the camera
  const loGeo = makePalm();
  const loMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const lo = new THREE.InstancedMesh(loGeo, loMat, palmMatrices.length);
  lo.castShadow = true;
  lo.receiveShadow = true;
  lo.name = 'palms-far';
  group.add(lo);
  const hiVariants: THREE.Group[] = [];
  if (kit?.has('palm_v0')) {
    for (const v of ['palm_v0', 'palm_v1', 'palm_v2']) {
      if (!kit.has(v)) continue;
      const g = kitInstances(kit, v, palmMatrices, `palms-${v}`);
      g.children.forEach((c) => ((c as THREE.InstancedMesh).count = 0));
      hiVariants.push(g);
      group.add(g);
    }
  }
  const hiIdx = hiVariants.map(() => [] as number[]);
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  let lastRadius = -1;
  const relod = (cam: THREE.Vector3, radius: number) => {
    const r2 = radius * radius;
    hiIdx.forEach((a) => (a.length = 0));
    let nLo = 0;
    for (let i = 0; i < palmMatrices.length; i++) {
      if (hiVariants.length && palmPos[i].distanceToSquared(cam) < r2) hiIdx[i % hiVariants.length].push(i);
      else lo.setMatrixAt(nLo++, loMatrices[i]);
    }
    lo.count = nLo;
    lo.instanceMatrix.needsUpdate = true;
    lo.computeBoundingSphere();
    hiVariants.forEach((g, vi) => {
      for (const c of g.children) {
        const im = c as THREE.InstancedMesh;
        const ids = hiIdx[vi];
        ids.forEach((pi, k) => im.setMatrixAt(k, palmMatrices[pi]));
        im.count = ids.length;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      }
    });
  };

  // shade trees and shrubs: leaf clouds (shrubs line the boulevard median between the palms)
  const treeList = trees.filter((_, i) => (i * 104729) % 100 < density * 100 + 10);
  const shrubs: Spot[] = [];
  for (const id of net.linkIds) {
    const l = net.links[id];
    if (net.roads[l.road].median < 4 || l.dir.x < 0) continue;
    for (let s = 12.5; s < l.length - 6; s += 13) {
      for (const off of [-1.6, 1.6]) shrubs.push({ x: l.start.x + l.dir.x * s + l.right.x * off, y: l.start.y + l.dir.y * s + l.right.y * off, s: randRange(r, 0.75, 1.05), h: 0.22 });
    }
  }
  group.add(buildTrees(treeList, density > 0.5 ? shrubs : [], CURB_H));

  // ---------------------------------------------------------------- benches and rooftop solar
  if (kit?.has('bench_v0') && benches.length) {
    group.add(
      kitInstances(
        kit,
        'bench_v0',
        benches.map((b) => new THREE.Matrix4().compose(new THREE.Vector3(b.x, CURB_H, -b.y), q.setFromAxisAngle(up, b.a ?? 0), one)),
        'benches',
      ),
    );
  }
  if (kit?.has('solar-array_v0') && roofs.length && density > 0.5) {
    const pv: THREE.Matrix4[] = [];
    for (const rf of roofs.filter((_, i) => i % 2 === 0)) {
      q.setFromAxisAngle(up, rf.face);
      const cols = Math.min(2, Math.max(1, Math.floor(rf.w / 10.5)));
      const rows = 1;
      for (let i = 0; i < cols; i++) {
        for (let k = 0; k < rows; k++) {
          const lx = (i - (cols - 1) / 2) * 10.5;
          const lz = (k - (rows - 1) / 2) * 6.6;
          const off = new THREE.Vector3(lx, 0, lz).applyQuaternion(q);
          // modules face south: keep the rack unrotated toward +Z
          pv.push(new THREE.Matrix4().compose(new THREE.Vector3(rf.x + off.x, rf.z + 0.05, -rf.y + off.z), new THREE.Quaternion(), one));
        }
      }
    }
    group.add(kitInstances(kit, 'solar-array_v0', pv, 'rooftop-solar', false));
  }

  // ---------------------------------------------------------------- static meshes
  const poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6 });
  const housingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  const add = (b: GeoBuilder, m: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  };
  add(poles, poleMat, 'signal-poles');
  add(housings, housingMat, 'signal-housings');
  add(rsuBoxes, housingMat, 'rsu-cabinets');

  const indexByKey = new Map<string, number[]>();
  heads.forEach((h, i) => {
    const key = `${h.junction}|${h.inLink}|${h.turn}`;
    if (!indexByKey.has(key)) indexByKey.set(key, []);
    indexByKey.get(key)!.push(i);
  });

  let lastKey = '';
  return {
    group,
    rsuLeds,
    rsuIndex,
    headPositions: heads.map((h) => ({ junction: h.junction, side: h.side, x: h.x, y: h.y, z: h.z })),
    setAspects(get, blink) {
      // only touch GPU buffers when something changed
      const parts: string[] = [];
      for (const [key] of indexByKey) {
        const [jid, inLink, turn] = key.split('|');
        parts.push(get(jid, inLink, turn as Turn));
      }
      const sig = parts.join('') + (blink ? '1' : '0');
      if (sig === lastKey) return;
      lastKey = sig;
      let p = 0;
      for (const [, idxs] of indexByKey) {
        const a = parts[p++] as Aspect;
        for (const i of idxs) {
          lamps.R.setColorAt(i, a === 'R' ? LAMP_ON.R : LAMP_OFF.R);
          lamps.A.setColorAt(i, a === 'A' ? LAMP_ON.A : LAMP_OFF.A);
          lamps.G.setColorAt(i, a === 'G' ? LAMP_ON.G : LAMP_OFF.G);
        }
      }
      for (const k of ['R', 'A', 'G'] as const) if (lamps[k].instanceColor) lamps[k].instanceColor!.needsUpdate = true;
    },
    update(camera, lodRadius) {
      const cam = camera.position;
      if (cam.distanceToSquared(lastCam) > 30 * 30 || lodRadius !== lastRadius) {
        lastCam.copy(cam);
        lastRadius = lodRadius;
        relod(cam, lodRadius);
      }
      const k = poolsOn ? ENV.uLamp.value : 0;
      poolMat.color.setRGB(0.4 * k, 0.29 * k, 0.16 * k);
      poolMesh.visible = k > 0.01;
    },
    setPools(on) {
      poolsOn = on;
    },
  };
}

/** Date palm stand-in: tapered trunk and a crown of arching fronds. About 9 m tall at scale 1. */
export function makePalm(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const trunkH = 8.0;
  b.setColor(0x7a6448);
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, trunkH, 6, 2, true);
  b.addGeometry(trunk, new THREE.Matrix4().makeTranslation(0, trunkH / 2, 0));
  const fronds = 12;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.12;
    const upper = i % 2 === 0;
    const len = upper ? 4.8 : 4.2;
    const lift = upper ? 0.9 : 0.25;
    const segs = 3;
    let prev: [number, number, number] | null = null;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const x = Math.cos(a) * len * t;
      const z = Math.sin(a) * len * t;
      const y = trunkH + 0.25 + lift * Math.sin(t * Math.PI * 0.8) * 1.2 - 2.2 * t * t;
      const cur: [number, number, number] = [x, y, z];
      if (prev) {
        const w0 = 0.55 * (1 - (t - 1 / segs) * 0.55);
        const w1 = 0.55 * (1 - t * 0.55);
        const px = -Math.sin(a);
        const pz = Math.cos(a);
        const g = new THREE.BufferGeometry();
        const v = new Float32Array([
          prev[0] - px * w0, prev[1], prev[2] - pz * w0,
          cur[0] - px * w1, cur[1] - 0.12, cur[2] - pz * w1,
          cur[0] + px * w1, cur[1] - 0.12, cur[2] + pz * w1,
          prev[0] - px * w0, prev[1], prev[2] - pz * w0,
          cur[0] + px * w1, cur[1] - 0.12, cur[2] + pz * w1,
          prev[0] + px * w0, prev[1], prev[2] + pz * w0,
        ]);
        g.setAttribute('position', new THREE.BufferAttribute(v, 3));
        g.computeVertexNormals();
        b.setColor(new THREE.Color().setHSL(0.21 + (upper ? 0.01 : -0.01), 0.42, 0.16 + t * 0.06));
        b.addGeometry(g, new THREE.Matrix4());
      }
      prev = cur;
    }
  }
  return b.build();
}
