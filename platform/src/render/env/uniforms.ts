import * as THREE from 'three';

/* Uniforms shared by every patched material, updated once per frame by the atmosphere. Shaders
   reference these objects directly, so one write reaches the whole city. */

export const ENV = {
  /** wall-clock seconds (animated water, flashing lamps) */
  uTime: { value: 0 },
  /** 0 = no window lit (midday) .. 1 = evening occupancy */
  uWinLit: { value: 0 },
  /** street lamps, aviation and facade lights: 0 off .. 1 full */
  uLamp: { value: 0 },
  /** 1 = daylight .. 0 = night; tunes glass reflections and ground glow */
  uDay: { value: 1 },
  /** direction toward the key light (sun or moon), world space */
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

export type EnvUniforms = typeof ENV;

/** Hash and anti-aliased box helpers shared by the procedural shaders. */
export const GLSL_COMMON = /* glsl */ `
float dmHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float dmHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float dmBoxAA(float x, float a, float b, float w) { return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
float dmNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = dmHash12(i), b = dmHash12(i + vec2(1.0, 0.0)), c = dmHash12(i + vec2(0.0, 1.0)), d = dmHash12(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float dmFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * dmNoise(p); p = r * p * 2.02 + 17.3; a *= 0.5; }
  return v;
}
`;
