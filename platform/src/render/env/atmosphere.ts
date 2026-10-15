import * as THREE from 'three';
import { ENV } from './uniforms';
import { applySky, hazeColor, makeSkyMaterial, makeSkyUniforms, type SkyUniforms } from './sky';
import { dirFrom, phaseOf, todAt, type TodKey, type TodState } from './tod';
import { installHaze } from './fog';

/* Sky, sun or moon, ambient light, haze, exposure and image-based lighting for the current time of
   day. A change of lighting blends over a couple of seconds; the environment map is re-captured
   from the procedural sky a few times during the blend and once at the end. */

installHaze();

export class Atmosphere {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly state: TodState;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  private readonly moonDir = new THREE.Vector3(0, 1, 0);
  private readonly sky: THREE.Mesh;
  private readonly skyU: SkyUniforms;
  private readonly envU: SkyUniforms;
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private phase = 1;
  private from = 1;
  private to = 1;
  private t0 = 0;
  private dur = 0;
  private envDirty = true;
  private envClock = 0;
  private readonly fog: THREE.FogExp2;
  private readonly fwd = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  /** bloom strength the post chain should use now */
  bloom = 0.3;
  onChange: ((phase: number) => void) | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
  ) {
    this.state = todAt(this.phase);
    this.skyU = makeSkyUniforms();
    this.envU = makeSkyUniforms();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), makeSkyMaterial(this.skyU));
    this.sky.name = 'sky';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.sky.userData.noAO = true;
    scene.add(this.sky);
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial(this.envU, true));
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun, this.sun.target);

    this.fog = new THREE.FogExp2(0xffffff, 0.00015);
    scene.fog = this.fog;
    scene.background = null;
    this.apply();
  }

  get currentPhase(): number {
    return this.phase;
  }

  /** Blend to a time of day (or jump with `immediate`). */
  setKey(key: TodKey, immediate = false): void {
    this.setPhase(phaseOf(key), immediate);
  }

  setPhase(p: number, immediate = false): void {
    if (immediate) {
      this.phase = this.from = this.to = p;
      this.dur = 0;
      this.envDirty = true;
      this.apply();
      return;
    }
    if (Math.abs(p - this.to) < 1e-4) return;
    this.from = this.phase;
    this.to = p;
    this.t0 = performance.now() / 1000;
    this.dur = 1.2 + Math.abs(p - this.phase) * 0.9;
  }

  private apply(): void {
    const s = todAt(this.phase, this.state);
    dirFrom(s.lightEl, s.lightAz, this.lightDir);
    dirFrom(s.sunEl, s.sunAz, this.sunDir);
    dirFrom(38, 118, this.moonDir);
    this.sun.color.copy(s.lightColor);
    this.sun.intensity = s.lightIntensity;
    this.sun.shadow.intensity = s.shadowStrength;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
    this.scene.environmentIntensity = s.envIntensity;
    this.renderer.toneMappingExposure = s.exposure;
    this.fog.density = s.fogDensity;
    applySky(this.skyU, s, this.sunDir, this.moonDir);
    applySky(this.envU, s, this.sunDir, this.moonDir);
    ENV.uWinLit.value = s.winLit;
    ENV.uLamp.value = s.lamp;
    ENV.uDay.value = THREE.MathUtils.clamp(1 - this.phase / 2, 0, 1);
    ENV.uSunDir.value.copy(this.lightDir);
    ENV.uSunColor.value.copy(s.lightColor).multiplyScalar(s.lightIntensity);
    this.bloom = s.bloom;
    this.onChange?.(this.phase);
  }

  private captureEnv(): void {
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.015, 1, 400);
    this.scene.environment = this.envTarget.texture;
    prev?.dispose();
  }

  private shadowKey = '';

  /**
   * Per frame: transitions, sky follows the camera, haze colour along the view, light frustum.
   * Returns true when the shadow map needs to be drawn again: the light moved, or the frustum,
   * which follows the camera in coarse steps so a still or slowly moving view reuses the last map.
   */
  update(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, shadowHalf: number, shadowMap: number): boolean {
    const now = performance.now() / 1000;
    ENV.uTime.value = now;
    this.skyU.uTime.value = now;
    if (this.dur > 0) {
      const k = Math.min(1, (now - this.t0) / this.dur);
      const e = k * k * (3 - 2 * k);
      this.phase = this.from + (this.to - this.from) * e;
      this.apply();
      if (now - this.envClock > 0.25) this.envDirty = true;
      if (k >= 1) {
        this.dur = 0;
        this.envDirty = true;
      }
    }
    if (this.envDirty) {
      this.envDirty = false;
      this.envClock = now;
      this.captureEnv();
    }
    this.sky.position.copy(camera.position);
    // haze takes the colour of the horizon in the view direction
    camera.getWorldDirection(this.fwd);
    hazeColor(this.state, this.sunDir, this.fwd.x, this.fwd.z, this.tmpC);
    this.fog.color.copy(this.tmpC);

    // shadow frustum follows the focus and scales with zoom: its size moves in steps of 25% and its
    // centre in steps of an eighth of its width (snapped to whole texels, so nothing shimmers)
    const l = this.lightDir;
    shadowHalf = Math.pow(1.25, Math.ceil(Math.log(shadowHalf) / Math.log(1.25)));
    const texel = (shadowHalf * 2) / shadowMap;
    const step = Math.max(texel, Math.round(shadowHalf / 4 / texel) * texel);
    const sx = Math.round(focus.x / step) * step;
    const sz = Math.round(focus.z / step) * step;
    const key = `${sx.toFixed(1)},${sz.toFixed(1)},${shadowHalf.toFixed(1)},${l.x.toFixed(4)},${l.y.toFixed(4)},${l.z.toFixed(4)}`;
    const moved = key !== this.shadowKey;
    this.shadowKey = key;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + l.x * 1800, Math.max(60, l.y * 1800), sz + l.z * 1800);
    const sc = this.sun.shadow.camera;
    if (sc.right !== shadowHalf) {
      sc.left = -shadowHalf;
      sc.right = shadowHalf;
      sc.top = shadowHalf;
      sc.bottom = -shadowHalf;
      sc.near = 100;
      sc.far = 4200;
      sc.updateProjectionMatrix();
    }
    this.sun.target.updateMatrixWorld();
    return moved;
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
  }
}
