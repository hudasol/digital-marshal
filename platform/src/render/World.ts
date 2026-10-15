import * as THREE from 'three';
import { CameraRig } from './CameraRig';
import { QUALITY, type QualityProfile } from './quality';
import type { QualityTier } from '../app/store';
import { Atmosphere } from './env/atmosphere';
import { buildTerrain } from './env/terrain';
import { PostFX } from './post';

/* The render host: renderer, atmosphere (sky, sun, haze, time of day), terrain, post-processing,
   input and per-frame statistics. It draws whatever layers are attached to `scene`; it knows
   nothing about traffic. */

export interface FrameStats {
  calls: number;
  tris: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
}

export interface PickHandler {
  (ndc: THREE.Vector2, ray: THREE.Raycaster, ev: PointerEvent): boolean;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly atmosphere: Atmosphere;
  readonly host: HTMLElement;
  private post: PostFX | null = null;
  private profile: QualityProfile = QUALITY.balanced;
  private width = 1;
  private height = 1;
  private viewShift = 0;
  private viewShiftWant = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly frameTarget = new THREE.Vector3();
  private disposers: Array<() => void> = [];
  pickHandler: PickHandler | null = null;
  hoverHandler: ((ndc: THREE.Vector2, ray: THREE.Raycaster) => void) | null = null;
  onDragState: ((dragging: boolean) => void) | null = null;
  /** called every frame after the camera moved, before drawing (screen-space labels follow it) */
  onCamera: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    const r = new THREE.WebGLRenderer({
      // the scene renders into a multisampled target; the canvas itself needs no antialiasing
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // redrawn on demand (see frame): the city is static, so a still view reuses the last map
    r.shadowMap.autoUpdate = false;
    r.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(r.domElement);
    this.renderer = r;

    this.rig = new CameraRig(1);
    this.atmosphere = new Atmosphere(r, this.scene);
    this.atmosphere.sun.shadow.radius = 1.6;
    this.scene.add(buildTerrain());

    this.attachInput();
    this.resize();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
  }

  // ---------------------------------------------------------------- quality

  setQuality(tier: QualityTier): void {
    this.profile = QUALITY[tier];
    const p = this.profile;
    const pr = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = p.shadows;
    const sun = this.atmosphere.sun;
    sun.castShadow = p.shadows;
    if (p.shadows) {
      sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.post?.dispose();
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera, p);
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  /** Ask for the shadow map to be drawn again on the next frame (scene content changed). */
  refreshShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  get quality(): QualityProfile {
    return this.profile;
  }

  // ---------------------------------------------------------------- layout

  /** Horizontal shift (CSS px) of the projection centre so the focus sits in the free area between panels. */
  setViewShift(px: number, immediate = false): void {
    this.viewShiftWant = px;
    if (immediate) this.viewShift = px;
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.applyViewOffset();
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
  }

  private applyViewOffset(): void {
    const cam = this.rig.camera;
    if (Math.abs(this.viewShift) < 0.5) {
      cam.clearViewOffset();
    } else {
      cam.setViewOffset(this.width, this.height, -this.viewShift, 0, this.width, this.height);
    }
    cam.updateProjectionMatrix();
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  // ---------------------------------------------------------------- input

  private attachInput(): void {
    const el = this.host;
    const ptrs = new Map<number, { x: number; y: number; button: number }>();
    let moved = 0;
    let pinchDist = 0;
    let downAt = 0;

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      moved = 0;
      downAt = performance.now();
      pinchDist = 0;
      el.focus({ preventScroll: true });
    };
    const onMove = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.hoverHandler) {
          this.setNdc(e);
          this.raycaster.setFromCamera(this.ndc, this.rig.camera);
          this.hoverHandler(this.ndc, this.raycaster);
        }
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) this.onDragState?.(true);
      if (ptrs.size >= 2) {
        const pts = [...ptrs.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist > 0) this.rig.zoom(pinchDist / Math.max(1, d));
        pinchDist = d;
        // two-finger drag pans
        this.rig.pan(dx / 2, dy / 2, this.height);
        return;
      }
      const panMode = p.button === 2 || p.button === 1 || e.shiftKey || e.ctrlKey;
      if (panMode) this.rig.pan(dx, dy, this.height);
      else this.rig.orbit(-dx * 0.0052, dy * 0.0042);
    };
    const onUp = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) this.onDragState?.(false);
      if (p && moved < 6 && performance.now() - downAt < 600 && e.type === 'pointerup' && p.button === 0) {
        this.setNdc(e);
        this.raycaster.setFromCamera(this.ndc, this.rig.camera);
        this.pickHandler?.(this.ndc.clone(), this.raycaster, e);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.setNdc(e);
      this.raycaster.setFromCamera(this.ndc, this.rig.camera);
      const hit = new THREE.Vector3();
      const ok = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
      const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0012));
      this.rig.zoom(factor, ok ? hit : undefined);
    };
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
    });
  }

  private setNdc(e: { clientX: number; clientY: number }): void {
    const r = this.host.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Keyboard camera control, called by the app when the canvas has focus. */
  handleKey(e: KeyboardEvent): boolean {
    const k = e.key;
    const step = e.shiftKey ? 60 : 0;
    if (k === 'ArrowLeft') {
      if (step) this.rig.pan(step, 0, this.height);
      else this.rig.orbit(0.08, 0);
      return true;
    }
    if (k === 'ArrowRight') {
      if (step) this.rig.pan(-step, 0, this.height);
      else this.rig.orbit(-0.08, 0);
      return true;
    }
    if (k === 'ArrowUp') {
      if (step) this.rig.pan(0, step, this.height);
      else this.rig.orbit(0, 0.05);
      return true;
    }
    if (k === 'ArrowDown') {
      if (step) this.rig.pan(0, -step, this.height);
      else this.rig.orbit(0, -0.05);
      return true;
    }
    if (k === '+' || k === '=') {
      this.rig.zoom(0.85);
      return true;
    }
    if (k === '-' || k === '_') {
      this.rig.zoom(1 / 0.85);
      return true;
    }
    return false;
  }

  /** Ground point (y = 0) under a normalised device coordinate. */
  groundAt(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  private readonly projTmp = new THREE.Vector3();
  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(v: THREE.Vector3): { x: number; y: number } | null {
    const p = this.projTmp.copy(v).project(this.rig.camera);
    if (p.z > 1 || p.z < -1) return null;
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (-p.y * 0.5 + 0.5) * this.height };
  }

  // ---------------------------------------------------------------- frame

  /** Advance camera and draw one frame. */
  frame(dt: number): FrameStats {
    // ease the projection centre toward the free area between panels
    if (Math.abs(this.viewShift - this.viewShiftWant) > 0.25) {
      this.viewShift += (this.viewShiftWant - this.viewShift) * (1 - Math.exp(-dt * 8));
      this.applyViewOffset();
    } else if (this.viewShift !== this.viewShiftWant) {
      this.viewShift = this.viewShiftWant;
      this.applyViewOffset();
    }
    this.rig.update(dt);
    const cam = this.rig.camera;
    const half = THREE.MathUtils.clamp(this.rig.pose.dist * 0.75, 90, 1150);
    const moved = this.atmosphere.update(cam, this.rig.targetInto(this.frameTarget), half, this.atmosphere.sun.shadow.mapSize.x);
    // moving casters (vehicles) need a fresh map every frame on tiers that draw their shadows
    if (moved || this.profile.dynamicShadows) this.renderer.shadowMap.needsUpdate = true;
    this.onCamera?.();

    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    if (this.post) {
      this.post.setBloom(this.profile.bloom ? this.atmosphere.bloom : 0);
      this.post.render(dt);
    } else this.renderer.render(this.scene, cam);

    return {
      calls: info.render.calls,
      tris: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.post?.dispose();
    this.atmosphere.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
