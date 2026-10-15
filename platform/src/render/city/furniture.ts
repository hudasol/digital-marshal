import * as THREE from 'three';
import type { Network, Side, Turn } from '../../core/network/types';
import type { Aspect } from '../../core/sim/signals';
import { makeRng, rand, randRange } from '../../core/rng';
import { GeoBuilder } from './builder';
import { CURB_H } from './roads';
import type { Spot } from './blocks';

/* Street furniture: signal poles with lamp heads, roadside units, street lights and vegetation.
   Lamps and tree instances are InstancedMeshes; signal lamp colours are updated from the
   simulation state every frame without rebuilding geometry. */

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
  setNight(on: boolean): void;
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

export function buildFurniture(
  net: Network,
  trees: Spot[],
  palms: Spot[],
  density: number,
): FurnitureLayer {
  const group = new THREE.Group();
  group.name = 'furniture';
  const poles = new GeoBuilder();
  const housings = new GeoBuilder();
  const rsuBoxes = new GeoBuilder();
  const r = makeRng(77, 'furniture');

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
      const m = new THREE.Matrix4()
        .makeRotationY(Math.atan2(l.right.y, l.right.x))
        .setPosition(ax, CURB_H + poleH - 0.3, -ay);
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
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const k of ['R', 'A', 'G'] as const) {
    const im = lamps[k];
    heads.forEach((h, i) => {
      // facing in sim radians (CCW from east) -> three.js rotation about Y; circle faces +z by default
      const fx = Math.cos(h.facing);
      const fy = Math.sin(h.facing);
      const yaw = Math.atan2(fx, -fy); // rotate +z (three) onto the facing direction
      q.setFromAxisAngle(up, yaw);
      tmp.compose(new THREE.Vector3(h.x + fx * 0.18, h.z + lampY[k], -(h.y + fy * 0.18)), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, tmp);
      im.setColorAt(i, LAMP_OFF[k]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    im.name = `signal-lamps-${k}`;
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
  group.add(rsuLeds);

  // ---------------------------------------------------------------- street lights
  const lightSpots: Array<{ x: number; y: number; a: number }> = [];
  const seen = new Set<string>();
  for (const id of net.linkIds) {
    const l = net.links[id];
    const key = [l.from, l.to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const spacing = l.cls === 'arterial' ? 32 : 38;
    for (let s = 12; s < l.length - 10; s += spacing) {
      for (const side of [1, -1]) {
        const off = side * (l.halfWidth + 1.0);
        lightSpots.push({
          x: l.start.x + l.dir.x * s + l.right.x * off,
          y: l.start.y + l.dir.y * s + l.right.y * off,
          a: Math.atan2(-l.right.y * side, -l.right.x * side),
        });
      }
    }
  }
  const lightGeo = (() => {
    const b = new GeoBuilder();
    b.setColor(0x5a6068);
    b.addGeometry(new THREE.CylinderGeometry(0.09, 0.13, 9, 8), new THREE.Matrix4().makeTranslation(0, 4.5, 0));
    b.addGeometry(new THREE.BoxGeometry(2.2, 0.12, 0.12), new THREE.Matrix4().makeTranslation(1.05, 8.9, 0));
    b.setColor(0xb9bfc6);
    b.addGeometry(new THREE.BoxGeometry(0.7, 0.16, 0.32), new THREE.Matrix4().makeTranslation(2.05, 8.8, 0));
    return b.build();
  })();
  const lightMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 });
  const nLights = Math.floor(lightSpots.length * Math.max(0.35, density));
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, nLights);
  for (let i = 0; i < nLights; i++) {
    const sp = lightSpots[Math.floor((i * lightSpots.length) / nLights)];
    q.setFromAxisAngle(up, sp.a);
    tmp.compose(new THREE.Vector3(sp.x, CURB_H, -sp.y), q, new THREE.Vector3(1, 1, 1));
    lights.setMatrixAt(i, tmp);
  }
  lights.castShadow = true;
  lights.name = 'street-lights';
  group.add(lights);
  // glow heads for night (hidden by day)
  const glowGeo = new THREE.BoxGeometry(0.66, 0.06, 0.28);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7.5, 5.6, 3.6) });
  const glows = new THREE.InstancedMesh(glowGeo, glowMat, nLights);
  for (let i = 0; i < nLights; i++) {
    const sp = lightSpots[Math.floor((i * lightSpots.length) / nLights)];
    q.setFromAxisAngle(up, sp.a);
    const off = new THREE.Vector3(2.05, 8.7, 0).applyQuaternion(q);
    tmp.compose(new THREE.Vector3(sp.x + off.x, CURB_H + off.y, -sp.y + off.z), q, new THREE.Vector3(1, 1, 1));
    glows.setMatrixAt(i, tmp);
  }
  glows.visible = false;
  glows.name = 'street-light-glow';
  group.add(glows);

  // ---------------------------------------------------------------- boulevard median palms
  for (const id of net.linkIds) {
    const l = net.links[id];
    const road = net.roads[l.road];
    if (road.median < 4 || l.dir.x < 0) continue; // once per segment, eastbound only
    for (let s = 6; s < l.length - 6; s += 13) {
      // centre line of the road is at offset 0 from the link start
      palms.push({ x: l.start.x + l.dir.x * s, y: l.start.y + l.dir.y * s, s: randRange(r, 0.95, 1.2), a: rand(r) * 6.28, h: 0.22 });
    }
  }

  // ---------------------------------------------------------------- vegetation instances
  const palmGeo = makePalm();
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const palmList = palms.filter((_, i) => (i * 7919) % 100 < density * 100 + 20);
  const palmMesh = new THREE.InstancedMesh(palmGeo, palmMat, palmList.length);
  palmList.forEach((p, i) => {
    q.setFromAxisAngle(up, p.a ?? 0);
    const k = p.s ?? 1;
    tmp.compose(new THREE.Vector3(p.x, p.h ?? CURB_H, -p.y), q, new THREE.Vector3(k, k, k));
    palmMesh.setMatrixAt(i, tmp);
  });
  palmMesh.castShadow = true;
  palmMesh.name = 'palms';
  group.add(palmMesh);

  const treeGeo = makeShadeTree();
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const treeList = trees.filter((_, i) => (i * 104729) % 100 < density * 100 + 10);
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, treeList.length);
  const col = new THREE.Color();
  treeList.forEach((p, i) => {
    q.setFromAxisAngle(up, rand(r) * 6.28);
    const k = p.s ?? 1;
    tmp.compose(new THREE.Vector3(p.x, p.h ?? CURB_H, -p.y), q, new THREE.Vector3(k, k * randRange(r, 0.85, 1.15), k));
    treeMesh.setMatrixAt(i, tmp);
    col.setHSL(0.2 + rand(r) * 0.07, 0.34 + rand(r) * 0.14, 0.3 + rand(r) * 0.1);
    treeMesh.setColorAt(i, col);
  });
  treeMesh.castShadow = true;
  treeMesh.name = 'trees';
  group.add(treeMesh);

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
    setNight(on) {
      glows.visible = on;
    },
  };
}

/** Date palm: tapered trunk and a crown of arching, darker fronds. About 9 m tall at scale 1. */
function makePalm(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const trunkH = 8.0;
  b.setColor(0x6b543d);
  const trunk = new THREE.CylinderGeometry(0.19, 0.3, trunkH, 7, 6);
  b.addGeometry(trunk, new THREE.Matrix4().makeTranslation(0, trunkH / 2, 0));
  // knob where the fronds meet
  b.setColor(0x5c4a30);
  b.addGeometry(new THREE.SphereGeometry(0.45, 7, 5), new THREE.Matrix4().makeTranslation(0, trunkH + 0.1, 0));
  const fronds = 16;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.12;
    const upper = i % 2 === 0;
    const len = upper ? 4.6 : 4.0;
    const lift = upper ? 0.9 : 0.25; // upper fronds rise before arching
    const segs = 4;
    let prev: [number, number, number] | null = null;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const x = Math.cos(a) * len * t;
      const z = Math.sin(a) * len * t;
      const y = trunkH + 0.25 + lift * Math.sin(t * Math.PI * 0.8) * 1.2 - 2.2 * t * t;
      const cur: [number, number, number] = [x, y, z];
      if (prev) {
        const w0 = 0.42 * (1 - (t - 1 / segs) * 0.55);
        const w1 = 0.42 * (1 - t * 0.55);
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
        b.setColor(new THREE.Color().setHSL(0.24 + (upper ? 0.01 : -0.01), 0.45, 0.13 + t * 0.07));
        b.addGeometry(g, new THREE.Matrix4());
      }
      prev = cur;
    }
  }
  return b.build();
}

/** Rounded shade tree (ghaf-like): short trunk and a low, wide canopy. About 6 m tall. */
function makeShadeTree(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.setColor(0x7a5f45);
  b.addGeometry(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6), new THREE.Matrix4().makeTranslation(0, 1.2, 0));
  b.setColor(0xffffff);
  const c1 = new THREE.IcosahedronGeometry(2.6, 2);
  c1.scale(1.25, 0.8, 1.25);
  const pa = c1.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const y = pa.getY(i);
    const z = pa.getZ(i);
    const n = 1 + 0.14 * Math.sin(x * 2.1 + z * 1.3) * Math.cos(y * 2.7 - x);
    pa.setXYZ(i, x * n, y * n, z * n);
  }
  c1.computeVertexNormals();
  b.addGeometry(c1, new THREE.Matrix4().makeTranslation(0, 3.8, 0));
  const c2 = new THREE.IcosahedronGeometry(1.7, 0);
  b.addGeometry(c2, new THREE.Matrix4().makeTranslation(0.9, 4.9, -0.5));
  return b.build();
}
