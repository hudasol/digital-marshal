import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CameraRig } from './CameraRig';
import { QUALITY, type QualityProfile } from './quality';
import type { QualityTier } from '../app/store';

/* The render host: renderer, lighting, sky, post-processing, input and per-frame statistics.
   It draws whatever layers are attached to `scene`; it knows nothing about traffic. */

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

/** Late-afternoon sun over the district: west-south-west, low in the sky. */
export const SUN = { azimuthDeg: 246, elevationDeg: 19 };

export function sunDirection(): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(SUN.azimuthDeg);
  const el = THREE.MathUtils.degToRad(SUN.elevationDeg);
  // x east, y up, z south
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly host: HTMLElement;
  private sky: Sky;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private profile: QualityProfile = QUALITY.balanced;
  private width = 1;
  private height = 1;
  private viewShift = 0;
  private viewShiftWant = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private disposers: Array<() => void> = [];
  pickHandler: PickHandler | null = null;
  hoverHandler: ((ndc: THREE.Vector2, ray: THREE.Raycaster) => void) | null = null;
  onDragState: ((dragging: boolean) => void) | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    const r = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.5;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = true;
    r.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(r.domElement);
    this.renderer = r;

    this.rig = new CameraRig(1);

    // atmosphere
    const fogColor = new THREE.Color(0xc6b7a2);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.00026);
    this.scene.background = fogColor.clone();

    // sky box follows the camera and is drawn first; everything else draws over it
    this.sky = new Sky();
    this.sky.scale.setScalar(6000);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u['turbidity'].value = 7.5;
    u['rayleigh'].value = 1.6;
    u['mieCoefficient'].value = 0.0055;
    u['mieDirectionalG'].value = 0.82;
    u['cloudCoverage'].value = 0.14;
    u['cloudDensity'].value = 0.3;
    const sd = sunDirection();
    u['sunPosition'].value.copy(sd);
    this.scene.add(this.sky);

    // lights
    this.hemi = new THREE.HemisphereLight(0xc4d6f2, 0x9c8466, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9ae, 5.6);
    this.sun.position.copy(sd).multiplyScalar(1200);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.buildEnvironment();
    this.buildGround();
    this.attachInput();
    this.resize();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
  }

  /** Image based lighting from the same sky, so glass and car paint reflect the sunset. */
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const su = sky.material.uniforms;
    const u = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity'])
      su[k].value = u[k].value;
    su['sunPosition'].value.copy(u['sunPosition'].value);
    su['showSunDisc'].value = 0;
    envScene.add(sky);
    // a warm ground bounce in the lower hemisphere of the environment
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x6f5f4b, side: THREE.BackSide }),
    );
    envScene.add(ground);
    this.envTarget = pmrem.fromScene(envScene, 0.02, 1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 1.0;
    pmrem.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
  }

  /** Desert ground that the district sits on; the city layer draws its own paved base. */
  private buildGround(): void {
    const size = 14000;
    const tex = makeSandTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 90, size / 90);
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9c3a0, map: tex, roughness: 0.97, metalness: 0 });
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -0.06;
    m.receiveShadow = true;
    m.name = 'ground';
    this.scene.add(m);
  }

  // ---------------------------------------------------------------- quality

  setQuality(tier: QualityTier): void {
    this.profile = QUALITY[tier];
    const p = this.profile;
    const pr = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    if (p.shadows) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.rebuildComposer();
    this.resize();
  }

  get quality(): QualityProfile {
    return this.profile;
  }

  private rebuildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.profile.postprocessing) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: this.profile.msaaSamples,
    });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.rig.camera));
    if (this.profile.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.38, 1.0);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    this.composer = c;
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
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
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

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(v: THREE.Vector3): { x: number; y: number } | null {
    const p = v.clone().project(this.rig.camera);
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
    this.sky.position.copy(cam.position);

    // shadow frustum follows the camera target and scales with zoom, snapped to texels to avoid shimmer
    if (this.profile.shadows) {
      const t = this.rig.target;
      const half = THREE.MathUtils.clamp(this.rig.pose.dist * 0.75, 90, 1100);
      const sc = this.sun.shadow.camera;
      const texel = (half * 2) / this.sun.shadow.mapSize.x;
      const sd = sunDirection();
      // snap target in light space
      const snapX = Math.round(t.x / texel) * texel;
      const snapZ = Math.round(t.z / texel) * texel;
      this.sun.target.position.set(snapX, 0, snapZ);
      this.sun.position.set(snapX + sd.x * 1500, sd.y * 1500, snapZ + sd.z * 1500);
      if (sc.right !== half) {
        sc.left = -half;
        sc.right = half;
        sc.top = half;
        sc.bottom = -half;
        sc.near = 200;
        sc.far = 3400;
        sc.updateProjectionMatrix();
      }
      this.sun.target.updateMatrixWorld();
    }

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);

    const info = this.renderer.info;
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
    this.composer?.dispose();
    this.envTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Procedural fine sand with soft ripples, generated once on a canvas (no external assets). */
function makeSandTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  let s = 1234567;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ripple = Math.sin((x * 0.11 + y * 0.045) * Math.PI) * 0.5 + 0.5;
      const v = 0.86 + ripple * 0.06 + (rnd() - 0.5) * 0.1;
      const i = (y * n + x) * 4;
      img.data[i] = Math.min(255, 255 * v);
      img.data[i + 1] = Math.min(255, 238 * v);
      img.data[i + 2] = Math.min(255, 214 * v);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
