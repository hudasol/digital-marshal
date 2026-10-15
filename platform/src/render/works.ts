import * as THREE from 'three';
import type { LinkDef, Network } from '../core/network/types';
import { LANE_W } from '../core/network/district';
import { GeoBuilder } from './city/builder';

/* Temporary traffic management, drawn from the closures that are physically on the road: a cone
   taper and a cone line along the closed lanes, a hatched surface, a flashing arrow board at the
   start of a lane closure, and a barrier row with a "road closed" board across a closed segment.
   Closures that have been announced but are not in place yet are a different thing (information,
   not objects on the road) and are drawn as a dashed outline that can be switched off. */

export interface WorksZone {
  id: string;
  link: string;
  lanes: number[];
  s0: number;
  s1: number;
}

const TAPER = 24; // m, lead-in taper of a lane closure
const END_TAPER = 9;
const HATCH_H = 0.05;

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function hatchTexture(): THREE.CanvasTexture {
  const t = canvas(64, 64, (g) => {
    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e0702a';
    for (let k = -64; k < 128; k += 32) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 16, 0);
      g.lineTo(k + 16 - 64, 64);
      g.lineTo(k - 64, 64);
      g.closePath();
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function barrierTexture(): THREE.CanvasTexture {
  return canvas(128, 16, (g) => {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = '#c8242b';
    for (let k = -16; k < 144; k += 32) {
      g.beginPath();
      g.moveTo(k, 16);
      g.lineTo(k + 16, 16);
      g.lineTo(k + 32, 0);
      g.lineTo(k + 16, 0);
      g.closePath();
      g.fill();
    }
  });
}

function arrowTexture(): THREE.CanvasTexture {
  // lamp matrix of an arrow board pointing left; drawn white on black and tinted by the material
  return canvas(128, 80, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#fff';
    const dot = (x: number, y: number) => {
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    };
    for (let x = 34; x <= 104; x += 9) dot(x, 40);
    for (let k = 1; k <= 3; k++) {
      dot(34 + k * 9, 40 - k * 9);
      dot(34 + k * 9, 40 + k * 9);
    }
    dot(25, 40);
  }, false);
}

function closedSignTexture(): THREE.CanvasTexture {
  return canvas(256, 128, (g) => {
    g.fillStyle = '#f6f3ec';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#c8242b';
    g.lineWidth = 10;
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#c8242b';
    g.textAlign = 'center';
    // shrink each line until it fits inside the frame, whatever font the browser falls back to
    const line = (text: string, family: string, size: number, y: number) => {
      let px = size;
      g.font = `700 ${px}px ${family}`;
      while (px > 12 && g.measureText(text).width > 212) {
        px -= 2;
        g.font = `700 ${px}px ${family}`;
      }
      g.fillText(text, 128, y);
    };
    line('ROAD CLOSED', 'Inter, Arial, sans-serif', 36, 58);
    line('الطريق مغلق', '"IBM Plex Sans Arabic", Arial, sans-serif', 34, 102);
  });
}

/** Point on a link at distance s along it and lateral offset `off` (to the right of travel). */
function P(l: LinkDef, s: number, off: number): [number, number] {
  return [l.start.x + l.dir.x * s + l.right.x * off, l.start.y + l.dir.y * s + l.right.y * off];
}

export class WorksLayer {
  readonly group = new THREE.Group();
  private net: Network;
  private physical = new THREE.Group();
  private plannedGroup = new THREE.Group();
  private physKey = '';
  private planKey = '';
  private boards: THREE.MeshBasicMaterial[] = [];
  private cone: THREE.BufferGeometry;
  private mats: {
    cone: THREE.MeshStandardMaterial;
    hatch: THREE.MeshStandardMaterial;
    barrier: THREE.MeshStandardMaterial;
    dark: THREE.MeshStandardMaterial;
    sign: THREE.MeshStandardMaterial;
    plan: THREE.LineDashedMaterial;
  };
  private arrowTex: THREE.CanvasTexture;
  enabled = true;

  constructor(net: Network) {
    this.net = net;
    this.group.name = 'works';
    this.group.add(this.physical, this.plannedGroup);
    this.mats = {
      cone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }),
      hatch: new THREE.MeshStandardMaterial({ map: hatchTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
      barrier: new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.7, metalness: 0.2 }),
      sign: new THREE.MeshStandardMaterial({ map: closedSignTexture(), roughness: 0.6, side: THREE.DoubleSide }),
      plan: new THREE.LineDashedMaterial({ color: new THREE.Color(2.2, 1.3, 0.25), dashSize: 2.4, gapSize: 1.6, transparent: true, opacity: 0.9 }),
    };
    this.arrowTex = arrowTexture();
    // one traffic cone: base, body and a reflective band (vertex colours)
    const b = new GeoBuilder();
    const orange = new THREE.Color(0xf26a1b);
    const white = new THREE.Color(0xf2f2ee);
    b.setColor(orange).addGeometry(new THREE.BoxGeometry(0.36, 0.04, 0.36), new THREE.Matrix4().makeTranslation(0, 0.02, 0));
    b.setColor(orange).addGeometry(new THREE.CylinderGeometry(0.035, 0.15, 0.64, 10, 1, true), new THREE.Matrix4().makeTranslation(0, 0.36, 0));
    b.setColor(white).addGeometry(new THREE.CylinderGeometry(0.095, 0.112, 0.11, 10, 1, true), new THREE.Matrix4().makeTranslation(0, 0.4, 0));
    this.cone = b.build();
  }

  /** Closures physically in place, and those announced for later (shown as outlines). */
  update(zones: WorksZone[], planned: WorksZone[], wall: number): void {
    const pk = zones.map((z) => `${z.id}:${z.lanes.join(',')}:${z.s0}:${z.s1}`).join('|');
    if (pk !== this.physKey) {
      this.physKey = pk;
      this.rebuildPhysical(zones);
    }
    const qk = planned.map((z) => `${z.id}:${z.lanes.join(',')}:${z.s0}:${z.s1}`).join('|');
    if (qk !== this.planKey) {
      this.planKey = qk;
      this.rebuildPlanned(planned);
    }
    // arrow boards flash; the planned outline breathes
    const on = (wall * 1.4) % 1 < 0.6;
    for (const m of this.boards) m.color.setRGB(on ? 6.5 : 0.35, on ? 3.6 : 0.2, on ? 0.35 : 0.02);
    this.plannedGroup.visible = this.enabled && planned.length > 0;
    this.mats.plan.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(wall * 3));
  }

  private clear(g: THREE.Group): void {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== this.cone) m.geometry.dispose();
      });
    }
  }

  private rebuildPhysical(zones: WorksZone[]): void {
    this.clear(this.physical);
    this.boards = [];
    const cones = new GeoBuilder();
    const hatch = new GeoBuilder();
    const dark = new GeoBuilder();
    const coneAt = (x: number, y: number) => cones.addGeometry(this.cone, new THREE.Matrix4().makeTranslation(x, 0, -y));
    for (const z of zones) {
      const l = this.net.links[z.link];
      if (!l) continue;
      const offs = z.lanes.map((k) => l.laneOffsets[k]);
      const lo = Math.min(...offs) - LANE_W / 2;
      const hi = Math.max(...offs) + LANE_W / 2;
      const full = z.lanes.length >= l.lanes;
      if (full) {
        // hatched carriageway, barrier rows at both ends, a board facing the approach
        hatch.quadH(ccw([P(l, z.s0, lo), P(l, z.s1, lo), P(l, z.s1, hi), P(l, z.s0, hi)]), HATCH_H, 2.2);
        for (const s of [z.s0, z.s1]) this.barrierRow(l, s, lo + 0.2, hi - 0.2, dark);
        for (let off = lo + 0.5; off <= hi - 0.4; off += 1.2) coneAt(...P(l, z.s0 - 2.2, off));
        const mid = (lo + hi) / 2;
        this.signBoard(l, z.s0 - 0.6, mid, dark);
        continue;
      }
      // lane closure: the open lanes lie toward the median when the kerb lanes are closed, and vice versa
      const kerbSide = !z.lanes.includes(0);
      const open = kerbSide ? lo + 0.35 : hi - 0.35;
      const far = kerbSide ? hi - 0.3 : lo + 0.3;
      const a = z.s0;
      const b = Math.min(z.s1, z.s0 + TAPER);
      const e = Math.max(b, z.s1 - END_TAPER);
      hatch.quadH(ccw([P(l, a, far), P(l, b, open), P(l, e, open), P(l, z.s1, far)]), HATCH_H, 2.2);
      for (let s = a; s <= b + 1e-6; s += 3) coneAt(...P(l, s, far + ((open - far) * (s - a)) / Math.max(1, b - a)));
      for (let s = b + 6; s < e; s += 6) coneAt(...P(l, s, open));
      for (let s = e; s <= z.s1 + 1e-6; s += 3) coneAt(...P(l, s, open + ((far - open) * (s - e)) / Math.max(1, z.s1 - e)));
      // arrow board on a small trailer in the closed lane, facing oncoming traffic, pointing to the open side
      const centre = (lo + hi) / 2;
      this.arrowBoard(l, a + 3, centre, kerbSide, dark);
    }
    const add = (bld: GeoBuilder, m: THREE.Material, shadow: boolean) => {
      if (bld.empty) return;
      const mesh = new THREE.Mesh(bld.build(), m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.physical.add(mesh);
    };
    add(hatch, this.mats.hatch, false);
    add(cones, this.mats.cone, true);
    add(dark, this.mats.dark, true);
  }

  /** Orientation for a vertical panel at distance s on link l, facing traffic coming toward it. */
  private facing(l: LinkDef): number {
    return Math.atan2(-l.dir.x, l.dir.y);
  }

  private arrowBoard(l: LinkDef, s: number, off: number, pointLeft: boolean, dark: GeoBuilder): void {
    const [x, y] = P(l, s, off);
    const yaw = this.facing(l);
    // trailer body and mast
    dark.addGeometry(new THREE.BoxGeometry(1.7, 0.7, 2.0), new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0.6, -y));
    dark.addGeometry(new THREE.BoxGeometry(0.12, 1.4, 0.12), new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 1.6, -y));
    const mat = new THREE.MeshBasicMaterial({ map: this.arrowTex, color: new THREE.Color(6.5, 3.6, 0.35), side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.15), mat);
    panel.position.set(x - l.dir.x * 0.08, 2.55, -(y - l.dir.y * 0.08));
    panel.rotation.y = yaw;
    if (!pointLeft) panel.scale.x = -1;
    this.boards.push(mat);
    this.physical.add(panel);
  }

  private barrierRow(l: LinkDef, s: number, from: number, to: number, dark: GeoBuilder): void {
    const yaw = this.facing(l);
    const w = 1.9;
    const n = Math.max(1, Math.round((to - from) / w));
    const step = (to - from) / n;
    const boards = new GeoBuilder();
    for (let i = 0; i < n; i++) {
      const [x, y] = P(l, s, from + step * (i + 0.5));
      boards.addGeometry(new THREE.BoxGeometry(step - 0.15, 0.28, 0.06), new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0.95, -y));
      boards.addGeometry(new THREE.BoxGeometry(step - 0.15, 0.2, 0.06), new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0.45, -y));
      for (const side of [-1, 1]) {
        const [lx, ly] = P(l, s, from + step * (i + 0.5) + side * (step / 2 - 0.2));
        dark.addGeometry(new THREE.BoxGeometry(0.07, 1.1, 0.5), new THREE.Matrix4().makeRotationY(yaw).setPosition(lx, 0.55, -ly));
      }
    }
    const mesh = new THREE.Mesh(boards.build(), this.mats.barrier);
    mesh.castShadow = true;
    this.physical.add(mesh);
  }

  private signBoard(l: LinkDef, s: number, off: number, dark: GeoBuilder): void {
    const [x, y] = P(l, s, off);
    const yaw = this.facing(l);
    for (const side of [-1, 1]) {
      const [lx, ly] = P(l, s, off + side * 1.0);
      dark.addGeometry(new THREE.BoxGeometry(0.08, 2.1, 0.08), new THREE.Matrix4().makeRotationY(yaw).setPosition(lx, 1.05, -ly));
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), this.mats.sign);
    sign.position.set(x - l.dir.x * 0.05, 1.75, -(y - l.dir.y * 0.05));
    sign.rotation.y = yaw;
    sign.castShadow = true;
    this.physical.add(sign);
  }

  private rebuildPlanned(zones: WorksZone[]): void {
    this.clear(this.plannedGroup);
    for (const z of zones) {
      const l = this.net.links[z.link];
      if (!l) continue;
      const offs = z.lanes.map((k) => l.laneOffsets[k]);
      const lo = Math.min(...offs) - LANE_W / 2 + 0.15;
      const hi = Math.max(...offs) + LANE_W / 2 - 0.15;
      const pts = [P(l, z.s0, lo), P(l, z.s1, lo), P(l, z.s1, hi), P(l, z.s0, hi), P(l, z.s0, lo)].map(([x, y]) => new THREE.Vector3(x, 0.16, -y));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.mats.plan);
      line.computeLineDistances();
      line.renderOrder = 8;
      this.plannedGroup.add(line);
    }
  }
}

function ccw(p: Array<[number, number]>): Array<[number, number]> {
  const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
  return cross >= 0 ? p : [...p].reverse();
}
