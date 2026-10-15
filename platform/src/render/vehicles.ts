import * as THREE from 'three';
import type { Engine } from '../core/sim/engine';
import type { Vehicle, VehicleClass } from '../core/sim/types';
import { CLASSES, PAINT } from '../core/sim/params';
import { connectorPose, lanePose } from '../core/network/geometry';
import { GeoBuilder } from './city/builder';
import { ENV } from './env/uniforms';
import { BODY_STYLES, vehicleModel, type BodyStyle, type VehicleGeo } from './vehicleModels';

/* Vehicles drawn from simulation state. Each body style is a set of instanced meshes (clear-coated
   paint, glass, trim and tyres, head and tail lamps) in two levels of detail: the full model near
   the camera and a light one further out. Poses are interpolated between the last two simulation
   steps so motion is smooth at any speed. Ground effects are instanced too: the status ring under
   every automated vehicle, headlight beams after dusk, and the ambulance's flashing light on the
   road. Nothing here decides where a vehicle is: positions come only from the engine state. */

export interface Pose {
  x: number;
  y: number;
  h: number; // heading, rad (0 = east, counter-clockwise)
}

export const CLASS_LIST: VehicleClass[] = ['robotaxi', 'car', 'van', 'bus', 'ambulance'];
const MAX = 900;

/** Centre position and heading of a vehicle, from its front bumper position and the rear point. */
export function vehiclePose(engine: Engine, v: Vehicle): Pose {
  const front = pointAt(engine, v, v.s);
  const rear = pointAt(engine, v, v.s - v.len);
  const dx = front.x - rear.x;
  const dy = front.y - rear.y;
  const h = dx * dx + dy * dy > 1e-6 ? Math.atan2(dy, dx) : front.h;
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

/** Body style of a simulated vehicle (private cars are a mix of saloons and SUVs). */
function styleOf(v: Vehicle): BodyStyle {
  switch (v.cls) {
    case 'robotaxi':
      return 'robotaxi';
    case 'car':
      return v.id % 3 === 0 ? 'suv' : 'sedan';
    case 'van':
      return 'van';
    case 'bus':
      return 'bus';
    case 'ambulance':
      return 'ambulance';
  }
}

// ------------------------------------------------------------------ light geometry for parked cars

const M = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Parked car for the lots: body, darker cabin and tyres in one mesh (about 60 triangles). */
function parkedGeometry(): THREE.BufferGeometry {
  const L = 4.5;
  const W = 1.82;
  const b = new GeoBuilder();
  const body = new THREE.BoxGeometry(L, 0.6, W);
  b.setColor(0xffffff).addGeometry(body, M(0, 0.62, 0));
  const hood = new THREE.BoxGeometry(L * 0.3, 0.1, W - 0.1);
  b.addGeometry(hood, new THREE.Matrix4().makeRotationZ(-0.12).setPosition(L * 0.33, 0.93, 0));
  const cabin = new THREE.CylinderGeometry(0.62, 0.86, 0.46, 4, 1);
  cabin.rotateY(Math.PI / 4);
  cabin.scale(1.75, 1, 0.97);
  b.setColor(0x262c34).addGeometry(cabin, M(-0.1 * L, 1.15, 0));
  b.setColor(0x15161a).addGeometry(new THREE.BoxGeometry(L - 0.6, 0.3, W - 0.04), M(0, 0.22, 0));
  const g = b.build();
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ ground effect textures

function radial(stops: Array<[number, string]>, n = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (const [k, col] of stops) grd.addColorStop(k, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(c);
}

/** Headlight beam on the road: bright near the car, fading forward and to the sides. */
function beamTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 0.5;
      // canvas rows run top-down while texture v runs bottom-up: v = 0 (the car) is the last row
      const v = 1 - (y + 0.5) / h;
      const spread = 0.18 + v * 0.32;
      const across = Math.max(0, 1 - Math.abs(u) / spread);
      const along = Math.pow(1 - v, 1.4) * Math.min(1, v * 9);
      const k = Math.min(1, across * across * along * 1.4);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(k * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function additive(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -16,
    toneMapped: true,
  });
}

// ------------------------------------------------------------------ layer

interface StyleMeshes {
  paint: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  trim: THREE.InstancedMesh;
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
const TAIL_DAY = new THREE.Color(0.9, 0.06, 0.05);
const TAIL_NIGHT = new THREE.Color(2.6, 0.12, 0.08);
const HEAD_DAY = new THREE.Color(1.6, 1.6, 1.55);
const HEAD_NIGHT = new THREE.Color(6, 5.7, 5);
const STATUS: Record<string, THREE.Color> = {
  normal: new THREE.Color(0.25, 2.2, 2.8),
  advisory: new THREE.Color(4.2, 2.6, 0.3),
  mrc: new THREE.Color(5.5, 0.4, 0.3),
  selected: new THREE.Color(4, 4, 4),
};
/** ring colours on the road (additive, so kept modest) */
const RING: Record<string, THREE.Color> = {
  normal: new THREE.Color(0.1, 0.62, 0.78),
  advisory: new THREE.Color(0.95, 0.6, 0.08),
  mrc: new THREE.Color(1.1, 0.12, 0.08),
  selected: new THREE.Color(0.9, 0.95, 1.0),
};

export class VehicleLayer {
  readonly group = new THREE.Group();
  private styles = {} as Record<BodyStyle, { hi: StyleMeshes; lo: StyleMeshes }>;
  private status: THREE.InstancedMesh;
  private beaconR: THREE.InstancedMesh;
  private beaconB: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private rings: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  /** soft contact shadows; the only shadow vehicles get when they do not cast sun shadows */
  private blobs: THREE.InstancedMesh;
  private evGlow: THREE.Mesh;
  private prev = new Map<number, Pose>();
  private curr = new Map<number, Pose>();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private pos = new THREE.Vector3();
  private col = new THREE.Color();
  private scl = new THREE.Vector3();
  private local = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  /** screen-size markers that keep traffic readable from the overview */
  private markers: THREE.Points;
  private markerPos: Float32Array;
  private markerCol: Float32Array;
  private camDist = 1000;
  /** vehicles closer than this to the camera use the detailed model, m */
  lodRadius = 220;
  markerOpacity = 0;
  selected: number | null = null;
  /** per-vehicle status override from the Digital Marshal layer (advisory, mrc ...) */
  statusOf: ((v: Vehicle) => keyof typeof STATUS) | null = null;

  constructor() {
    this.group.name = 'vehicles';
    const paintMat = new THREE.MeshPhysicalMaterial({
      name: 'vehicle-paint',
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.35,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      name: 'vehicle-glass',
      color: 0x10161d,
      roughness: 0.04,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.8,
    });
    const trimMat = new THREE.MeshStandardMaterial({ name: 'vehicle-trim', vertexColors: true, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide });
    const lampMat = new THREE.MeshBasicMaterial({ name: 'vehicle-lamps' });
    for (const style of BODY_STYLES) {
      const make = (g: VehicleGeo, lod: string): StyleMeshes => {
        const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow: boolean, colored: boolean) => {
          const m = new THREE.InstancedMesh(geo, mat, MAX);
          m.count = 0;
          m.visible = false;
          m.castShadow = shadow;
          m.receiveShadow = !colored || name === 'paint';
          m.frustumCulled = false;
          m.name = `veh-${style}-${lod}-${name}`;
          // only meshes that are tinted per vehicle get an instance colour buffer
          if (colored) m.setColorAt(0, new THREE.Color(1, 1, 1));
          this.group.add(m);
          return m;
        };
        const set: StyleMeshes = {
          paint: mk(g.paint, paintMat, 'paint', true, true),
          glass: mk(g.glass, glassMat, 'glass', lod === 'hi', false),
          trim: mk(g.trim, trimMat, 'trim', true, false),
          head: mk(g.head, lampMat, 'head', false, true),
          tail: mk(g.tail, lampMat, 'tail', false, true),
          ids: [],
        };
        set.head.userData.noAO = true;
        set.tail.userData.noAO = true;
        return set;
      };
      this.styles[style] = { hi: make(vehicleModel(style, true), 'hi'), lo: make(vehicleModel(style, false), 'lo') };
    }
    // robotaxi status light around the lidar dome
    const ringGeo = new THREE.TorusGeometry(0.29, 0.03, 6, 24);
    ringGeo.rotateX(Math.PI / 2);
    this.status = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial(), MAX);
    this.status.count = 0;
    this.status.frustumCulled = false;
    this.status.setColorAt(0, STATUS.normal);
    this.group.add(this.status);
    // ambulance light bar halves
    const lamp = new THREE.BoxGeometry(0.34, 0.16, 0.34);
    this.beaconR = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial(), 16);
    this.beaconB = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial(), 16);
    for (const m of [this.beaconR, this.beaconB]) {
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
    // ground effects: status rings under automated vehicles, headlight beams, tail glows
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const ringTex = radial([
      [0, 'rgba(255,255,255,0)'],
      [0.62, 'rgba(255,255,255,0.05)'],
      [0.8, 'rgba(255,255,255,0.9)'],
      [0.86, 'rgba(255,255,255,0.55)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.rings = new THREE.InstancedMesh(flat, additive(ringTex), MAX);
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.rotateY(-Math.PI / 2); // texture v runs along +x (forward)
    this.beams = new THREE.InstancedMesh(beamGeo, additive(beamTexture()), MAX);
    const glowTex = radial([
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.35)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.glows = new THREE.InstancedMesh(flat, additive(glowTex), MAX);
    for (const m of [this.rings, this.beams, this.glows]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 6;
      m.userData.noAO = true;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
    // soft contact shadow under every vehicle (darkens: normal blending, black with a radial alpha)
    const blobTex = radial([
      [0, 'rgba(255,255,255,1)'],
      [0.55, 'rgba(255,255,255,0.75)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.blobs = new THREE.InstancedMesh(
      flat,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        alphaMap: blobTex,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -12,
      }),
      MAX,
    );
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 4;
    this.blobs.userData.noAO = true;
    this.group.add(this.blobs);
    this.evGlow = new THREE.Mesh(flat, additive(glowTex));
    this.evGlow.renderOrder = 6;
    this.evGlow.visible = false;
    this.evGlow.userData.noAO = true;
    this.group.add(this.evGlow);
    // selection ring on the ground
    const sel = new THREE.RingGeometry(3.6, 3.85, 64);
    sel.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      sel,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.7, 0.88), transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.ring.userData.noAO = true;
    this.group.add(this.ring);

    // operations markers: one dot per vehicle, constant on-screen size, faded in from afar
    this.markerPos = new Float32Array(MAX * 3);
    this.markerCol = new Float32Array(MAX * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.markerPos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('color', new THREE.BufferAttribute(this.markerCol, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setDrawRange(0, 0);
    const tex = radial(
      [
        [0, 'rgba(255,255,255,1)'],
        [0.45, 'rgba(255,255,255,0.95)'],
        [0.62, 'rgba(255,255,255,0.35)'],
        [1, 'rgba(255,255,255,0)'],
      ],
      64,
    );
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
    this.camDist = d;
    const k = Math.max(0, Math.min(1, (d - 420) / 520));
    this.markerOpacity = k;
    const m = this.markers.material as THREE.PointsMaterial;
    m.opacity = k * 0.95;
    m.size = 5.5 + k * 4;
    this.markers.visible = k > 0.01;
  }

  /** Real sun shadows from vehicles (dynamic shadow map), or contact shadows only. */
  setShadowMode(dynamic: boolean): void {
    for (const m of this.sets()) {
      m.paint.castShadow = dynamic;
      m.trim.castShadow = dynamic;
      m.glass.castShadow = false;
    }
    (this.blobs.material as THREE.MeshBasicMaterial).opacity = dynamic ? 0.32 : 0.62;
  }

  /** Camera position for the level of detail (call each frame before draw). */
  setCamera(p: THREE.Vector3): void {
    this.camPos.copy(p);
  }

  /** Static parked cars in the city's lots (decoration only; not part of the simulation). */
  setParked(spots: Array<{ x: number; y: number; a?: number; h?: number }>): void {
    if (!spots.length) return;
    const mat = new THREE.MeshStandardMaterial({ name: 'parked-cars', vertexColors: true, roughness: 0.35, metalness: 0.45, envMapIntensity: 1.2 });
    const mesh = new THREE.InstancedMesh(parkedGeometry(), mat, spots.length);
    const palette = PAINT.car;
    spots.forEach((p, i) => {
      this.q.setFromAxisAngle(this.up, p.a ?? 0);
      this.tmp.compose(new THREE.Vector3(p.x, (p.h ?? 0) + 0.01, -p.y), this.q, this.one);
      mesh.setMatrixAt(i, this.tmp);
      mesh.setColorAt(i, this.col.setHex(palette[(i * 7 + 3) % palette.length]));
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
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

  /** Place an instance at the vehicle pose with a local offset and scale. */
  private at(mesh: THREE.InstancedMesh, i: number, p: Pose, lx: number, ly: number, lz: number, sx = 1, sy = 1, sz = 1): void {
    this.local.set(lx, ly, lz).applyQuaternion(this.q);
    this.pos.set(p.x + this.local.x, 0.03 + this.local.y, -p.y + this.local.z);
    this.scl.set(sx, sy, sz);
    this.tmp.compose(this.pos, this.q, this.scl);
    mesh.setMatrixAt(i, this.tmp);
  }

  private sets(): StyleMeshes[] {
    const out: StyleMeshes[] = [];
    for (const s of BODY_STYLES) out.push(this.styles[s].hi, this.styles[s].lo);
    return out;
  }

  /** Write instance matrices and colours for the current frame. */
  draw(engine: Engine, alpha: number, wallTime: number): void {
    const st = engine.state;
    for (const m of this.sets()) {
      m.ids.length = 0;
      m.paint.count = m.glass.count = m.trim.count = m.head.count = m.tail.count = 0;
    }
    this.status.count = 0;
    this.beaconR.count = 0;
    this.beaconB.count = 0;
    let nRing = 0;
    let nBeam = 0;
    let nGlow = 0;
    let nBlob = 0;
    const lamp = ENV.uLamp.value;
    const night = Math.min(1, lamp * 1.2);
    const blink = Math.floor(wallTime * 3.2) % 2 === 0;
    // rings read best at street and district scale; the overview has markers instead
    const ringK = Math.max(0, Math.min(1, (900 - this.camDist) / 500)) * (0.55 + 0.45 * night);
    const fxNear = this.camDist < 1400;
    const lod2 = this.lodRadius * this.lodRadius;
    let mk = 0;
    let ev: Pose | null = null;
    for (const id of st.order) {
      const v = st.vehicles[id];
      const p = this.pose(id, alpha);
      if (!p) continue;
      const dx = p.x - this.camPos.x;
      const dz = -p.y - this.camPos.z;
      const near = dx * dx + dz * dz < lod2 || id === this.selected;
      const style = styleOf(v);
      const m = near ? this.styles[style].hi : this.styles[style].lo;
      const i = m.ids.length;
      m.ids.push(id);
      this.q.setFromAxisAngle(this.up, p.h);
      this.pos.set(p.x, 0.03, -p.y);
      this.tmp.compose(this.pos, this.q, this.one);
      m.paint.setMatrixAt(i, this.tmp);
      m.glass.setMatrixAt(i, this.tmp);
      m.trim.setMatrixAt(i, this.tmp);
      m.head.setMatrixAt(i, this.tmp);
      m.tail.setMatrixAt(i, this.tmp);
      this.col.setHex(PAINT[v.cls][v.paint % PAINT[v.cls].length]);
      m.paint.setColorAt(i, this.col);
      this.col.copy(HEAD_DAY).lerp(HEAD_NIGHT, night);
      m.head.setColorAt(i, this.col);
      const braking = v.acc < -0.6 || v.v < 0.3;
      if (braking) m.tail.setColorAt(i, TAIL_ON);
      else m.tail.setColorAt(i, this.col.copy(TAIL_DAY).lerp(TAIL_NIGHT, night));
      m.paint.count = m.glass.count = m.trim.count = m.head.count = m.tail.count = i + 1;
      const s2 = this.statusOf ? this.statusOf(v) : v.mode === 'mrc' ? 'mrc' : 'normal';
      if (this.markers.visible && mk < MAX) {
        this.markerPos[mk * 3] = p.x;
        this.markerPos[mk * 3 + 1] = 4;
        this.markerPos[mk * 3 + 2] = -p.y;
        const c =
          v.cls === 'ambulance' ? MARK.ambulance : s2 === 'mrc' ? (blink ? MARK.mrc : MARK.dim) : s2 === 'advisory' ? MARK.advisory : MARK[v.cls];
        this.markerCol[mk * 3] = c.r;
        this.markerCol[mk * 3 + 1] = c.g;
        this.markerCol[mk * 3 + 2] = c.b;
        mk++;
      }
      const L = CLASSES[v.cls].len;
      if (fxNear) {
        this.at(this.blobs, nBlob++, p, 0, 0.045, 0, L * 1.18, 1, CLASSES[v.cls].width * 1.55);
        // automated vehicles carry a status ring on the road
        if (v.av && ringK > 0.01) {
          const key = id === this.selected ? 'selected' : s2;
          const c = RING[key] ?? RING.normal;
          const k = ringK * (key === 'mrc' && !blink ? 0.3 : 1);
          this.at(this.rings, nRing, p, 0, 0.06, 0, L + 2.2, 1, L + 2.2);
          this.rings.setColorAt(nRing++, this.col.setRGB(c.r * k, c.g * k, c.b * k));
        }
        if (night > 0.02 && v.cls !== 'bus') {
          this.at(this.beams, nBeam, p, L / 2 + 7.5, 0.05, 0, 15, 1, 6.5);
          const k = 0.5 * night;
          this.beams.setColorAt(nBeam++, this.col.setRGB(0.95 * k, 0.88 * k, 0.72 * k));
        }
        if (night > 0.02) {
          this.at(this.glows, nGlow, p, -L / 2 - 1.2, 0.05, 0, 4.5, 1, 3.4);
          const k = (braking ? 0.75 : 0.35) * night;
          this.glows.setColorAt(nGlow++, this.col.setRGB(0.9 * k, 0.05 * k, 0.03 * k));
        }
      }
      if (v.cls === 'robotaxi') {
        const k = this.status.count;
        this.at(this.status, k, p, -0.1 * L, 1.86, 0);
        const s = id === this.selected ? 'selected' : s2;
        const c = STATUS[s];
        if (s === 'mrc' && !blink) this.col.setRGB(c.r * 0.25, c.g * 0.25, c.b * 0.25);
        else this.col.copy(c);
        this.status.setColorAt(k, this.col);
        this.status.count = k + 1;
      }
      if (v.cls === 'ambulance') {
        ev = p;
        // beacons on the four top corners of the patient module, red and blue alternating
        for (const [lx, side] of [
          [0.12 * L - 0.22, 1],
          [-0.5 * L + 0.22, -1],
        ]) {
          for (const [mesh, s, on] of [
            [this.beaconR, side, blink],
            [this.beaconB, -side, !blink],
          ] as Array<[THREE.InstancedMesh, number, boolean]>) {
            const k = mesh.count;
            this.at(mesh, k, p, lx, 2.68, s * 0.88);
            const base = mesh === this.beaconR ? [9, 0.5, 0.4] : [0.5, 1.6, 9];
            const f = on ? 1 : 0.05;
            mesh.setColorAt(k, this.col.setRGB(base[0] * f, base[1] * f, base[2] * f));
            mesh.count = k + 1;
          }
        }
      }
    }
    for (const m of this.sets()) {
      for (const mesh of [m.paint, m.glass, m.trim, m.head, m.tail]) {
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.rings.count = nRing;
    this.beams.count = nBeam;
    this.glows.count = nGlow;
    this.blobs.count = nBlob;
    for (const mesh of [this.status, this.beaconR, this.beaconB, this.rings, this.beams, this.glows, this.blobs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // the ambulance washes the road in red and blue
    this.evGlow.visible = !!ev;
    if (ev) {
      const k = 0.18 + 0.5 * night;
      this.evGlow.position.set(ev.x, 0.07, -ev.y);
      this.evGlow.scale.set(15, 1, 15);
      (this.evGlow.material as THREE.MeshBasicMaterial).color.setRGB(blink ? 1.1 * k : 0.08 * k, 0.08 * k, blink ? 0.12 * k : 1.3 * k);
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
    for (const m of this.sets()) {
      if (!m.paint.count) continue;
      m.paint.computeBoundingSphere();
      const hits = ray.intersectObject(m.paint, false);
      for (const h of hits) {
        if (h.instanceId === undefined) continue;
        const id = m.ids[h.instanceId];
        if (id !== undefined && (!best || h.distance < best.d)) best = { d: h.distance, id };
      }
    }
    return best ? best.id : null;
  }
}
