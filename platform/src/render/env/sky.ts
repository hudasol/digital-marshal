import * as THREE from 'three';
import { GLSL_COMMON } from './uniforms';
import type { TodState } from './tod';

/* Procedural sky shared by the visible dome and the environment-lighting capture: a three-band
   gradient, a warm horizon glow toward the sun, a halo and disc, drifting clouds, stars and a moon
   at night, and the city's light dome over the horizon. Nothing is downloaded. */

export interface SkyUniforms {
  [k: string]: THREE.IUniform;
  uZenith: THREE.IUniform<THREE.Color>;
  uMid: THREE.IUniform<THREE.Color>;
  uHorizon: THREE.IUniform<THREE.Color>;
  uHorizonAway: THREE.IUniform<THREE.Color>;
  uGlow: THREE.IUniform<THREE.Color>;
  uGlowSpread: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunDisc: THREE.IUniform<number>;
  uMoonDir: THREE.IUniform<THREE.Vector3>;
  uCloudLit: THREE.IUniform<THREE.Color>;
  uCloudShade: THREE.IUniform<THREE.Color>;
  uClouds: THREE.IUniform<number>;
  uStars: THREE.IUniform<number>;
  uCityGlow: THREE.IUniform<THREE.Color>;
  uGround: THREE.IUniform<THREE.Color>;
  uTime: THREE.IUniform<number>;
}

export function makeSkyUniforms(): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHorizonAway: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uGlowSpread: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDisc: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uClouds: { value: 0.3 },
    uStars: { value: 0 },
    uCityGlow: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uTime: { value: 0 },
  };
}

export function applySky(u: SkyUniforms, s: TodState, sunDir: THREE.Vector3, moonDir: THREE.Vector3): void {
  u.uZenith.value.copy(s.zenith);
  u.uMid.value.copy(s.mid);
  u.uHorizon.value.copy(s.horizon);
  u.uHorizonAway.value.copy(s.horizonAway);
  u.uGlow.value.copy(s.glow);
  u.uGlowSpread.value = s.glowSpread;
  u.uSunDir.value.copy(sunDir);
  u.uSunDisc.value = s.sunDisc;
  u.uMoonDir.value.copy(moonDir);
  u.uCloudLit.value.copy(s.cloudLit);
  u.uCloudShade.value.copy(s.cloudShade);
  u.uClouds.value = s.clouds;
  u.uStars.value = s.stars;
  u.uCityGlow.value.copy(s.cityGlow);
  // the ground in reflections is darker than the sky above it: car paint and glass show a horizon line
  u.uGround.value.copy(s.sand).multiplyScalar(0.1 + 0.25 * Math.max(0, Math.sin(THREE.MathUtils.degToRad(s.lightEl))) * s.lightIntensity * 0.3);
}

const SKY_FN = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uHorizonAway;
uniform vec3 uGlow;
uniform float uGlowSpread;
uniform vec3 uSunDir;
uniform float uSunDisc;
uniform vec3 uMoonDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uClouds;
uniform float uStars;
uniform vec3 uCityGlow;
uniform vec3 uGround;
uniform float uTime;
${GLSL_COMMON}
vec3 dmSkyBase(vec3 d) {
  float t = clamp(d.y, 0.0, 1.0);
  vec3 dh = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
  vec3 sh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-5, 0.0, 0.0));
  float az = dot(dh, sh) * 0.5 + 0.5;
  // the horizon is warm toward the sun and cool away from it
  vec3 hor = mix(uHorizonAway, uHorizon, smoothstep(0.15, 0.95, az));
  vec3 col = mix(hor, uMid, smoothstep(0.0, 0.17, t));
  col = mix(col, uZenith, smoothstep(0.12, 0.7, t));
  float low = 1.0 - smoothstep(0.0, 0.42, t);
  col += uGlow * pow(az, 3.0) * low * low * uGlowSpread * 0.85;
  // the opposite horizon picks up a faint pink band (the belt of Venus) when the sun is low
  col += uGlow * vec3(0.55, 0.42, 0.6) * pow(1.0 - az, 4.0) * low * smoothstep(0.02, 0.1, t) * 0.25 * uGlowSpread;
  col += uCityGlow * (1.0 - smoothstep(0.0, 0.3, t));
  return col;
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // pinned just inside the far plane: behind everything, never clipped
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

function fragment(envPass: boolean): string {
  return /* glsl */ `
varying vec3 vDir;
${SKY_FN}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = dmSkyBase(d);
  float sd = max(dot(d, uSunDir), 0.0);
  // halo around the sun (strongest when it is low)
  col += uGlow * (pow(sd, 10.0) * 0.32 + pow(sd, 90.0) * 0.9) * (0.25 + 0.75 * uGlowSpread);
  ${
    envPass
      ? ''
      : `
  // disc: bright enough to bloom
  col += uGlow * 24.0 * smoothstep(0.99962, 0.99982, sd) * uSunDisc;
  if (d.y > 0.0) {
    // clouds on a plane above the city
    vec2 cp = d.xz / (d.y + 0.06) * 0.42 + vec2(uTime * 0.0035, uTime * 0.0011);
    float n = dmFbm(cp * 1.4);
    float n2 = dmFbm(cp * 4.2 + 3.1);
    float cov = smoothstep(0.62 - uClouds * 0.32, 0.92 - uClouds * 0.2, n * 0.82 + n2 * 0.26);
    cov *= smoothstep(0.012, 0.09, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    vec3 dh = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5, 0.0, 0.0));
    vec3 sh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-5, 0.0, 0.0));
    float az = dot(dh, sh) * 0.5 + 0.5;
    vec3 cloud = mix(uCloudShade, uCloudLit, smoothstep(0.3, 0.95, n2) * (0.45 + 0.55 * az * az));
    col = mix(col, cloud, cov * 0.75);
    // long thin streaks near the horizon
    float streak = smoothstep(0.6, 0.9, dmFbm(vec2(cp.x * 0.5, cp.y * 5.5))) * smoothstep(0.008, 0.04, d.y) * (1.0 - smoothstep(0.07, 0.2, d.y));
    col = mix(col, mix(uCloudShade, uCloudLit, az), streak * 0.35 * uClouds * 2.0);
    // stars and the moon
    if (uStars > 0.001) {
      vec3 sp = d * 380.0;
      vec3 cell = floor(sp);
      float hs = dmHash13(cell);
      float r = length(fract(sp) - 0.5);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + hs * 3.0) + hs * 60.0);
      float star = step(0.9965, hs) * smoothstep(0.42, 0.0, r) * tw * (0.6 + 3.0 * fract(hs * 911.0));
      col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.04, 0.25, d.y) * (1.0 - cov);
      float md = max(dot(d, uMoonDir), 0.0);
      col += vec3(1.0, 0.97, 0.9) * 3.5 * smoothstep(0.99955, 0.99975, md) * uStars;
      col += vec3(0.5, 0.6, 0.9) * pow(md, 300.0) * 0.4 * uStars;
    }
  }
  float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dn - 0.5) / 255.0;`
  }
  // below the horizon: ground bounce (for reflections) fading in quickly
  col = mix(col, ${envPass ? 'uGround' : 'uHorizon * 0.8'}, smoothstep(0.0, ${envPass ? '0.12' : '0.03'}, -d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
}

export function makeSkyMaterial(u: SkyUniforms, envPass = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: envPass ? 'sky-env' : 'sky',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: !envPass,
    fog: false,
    uniforms: u,
    vertexShader: VERT,
    fragmentShader: fragment(envPass),
  });
}

/** CPU mirror of the horizon colour in a horizontal direction, for the distance haze. */
export function hazeColor(s: TodState, sunDir: THREE.Vector3, dirX: number, dirZ: number, out: THREE.Color): THREE.Color {
  const t = 0.025;
  const s1 = THREE.MathUtils.smoothstep(t, 0, 0.17);
  const l = Math.hypot(dirX, dirZ) || 1;
  const sl = Math.hypot(sunDir.x, sunDir.z) || 1;
  const az = ((dirX / l) * (sunDir.x / sl) + (dirZ / l) * (sunDir.z / sl)) * 0.5 + 0.5;
  out.copy(s.horizonAway).lerp(s.horizon, THREE.MathUtils.smoothstep(az, 0.15, 0.95)).lerp(s.mid, s1);
  const low = 1 - THREE.MathUtils.smoothstep(t, 0, 0.42);
  const k = Math.pow(az, 3) * low * low * s.glowSpread * 0.85;
  out.r += s.glow.r * k + s.cityGlow.r;
  out.g += s.glow.g * k + s.cityGlow.g;
  out.b += s.glow.b * k + s.cityGlow.b;
  return out.multiply(s.fogTint);
}
