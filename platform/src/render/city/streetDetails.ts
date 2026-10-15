import * as THREE from 'three';
import type { LinkDef, Network } from '../../core/network/types';
import { GeoBuilder } from './builder';
import { CURB_H } from './roads';
import { ENV } from '../env/uniforms';

/* Street details on the boulevard: overhead direction-sign gantries ahead of junctions, in the
   region's bilingual blue style, and enclosed, air-conditioned glass bus shelters whose interiors
   light up at dusk. Destinations are the district's own invented road names and codes; the Arabic
   is a literal rendering of those names. */

const AR: Record<string, string> = {
  'Central Boulevard': 'الجادة المركزية',
  'North Avenue': 'الجادة الشمالية',
  'South Street': 'الشارع الجنوبي',
  'West Road': 'الطريق الغربي',
  'Market Street': 'شارع السوق',
  'Tower Road': 'طريق البرج',
  'Harbour Road': 'طريق الميناء',
};

/** "Tower Road (C4)" -> ["Tower Road", "C4"] */
function splitName(roadName: string): [string, string] {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(roadName);
  return m ? [m[1], m[2]] : [roadName, ''];
}

type Arrow = 'up' | 'right' | 'left';

/** A sign face: route code, Arabic above English, and an arrow; white on blue with a border. */
function signTexture(name: string, code: string, arrow: Arrow): THREE.CanvasTexture {
  const W = 512;
  const H = 208;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f4f96';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#f4f6f8';
  g.lineWidth = 7;
  g.strokeRect(10, 10, W - 20, H - 20);
  // route code shield
  if (code) {
    g.fillStyle = '#f4f6f8';
    g.fillRect(34, 36, 92, 56);
    g.fillStyle = '#1f4f96';
    g.font = '800 40px Inter, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(code, 80, 66);
  }
  g.fillStyle = '#f4f6f8';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.font = '600 44px "IBM Plex Sans Arabic", "Segoe UI", Arial, sans-serif';
  g.fillText(AR[name] ?? '', W - 120, 70);
  g.font = '700 38px Inter, Arial, sans-serif';
  g.fillText(name, W - 120, 140);
  // arrow
  g.save();
  g.translate(W - 66, H / 2);
  if (arrow === 'right') g.rotate(Math.PI / 4);
  if (arrow === 'left') g.rotate(-Math.PI / 4);
  g.fillStyle = '#f4f6f8';
  g.beginPath();
  g.moveTo(0, -46);
  g.lineTo(26, -14);
  g.lineTo(9, -14);
  g.lineTo(9, 44);
  g.lineTo(-9, 44);
  g.lineTo(-9, -14);
  g.lineTo(-26, -14);
  g.closePath();
  g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const at = (l: LinkDef, s: number, off: number): [number, number] => [l.start.x + l.dir.x * s + l.right.x * off, l.start.y + l.dir.y * s + l.right.y * off];

export function buildStreetDetails(net: Network): { group: THREE.Group; update: () => void } {
  const group = new THREE.Group();
  group.name = 'street-details';
  const steel = new GeoBuilder();
  const dark = new GeoBuilder();
  const signs: THREE.Mesh[] = [];

  // ---------------------------------------------------------------- overhead sign gantries
  const boulevard = net.linkIds.map((id) => net.links[id]).filter((l) => l.cls === 'arterial' && l.endsAtJunction);
  const picked = boulevard.filter((l) => {
    // one gantry ahead of every other junction in each direction keeps the street uncluttered
    const j = net.junctions[l.to];
    const k = Math.round((j.x + 400) / 270);
    return l.dir.x > 0 ? k % 2 === 1 : k % 2 === 0;
  });
  const signMat = (tex: THREE.Texture) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
  const signMats: THREE.MeshStandardMaterial[] = [];
  for (const l of picked) {
    if (l.length < 120) continue;
    const s = l.length - 70;
    const road = net.roads[l.road];
    const inner = road.median / 2 + 0.6;
    const outer = l.halfWidth + 1.2;
    const [ax, ay] = at(l, s, inner);
    const [bx, by] = at(l, s, outer);
    const H = 7.2;
    // two columns, a box truss between them
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      steel.setColor(0x9aa1a8).addGeometry(new THREE.CylinderGeometry(0.22, 0.26, H + 0.6, 10), new THREE.Matrix4().makeTranslation(x, CURB_H + (H + 0.6) / 2, -y));
      dark.setColor(0x5a6068).addGeometry(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.Matrix4().makeTranslation(x, CURB_H + 0.25, -y));
    }
    const span = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const yaw = Math.atan2(-(by - ay), bx - ax);
    for (const dy of [0, 1.1]) {
      const beam = new THREE.BoxGeometry(span + 0.4, 0.16, 0.16);
      for (const dz of [-0.35, 0.35]) steel.addGeometry(beam, new THREE.Matrix4().makeRotationY(yaw).setPosition(mx - l.dir.x * dz, H + dy, -(my - l.dir.y * dz)));
    }
    for (let k = 0; k <= Math.floor(span / 1.4); k++) {
      const f = k / Math.floor(span / 1.4);
      const x = ax + (bx - ax) * f;
      const y = ay + (by - ay) * f;
      steel.addGeometry(new THREE.BoxGeometry(0.08, 1.1, 0.08), new THREE.Matrix4().makeTranslation(x, H + 0.55, -y));
    }
    // sign faces hang in front of the truss, facing approaching traffic
    const cross = net.junctions[l.to];
    const turnRoad = Object.values(net.roads).find((rd) => rd.id !== l.road && rd.nodes.includes(cross.id));
    const [thru, thruCode] = splitName(road.name);
    const faces: Array<[string, string, Arrow, number]> = [[thru, thruCode, 'up', 0.32]];
    if (turnRoad) {
      const [tn, tc] = splitName(turnRoad.name);
      faces.push([tn, tc, 'right', 0.78]);
    }
    // faces the drivers approaching the gantry (against the direction of travel)
    const facing = Math.atan2(-l.dir.x, l.dir.y);
    for (const [name, code, arrow, f] of faces) {
      const tex = signTexture(name, code, arrow);
      const mat = signMat(tex);
      signMats.push(mat);
      const w = Math.min(7.2, span * 0.44);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (208 / 512)), mat);
      const off = inner + (outer - inner) * f;
      const [px, py] = at(l, s - 0.55, off);
      panel.position.set(px, H + 0.55, -py);
      panel.rotation.y = facing;
      panel.castShadow = true;
      signs.push(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (208 / 512)), new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.6, metalness: 0.4 }));
      back.position.copy(panel.position);
      back.rotation.y = facing + Math.PI;
      back.position.x += l.dir.x * 0.03;
      back.position.z -= l.dir.y * 0.03;
      signs.push(back);
    }
  }

  // ---------------------------------------------------------------- enclosed bus shelters
  const glass = new GeoBuilder();
  const lit = new GeoBuilder();
  const kerbLinks = boulevard.filter((l) => l.length > 160);
  for (const l of kerbLinks) {
    const s = l.length * 0.42;
    const off = l.halfWidth + 2.6; // on the sidewalk, set back from the kerb
    const [x, y] = at(l, s, off);
    const yaw = Math.atan2(l.dir.y, l.dir.x);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, CURB_H, -y);
    const add = (b: GeoBuilder, geo: THREE.BufferGeometry, lx: number, ly: number, lz: number) =>
      b.addGeometry(geo, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(lx, ly, lz)));
    // floor plinth, a glazed cabin with a dark frame, an overhanging roof and a lit advertising panel
    add(dark.setColor(0x6a7076), new THREE.BoxGeometry(6.2, 0.18, 2.6), 0, 0.09, 0);
    add(glass.setColor(0xffffff), new THREE.BoxGeometry(5.2, 2.5, 1.9), 0, 1.43, 0);
    for (const sx of [-2.6, 2.6]) for (const sz of [-0.95, 0.95]) add(dark.setColor(0x2b3036), new THREE.BoxGeometry(0.1, 2.5, 0.1), sx, 1.43, sz);
    add(dark, new THREE.BoxGeometry(5.3, 0.12, 2.0), 0, 2.7, 0);
    add(steel.setColor(0xd8dce0), new THREE.BoxGeometry(6.4, 0.22, 2.8), 0, 2.88, 0);
    add(lit.setColor(0xffffff), new THREE.BoxGeometry(1.2, 1.9, 0.08), 2.0, 1.4, 1.0);
    add(dark.setColor(0x3a3f45), new THREE.BoxGeometry(3.4, 0.45, 0.5), -0.6, 0.55, -0.6);
  }

  const mesh = (b: GeoBuilder, mat: THREE.Material, name: string, cast = true) => {
    if (b.empty) return null;
    const me = new THREE.Mesh(b.build(), mat);
    me.name = name;
    me.castShadow = cast;
    me.receiveShadow = true;
    me.matrixAutoUpdate = false;
    me.updateMatrix();
    group.add(me);
    return me;
  };
  mesh(steel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }), 'gantries');
  mesh(dark, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }), 'street-dark');
  const g = mesh(
    glass,
    new THREE.MeshPhysicalMaterial({ color: 0xb7d2dc, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.4, depthWrite: false }),
    'shelter-glass',
    false,
  );
  if (g) g.renderOrder = 4;
  const litMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, emissive: new THREE.Color(1, 0.96, 0.9), emissiveIntensity: 0.6, roughness: 0.4 });
  mesh(lit, litMat, 'shelter-panels');
  for (const sgn of signs) group.add(sgn);
  // sign faces are retro-reflective: brighter at night as if lit by headlights; panels glow after dusk
  const update = () => {
    const k = ENV.uLamp.value;
    for (const sm of signMats) sm.emissiveIntensity = 0.06 + 0.32 * k;
    litMat.emissiveIntensity = 0.25 + 1.6 * k;
  };
  return { group, update };
}
