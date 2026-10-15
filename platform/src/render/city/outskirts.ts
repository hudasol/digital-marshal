import * as THREE from 'three';
import type { Kit } from '../kit/kit';
import { KitBatcher } from '../kit/batch';
import { ENV, GLSL_COMMON } from '../env/uniforms';
import { coastDistance } from '../env/coast';
import { makePalm } from './furniture';
import { GeoBuilder } from './builder';
import {
  ARTERIAL,
  CITY_R,
  COAST_ROAD,
  DISTRICT,
  EXTENT,
  ROAD_CLASSES,
  XL,
  YL,
  ZONE,
  buildable,
  metroLots,
  villaPlots,
  type Lot,
} from './metro';
import { VILLA_3D_R } from './metroGround';

/* The buildings, trees and street lamps of the city around the district (layout: metro.ts).
   Scenery only, nothing here is simulated. Buildings are boxes drawn by one instanced draw per
   map tile; a shader gives each its facade from the instance's size and style (punched windows
   with shopfronts, glass curtain walls, villas, warehouses), its roof, a darker base and windows
   that light up after dusk. The towers nearest the district and a few along the coast are kit
   models; on the lowest quality tier they fall back to boxes. Coordinates: simulation metres
   (x east, y north); three.js world = (x, height, -y). */

const Style = { Apartments: 0, Glass: 1, Villa: 2, Shed: 3, Podium: 4 } as const;
type Style = (typeof Style)[keyof typeof Style];

interface Box {
  x: number;
  y: number;
  w: number; // along x before the yaw
  d: number;
  h: number;
  base: number;
  yaw: number;
  style: Style;
  floor: number; // storey height, m
  lit: number; // share of windows lit at night
  color: THREE.Color;
}

/** Small deterministic generator per lot (mulberry32). */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const hex = (h: number) => new THREE.Color(h);
const STONE = [0xe8dcc6, 0xdccbb0, 0xefe6d6, 0xd2c0a2, 0xe4d2b8, 0xc9b79c, 0xf1ece2, 0xd9c7ae].map(hex);
const WARM = [0xc89a74, 0xd8b38e, 0xbfa58a].map(hex);
const GLASS = [0x7fa7b0, 0x7590b0, 0xa9b4bd, 0xa89780, 0x667684, 0x8eaac0, 0x9fb8b4].map(hex);
const SHED = [0xc9cbcb, 0xb8bec4, 0xd6cfc0, 0xa9b3ba].map(hex);
const VILLA = [0xf2ede3, 0xeee3cf, 0xe6d5b8, 0xf6f3ec].map(hex);

/** Facade, roof and night lights for the instanced boxes, from the unit box and instance size. */
function facadeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ name: 'outskirts', roughness: 0.85, metalness: 0 });
  mat.customProgramCacheKey = () => 'dm-outskirts';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWinLit = ENV.uWinLit;
    sh.uniforms.uLamp = ENV.uLamp;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aStyle;
varying vec4 vStyle;
varying vec3 vBox;
varying vec3 vBoxN;
varying vec3 vSize;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vStyle = aStyle;
vBox = position;
vBoxN = normal;
vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWinLit;
uniform float uLamp;
varying vec4 vStyle;
varying vec3 vBox;
varying vec3 vBoxN;
varying vec3 vSize;
${GLSL_COMMON}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
int dmKind = int(vStyle.z + 0.5);
float dmWin = 0.0;
float dmLitW = 0.0;
vec3 dmLightC = vec3(1.0, 0.72, 0.42);
float dmR = 0.85;
float dmM = 0.0;
if (abs(vBoxN.y) < 0.5) {
  bool alongX = abs(vBoxN.z) > 0.5;
  float faceW = alongX ? vSize.x : vSize.z;
  float u = ((alongX ? vBox.x : vBox.z) + 0.5) * faceW;
  float v = vBox.y * vSize.y;
  float floors = max(1.0, floor(vSize.y / vStyle.x + 0.25));
  float fh = vSize.y / floors;
  float bayW = dmKind == 2 ? 4.2 : (dmKind == 1 ? 1.6 : 3.4);
  float bays = max(1.0, floor(faceW / bayW + 0.5));
  vec2 cell = vec2(u / (faceW / bays), v / fh);
  vec2 cf = fract(cell);
  vec2 ci = floor(cell);
  vec2 fwc = max(fwidth(cell), vec2(1e-4));
  float far = smoothstep(0.28, 0.65, max(fwc.x, fwc.y));
  float seed = vStyle.y;
  float h = dmHash13(vec3(ci, seed));
  if (dmKind == 1) {
    // curtain wall: glass between thin mullions and floor-edge spandrels
    float glass = dmBoxAA(cf.x, 0.05, 0.95, fwc.x) * dmBoxAA(cf.y, 0.2, 1.0, fwc.y);
    dmWin = mix(glass, 0.72, far);
    vec3 frame = diffuseColor.rgb * 0.6 + 0.08;
    diffuseColor.rgb = mix(frame, diffuseColor.rgb * (0.85 + 0.3 * fract(seed * 3.7 + ci.y * 0.13)), dmWin);
    dmR = mix(0.5, 0.12, dmWin);
    dmM = mix(0.1, 0.55, dmWin);
    // offices: runs of bays on a floor lit, cooler light; averaged where the floors blur together
    float hr = dmHash13(vec3(floor(ci.x / 3.0), ci.y, seed));
    float occ = vStyle.w * uWinLit;
    dmLitW = mix(step(hr, occ), occ * 0.2, far) * dmWin * 0.8;
    dmLightC = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.8, 0.58), step(0.55, fract(hr * 9.0)));
  } else if (dmKind == 3) {
    // shed: ribbed cladding, a band of roller doors on the long sides
    float rib = dmBoxAA(fract(u / 1.1), 0.0, 0.5, fwidth(u / 1.1));
    diffuseColor.rgb *= 0.92 + 0.08 * mix(rib, 0.5, far);
    float door = faceW > 35.0 ? dmBoxAA(fract(u / 9.0), 0.2, 0.75, fwidth(u / 9.0)) * step(v, 4.5) : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, door);
  } else {
    // punched windows; villas fewer and smaller; shopfronts on the ground floor of apartments and podiums
    float wx = dmKind == 2 ? 0.3 : 0.18;
    float wy = dmKind == 2 ? 0.3 : 0.26;
    float win = dmBoxAA(cf.x, wx, 1.0 - wx, fwc.x) * dmBoxAA(cf.y, wy, 0.82, fwc.y);
    if (dmKind == 2) win *= step(0.35, h);
    bool shop = (dmKind == 0 || dmKind == 4) && ci.y < 0.5 && vSize.y > 7.0;
    if (shop) win = dmBoxAA(cf.x, 0.04, 0.96, fwc.x) * dmBoxAA(cf.y, 0.08, 0.78, fwc.y);
    if (dmKind == 4 && ci.y > 0.5) win = dmBoxAA(cf.y, 0.35, 0.75, fwc.y) * 0.8; // car park decks
    dmWin = mix(win, dmKind == 2 ? 0.12 : 0.3, far);
    // balconies: a light slab edge under every other bay
    float slab = (dmKind == 0 && mod(ci.x, 2.0) < 0.5) ? dmBoxAA(cf.y, 0.0, 0.08, fwc.y) * (1.0 - far) : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.12, 0.15), dmWin * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.93, 0.88), slab * 0.6);
    dmR = mix(0.88, 0.25, dmWin);
    dmM = mix(0.0, 0.35, dmWin);
    float occ = (shop ? 0.9 : vStyle.w) * uWinLit;
    dmLitW = mix(step(h, occ), occ * 0.2, far) * dmWin;
    dmLightC = shop ? vec3(1.0, 0.85, 0.62) : mix(vec3(1.0, 0.7, 0.4), vec3(1.0, 0.86, 0.66), fract(h * 7.0));
  }
  // parapet line along the top, darker base where the building meets the ground
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.03, dmBoxAA(vSize.y - v, 0.0, 0.7, fwidth(v)) * (dmKind == 1 ? 0.0 : 1.0));
  diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 4.0, v));
} else {
  // roof: concrete with a lighter parapet ring and plant
  vec2 r = (vBox.xz + 0.5) * vSize.xz;
  vec2 e = min(r, vSize.xz - r);
  float ring = 1.0 - smoothstep(0.5, 0.9, min(e.x, e.y));
  float tone = 0.86 + 0.14 * dmNoise(r * 0.15 + vStyle.y * 7.0);
  diffuseColor.rgb = mix(vec3(0.56, 0.54, 0.5) * tone, diffuseColor.rgb * 1.05, ring * 0.8 + (dmKind == 2 ? 0.55 : 0.0));
  dmR = 0.9;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dmR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = dmM;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += dmLightC * dmLitW * 1.25;');
  };
  return mat;
}

/** Unit box standing on the origin (y 0..1), without its never-seen bottom face. */
function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const idx = g.getIndex()!;
  const keep: number[] = [];
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; six indices per face
  for (let i = 0; i < idx.count; i += 6) if (Math.floor(i / 6) !== 3) for (let k = 0; k < 6; k++) keep.push(idx.getX(i + k));
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

interface TreeSpot {
  x: number;
  y: number;
  s: number;
}

/** Building boxes, kit towers and garden trees for one lot. */
function buildLot(lot: Lot, out: Box[], landmarks: Array<{ x: number; y: number; h: number; seed: number }>, trees: TreeSpot[]): void {
  const r = rng32(lot.hash);
  const w = lot.x1 - lot.x0;
  const d = lot.y1 - lot.y0;
  const cx = (lot.x0 + lot.x1) / 2;
  const cy = (lot.y0 + lot.y1) / 2;
  const dist = Math.hypot(cx / 1.15, cy);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const add = (b: Omit<Box, 'base'> & { base?: number }) => {
    if (!buildable(b.x - b.w / 2, b.y - b.d / 2, b.x + b.w / 2, b.y + b.d / 2)) return false;
    out.push({ base: 0, ...b });
    return true;
  };
  // a share of the tower lots are mid-rise blocks, so the towers stand in clusters, not a wall
  const zone = lot.cell.zone === ZONE.towers && r() < 0.3 ? ZONE.mid : lot.cell.zone;
  switch (zone) {
    case ZONE.towers: {
      const sd = coastDistance(cx, cy);
      const coast = smooth(-1400, -300, sd);
      const blvd = 1 - smooth(150, 450, Math.abs(cy));
      const hBase = (62 + 120 * Math.max(coast, blvd * 0.85)) * (1 - 0.55 * smooth(2600, 7000, dist));
      const podH = 9 + Math.floor(r() * 3) * 3.5;
      const hasPodium = w * d > 3000;
      if (hasPodium) add({ x: cx, y: cy, w: w - 8, d: d - 8, h: podH, yaw: 0, style: Style.Podium, floor: 3.6, lit: 0.4, color: pick(STONE) });
      const base = hasPodium ? podH : 0;
      const n = w * d > 18000 && r() < 0.45 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const s = 24 + r() * 16;
        const sw = s;
        const sdp = s * (0.75 + r() * 0.5);
        const ox = n === 1 ? (r() - 0.5) * Math.max(0, w - sw - 24) : (i === 0 ? -1 : 1) * Math.max(0, w / 2 - sw / 2 - 10);
        const oy = n === 1 ? (r() - 0.5) * Math.max(0, d - sdp - 24) : (i === 0 ? 1 : -1) * Math.max(0, d / 2 - sdp / 2 - 10);
        const x = cx + ox;
        const y = cy + oy;
        const h = Math.max(45, hBase * (0.6 + 0.8 * r()));
        const glass = r() < 0.55;
        const twin: Box[] = [];
        const color = glass ? pick(GLASS) : pick(STONE);
        const style = glass ? Style.Glass : Style.Apartments;
        const set = r() < 0.3;
        const h0 = set ? h * 0.7 : h;
        twin.push({ x, y, w: sw, d: sdp, h: h0, base, yaw: 0, style, floor: 3.6, lit: 0.35, color });
        if (set) twin.push({ x, y, w: sw * 0.78, d: sdp * 0.78, h: h - h0, base: base + h0, yaw: 0, style, floor: 3.6, lit: 0.35, color });
        twin.push({ x, y, w: sw * 0.7, d: sdp * 0.7, h: 4 + r() * 6, base: base + h, yaw: 0, style: Style.Shed, floor: 6, lit: 0, color: hex(0x9a9ea3) });
        if (!buildable(x - sw / 2, y - sdp / 2, x + sw / 2, y + sdp / 2)) continue;
        // a few landmark towers from the kit's skyline set on the coast front (box twins on the lowest tier)
        if (coast > 0.6 && dist < 4800 && r() < 0.18) {
          landmarks.push({ x, y, h: Math.max(110, h * 1.15), seed: lot.hash + i });
          continue;
        }
        out.push(...twin);
      }
      break;
    }
    case ZONE.mid: {
      const floorsMax = Math.round(12 - 7 * smooth(2000, 7000, dist));
      if (r() < 0.22 && w > 70 && d > 70) {
        // courtyard block: four wings around a garden
        const depth = 14 + r() * 4;
        const h = (4 + Math.floor(r() * Math.max(1, floorsMax - 3))) * 3.3;
        const color = pick(r() < 0.8 ? STONE : WARM);
        const ww = w - 10;
        const dd = d - 10;
        add({ x: cx, y: cy + dd / 2 - depth / 2, w: ww, d: depth, h, yaw: 0, style: Style.Apartments, floor: 3.3, lit: 0.3, color });
        add({ x: cx, y: cy - dd / 2 + depth / 2, w: ww, d: depth, h, yaw: 0, style: Style.Apartments, floor: 3.3, lit: 0.3, color });
        add({ x: cx - ww / 2 + depth / 2, y: cy, w: depth, d: dd - 2 * depth, h, yaw: 0, style: Style.Apartments, floor: 3.3, lit: 0.3, color });
        add({ x: cx + ww / 2 - depth / 2, y: cy, w: depth, d: dd - 2 * depth, h, yaw: 0, style: Style.Apartments, floor: 3.3, lit: 0.3, color });
        break;
      }
      const ax = THREE.MathUtils.clamp(Math.round(w / 58), 1, 3);
      const ay = THREE.MathUtils.clamp(Math.round(d / 52), 1, 3);
      for (let j = 0; j < ay; j++) {
        for (let i = 0; i < ax; i++) {
          if (r() < 0.12) continue; // a gap: garden or a small car park
          const sw = (w / ax) * (0.6 + r() * 0.22);
          const sdp = (d / ay) * (0.58 + r() * 0.22);
          const x = lot.x0 + (i + 0.5) * (w / ax);
          const y = lot.y0 + (j + 0.5) * (d / ay);
          const floors = 3 + Math.floor(r() * Math.max(1, floorsMax - 2));
          const h = floors * 3.3;
          const color = pick(r() < 0.8 ? STONE : WARM);
          if (add({ x, y, w: sw, d: sdp, h, yaw: 0, style: Style.Apartments, floor: 3.3, lit: 0.3, color }) && dist < 3200 && r() < 0.7)
            out.push({ x: x + (r() - 0.5) * sw * 0.4, y: y + (r() - 0.5) * sdp * 0.4, w: 6, d: 5, h: 3.4, base: h, yaw: 0, style: Style.Shed, floor: 4, lit: 0, color: hex(0xd4cfc5) });
          // a tree or two in the gaps between the blocks
          if (dist < 2800 && r() < 0.6) trees.push({ x: lot.x0 + (i + (r() < 0.5 ? 0.06 : 0.94)) * (w / ax), y: lot.y0 + (j + 0.5) * (d / ay), s: 0.9 + r() * 0.4 });
        }
      }
      break;
    }
    case ZONE.villas: {
      if (dist > VILLA_3D_R) break; // painted roofs beyond (metroGround.ts)
      for (const p of villaPlots(lot)) {
        const pr = rng32(p.hash);
        const hw = 12 + pr() * 3;
        const hd = 10 + pr() * 2;
        const x = p.x0 + p.w / 2;
        const y = p.y0 + p.h * 0.62;
        const color = VILLA[Math.floor(pr() * VILLA.length)];
        const fw = Math.min(hw, p.w - 6);
        const fd = Math.min(hd, p.h - 14);
        if (dist < 3200) {
          // ground floor, and an upper floor set back from it
          if (!add({ x, y, w: fw, d: fd, h: 3.9, yaw: 0, style: Style.Villa, floor: 3.9, lit: 0.3, color })) continue;
          const k = 0.68 + pr() * 0.2;
          out.push({ x: x + (pr() - 0.5) * fw * (1 - k), y: y + (pr() - 0.5) * fd * (1 - k), w: fw * k, d: fd * k, h: 3.5, base: 3.9, yaw: 0, style: Style.Villa, floor: 3.5, lit: 0.3, color });
        } else if (!add({ x, y, w: fw, d: fd, h: 7 + pr() * 1.5, yaw: 0, style: Style.Villa, floor: 3.6, lit: 0.3, color })) continue;
        if (dist < 2600 && pr() < 0.45)
          out.push({ x: x + p.w * 0.3, y: y + p.h * 0.1, w: 5, d: 5, h: 3.6, base: 0, yaw: 0, style: Style.Villa, floor: 3.6, lit: 0.2, color });
        // garden trees at the front corners, clear of the pool
        if (dist < 3000) {
          if (pr() < 0.6) trees.push({ x: p.x0 + 3.5, y: p.y0 + 3.2, s: 0.8 + pr() * 0.35 });
          if (pr() < 0.35) trees.push({ x: p.x0 + p.w - 3.5, y: p.y0 + 3.2, s: 0.8 + pr() * 0.35 });
        }
      }
      break;
    }
    case ZONE.industry: {
      const n = w * d > 20000 ? 1 + Math.floor(r() * 3) : 1;
      for (let i = 0; i < n; i++) {
        const sw = Math.min(w - 16, 40 + r() * 60);
        const sdp = Math.min(d / n - 12, 30 + r() * 30);
        if (sw < 15 || sdp < 12) continue;
        const y = lot.y0 + (i + 0.5) * (d / n);
        add({ x: cx + (r() - 0.5) * (w - sw - 16), y, w: sw, d: sdp, h: 8 + r() * 5, yaw: 0, style: Style.Shed, floor: 10, lit: 0, color: pick(SHED) });
      }
      break;
    }
    case ZONE.park: {
      if (dist > 3600) break;
      // trees on a loose grid, off the paths across and around the park
      const c = { x: cx, y: cy };
      const ring = 0.6 * Math.min(w, d) / 2;
      for (let y = lot.y0 + 8; y < lot.y1 - 8; y += 19) {
        for (let x = lot.x0 + 8; x < lot.x1 - 8; x += 19) {
          const px = x + (r() - 0.5) * 9;
          const py = y + (r() - 0.5) * 9;
          const qx = (px - c.x) / (w / 2);
          const qy = (py - c.y) / (d / 2);
          const k = 0.7 * Math.min(w, d) / 2;
          if (Math.abs(qx - qy) * k < 5 || Math.abs(qx + qy) * k < 5 || Math.abs(Math.hypot(px - c.x, py - c.y) - ring) < 6) continue;
          if (r() < 0.75) trees.push({ x: px, y: py, s: 0.9 + r() * 0.6 });
        }
      }
      break;
    }
    default:
      break;
  }
}

/** Garden tree: a low-poly crown on a short trunk, about 6.5 m tall at scale 1. */
function cheapTree(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.setColor(0x6b5640);
  b.addGeometry(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 5, 1, true), new THREE.Matrix4().makeTranslation(0, 1.6, 0));
  b.setColor(0x3d5a28);
  b.addGeometry(new THREE.IcosahedronGeometry(1, 0), new THREE.Matrix4().compose(new THREE.Vector3(0, 4.3, 0), new THREE.Quaternion(), new THREE.Vector3(2.5, 2.0, 2.5)));
  return b.build();
}

function treeMesh(spots: TreeSpot[]): THREE.InstancedMesh {
  const max = 6000;
  const keep = spots.length > max ? spots.filter((_, i) => (i * 7919) % spots.length < max) : spots;
  const im = new THREE.InstancedMesh(cheapTree(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), keep.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  keep.forEach((t, i) => {
    q.setFromAxisAngle(up, (i * 2.39996) % (Math.PI * 2));
    m.compose(new THREE.Vector3(t.x, 0, -t.y), q, new THREE.Vector3(t.s, t.s * (0.9 + ((i * 37) % 20) / 100), t.s));
    im.setMatrixAt(i, m);
    c.setHSL(0.24 + ((i * 13) % 10) / 200, 0.35 + ((i * 7) % 10) / 50, 0.9 + ((i * 11) % 10) / 50);
    im.setColorAt(i, c);
  });
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'outskirts-trees';
  return im;
}

/** Instanced boxes split into map tiles (so tiles out of view are culled). */
function boxMeshes(boxes: Box[], mat: THREE.Material, name: string, tile: number, shadowR: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const geo = unitBox();
  const tiles = new Map<string, Box[]>();
  for (const b of boxes) {
    const key = `${Math.floor((b.x + tile / 2) / tile)},${Math.floor((b.y + tile / 2) / tile)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = []));
    t.push(b);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (const [key, list] of tiles) {
    const tg = geo.clone();
    const style = new Float32Array(list.length * 4);
    const im = new THREE.InstancedMesh(tg, mat, list.length);
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.yaw);
      m.compose(p.set(b.x, b.base, -b.y), q, s.set(b.w, Math.max(0.5, b.h), b.d));
      im.setMatrixAt(i, m);
      im.setColorAt(i, b.color);
      style.set([b.floor, (Math.abs(Math.imul(Math.round(b.x * 7 + b.y * 13), 2654435761)) % 1000) / 37.0, b.style, b.lit], i * 4);
    });
    tg.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 4));
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    const [tx, ty] = key.split(',').map(Number);
    im.castShadow = Math.hypot(tx * tile, ty * tile) < shadowR;
    im.receiveShadow = true;
    im.name = `${name}:${key}`;
    im.matrixAutoUpdate = false;
    g.add(im);
  }
  return g;
}

/** Points of light at the lamp heads along the main roads, for the night. */
function lampHeads(): THREE.Points {
  const pos: number[] = [];
  const lamp = (x: number, y: number) => {
    if (x > DISTRICT.x0 - 6 && x < DISTRICT.x1 + 6 && y > DISTRICT.y0 - 6 && y < DISTRICT.y1 + 6) return;
    if (Math.hypot(x / 1.15, y) > CITY_R + 1500) return;
    if (coastDistance(x, y) > COAST_ROAD.sd - COAST_ROAD.hw) return;
    pos.push(x, 9, -y);
  };
  const along = (c: number, cls: number, ns: boolean) => {
    if (cls < 1) return;
    const rc = ROAD_CLASSES[cls];
    const offs = [rc.hw - 1.0, -(rc.hw - 1.0)];
    if (rc.median > 5) offs.push(0);
    const lim = Math.min(EXTENT, CITY_R + 1500);
    // the ground shader's lamp pools sit where fract(a / 32 + 0.25) = 0.5
    for (let a = -lim + (((8 - -lim) % 32) + 32) % 32; a < lim; a += 32) {
      for (const o of offs) {
        if (ns) lamp(c + o, a);
        else lamp(a, c + o);
      }
    }
  };
  for (const l of XL) along(l.c, l.cls, true);
  for (const l of YL) along(l.c, l.cls, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uLamp: ENV.uLamp, uScale: { value: 800 } },
    vertexShader: /* glsl */ `
      uniform float uScale;
      varying float vFade;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = clamp(uScale * 3.2 / dist, 1.5, 9.0);
        vFade = 1.0 - smoothstep(6000.0, 11000.0, dist);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLamp;
      varying float vFade;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float a = exp(-dot(p, p) * 14.0);
        gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * a * uLamp * vFade * 1.4, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'outskirts-lamps';
  pts.frustumCulled = false;
  pts.userData.noAO = true;
  return pts;
}

/** Palms down the medians of the wide roads near the district. */
function medianPalms(): THREE.InstancedMesh {
  const mats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, y: number, k: number) => {
    if (x > DISTRICT.x0 - 10 && x < DISTRICT.x1 + 10 && y > DISTRICT.y0 - 10 && y < DISTRICT.y1 + 10) return;
    if (coastDistance(x, y) > COAST_ROAD.sd - COAST_ROAD.hw - 2) return;
    const s = 0.95 + ((k * 7919) % 100) / 400;
    q.setFromAxisAngle(up, (k * 2.39996) % (Math.PI * 2));
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, -y), q, new THREE.Vector3(s, s, s)));
  };
  let k = 0;
  const R = 2300;
  // not in the middle of a crossing road
  const clear = (a: number, cross: typeof XL) => cross.every((c) => Math.abs(a - c.c) > ROAD_CLASSES[c.cls].hw + ROAD_CLASSES[c.cls].walk + 4);
  for (const l of XL) if (l.cls >= ARTERIAL && Math.abs(l.c) < 1600) for (let a = -R; a < R; a += 26) if (clear(a, YL)) place(l.c, a, k++);
  for (const l of YL) if (l.cls >= ARTERIAL && Math.abs(l.c) < 1600) for (let a = -R; a < R; a += 26) if (clear(a, XL)) place(a, l.c, k++);
  const im = new THREE.InstancedMesh(makePalm(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'outskirts-palms';
  return im;
}

export interface Outskirts {
  group: THREE.Group;
  /** kit towers and palms on the higher tiers, box stand-ins on the lowest */
  setDetail(on: boolean): void;
  counts: { boxes: number; landmarks: number; trees: number };
}

const SKYLINE = ['skyline_twist', 'skyline_glass_a', 'skyline_stepped', 'skyline_glass_b', 'skyline_twist_b', 'skyline_marina_a', 'skyline_glass_c', 'skyline_marina_b', 'skyline_marina_c', 'skyline_twin_a'];

export function buildOutskirts(kit: Kit | null): Outskirts {
  const group = new THREE.Group();
  group.name = 'outskirts';
  const boxes: Box[] = [];
  const landmarks: Array<{ x: number; y: number; h: number; seed: number }> = [];
  const trees: TreeSpot[] = [];
  for (const lot of metroLots()) {
    if (lot.parking) continue;
    buildLot(lot, boxes, landmarks, trees);
  }
  const mat = facadeMaterial();
  group.add(boxMeshes(boxes, mat, 'outskirts-boxes', 3200, 3600));

  // landmark towers on the coast, palms and trees; box twins for the towers on the lowest tier
  const detail = new THREE.Group();
  detail.name = 'outskirts-detail';
  const twins: Box[] = [];
  if (kit) {
    const batch = new KitBatcher(kit, 1600);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const l of landmarks) {
      const node = SKYLINE[l.seed % SKYLINE.length];
      if (!kit.has(node)) continue;
      const size = kit.sizeOf(node);
      const s = THREE.MathUtils.clamp(l.h / size.y, 0.45, 1.1);
      q.setFromAxisAngle(up, ((l.seed % 8) * Math.PI) / 4);
      batch.add({ node, matrix: new THREE.Matrix4().compose(new THREE.Vector3(l.x, 0, -l.y), q, new THREE.Vector3(s, s, s)), seed: l.seed, grid: [s, s], shadow: false });
      const fw = Math.max(size.x, size.z) * s * 0.8;
      twins.push({ x: l.x, y: l.y, w: fw, d: fw, h: size.y * s, base: 0, yaw: 0, style: Style.Glass, floor: 3.8, lit: 0.45, color: GLASS[l.seed % GLASS.length] });
    }
    if (batch.count) detail.add(batch.build('outskirts-landmarks'));
  }
  detail.add(medianPalms());
  detail.add(treeMesh(trees));
  group.add(detail);
  const lowTier = boxMeshes(twins, mat, 'outskirts-twins', 3200, 0);
  lowTier.visible = false;
  group.add(lowTier);
  group.add(lampHeads());
  group.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return {
    group,
    setDetail(on: boolean) {
      detail.visible = on;
      lowTier.visible = !on;
    },
    counts: { boxes: boxes.length, landmarks: landmarks.length, trees: trees.length },
  };
}

