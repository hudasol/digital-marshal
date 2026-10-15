import * as THREE from 'three';
import type { Engine } from '../core/sim/engine';
import type { Vehicle, VehicleClass } from '../core/sim/types';
import { CLASSES, PAINT } from '../core/sim/params';
import { connectorPose, lanePose } from '../core/network/geometry';
import { GeoBuilder } from './city/builder';

/* Vehicles drawn from simulation state. One instanced mesh per class body plus instanced lamps;
   poses are interpolated between the last two simulation steps so motion is smooth at any speed.
   Nothing here decides where a vehicle is: positions come only from the engine state. */

export interface Pose {
  x: number;
  y: number;
  h: number; // heading, rad (0 = east, counter-clockwise)
}

const CLASS_LIST: VehicleClass[] = ['robotaxi', 'car', 'van', 'bus', 'ambulance'];
const MAX = 900;

/** Centre position and heading of a vehicle, from its front bumper position and the rear point. */
export function vehiclePose(engine: Engine, v: Vehicle): Pose {
  const net = engine.net;
  const front = pointAt(engine, v, v.s);
  const rear = pointAt(engine, v, v.s - v.len);
  const dx = front.x - rear.x;
  const dy = front.y - rear.y;
  const h = dx * dx + dy * dy > 1e-6 ? Math.atan2(dy, dx) : front.h;
  void net;
  return { x: (front.x + rear.x) / 2, y: (front.y + rear.y) / 2, h };
}

function pointAt(engine: Engine, v: Vehicle, s: number): Pose {
  const net = engine.net;
  const seg = v.seg;
  if (seg.k === 'L') {
    const l = net.links[seg.id];
    if (s >= 0 || !v.prev) return lanePose(l, seg.lane, s, v.lat);
    if (v.prev.k === 'C') return connectorPose(net.connectors[v.prev.id], v.prevLen + s);
    return lanePose(net.links[v.prev.id], v.prev.lane, v.prevLen + s);
  }
  const c = net.connectors[seg.id];
  if (s >= 0 || !v.prev) return connectorPose(c, Math.max(0, s));
  const pl = net.links[v.prev.id];
  return lanePose(pl, v.prev.lane, v.prevLen + s);
}

// ------------------------------------------------------------------ geometry

function profileShape(len: number, pts: Array<[number, number]>): THREE.Shape {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? sh.moveTo(x * len, y) : sh.lineTo(x * len, y)));
  sh.closePath();
  return sh;
}

function extrude(shape: THREE.Shape, width: number, bevel = 0.06): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

function wheels(b: GeoBuilder, len: number, width: number, r: number, axles: number[]) {
  const w = new THREE.CylinderGeometry(r, r, 0.26, 10);
  w.rotateX(Math.PI / 2);
  b.setColor(0x141518);
  for (const ax of axles) {
    for (const side of [-1, 1]) {
      b.addGeometry(w, new THREE.Matrix4().makeTranslation(ax * len, r, side * (width / 2 - 0.1)));
    }
  }
  const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.28, 6);
  hub.rotateX(Math.PI / 2);
  b.setColor(0x8b9097);
  for (const ax of axles) for (const side of [-1, 1]) b.addGeometry(hub, new THREE.Matrix4().makeTranslation(ax * len, r, side * (width / 2 - 0.09)));
}

/** Body geometry in local coordinates: +x forward, +y up, centred on the vehicle centre. */
function bodyGeometry(cls: VehicleClass): THREE.BufferGeometry {
  const spec = CLASSES[cls];
  const L = spec.len;
  const W = spec.width;
  const b = new GeoBuilder();
  const id = new THREE.Matrix4();
  if (cls === 'car' || cls === 'robotaxi') {
    // sedan silhouette (x as a fraction of the length, y in metres)
    const body = profileShape(L, [
      [-0.5, 0.32],
      [-0.5, 0.82],
      [-0.44, 0.96],
      [-0.25, 1.0],
      [0.27, 1.0],
      [0.46, 0.86],
      [0.5, 0.66],
      [0.5, 0.32],
    ]);
    b.setColor(0xffffff).addGeometry(extrude(body, W), id);
    const cabin = profileShape(L, [
      [-0.27, 0.98],
      [-0.15, 1.42],
      [0.12, 1.45],
      [0.25, 1.0],
    ]);
    b.setColor(0x1a222b).addGeometry(extrude(cabin, W - 0.16, 0.05), id);
    // roof panel over the glass (body colour)
    b.setColor(0xffffff).addGeometry(new THREE.BoxGeometry(L * 0.24, 0.05, W - 0.3), new THREE.Matrix4().makeTranslation(-0.01 * L, 1.46, 0));
    if (cls === 'robotaxi') {
      // sensor pod with a lidar puck
      b.setColor(0xe6e9ec).addGeometry(new THREE.BoxGeometry(0.9, 0.12, 1.0), new THREE.Matrix4().makeTranslation(-0.02 * L, 1.53, 0));
      b.setColor(0x262b31).addGeometry(new THREE.CylinderGeometry(0.21, 0.23, 0.2, 16), new THREE.Matrix4().makeTranslation(-0.02 * L, 1.68, 0));
      // side livery stripe
      b.setColor(0x2aa6bb).addGeometry(new THREE.BoxGeometry(L * 0.62, 0.06, W + 0.02), new THREE.Matrix4().makeTranslation(0, 0.72, 0));
    }
    wheels(b, L, W, 0.33, [-0.31, 0.31]);
  } else if (cls === 'van' || cls === 'ambulance') {
    const H = cls === 'ambulance' ? 2.55 : 2.25;
    const body = profileShape(L, [
      [-0.5, 0.34],
      [-0.5, H],
      [0.22, H],
      [0.33, H - 0.2],
      [0.44, 1.2],
      [0.5, 1.0],
      [0.5, 0.34],
    ]);
    b.setColor(0xffffff).addGeometry(extrude(body, W), id);
    const glass = profileShape(L, [
      [0.25, H - 0.25],
      [0.32, H - 0.36],
      [0.43, 1.25],
      [0.3, 1.2],
    ]);
    b.setColor(0x1a222b).addGeometry(extrude(glass, W + 0.02, 0.02), id);
    if (cls === 'ambulance') {
      // high-visibility side bands (red and yellow), roof light bar housing
      b.setColor(0xd11f2a).addGeometry(new THREE.BoxGeometry(L * 0.74, 0.32, W + 0.03), new THREE.Matrix4().makeTranslation(-0.1 * L, 1.15, 0));
      b.setColor(0xf2c230).addGeometry(new THREE.BoxGeometry(L * 0.74, 0.16, W + 0.03), new THREE.Matrix4().makeTranslation(-0.1 * L, 0.88, 0));
      b.setColor(0x30353c).addGeometry(new THREE.BoxGeometry(0.5, 0.12, W - 0.4), new THREE.Matrix4().makeTranslation(0.18 * L, H + 0.06, 0));
    }
    wheels(b, L, W, 0.36, [-0.32, 0.3]);
  } else {
    // bus
    const H = 3.1;
    b.setColor(0xffffff).addGeometry(new THREE.BoxGeometry(L, H - 0.35, W), new THREE.Matrix4().makeTranslation(0, 0.35 + (H - 0.35) / 2, 0));
    b.setColor(0x1a222b).addGeometry(new THREE.BoxGeometry(L - 0.6, 1.0, W + 0.03), new THREE.Matrix4().makeTranslation(0.1, 1.95, 0));
    b.setColor(0x1a222b).addGeometry(new THREE.BoxGeometry(0.06, 1.5, W - 0.3), new THREE.Matrix4().makeTranslation(L / 2 + 0.01, 1.85, 0));
    b.setColor(0xe9edf0).addGeometry(new THREE.BoxGeometry(L - 0.4, 0.12, W - 0.2), new THREE.Matrix4().makeTranslation(0, H + 0.06, 0));
    wheels(b, L, W, 0.48, [-0.3, 0.32]);
  }
  const g = b.build();
  g.computeVertexNormals();
  return g;
}

function lampGeometry(cls: VehicleClass, which: 'head' | 'tail'): THREE.BufferGeometry {
  const spec = CLASSES[cls];
  const L = spec.len;
  const W = spec.width;
  const x = which === 'head' ? L / 2 + 0.005 : -L / 2 - 0.005;
  const y = cls === 'bus' ? 0.85 : which === 'head' ? 0.74 : 0.86;
  const b = new GeoBuilder();
  b.setColor(0xffffff);
  const box = new THREE.BoxGeometry(0.06, which === 'head' ? 0.13 : 0.16, cls === 'bus' ? 0.32 : 0.36);
  for (const side of [-1, 1]) b.addGeometry(box, new THREE.Matrix4().makeTranslation(x, y, side * (W / 2 - 0.3)));
  return b.build();
}

// ------------------------------------------------------------------ layer

interface ClassMeshes {
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  tail: THREE.InstancedMesh;
  ids: number[];
}

const MARK: Record<string, THREE.Color> = {
  robotaxi: new THREE.Color(0.27, 0.83, 0.91),
  car: new THREE.Color(0.86, 0.89, 0.93),
  van: new THREE.Color(0.86, 0.89, 0.93),
  bus: new THREE.Color(0.35, 0.66, 1.0),
  ambulance: new THREE.Color(1.0, 0.32, 0.31),
  advisory: new THREE.Color(0.96, 0.72, 0.25),
  mrc: new THREE.Color(1.0, 0.33, 0.31),
  dim: new THREE.Color(0.45, 0.14, 0.13),
};

const TAIL_ON = new THREE.Color(7, 0.35, 0.25);
const TAIL_OFF = new THREE.Color(0.9, 0.06, 0.05);
const HEAD = new THREE.Color(2.2, 2.0, 1.7);
const STATUS: Record<string, THREE.Color> = {
  normal: new THREE.Color(0.25, 2.2, 2.8),
  advisory: new THREE.Color(4.2, 2.6, 0.3),
  mrc: new THREE.Color(5.5, 0.4, 0.3),
  selected: new THREE.Color(4, 4, 4),
};

export class VehicleLayer {
  readonly group = new THREE.Group();
  private classes = {} as Record<VehicleClass, ClassMeshes>;
  private status: THREE.InstancedMesh;
  private statusIds: number[] = [];
  private beaconR: THREE.InstancedMesh;
  private beaconB: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private prev = new Map<number, Pose>();
  private curr = new Map<number, Pose>();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private pos = new THREE.Vector3();
  private col = new THREE.Color();
  /** screen-size markers that keep traffic readable from the overview */
  private markers: THREE.Points;
  private markerPos: Float32Array;
  private markerCol: Float32Array;
  markerOpacity = 0;
  selected: number | null = null;
  /** per-vehicle status override from the Digital Marshal layer (advisory, mrc ...) */
  statusOf: ((v: Vehicle) => keyof typeof STATUS) | null = null;

  constructor() {
    this.group.name = 'vehicles';
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.45, envMapIntensity: 1.1 });
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: false });
    for (const cls of CLASS_LIST) {
      const body = new THREE.InstancedMesh(bodyGeometry(cls), bodyMat, MAX);
      body.count = 0;
      body.castShadow = true;
      body.receiveShadow = false;
      body.frustumCulled = false;
      body.name = `veh-${cls}`;
      const head = new THREE.InstancedMesh(lampGeometry(cls, 'head'), lampMat, MAX);
      const tail = new THREE.InstancedMesh(lampGeometry(cls, 'tail'), lampMat, MAX);
      for (const m of [head, tail]) {
        m.count = 0;
        m.frustumCulled = false;
      }
      // allocate instance colour buffers
      body.setColorAt(0, new THREE.Color(1, 1, 1));
      head.setColorAt(0, HEAD);
      tail.setColorAt(0, TAIL_OFF);
      this.group.add(body, head, tail);
      this.classes[cls] = { body, head, tail, ids: [] };
    }
    // robotaxi status ring around the lidar puck
    const ringGeo = new THREE.TorusGeometry(0.27, 0.035, 6, 20);
    ringGeo.rotateX(Math.PI / 2);
    this.status = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial(), MAX);
    this.status.count = 0;
    this.status.frustumCulled = false;
    this.status.setColorAt(0, STATUS.normal);
    this.group.add(this.status);
    // ambulance light bar halves
    const half = new THREE.BoxGeometry(0.42, 0.14, 0.62);
    this.beaconR = new THREE.InstancedMesh(half, new THREE.MeshBasicMaterial(), 8);
    this.beaconB = new THREE.InstancedMesh(half, new THREE.MeshBasicMaterial(), 8);
    for (const m of [this.beaconR, this.beaconB]) {
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
    // selection ring on the ground
    const sel = new THREE.RingGeometry(3.4, 3.9, 48);
    sel.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      sel,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3.0), transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.group.add(this.ring);

    // operations markers: one dot per vehicle, constant on-screen size, faded in from afar
    this.markerPos = new Float32Array(MAX * 3);
    this.markerCol = new Float32Array(MAX * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.markerPos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('color', new THREE.BufferAttribute(this.markerCol, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setDrawRange(0, 0);
    const dot = document.createElement('canvas');
    dot.width = dot.height = 64;
    const g = dot.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.62, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(dot);
    this.markers = new THREE.Points(
      mg,
      new THREE.PointsMaterial({
        size: 7,
        sizeAttenuation: false,
        map: tex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        toneMapped: false,
      }),
    );
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 8;
    this.markers.name = 'vehicle-markers';
    this.group.add(this.markers);
  }

  /** Fade markers with camera distance (call each frame). */
  setCameraDistance(d: number): void {
    const k = Math.max(0, Math.min(1, (d - 380) / 520));
    this.markerOpacity = k;
    const m = this.markers.material as THREE.PointsMaterial;
    m.opacity = k * 0.95;
    m.size = 5.5 + k * 4;
    this.markers.visible = k > 0.01;
  }

  /** Static parked cars in the city's lots (decoration only; not part of the simulation). */
  setParked(spots: Array<{ x: number; y: number; a?: number; h?: number }>): void {
    if (!spots.length) return;
    const mesh = new THREE.InstancedMesh(bodyGeometry('car'), (this.classes.car.body.material as THREE.Material), spots.length);
    const palette = PAINT.car;
    spots.forEach((p, i) => {
      this.q.setFromAxisAngle(this.up, p.a ?? 0);
      this.tmp.compose(new THREE.Vector3(p.x, (p.h ?? 0) + 0.01, -p.y), this.q, this.one);
      mesh.setMatrixAt(i, this.tmp);
      mesh.setColorAt(i, this.col.setHex(palette[(i * 7 + 3) % palette.length]));
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'parked-cars';
    this.group.add(mesh);
  }

  /** Store current poses as the previous ones (call right before the last step of a frame). */
  capturePrev(engine: Engine): void {
    this.prev.clear();
    const st = engine.state;
    for (const id of st.order) {
      const p = this.curr.get(id);
      if (p) this.prev.set(id, p);
      else this.prev.set(id, vehiclePose(engine, st.vehicles[id]));
    }
  }

  /** Recompute current poses from the engine (after stepping). */
  refresh(engine: Engine, resetInterpolation = false): void {
    const st = engine.state;
    const next = new Map<number, Pose>();
    for (const id of st.order) next.set(id, vehiclePose(engine, st.vehicles[id]));
    this.curr = next;
    if (resetInterpolation) this.prev = new Map(next);
  }

  /** Interpolated pose of a vehicle (null when it is not in the simulation). */
  pose(id: number, alpha: number): Pose | null {
    const c = this.curr.get(id);
    if (!c) return null;
    const p = this.prev.get(id) ?? c;
    let dh = c.h - p.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    return { x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, h: p.h + dh * alpha };
  }

  /** Write instance matrices and colours for the current frame. */
  draw(engine: Engine, alpha: number, wallTime: number): void {
    const st = engine.state;
    for (const cls of CLASS_LIST) {
      const m = this.classes[cls];
      m.ids.length = 0;
      m.body.count = 0;
      m.head.count = 0;
      m.tail.count = 0;
    }
    this.status.count = 0;
    this.statusIds.length = 0;
    this.beaconR.count = 0;
    this.beaconB.count = 0;
    const blink = Math.floor(wallTime * 3.2) % 2 === 0;
    let mk = 0;
    for (const id of st.order) {
      const v = st.vehicles[id];
      const p = this.pose(id, alpha);
      if (!p) continue;
      const m = this.classes[v.cls];
      const i = m.ids.length;
      m.ids.push(id);
      this.q.setFromAxisAngle(this.up, p.h);
      this.pos.set(p.x, 0.03, -p.y);
      this.tmp.compose(this.pos, this.q, this.one);
      m.body.setMatrixAt(i, this.tmp);
      m.head.setMatrixAt(i, this.tmp);
      m.tail.setMatrixAt(i, this.tmp);
      this.col.setHex(PAINT[v.cls][v.paint % PAINT[v.cls].length]);
      m.body.setColorAt(i, this.col);
      m.head.setColorAt(i, HEAD);
      const braking = v.acc < -0.6 || v.v < 0.3;
      m.tail.setColorAt(i, braking ? TAIL_ON : TAIL_OFF);
      m.body.count = m.head.count = m.tail.count = i + 1;
      if (this.markers.visible && mk < MAX) {
        this.markerPos[mk * 3] = p.x;
        this.markerPos[mk * 3 + 1] = 4;
        this.markerPos[mk * 3 + 2] = -p.y;
        const st2 = this.statusOf ? this.statusOf(v) : v.mode === 'mrc' ? 'mrc' : 'normal';
        const c =
          v.cls === 'ambulance'
            ? MARK.ambulance
            : st2 === 'mrc'
              ? blink
                ? MARK.mrc
                : MARK.dim
              : st2 === 'advisory'
                ? MARK.advisory
                : MARK[v.cls];
        this.markerCol[mk * 3] = c.r;
        this.markerCol[mk * 3 + 1] = c.g;
        this.markerCol[mk * 3 + 2] = c.b;
        mk++;
      }
      if (v.cls === 'robotaxi') {
        const k = this.status.count;
        const L = CLASSES.robotaxi.len;
        const local = new THREE.Vector3(-0.02 * L, 1.66, 0).applyQuaternion(this.q);
        this.tmp.compose(new THREE.Vector3(p.x + local.x, 0.03 + local.y, -p.y + local.z), this.q, this.one);
        this.status.setMatrixAt(k, this.tmp);
        const s = id === this.selected ? 'selected' : this.statusOf ? this.statusOf(v) : v.mode === 'mrc' ? 'mrc' : 'normal';
        const c = STATUS[s];
        if (s === 'mrc' && !blink) this.col.setRGB(c.r * 0.25, c.g * 0.25, c.b * 0.25);
        else this.col.copy(c);
        this.status.setColorAt(k, this.col);
        this.status.count = k + 1;
        this.statusIds.push(id);
      }
      if (v.cls === 'ambulance') {
        const k = this.beaconR.count;
        const L = CLASSES.ambulance.len;
        for (const [mesh, side, on] of [
          [this.beaconR, 1, blink],
          [this.beaconB, -1, !blink],
        ] as Array<[THREE.InstancedMesh, number, boolean]>) {
          const local = new THREE.Vector3(0.18 * L, 2.69, side * 0.32).applyQuaternion(this.q);
          this.tmp.compose(new THREE.Vector3(p.x + local.x, 0.03 + local.y, -p.y + local.z), this.q, this.one);
          mesh.setMatrixAt(k, this.tmp);
          const base = mesh === this.beaconR ? [9, 0.5, 0.4] : [0.5, 1.6, 9];
          const f = on ? 1 : 0.06;
          mesh.setColorAt(k, this.col.setRGB(base[0] * f, base[1] * f, base[2] * f));
          mesh.count = k + 1;
        }
      }
    }
    for (const cls of CLASS_LIST) {
      const m = this.classes[cls];
      for (const mesh of [m.body, m.head, m.tail]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const mesh of [this.status, this.beaconR, this.beaconB]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const mgeo = this.markers.geometry;
    mgeo.setDrawRange(0, mk);
    (mgeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (mgeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    // selection ring
    const sp = this.selected !== null ? this.pose(this.selected, alpha) : null;
    this.ring.visible = !!sp;
    if (sp) {
      this.ring.position.set(sp.x, 0.08, -sp.y);
      const k = 1 + 0.06 * Math.sin(wallTime * 4);
      this.ring.scale.set(k, 1, k);
    }
  }

  /** Vehicle id under the ray, if any. */
  pick(ray: THREE.Raycaster): number | null {
    let best: { d: number; id: number } | null = null;
    for (const cls of CLASS_LIST) {
      const m = this.classes[cls];
      if (!m.body.count) continue;
      m.body.computeBoundingSphere();
      const hits = ray.intersectObject(m.body, false);
      for (const h of hits) {
        if (h.instanceId === undefined) continue;
        const id = m.ids[h.instanceId];
        if (id !== undefined && (!best || h.distance < best.d)) best = { d: h.distance, id };
      }
    }
    return best ? best.id : null;
  }
}
