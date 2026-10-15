import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENV } from '../env/uniforms';
import { coastDistance } from '../env/coast';
import { CITY_R, COAST_ROAD, COLLECTOR, DISTRICT, EXTENT, HIGHWAY, ROAD_CLASSES, XL, YL, type Line } from './metro';

/* Traffic on the main roads of the city around the district. Scenery, not simulated: every car
   keeps a steady speed in its lane and wraps at the end of its road, and its position is worked
   out on the GPU from the simulation clock (so it pauses and speeds up with the simulation), which
   makes thousands of cars one draw call and no work on the CPU. Headlights and tail lights come on
   after dark. Never inside the simulated district, where every vehicle is the simulation's own. */

/** Simulation time in seconds, set every frame by the city renderer. */
export const TRAFFIC_CLOCK = { value: 0 };

const MAX_CARS = 9000;

function carGeometry(): THREE.BufferGeometry {
  // body and cabin; length along +x, centred, standing on the ground
  const body = new THREE.BoxGeometry(4.5, 0.82, 1.84);
  body.translate(0, 0.3 + 0.41, 0);
  const cabin = new THREE.BoxGeometry(2.3, 0.6, 1.6);
  cabin.translate(-0.3, 1.12 + 0.3, 0);
  const g = mergeGeometries([body, cabin])!;
  g.deleteAttribute('uv');
  return g;
}

const PAINT = [0xf4f4f2, 0xe9e9e6, 0x1c1d20, 0x8c9096, 0xb9bcc0, 0x2b3f63, 0x7a1b1b, 0xd8d0bc, 0x3a4a3a, 0x5b5f66].map((h) => new THREE.Color(h));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Run {
  a0: number;
  a1: number;
}

/** Stretches of a road that run over built-up land, outside the district and inland of the coast road. */
function runs(l: Line, ns: boolean): Run[] {
  const out: Run[] = [];
  const lim = Math.min(EXTENT, CITY_R + 900);
  const step = 40;
  let start: number | null = null;
  for (let a = -lim; a <= lim; a += step) {
    const x = ns ? l.c : a;
    const y = ns ? a : l.c;
    const ok =
      !(x > DISTRICT.x0 - 30 && x < DISTRICT.x1 + 30 && y > DISTRICT.y0 - 30 && y < DISTRICT.y1 + 30) &&
      Math.hypot(x / 1.15, y) < CITY_R + 900 &&
      coastDistance(x, y) < COAST_ROAD.sd - COAST_ROAD.hw - 4;
    if (ok && start === null) start = a;
    if ((!ok || a + step > lim) && start !== null) {
      const end = ok ? a : a - step;
      if (end - start > 300) out.push({ a0: start, a1: end });
      start = null;
    }
  }
  return out;
}

export function buildTraffic(): THREE.Mesh {
  const lanes: Array<{ ox: number; oz: number; dx: number; dz: number; len: number; speed: number; spacing: number }> = [];
  const add = (l: Line, ns: boolean) => {
    if (l.cls < COLLECTOR) return;
    const rc = ROAD_CLASSES[l.cls];
    for (const r of runs(l, ns)) {
      const mid = (r.a0 + r.a1) / 2;
      const near = Math.min(Math.hypot(ns ? l.c / 1.15 : mid / 1.15, ns ? mid : l.c), Math.abs(l.c));
      for (const dir of [1, -1]) {
        for (let i = 0; i < rc.lanes; i++) {
          const off = rc.median / 2 + 3.5 * (i + 0.5);
          const speed = (l.cls === HIGHWAY ? 23 : l.cls === COLLECTOR ? 13 : 16.5) + (rc.lanes - 1 - i) * 1.6;
          const spacing = (l.cls === HIGHWAY ? 38 : 55) + 110 * smooth(1200, 6500, near) + i * 8;
          if (ns) {
            // north-south road at x = c: northbound on the east side
            const x = l.c + dir * off;
            lanes.push({ ox: x, oz: -(dir > 0 ? r.a0 : r.a1), dx: 0, dz: -dir, len: r.a1 - r.a0, speed, spacing });
          } else {
            // east-west road at y = c: eastbound on the south side
            const y = l.c - dir * off;
            lanes.push({ ox: dir > 0 ? r.a0 : r.a1, oz: -y, dx: dir, dz: 0, len: r.a1 - r.a0, speed, spacing });
          }
        }
      }
    }
  };
  for (const l of XL) add(l, true);
  for (const l of YL) add(l, false);

  let total = 0;
  for (const ln of lanes) total += Math.floor(ln.len / ln.spacing);
  const thin = Math.max(1, total / MAX_CARS);
  const laneA: number[] = [];
  const moveA: number[] = [];
  const colorA: number[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const ln of lanes) {
    const n = Math.floor(ln.len / (ln.spacing * thin));
    const gap = ln.len / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      laneA.push(ln.ox, ln.oz, ln.dx, ln.dz);
      moveA.push(ln.len, ln.speed, k * gap + rnd() * gap * 0.4, 0.92 + rnd() * 0.2);
      const c = PAINT[Math.floor(rnd() * PAINT.length)];
      colorA.push(c.r, c.g, c.b);
    }
  }

  const base = carGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  geo.setAttribute('aLane', new THREE.InstancedBufferAttribute(new Float32Array(laneA), 4));
  geo.setAttribute('aMove', new THREE.InstancedBufferAttribute(new Float32Array(moveA), 4));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(colorA), 3));
  geo.instanceCount = laneA.length / 4;

  const mat = new THREE.MeshStandardMaterial({ name: 'traffic', roughness: 0.35, metalness: 0.4 });
  mat.customProgramCacheKey = () => 'dm-traffic';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSimT = TRAFFIC_CLOCK;
    sh.uniforms.uLamp = ENV.uLamp;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aLane;
attribute vec4 aMove;
attribute vec3 aColor;
uniform float uSimT;
varying vec3 vPaint;
varying vec3 vCar;
varying vec3 vCarN;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 dmF = aLane.zw;
vec2 dmSd = vec2(-aLane.w, aLane.z);
vec3 objectNormal = vec3(dmF.x * normal.x + dmSd.x * normal.z, normal.y, dmF.y * normal.x + dmSd.y * normal.z);`,
      )
      .replace(
        '#include <begin_vertex>',
        `float dmAlong = mod(aMove.z + aMove.y * uSimT, aMove.x);
vec3 dmP = position * vec3(aMove.w, aMove.w, 1.0);
vec3 transformed = vec3(aLane.x + dmF.x * (dmAlong + dmP.x) + dmSd.x * dmP.z, dmP.y, aLane.y + dmF.y * (dmAlong + dmP.x) + dmSd.y * dmP.z);
vPaint = aColor;
vCar = position;
vCarN = normal;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uLamp;
varying vec3 vPaint;
varying vec3 vCar;
varying vec3 vCarN;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = vPaint;
float dmGlass = vCar.y > 1.13 && vCarN.y < 0.5 ? 1.0 : 0.0;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.05, 0.06), dmGlass);
float dmHead = step(0.5, vCarN.x) * step(vCar.y, 1.05) * step(0.45, abs(vCar.z)) * step(0.62, vCar.y);
float dmTail = step(0.5, -vCarN.x) * step(vCar.y, 1.08) * step(0.5, abs(vCar.z)) * step(0.72, vCar.y);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += (dmHead * vec3(2.6, 2.4, 2.0) + dmTail * vec3(2.2, 0.12, 0.06)) * uLamp;',
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'outskirts-traffic';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // positions come from the shader: keep it out of passes that would draw it with another material
  mesh.userData.noAO = true;
  return mesh;
}
