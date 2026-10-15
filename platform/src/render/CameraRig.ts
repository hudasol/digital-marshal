import * as THREE from 'three';
import type { CamMode } from '../app/store';

/* Orbit-style camera rig.
   Pose = target point + yaw + pitch + distance + vertical field of view.
   Every change is either a timed transition (eased, with an optional "hop" that lifts the camera
   on long moves) or exponential damping toward user input, so the view never jumps. Camera changes
   never touch the simulation. World convention: x east, z south (sim y north = -z), y up. */

export interface Pose {
  tx: number;
  ty: number;
  tz: number;
  yaw: number; // 0 = camera south of target looking north; positive rotates counter-clockwise seen from above
  pitch: number; // radians above the horizon
  dist: number;
  fov: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FollowTarget {
  x: number;
  y: number;
  z: number;
  heading: number; // radians, direction of travel in the xz plane (atan2(-dz, dx) convention: 0 = east)
  speed: number;
}

const TAU = Math.PI * 2;

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  pose: Pose;
  private want: Pose;
  private from: Pose | null = null;
  private to: Pose | null = null;
  private tStart = 0;
  private tDur = 0;
  private hop = 0;
  mode: CamMode = 'overview';
  bounds: Bounds = { minX: -900, maxX: 900, minZ: -900, maxZ: 900 };
  follow: (() => FollowTarget | null) | null = null;
  followYawOffset = 0;
  followPitch = 0.42;
  followDist = 48;
  reducedMotion = false;
  /** Called when user input takes over a preset mode, so the UI can switch to "free". */
  onUserTakeover: (() => void) | null = null;
  private presets: Partial<Record<CamMode, Pose>> = {};
  private obstacle: ((from: THREE.Vector3, to: THREE.Vector3) => number | null) | null = null;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 1.5, 9000);
    this.pose = { tx: 0, ty: 0, tz: 0, yaw: 0.6, pitch: 0.5, dist: 1400, fov: 40 };
    this.want = { ...this.pose };
    this.apply();
  }

  setPreset(mode: CamMode, p: Pose): void {
    this.presets[mode] = p;
  }

  getPreset(mode: CamMode): Pose | undefined {
    return this.presets[mode];
  }

  setObstacleTest(fn: (from: THREE.Vector3, to: THREE.Vector3) => number | null): void {
    this.obstacle = fn;
  }

  /** Eased transition to a pose. Duration scales with how far the view travels. */
  flyTo(p: Pose, opts: { duration?: number; hop?: boolean } = {}): void {
    const now = performance.now() / 1000;
    const dx = p.tx - this.pose.tx;
    const dz = p.tz - this.pose.tz;
    const travel = Math.hypot(dx, dz);
    const zoom = Math.abs(Math.log(p.dist / Math.max(1, this.pose.dist)));
    const dur = this.reducedMotion
      ? 0.001
      : (opts.duration ?? Math.min(2.6, 0.9 + travel / 900 + zoom * 0.35));
    const target: Pose = { ...p, yaw: this.pose.yaw + wrapAngle(p.yaw - this.pose.yaw) };
    this.from = { ...this.pose };
    this.to = target;
    this.tStart = now;
    this.tDur = dur;
    this.hop = opts.hop === false || this.reducedMotion ? 0 : Math.min(0.55, travel / Math.max(200, p.dist * 2.2));
    this.want = { ...target };
  }

  /** Switch mode; presets fly, follow modes attach to the target provider. */
  setMode(mode: CamMode, follow?: () => FollowTarget | null): void {
    this.mode = mode;
    if (mode === 'follow' || mode === 'emergency') {
      this.follow = follow ?? this.follow;
      this.followYawOffset = 0;
      if (mode === 'emergency') {
        this.followPitch = 0.3;
        this.followDist = 42;
      } else {
        this.followPitch = 0.46;
        this.followDist = 52;
      }
      const f = this.follow?.();
      if (f) {
        this.flyTo(
          {
            tx: f.x,
            ty: f.y,
            tz: f.z,
            yaw: this.chaseYaw(f.heading),
            pitch: this.followPitch,
            dist: this.followDist,
            fov: mode === 'emergency' ? 50 : 44,
          },
          { duration: this.reducedMotion ? 0.001 : 1.6 },
        );
      }
      return;
    }
    this.follow = null;
    const p = this.presets[mode];
    if (p) this.flyTo(p);
  }

  /** Camera yaw that places the camera behind a vehicle with the given heading. */
  chaseYaw(heading: number): number {
    // heading 0 = travelling east (+x); travel direction in (x, z) is (cos h, -sin h).
    // Camera offset = (sin(yaw), cos(yaw)) must point backwards: (-cos h, sin h) -> yaw = h - PI/2.
    return wrapAngle(heading - Math.PI / 2);
  }

  focus(x: number, z: number, dist = 240, pitch = 0.62, yaw?: number): void {
    this.flyTo({ tx: x, ty: 0, tz: z, yaw: yaw ?? this.pose.yaw, pitch, dist, fov: 40 });
  }

  // ---------------------------------------------------------------- user input

  private takeover(): void {
    if (this.from) {
      // freeze the in-flight transition where it is
      this.want = { ...this.pose };
      this.from = this.to = null;
    }
    if (this.mode !== 'free' && this.mode !== 'follow' && this.mode !== 'emergency') {
      this.mode = 'free';
      this.onUserTakeover?.();
    }
  }

  orbit(dYaw: number, dPitch: number): void {
    this.takeover();
    if (this.follow && (this.mode === 'follow' || this.mode === 'emergency')) {
      this.followYawOffset = wrapAngle(this.followYawOffset + dYaw);
      this.followPitch = THREE.MathUtils.clamp(this.followPitch + dPitch, 0.06, 1.45);
      return;
    }
    this.want.yaw += dYaw;
    this.want.pitch = THREE.MathUtils.clamp(this.want.pitch + dPitch, 0.05, 1.5);
  }

  pan(dxScreen: number, dyScreen: number, viewH: number): void {
    if (this.follow && (this.mode === 'follow' || this.mode === 'emergency')) return; // follow keeps the vehicle centred
    this.takeover();
    // metres per pixel at the target distance
    const mpp = (2 * this.pose.dist * Math.tan(THREE.MathUtils.degToRad(this.pose.fov) / 2)) / Math.max(1, viewH);
    const sy = Math.sin(this.want.yaw);
    const cy = Math.cos(this.want.yaw);
    // screen right vector in the xz plane, and screen-up projected onto the ground (away from camera)
    const rx = cy;
    const rz = -sy;
    const fx = -sy;
    const fz = -cy;
    const k = mpp / Math.max(0.35, Math.sin(this.want.pitch));
    this.want.tx += (-dxScreen * rx) * mpp + dyScreen * fx * k;
    this.want.tz += (-dxScreen * rz) * mpp + dyScreen * fz * k;
    this.clampTarget(this.want);
  }

  /** Zoom by a factor; when a ground point under the cursor is given, zoom toward it. */
  zoom(factor: number, toward?: THREE.Vector3): void {
    if (this.follow && (this.mode === 'follow' || this.mode === 'emergency')) {
      this.followDist = THREE.MathUtils.clamp(this.followDist * factor, 14, 400);
      return;
    }
    this.takeover();
    const before = this.want.dist;
    const after = THREE.MathUtils.clamp(before * factor, 18, 3200);
    this.want.dist = after;
    if (toward && factor < 1) {
      const k = 1 - after / before;
      this.want.tx += (toward.x - this.want.tx) * k;
      this.want.tz += (toward.z - this.want.tz) * k;
      this.clampTarget(this.want);
    }
  }

  private clampTarget(p: Pose): void {
    const m = 250;
    p.tx = THREE.MathUtils.clamp(p.tx, this.bounds.minX - m, this.bounds.maxX + m);
    p.tz = THREE.MathUtils.clamp(p.tz, this.bounds.minZ - m, this.bounds.maxZ + m);
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number): void {
    const now = performance.now() / 1000;
    const f = this.follow && (this.mode === 'follow' || this.mode === 'emergency') ? this.follow() : null;
    if (f && !this.from) {
      // chase: target leads the vehicle slightly so it sits a little below centre in direction of travel
      const lead = Math.min(14, f.speed * 0.9);
      const hx = Math.cos(f.heading);
      const hz = -Math.sin(f.heading);
      this.want.tx = f.x + hx * lead;
      this.want.ty = f.y + 1.2;
      this.want.tz = f.z + hz * lead;
      const desiredYaw = this.chaseYaw(f.heading) + this.followYawOffset;
      this.want.yaw = this.pose.yaw + wrapAngle(desiredYaw - this.pose.yaw);
      this.want.pitch = this.followPitch;
      this.want.dist = this.followDist;
      this.want.fov = this.mode === 'emergency' ? 50 : 44;
    }

    if (this.from && this.to) {
      if (f) {
        // keep the destination attached to a moving vehicle during the approach
        this.to.tx = f.x;
        this.to.ty = f.y + 1.2;
        this.to.tz = f.z;
      }
      const raw = Math.min(1, (now - this.tStart) / Math.max(0.001, this.tDur));
      const e = easeInOutCubic(raw);
      const a = this.from;
      const b = this.to;
      this.pose.tx = a.tx + (b.tx - a.tx) * e;
      this.pose.ty = a.ty + (b.ty - a.ty) * e;
      this.pose.tz = a.tz + (b.tz - a.tz) * e;
      this.pose.yaw = a.yaw + (b.yaw - a.yaw) * e;
      this.pose.pitch = a.pitch + (b.pitch - a.pitch) * e;
      // interpolate distance in log space; "hop" lifts the camera mid-flight on long moves
      const ld = Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * e;
      this.pose.dist = Math.exp(ld) * (1 + this.hop * Math.sin(Math.PI * e));
      this.pose.fov = a.fov + (b.fov - a.fov) * e;
      if (raw >= 1) {
        this.pose = { ...b };
        this.want = { ...b };
        this.from = this.to = null;
      }
    } else {
      const chase = !!f;
      const k = 1 - Math.exp(-dt * (chase ? (this.mode === 'emergency' ? 5.5 : 4.5) : 9));
      const p = this.pose;
      const w = this.want;
      p.tx += (w.tx - p.tx) * k;
      p.ty += (w.ty - p.ty) * k;
      p.tz += (w.tz - p.tz) * k;
      p.yaw += wrapAngle(w.yaw - p.yaw) * k;
      p.pitch += (w.pitch - p.pitch) * k;
      p.dist = Math.exp(Math.log(p.dist) + (Math.log(w.dist) - Math.log(p.dist)) * k);
      p.fov += (w.fov - p.fov) * k;
    }
    this.apply();
  }

  private apply(): void {
    const p = this.pose;
    const cp = Math.cos(p.pitch);
    let dist = p.dist;
    const tx = p.tx;
    const ty = p.ty;
    const tz = p.tz;
    const ox = Math.sin(p.yaw) * cp;
    const oy = Math.sin(p.pitch);
    const oz = Math.cos(p.yaw) * cp;
    // keep the camera out of buildings on low shots by pulling it toward the target
    if (this.obstacle && p.pitch < 0.9 && dist < 600) {
      this.tmpA.set(tx, ty + 2, tz);
      this.tmpB.set(tx + ox * dist, ty + oy * dist, tz + oz * dist);
      const hit = this.obstacle(this.tmpA, this.tmpB);
      if (hit !== null && hit < dist) dist = Math.max(10, hit - 3);
    }
    let cy = ty + oy * dist;
    if (cy < 2.2) cy = 2.2; // never below street level
    this.camera.position.set(tx + ox * dist, cy, tz + oz * dist);
    this.camera.lookAt(tx, ty, tz);
    if (Math.abs(this.camera.fov - p.fov) > 1e-3) {
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
    }
    const near = THREE.MathUtils.clamp(dist * 0.02, 0.5, 20);
    const far = Math.max(6000, dist * 6);
    if (Math.abs(this.camera.near - near) / near > 0.15 || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  get target(): THREE.Vector3 {
    return new THREE.Vector3(this.pose.tx, this.pose.ty, this.pose.tz);
  }
}
