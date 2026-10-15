import * as THREE from 'three';
import { ENV, GLSL_COMMON } from './uniforms';
import { COAST } from './coast';
import { METRO_PARS } from '../city/metroGround';
import { metroZoneTexture } from '../city/metro';

export { COAST, inSea } from './coast';

/* The land and sea around the district, as one large plane with one shader: desert sand with
   wind ripples and dunes that catch a low sun, a dry beach and a band of wet sand, surf, and
   water that runs from shallow turquoise to deep blue with moving waves. One draw call, and no
   overlapping surfaces at the shoreline. The surrounding city's streets, plots, gardens and lamps
   are painted onto the same plane (city/metroGround.ts). Coordinates in comments are simulation
   metres (x east, y north); the coast lies north-west of the district. */

const vec2s = COAST.map(([x, y]) => `vec2(${x.toFixed(1)}, ${y.toFixed(1)})`).join(', ');

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uDay;
varying vec3 vTW;
${GLSL_COMMON}
const int DM_NC = ${COAST.length};
const vec2 DM_COAST[DM_NC] = vec2[DM_NC](${vec2s});
float dmFbm3(vec2 p) {
  float v = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 3; i++) { v += a * dmNoise(p); p = r * p * 2.03 + 17.3; a *= 0.5; }
  return v / 0.875;
}
/* signed distance to the coast in metres: positive at sea */
float dmCoast(vec2 p) {
  float d = 1e9;
  float side = -1.0;
  for (int i = 0; i < DM_NC - 1; i++) {
    vec2 a = DM_COAST[i];
    vec2 b = DM_COAST[i + 1];
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    d = min(d, length(p - a - ab * t));
    if (p.x >= a.x && p.x <= b.x) side = p.y > a.y + ab.y * (p.x - a.x) / ab.x ? 1.0 : -1.0;
  }
  return d * side;
}
/* dune field: crests across the prevailing wind, warped; returns height and gradient (sim xy) */
vec3 dmDunes(vec2 p) {
  vec2 w = vec2(dmNoise(p * 0.0011), dmNoise(p * 0.0011 + 5.2)) * 260.0;
  vec2 q = p + w;
  vec2 d1 = normalize(vec2(0.86, 0.5));
  vec2 d2 = normalize(vec2(0.3, 0.95));
  float f1 = 0.011, f2 = 0.0047, f3 = 0.023;
  float a1 = 3.2, a2 = 5.0, a3 = 0.9;
  float s1 = dot(q, d1) * f1, s2 = dot(q, d2) * f2, s3 = dot(q, vec2(0.6, -0.8)) * f3;
  // asymmetric crests: gentle windward slope, steeper lee
  float h = a1 * (sin(s1) + 0.25 * sin(2.0 * s1)) + a2 * sin(s2) + a3 * sin(s3);
  vec2 g = a1 * (cos(s1) + 0.5 * cos(2.0 * s1)) * f1 * d1 + a2 * cos(s2) * f2 * d2 + a3 * cos(s3) * f3 * vec2(0.6, -0.8);
  return vec3(h, g);
}
${METRO_PARS}
`;

const COLOR = /* glsl */ `#include <color_fragment>
vec2 sp = vec2(vTW.x, -vTW.z);
float viewD = length(vTW - cameraPosition);
float sd = dmCoast(sp);
float dmRough = 0.95;
float dmMetal = 0.0;
vec3 dmN = vec3(0.0, 1.0, 0.0);
float detail = 1.0 - smoothstep(2500.0, 9000.0, viewD);
float dmFw = length(fwidth(sp)) * 0.7;
vec3 dmEm = vec3(0.0);
if (sd < 0.0) {
  // the surrounding city: streets, plots and gardens where it is built, desert beyond
  vec3 cityCol;
  float cityRough;
  float urban = dmMetro(sp, sd, viewD, dmFw, cityCol, cityRough, dmEm);
  vec3 col = cityCol;
  dmRough = cityRough;
  if (urban < 0.999) {
    float big = dmFbm3(sp * 0.0012);
    float mid = dmFbm3(sp * 0.009 + 3.0);
    vec3 sandA = vec3(0.62, 0.45, 0.29);
    vec3 sandB = vec3(0.80, 0.63, 0.42);
    vec3 sand = mix(sandA, sandB, smoothstep(0.25, 0.8, big));
    sand *= 0.9 + 0.2 * mid;
    // wind ripples
    float rip = sin(dot(sp, vec2(0.7, 0.45)) * 1.6 + dmNoise(sp * 0.04) * 7.0);
    sand *= 1.0 + 0.035 * rip * detail;
    // dunes (normal only), beyond the city and fading with distance
    vec3 dn = dmDunes(sp);
    float amp = (1.0 - urban) * detail * smoothstep(-40.0, -260.0, sd);
    dmN = normalize(vec3(-dn.y * amp, 1.0, dn.z * amp));
    col = mix(sand, cityCol, urban);
    dmRough = mix(0.95, cityRough, urban);
  }
  // dry beach and wet sand toward the water
  float beach = 1.0 - smoothstep(-160.0, -35.0, sd);
  col = mix(vec3(0.86, 0.74, 0.56), col, beach);
  float wet = smoothstep(-26.0, -2.0, sd);
  col = mix(col, col * vec3(0.55, 0.52, 0.5), wet);
  dmRough = mix(dmRough, 0.3, wet);
  diffuseColor.rgb = col;
} else {
  float depth = smoothstep(0.0, 520.0, sd);
  vec3 shallow = vec3(0.08, 0.36, 0.36);
  vec3 deep = vec3(0.012, 0.075, 0.12);
  vec3 col = mix(shallow, deep, depth);
  col = mix(col * 1.2 + vec3(0.06, 0.05, 0.03), col, smoothstep(0.0, 22.0, sd));
  // waves: crossing swells (analytic slopes) with a little noise, flatter far away
  float t = uTime;
  vec2 w1 = vec2(0.8, 0.6), w2 = vec2(-0.45, 0.89), w3 = vec2(0.97, -0.24);
  float f1 = 0.06, f2 = 0.11, f3 = 0.23;
  float pix = length(fwidth(sp));
  // a swell only shades where it spans several pixels; below that it would alias into moire
  float k1 = 1.0 - smoothstep(10.0, 26.0, pix);
  float k2 = 1.0 - smoothstep(5.0, 14.0, pix);
  float k3 = 1.0 - smoothstep(2.5, 7.0, pix);
  vec2 g = w1 * f1 * cos(dot(sp, w1) * f1 - t * 0.9) * k1 + w2 * f2 * 0.6 * cos(dot(sp, w2) * f2 - t * 1.3) * k2
         + w3 * f3 * 0.3 * cos(dot(sp, w3) * f3 - t * 1.9) * k3;
  float nz = dmNoise(sp * 0.05 + vec2(t * 0.05, t * 0.03));
  g += (vec2(nz, dmNoise(sp * 0.05 + 7.0 - t * 0.04)) - 0.5) * 0.12 * k2;
  float wa = 2.2 * (1.0 - smoothstep(600.0, 5000.0, viewD)) + 0.25;
  dmN = normalize(vec3(-g.x * wa, 1.0, g.y * wa));
  // surf: broken white bands that run up the beach
  float wave = fract(sd / 14.0 - t * 0.12);
  float band = smoothstep(0.75, 0.95, wave) * (1.0 - smoothstep(0.0, 42.0, sd));
  float foam = band * smoothstep(0.35, 0.75, dmNoise(sp * 0.12 + vec2(t * 0.2, 0.0)));
  foam += (1.0 - smoothstep(0.0, 4.5, sd)) * (0.55 + 0.45 * dmNoise(sp * 0.3 + t * 0.4));
  col = mix(col, vec3(0.85, 0.88, 0.88), clamp(foam, 0.0, 1.0) * 0.85);
  dmRough = mix(0.07, 0.6, clamp(foam, 0.0, 1.0));
  dmMetal = 0.0;
  diffuseColor.rgb = col;
}
`;

export function buildTerrain(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ name: 'terrain', color: 0xffffff, roughness: 0.95, metalness: 0 });
  const zoneTex = metroZoneTexture();
  mat.customProgramCacheKey = () => 'dm-terrain';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ENV.uTime;
    sh.uniforms.uDay = ENV.uDay;
    sh.uniforms.uLamp = ENV.uLamp;
    sh.uniforms.uSunDir = ENV.uSunDir;
    sh.uniforms.uMetroZone = { value: zoneTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dmRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = dmMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(dmN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += dmEm;');
  };
  const size = 34000;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -0.06;
  m.receiveShadow = true;
  m.name = 'terrain';
  m.frustumCulled = false;
  return m;
}
