import * as THREE from 'three';
import type { KitPbr } from './kit';
import { ENV, GLSL_COMMON } from '../env/uniforms';

/* Materials for batched kit meshes. Every batch carries baked ambient occlusion times a
   per-building tint in its vertex colours, a building seed (aSeed) and the glazing grid (aGrid:
   u = facade bay, v = storey) from the kit's UV convention.
   - glazing: reflective glass by day; at dusk and night a hashed pattern of lit rooms, coherent
     per floor in office-like buildings, warm and cool interiors, blinds, and a far-distance
     fallback to the average so nothing shimmers
   - light_emissive / emissive_sign: lamps and signage that follow the light level
   - glass_clear: thin transparent glass
   - everything else: the kit's PBR values with the baked occlusion */

export type KitKind = 'glazing' | 'lamp' | 'sign' | 'glass' | 'standard';

export function kitKind(name: string): KitKind {
  if (name === 'glazing') return 'glazing';
  if (name === 'light_emissive') return 'lamp';
  if (name === 'emissive_sign') return 'sign';
  if (name === 'glass_clear') return 'glass';
  return 'standard';
}

const VERT_PARS = /* glsl */ `
attribute vec2 aGrid;
attribute float aSeed;
varying vec2 vGrid;
varying float vSeed;
varying vec3 vKWN;
varying vec3 vKWP;
`;
const VERT = /* glsl */ `
vGrid = aGrid;
vSeed = aSeed;
#ifdef USE_INSTANCING
  vKWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  vKWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vKWN = normalize(mat3(modelMatrix) * objectNormal);
  vKWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;
const FRAG_PARS = /* glsl */ `
uniform float uWinLit;
uniform float uLamp;
uniform float uDay;
uniform float uTime;
varying vec2 vGrid;
varying float vSeed;
varying vec3 vKWN;
varying vec3 vKWP;
${GLSL_COMMON}
`;

const GLAZING = /* glsl */ `#include <color_fragment>
vec2 g = vGrid;
vec2 ci = floor(g);
vec2 cf = fract(g);
vec2 fw = max(fwidth(g), vec2(1e-4));
float farF = smoothstep(0.2, 0.5, max(fw.x, fw.y));
// mullions and transoms inside each bay
float pane = dmBoxAA(cf.x, 0.045, 0.955, fw.x) * dmBoxAA(cf.y, 0.07, 0.93, fw.y);
pane = mix(pane, 0.84, farF);
vec3 nq = normalize(vKWN);
float face = floor(atan(nq.z, nq.x) * 0.6366 + 2.5);
vec3 cid = vec3(ci, face * 31.0 + vSeed * 7.13);
float h1 = dmHash13(cid);
float h2 = mix(dmHash13(cid + 11.3), 0.5, farF);
float h3 = mix(dmHash13(cid + 27.1), 0.5, farF);
float office = step(0.55, fract(vSeed * 0.371 + 0.13));
float floorPick = dmHash13(vec3(ci.y, face, vSeed + 3.7));
bool lobby = g.y < 1.0;
float occupancy = (0.22 + 0.38 * fract(vSeed * 0.618 + 0.21)) * uWinLit;
float litFrac = lobby ? min(1.0, uWinLit * 1.3) : occupancy;
float pick = mix(h1, floorPick * 0.75 + h1 * 0.25, office);
float lit = step(pick, litFrac);
lit = mix(lit, litFrac, farF);
vec3 warm = mix(vec3(1.0, 0.56, 0.26), vec3(1.0, 0.78, 0.52), h2);
warm = mix(warm, vec3(0.78, 0.88, 1.0), step(0.8, h2) * (0.5 + 0.4 * office));
float interior = mix(0.5, 1.0, smoothstep(0.0, 0.85, cf.y));
interior = mix(interior, 0.8, farF);
float blinds = mix(1.0, 0.45 + 0.35 * step(0.5, fract(cf.y * 9.0)), step(0.74, h3) * (1.0 - farF));
float inten = (0.45 + 0.95 * h3) * interior * blinds * (lobby ? 1.35 : 1.0);
// rooms read as a soft glow before dark and come up fully at night
vec3 dmWinEm = warm * inten * lit * pane * mix(0.22, 0.8, uWinLit);
vec3 frameCol = vec3(0.13, 0.14, 0.16);
// coated glass: a light, slightly tinted reflection colour (metal workflow) that varies per pane;
// lit rooms are emissive on top, unlit ones stay dark at night because the sky they reflect is dark
vec3 coat = mix(vec3(0.3, 0.38, 0.46), vec3(0.46, 0.52, 0.56), h3 * (1.0 - farF)) * (diffuseColor.rgb * 2.2 + 0.3);
diffuseColor.rgb = mix(frameCol, coat, pane);
float dmRough = mix(0.45, mix(0.03, 0.1, h2), pane);
float dmMetal = mix(0.5, 0.92, pane);
`;

/** Patch a MeshStandardMaterial with the kit shader for its kind (shared uniforms from ENV). */
function patch(mat: THREE.MeshStandardMaterial, kind: KitKind): void {
  mat.customProgramCacheKey = () => `dm-kit-${kind}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWinLit = ENV.uWinLit;
    sh.uniforms.uLamp = ENV.uLamp;
    sh.uniforms.uDay = ENV.uDay;
    sh.uniforms.uTime = ENV.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT}`);
    let f = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`);
    if (kind === 'glazing') {
      f = f
        .replace('#include <color_fragment>', GLAZING)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dmRough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = dmMetal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += dmWinEm;');
    } else if (kind === 'lamp') {
      // lamp heads and aviation lights: dark by day, lit from dusk; aviation reds blink
      f = f.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float blink = step(0.5, fract(uTime * 0.75 + vSeed * 0.37));
float high = step(60.0, vKWP.y);
totalEmissiveRadiance *= mix(0.02, 0.55, uLamp) * mix(1.0, 0.35 + 0.65 * blink, high);
// obstruction lights on tall structures are red
totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(dot(totalEmissiveRadiance, vec3(0.6, 0.3, 0.1))) * vec3(1.6, 0.12, 0.08), high);`,
      );
    } else if (kind === 'sign') {
      f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.45 + 0.75 * uLamp;');
    }
    sh.fragmentShader = f;
  };
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** The shared material for a kit material name (one program per kind). `prop`: instanced street
    furniture, whose small lamp heads stay at the kit's full intensity (building lights are large
    surfaces and are toned down). */
export function kitMaterial(name: string, pbr: KitPbr | undefined, prop = false): THREE.MeshStandardMaterial {
  const key = prop && name === 'light_emissive' ? `${name}#prop` : name;
  const hit = cache.get(key);
  if (hit) return hit;
  const kind = kitKind(name);
  const p = pbr ?? {};
  const mat = new THREE.MeshStandardMaterial({
    name: `kit-${name}`,
    color: new THREE.Color(p.baseColor ?? '#cccccc'),
    roughness: p.roughness ?? 0.8,
    metalness: p.metalness ?? 0,
    vertexColors: true,
    side: name === 'foliage' || p.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (kind === 'lamp' || kind === 'sign') {
    mat.emissive = new THREE.Color(p.emissive ?? '#ffd08a');
    mat.emissiveIntensity = (p.emissiveIntensity ?? 4) * (kind === 'lamp' && !prop ? 0.4 : 1);
  }
  if (kind === 'glass') {
    mat.transparent = true;
    mat.opacity = p.opacity ?? 0.35;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.roughness = 0.05;
    mat.metalness = 0.1;
  }
  if (name === 'water') {
    mat.emissive = new THREE.Color('#1a8fd0');
    mat.emissiveIntensity = 0.5;
  }
  if (name === 'facade' || name === 'facade_alt') mat.envMapIntensity = 0.85;
  if (name === 'foliage') mat.envMapIntensity = 0.55;
  patch(mat, kind);
  cache.set(key, mat);
  return mat;
}

/** Whether a batch of this material should cast sun shadows. */
export function kitCastsShadow(name: string): boolean {
  return name !== 'glass_clear' && name !== 'light_emissive' && name !== 'emissive_sign';
}
