import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import type { QualityProfile } from './quality';

/* Post-processing: scene render (multisampled), ground-truth ambient occlusion on the high tier,
   HDR bloom for lamps, windows and the sun, tone mapping, then a light grade: contrast, a gentle
   vignette and fine grain. Every tier goes through the same chain so colours and haze match;
   the lowest tier only drops the expensive passes. */

/** The two internal hooks of GTAOPass that hide points and lines from its normal pass. */
interface GtaoInternals {
  _overrideVisibility(this: GTAOPass): void;
  _restoreVisibility(this: GTAOPass): void;
}
const BASE = GTAOPass.prototype as unknown as GtaoInternals;

/** GTAO that ignores the sky, overlays and other transparent things (they would cast fake occlusion). */
class SceneAO extends GTAOPass {
  private hidden: THREE.Object3D[] = [];
  _overrideVisibility(): void {
    BASE._overrideVisibility.call(this);
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (o.userData.noAO || (o as THREE.Sprite).isSprite || (m && !Array.isArray(m) && m.transparent)) {
        o.visible = false;
        this.hidden.push(o);
      }
    });
  }
  _restoreVisibility(): void {
    BASE._restoreVisibility.call(this);
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }
  /** occlusion at half resolution: soft anyway, and four times fewer pixels */
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }
}

const GradeShader = {
  name: 'DmGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
    uContrast: { value: 1.06 },
    uSat: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uContrast;
    uniform float uSat;
    varying vec2 vUv;
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // gentle S-curve around mid grey and a touch of saturation (display-referred)
      col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.05, 1.25)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (h(vUv * 1931.0 + fract(uTime) * 97.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass;
  private ao: SceneAO | null = null;
  private fxaa: FXAAPass | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    profile: QualityProfile,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: profile.msaaSamples,
    });
    const c = new EffectComposer(renderer, rt);
    c.addPass(new RenderPass(scene, camera));
    if (profile.ao) {
      this.ao = new SceneAO(scene, camera, size.x, size.y);
      this.ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 4, scale: 1.2, samples: 12 });
      this.ao.updatePdMaterial({ radius: 8, samples: 12 });
      this.ao.blendIntensity = 0.85;
      c.addPass(this.ao);
    }
    if (profile.bloom) {
      // threshold above 1: only emissive light (lamps, lit windows, the sun disc, beacons) blooms
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.55, 1.05);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    if (!profile.msaaSamples) {
      this.fxaa = new FXAAPass();
      c.addPass(this.fxaa);
    }
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uGrain.value = profile.tier === 'performance' ? 0 : 0.022;
    c.addPass(this.grade);
    this.composer = c;
  }

  setBloom(strength: number): void {
    if (this.bloom) this.bloom.strength = strength;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.grade.uniforms.uTime.value = performance.now() / 1000;
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.ao?.dispose();
    this.bloom?.dispose();
    this.fxaa?.dispose();
  }
}
