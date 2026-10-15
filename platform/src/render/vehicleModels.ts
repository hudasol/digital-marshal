import * as THREE from 'three';
import { GeoBuilder } from './city/builder';

/* Procedural vehicle models. Bodies are lofted from superellipse cross-sections along designed side
   and plan profiles, so hoods, rooflines, tumblehome and tails curve like real cars; the glass
   greenhouse is a second loft whose roof, pillars and window frames are painted or trimmed; wheels
   are turned (tyre, rim, spokes). Every model is split by material: paint (per-vehicle colour),
   glass, trim (tyres, plastics, livery, chrome) and the head and tail lamps, which the renderer
   lights per vehicle. Local frame: +x forward, +y up, z across, origin at the centre on the ground.
   All shapes are original and generic; no real make or model is reproduced. */

export interface VehicleGeo {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
}

type Part = 'paint' | 'glass' | 'trim' | 'skip';

/** Piecewise-linear profile over u in [0, 1] (rear to front) with smoothstep easing between knots. */
function profile(knots: Array<[number, number]>): (u: number) => number {
  return (u: number) => {
    if (u <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      const [u1, v1] = knots[i];
      if (u <= u1) {
        const [u0, v0] = knots[i - 1];
        const t = (u - u0) / Math.max(1e-6, u1 - u0);
        const e = t * t * (3 - 2 * t);
        return v0 + (v1 - v0) * e;
      }
    }
    return knots[knots.length - 1][1];
  };
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** Closed superellipse ring (z, y) around a centre, `k` points, exponent n (2 = ellipse, large = box). */
function superRing(hw: number, y0: number, y1: number, n: number, k: number, bottomFlat = 0.65): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const yc = (y0 + y1) / 2;
  const hh = (y1 - y0) / 2;
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2 - Math.PI / 2; // start at the bottom centre, go up the +z side
    const c = Math.cos(t);
    const s = Math.sin(t);
    // a flatter floor: the lower half uses a higher exponent
    const e = s < 0 ? 2 / (n + (n * bottomFlat)) : 2 / n;
    pts.push([hw * sgnPow(c, e), yc + hh * sgnPow(s, e)]);
  }
  return pts;
}

interface LoftOut {
  pos: number[];
  /** quads as vertex index quadruples with their part */
  quads: Array<[number, number, number, number, Part]>;
}

/** Connect rings (same point count) along x into quads; `part(i, k)` names the material of each quad. */
function loft(
  stations: Array<{ x: number; ring: Array<[number, number]> }>,
  closed: boolean,
  part: (i: number, k: number) => Part,
  out: LoftOut,
  capEnds: Part | null = null,
): void {
  const base = out.pos.length / 3;
  const K = stations[0].ring.length;
  for (const st of stations) for (const [z, y] of st.ring) out.pos.push(st.x, y, z);
  const id = (i: number, k: number) => base + i * K + (((k % K) + K) % K);
  for (let i = 0; i + 1 < stations.length; i++) {
    for (let k = 0; k < (closed ? K : K - 1); k++) {
      out.quads.push([id(i, k), id(i + 1, k), id(i + 1, k + 1), id(i, k + 1), part(i, k)]);
    }
  }
  if (capEnds && closed) {
    for (const [i, flip] of [
      [0, true],
      [stations.length - 1, false],
    ] as Array<[number, boolean]>) {
      const st = stations[i];
      let cy = 0;
      let cz = 0;
      for (const [z, y] of st.ring) {
        cy += y;
        cz += z;
      }
      const c = out.pos.length / 3;
      out.pos.push(st.x, cy / K, cz / K);
      for (let k = 0; k < K; k++) {
        const a = id(i, k);
        const b = id(i, k + 1);
        out.quads.push(flip ? [c, b, a, a, capEnds] : [c, a, b, b, capEnds]);
      }
    }
  }
}

/** Turn a loft into per-part geometries with smooth normals, winding faces outward from the x axis. */
function finishLoft(out: LoftOut, into: Record<Exclude<Part, 'skip'>, GeoBuilder>, colors: Partial<Record<Part, number>> = {}, axisY = 0.8): void {
  const P = out.pos;
  // smooth normals: accumulate face normals per vertex (outward = away from the body axis)
  const nrm = new Float32Array(P.length);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const flips: boolean[] = [];
  for (const q of out.quads) {
    a.fromArray(P, q[0] * 3);
    b.fromArray(P, q[1] * 3);
    c.fromArray(P, q[2] * 3);
    n.subVectors(b, a).cross(c.sub(a));
    if (n.lengthSq() < 1e-12) {
      c.fromArray(P, q[3] * 3);
      n.subVectors(b, a).cross(c.sub(a));
    }
    // outward test against the centre line (x axis at axisY)
    const mx = (P[q[0] * 3] + P[q[2] * 3]) / 2;
    const my = (P[q[0] * 3 + 1] + P[q[2] * 3 + 1]) / 2;
    const mz = (P[q[0] * 3 + 2] + P[q[2] * 3 + 2]) / 2;
    const isCap = q[2] === q[3];
    const out3 = isCap ? new THREE.Vector3(Math.sign(mx) || 1, 0, 0) : new THREE.Vector3(0, my - axisY, mz);
    const flip = n.dot(out3) < 0;
    flips.push(flip);
    if (flip) n.negate();
    n.normalize();
    for (const v of q[2] === q[3] ? [q[0], q[1], q[2]] : q.slice(0, 4)) {
      const vi = v as number;
      nrm[vi * 3] += n.x;
      nrm[vi * 3 + 1] += n.y;
      nrm[vi * 3 + 2] += n.z;
    }
  }
  const tri = (part: Exclude<Part, 'skip'>, i0: number, i1: number, i2: number) => {
    const g = into[part];
    for (const i of [i0, i1, i2]) {
      g.pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      const nx = nrm[i * 3];
      const ny = nrm[i * 3 + 1];
      const nz = nrm[i * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      g.nor.push(nx / l, ny / l, nz / l);
      g.uv.push(0, 0);
      const col = new THREE.Color(colors[part] ?? 0xffffff);
      g.col.push(col.r, col.g, col.b);
    }
  };
  out.quads.forEach((q, qi) => {
    const part = q[4];
    if (part === 'skip') return;
    const f = flips[qi];
    if (q[2] === q[3]) {
      if (f) tri(part, q[0], q[2], q[1]);
      else tri(part, q[0], q[1], q[2]);
      return;
    }
    if (f) {
      tri(part, q[0], q[2], q[1]);
      tri(part, q[0], q[3], q[2]);
    } else {
      tri(part, q[0], q[1], q[2]);
      tri(part, q[0], q[2], q[3]);
    }
  });
}

const M = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Tyre (lathe), dished rim and spokes, axle along z. */
function wheel(trim: GeoBuilder, x: number, z: number, r: number, width: number, side: number, spokes = 5, detailed = true): void {
  const tw = width / 2;
  if (!detailed) {
    const tyre = new THREE.CylinderGeometry(r, r, width, 8, 1, true);
    tyre.rotateX(Math.PI / 2);
    trim.setColor(0x16171a).addGeometry(tyre, M(x, r, z));
    const cap = new THREE.CircleGeometry(r * 0.68, 8);
    cap.rotateY(side > 0 ? 0 : Math.PI);
    trim.setColor(0x9aa1a9).addGeometry(cap, M(x, r, z + side * tw));
    return;
  }
  const segs = 14;
  // tyre cross-section: tread, rounded shoulders, sidewalls down to the rim
  const prof = [
    new THREE.Vector2(r * 0.66, -tw * 0.92),
    new THREE.Vector2(r * 0.93, -tw),
    new THREE.Vector2(r, -tw * 0.5),
    new THREE.Vector2(r, tw * 0.5),
    new THREE.Vector2(r * 0.93, tw),
    new THREE.Vector2(r * 0.66, tw * 0.92),
  ];
  const tyre = new THREE.LatheGeometry(prof, segs);
  tyre.rotateX(Math.PI / 2);
  trim.setColor(0x16171a).addGeometry(tyre, M(x, r, z));
  // rim: a dark dished face with a bright lip, then spokes and a centre cap
  const dish = new THREE.CircleGeometry(r * 0.64, segs);
  dish.rotateY(side > 0 ? 0 : Math.PI);
  trim.setColor(0x2b2f35).addGeometry(dish, M(x, r, z + side * (tw * 0.84)));
  const lip = new THREE.RingGeometry(r * 0.6, r * 0.67, segs);
  lip.rotateY(side > 0 ? 0 : Math.PI);
  trim.setColor(0xc4c9cf).addGeometry(lip, M(x, r, z + side * (tw * 0.9)));
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const s = box(r * 0.56, 0.07, 0.03);
    s.translate(r * 0.3, 0, 0);
    s.rotateZ(a);
    trim.setColor(0xb8bec5).addGeometry(s, M(x, r, z + side * (tw * 0.92)));
  }
  const cap = new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.04, 10);
  cap.rotateX(Math.PI / 2);
  trim.setColor(0x8a9097).addGeometry(cap, M(x, r, z + side * (tw * 0.93)));
}

/** Dark wheel well: the inside of the arch above the tyre, across the car (hides the open floor). */
function wheelWell(trim: GeoBuilder, x: number, r: number, width: number, detailed: boolean): void {
  const g = new THREE.CylinderGeometry(r + 0.06, r + 0.06, width, detailed ? 14 : 8, 1, true, -Math.PI / 2, Math.PI);
  g.rotateX(Math.PI / 2);
  trim.setColor(0x0b0c0e).addGeometry(g, M(x, r, 0));
}


// ------------------------------------------------------------------ passenger cars

interface CarDesign {
  L: number;
  W: number;
  clearance: number;
  wheelR: number;
  axles: [number, number]; // u positions (rear, front)
  /** top of the lower body: trunk lid, beltline and hood (m) */
  deck: Array<[number, number]>;
  /** plan half width as a fraction of W/2 */
  plan: Array<[number, number]>;
  /** greenhouse: u from rear window base to windscreen base, roof height profile */
  gh: [number, number];
  roof: Array<[number, number]>;
  /** roof flat span (painted) and B-pillar position */
  roofSpan: [number, number];
  bPillar: number;
  tumble: number;
  boxiness: number;
  hatch?: boolean;
}

const SEDAN: CarDesign = {
  L: 4.6,
  W: 1.84,
  clearance: 0.26,
  wheelR: 0.33,
  axles: [0.19, 0.8],
  deck: [
    [0, 0.66],
    [0.025, 0.82],
    [0.07, 0.92],
    [0.18, 0.96],
    [0.6, 0.97],
    [0.72, 0.9],
    [0.9, 0.76],
    [0.975, 0.64],
    [1, 0.52],
  ],
  plan: [
    [0, 0.8],
    [0.04, 0.92],
    [0.14, 0.98],
    [0.5, 1],
    [0.84, 0.97],
    [0.95, 0.88],
    [1, 0.7],
  ],
  gh: [0.17, 0.69],
  roof: [
    [0.17, 0.96],
    [0.31, 1.38],
    [0.42, 1.43],
    [0.53, 1.42],
    [0.61, 1.33],
    [0.69, 0.97],
  ],
  roofSpan: [0.32, 0.6],
  bPillar: 0.47,
  tumble: 0.2,
  boxiness: 3.6,
};

const SUV: CarDesign = {
  L: 4.6,
  W: 1.86,
  clearance: 0.34,
  wheelR: 0.37,
  axles: [0.2, 0.8],
  deck: [
    [0, 0.82],
    [0.03, 1.0],
    [0.08, 1.05],
    [0.6, 1.06],
    [0.72, 1.02],
    [0.9, 0.94],
    [0.975, 0.84],
    [1, 0.7],
  ],
  plan: [
    [0, 0.84],
    [0.05, 0.96],
    [0.15, 1],
    [0.85, 1],
    [0.95, 0.93],
    [1, 0.8],
  ],
  gh: [0.05, 0.71],
  roof: [
    [0.05, 1.05],
    [0.1, 1.6],
    [0.2, 1.68],
    [0.52, 1.68],
    [0.62, 1.6],
    [0.71, 1.06],
  ],
  roofSpan: [0.11, 0.6],
  bPillar: 0.4,
  tumble: 0.16,
  boxiness: 5,
  hatch: true,
};

const ROBOTAXI: CarDesign = {
  L: 4.9,
  W: 1.92,
  clearance: 0.3,
  wheelR: 0.38,
  axles: [0.18, 0.81],
  deck: [
    [0, 0.78],
    [0.03, 0.96],
    [0.08, 1.02],
    [0.6, 1.03],
    [0.73, 0.98],
    [0.9, 0.88],
    [0.975, 0.78],
    [1, 0.64],
  ],
  plan: [
    [0, 0.82],
    [0.05, 0.95],
    [0.15, 1],
    [0.85, 1],
    [0.95, 0.92],
    [1, 0.76],
  ],
  gh: [0.06, 0.72],
  roof: [
    [0.06, 1.02],
    [0.13, 1.5],
    [0.25, 1.58],
    [0.52, 1.58],
    [0.63, 1.48],
    [0.72, 1.03],
  ],
  roofSpan: [0.14, 0.6],
  bPillar: 0.4,
  tumble: 0.2,
  boxiness: 4.5,
  hatch: true,
};

function car(d: CarDesign, detailed: boolean, extras?: (b: Builders) => void): VehicleGeo {
  const b = builders();
  const { L, W } = d;
  const deck = profile(d.deck);
  const plan = profile(d.plan);
  const roof = profile(d.roof);
  const xOf = (u: number) => (u - 0.5) * L;
  // ---- lower body: dense stations at the nose and tail where the shape changes fastest, and
  // around each axle, where the floor line rises into a round wheel arch
  const r = d.wheelR;
  const archU = (r + 0.07) / L;
  const archTop = 2 * r + 0.05;
  const S = detailed ? 22 : 9;
  const set = new Set<number>();
  for (let i = 0; i <= S; i++) set.add(+(0.5 - 0.5 * Math.cos((i / S) * Math.PI)).toFixed(5));
  const AS = detailed ? 5 : 2;
  for (const au of d.axles) for (let j = -AS; j <= AS; j++) set.add(+(au + (j / AS) * archU * 1.02).toFixed(5));
  const us = [...set].filter((u) => u >= 0 && u <= 1).sort((a, b) => a - b);
  const floorAt = (u: number) => {
    let y = d.clearance + 0.06 * (Math.max(0, 0.08 - Math.min(u, 1 - u)) / 0.08);
    for (const au of d.axles) {
      const t = (u - au) / archU;
      if (Math.abs(t) < 1) y = Math.max(y, d.clearance + (archTop - d.clearance) * Math.sqrt(1 - t * t));
    }
    return y;
  };
  const K = detailed ? 22 : 12;
  const body: LoftOut = { pos: [], quads: [] };
  const rings = us.map((u) => {
    const hw = (W / 2) * plan(u);
    const y0 = Math.min(floorAt(u), deck(u) - 0.08);
    return { x: xOf(u), ring: superRing(hw, y0, deck(u), d.boxiness, K) };
  });
  loft(rings, true, () => 'paint', body, 'paint');
  finishLoft(body, b, {}, 0.6);

  // ---- greenhouse: glass with a painted roof, A/B/C pillars and window frames
  const G = detailed ? 18 : 7;
  const GK = detailed ? 14 : 6;
  const gh: LoftOut = { pos: [], quads: [] };
  const gst: Array<{ x: number; ring: Array<[number, number]> }> = [];
  for (let i = 0; i <= G; i++) {
    const u = d.gh[0] + ((d.gh[1] - d.gh[0]) * i) / G;
    const yb = deck(u) - 0.015;
    const yt = Math.max(yb + 0.01, roof(u));
    const hwb = (W / 2) * plan(u) - 0.05;
    const hwt = hwb - d.tumble;
    const ring: Array<[number, number]> = [];
    for (let k = 0; k <= GK; k++) {
      // from the +z beltline over the roof to the -z beltline
      const a = (k / GK) * Math.PI;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 2 / 6;
      const lift = sgnPow(s, e);
      const hw = hwb + (hwt - hwb) * Math.pow(Math.max(0, s), 1.6);
      ring.push([hw * sgnPow(c, e), yb + (yt - yb) * lift]);
    }
    gst.push({ x: xOf(u), ring });
  }
  const ghPart = (i: number, k: number): Part => {
    const u0 = d.gh[0] + ((d.gh[1] - d.gh[0]) * i) / G;
    const u1 = d.gh[0] + ((d.gh[1] - d.gh[0]) * (i + 1)) / G;
    const um = (u0 + u1) / 2;
    const top = Math.sin(((k + 0.5) / GK) * Math.PI); // 1 on the roof centre line, 0 at the sills
    const inRoof = um > d.roofSpan[0] && um < d.roofSpan[1];
    if (inRoof && top > 0.88) return 'paint';
    // drip rail / upper window frame
    if (inRoof && top > 0.8) return 'trim';
    // B-pillar and the pillar tops that frame the screens
    if (Math.abs(um - d.bPillar) < 0.018 && top < 0.8) return 'trim';
    if (!inRoof && top > 0.62 && top < 0.86) return 'paint';
    // window sill line
    if (top < 0.12) return 'trim';
    return 'glass';
  };
  loft(gst, false, ghPart, gh);
  finishLoft(gh, b, { trim: 0x111316 }, 0.9);

  // ---- wheels flush with the body sides under their arches, dark wheel wells behind them
  for (const au of d.axles) {
    wheelWell(b.trim, xOf(au), r, W * plan(au) - 0.12, detailed);
    for (const side of [-1, 1]) {
      const z = side * ((W / 2) * plan(au) - 0.135);
      wheel(b.trim, xOf(au), z, r, 0.24, side, 5, detailed);
    }
  }
  const sill = d.clearance + 0.1;
  for (const side of [-1, 1]) {
    b.trim.setColor(0x1b1d21).addGeometry(box(xOf(d.axles[1]) - xOf(d.axles[0]) - (r + 0.07) * 2.1, 0.12, 0.04), M((xOf(d.axles[1]) + xOf(d.axles[0])) / 2, sill, side * ((W / 2) * 0.985)));
  }
  // ---- front: grille, lower intake, plate; rear: diffuser and plate
  const nose = xOf(1);
  const tail = xOf(0);
  b.trim.setColor(0x15171a).addGeometry(box(0.06, 0.16, W * 0.42), M(nose - 0.035, deck(0.97) - 0.12, 0));
  b.trim.addGeometry(box(0.06, 0.12, W * 0.6), M(nose - 0.06, d.clearance + 0.1, 0));
  b.trim.setColor(0xf1f1ec).addGeometry(box(0.02, 0.11, 0.5), M(nose + 0.005, d.clearance + 0.22, 0));
  b.trim.setColor(0x1b1d21).addGeometry(box(0.08, 0.12, W * 0.66), M(tail + 0.05, d.clearance + 0.1, 0));
  b.trim.setColor(0xf1f1ec).addGeometry(box(0.02, 0.11, 0.5), M(tail - 0.005, deck(0.02) - 0.22, 0));
  // ---- lamps: swept headlight units and a full-width rear light bar
  for (const side of [-1, 1]) {
    const hz = side * (W / 2) * 0.62;
    const hy = deck(0.965) - 0.06;
    const hl = box(0.14, 0.07, 0.36);
    hl.rotateY(side * 0.35);
    b.head.addGeometry(hl, M(nose - 0.09, hy, hz));
    // daytime running light under the lens
    const drl = box(0.1, 0.02, 0.34);
    drl.rotateY(side * 0.35);
    b.head.addGeometry(drl, M(nose - 0.08, hy - 0.06, hz));
    // mirrors
    const mu = d.gh[1] - 0.04;
    const mx = xOf(mu);
    const mz = side * ((W / 2) * plan(mu) + 0.08);
    const mirror = new THREE.SphereGeometry(0.09, 8, 6);
    mirror.scale(0.75, 0.62, 1.05);
    b.paint.addGeometry(mirror, M(mx, deck(mu) + 0.09, mz));
    b.trim.setColor(0x15171a).addGeometry(box(0.05, 0.03, 0.09), M(mx, deck(mu) + 0.02, mz - side * 0.07));
    // door handles
    if (detailed)
      for (const hu of [d.bPillar - 0.09, d.bPillar + 0.11]) {
        b.trim.setColor(0xc4c9cf).addGeometry(box(0.14, 0.025, 0.02), M(xOf(hu), deck(hu) - 0.12, side * ((W / 2) * plan(hu) + 0.008)));
      }
  }
  const ty = deck(0.03) - 0.06;
  b.tail.addGeometry(box(0.05, 0.06, W * 0.86), M(tail + 0.04, ty, 0));
  for (const side of [-1, 1]) b.tail.addGeometry(box(0.06, 0.12, 0.26), M(tail + 0.05, ty - 0.02, side * (W / 2) * 0.66));
  extras?.(b);
  return finish(b);
}

// ------------------------------------------------------------------ boxy vehicles

interface Builders {
  paint: GeoBuilder;
  glass: GeoBuilder;
  trim: GeoBuilder;
  head: GeoBuilder;
  tail: GeoBuilder;
}

function builders(): Builders {
  const b = { paint: new GeoBuilder(), glass: new GeoBuilder(), trim: new GeoBuilder(), head: new GeoBuilder(), tail: new GeoBuilder() };
  b.paint.setColor(0xffffff);
  b.glass.setColor(0xffffff);
  b.head.setColor(0xffffff);
  b.tail.setColor(0xffffff);
  return b;
}

function finish(b: Builders): VehicleGeo {
  const g = (x: GeoBuilder) => {
    const out = x.build();
    if (!out.getAttribute('normal')) out.computeVertexNormals();
    return out;
  };
  return { paint: g(b.paint), glass: g(b.glass), trim: g(b.trim), head: g(b.head), tail: g(b.tail) };
}

interface Axle {
  x: number;
  r: number;
}

/** Floor line of a body: the sill height, rising into a round arch over each wheel. */
function archFloor(x: number, base: number, axles: Axle[]): number {
  let y = base;
  for (const a of axles) {
    const half = a.r + 0.07;
    const t = (x - a.x) / half;
    if (Math.abs(t) < 1) y = Math.max(y, base + (2 * a.r + 0.05 - base) * Math.sqrt(1 - t * t));
  }
  return y;
}

/** Station positions between x0 and x1: cosine spaced, plus dense ones across every wheel arch. */
function stationsX(x0: number, x1: number, S: number, axles: Axle[], detailed: boolean): number[] {
  const set = new Set<number>();
  for (let i = 0; i <= S; i++) set.add(+(x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos((i / S) * Math.PI))).toFixed(4));
  const AS = detailed ? 5 : 2;
  for (const a of axles)
    for (let j = -AS; j <= AS; j++) {
      const x = a.x + (j / AS) * (a.r + 0.07) * 1.02;
      if (x > x0 && x < x1) set.add(+x.toFixed(4));
    }
  return [...set].sort((a, b) => a - b);
}

/** Tyres flush with the body sides and a dark well over each axle. */
function axleSet(b: Builders, axles: Axle[], W: number, tyreW: number, spokes: number, detailed: boolean): void {
  for (const a of axles) {
    wheelWell(b.trim, a.x, a.r, W - 0.14, detailed);
    for (const side of [-1, 1]) wheel(b.trim, a.x, side * (W / 2 - tyreW / 2 - 0.015), a.r, tyreW, side, spokes, detailed);
  }
}

/** A rounded box body lofted along x (vans, buses, ambulance modules), with wheel arches. */
function roundedBody(
  b: Builders,
  x0: number,
  x1: number,
  hw: number,
  y0: number,
  y1: number,
  n: number,
  part: (u: number, top: number, side: number) => Part,
  detailed: boolean,
  axles: Axle[] = [],
): void {
  const S = detailed ? 12 : 5;
  const K = detailed ? 22 : 12;
  const st: Array<{ x: number; ring: Array<[number, number]> }> = [];
  for (const x of stationsX(x0, x1, S, axles, detailed)) {
    const u = THREE.MathUtils.clamp((x - x0) / (x1 - x0), 0, 1);
    // ends pull in slightly so the box has rounded vertical edges
    const endK = 1 - 0.06 * Math.pow(Math.abs(u - 0.5) * 2, 8);
    st.push({ x, ring: superRing(hw * endK, archFloor(x, y0, axles), y1 - (1 - endK) * 0.3, n, K, 0.6) });
  }
  const out: LoftOut = { pos: [], quads: [] };
  loft(
    st,
    true,
    (i, k) => {
      const u = ((st[i].x + st[Math.min(i + 1, st.length - 1)].x) / 2 - x0) / (x1 - x0);
      const a = ((k + 0.5) / K) * Math.PI * 2 - Math.PI / 2;
      return part(u, Math.sin(a), Math.cos(a));
    },
    out,
    'paint',
  );
  finishLoft(out, b, { trim: 0x111316 }, (y0 + y1) / 2);
}

function van(detailed: boolean): VehicleGeo {
  const L = 5.6;
  const W = 2.0;
  const b = builders();
  const H = 2.3;
  const axles: Axle[] = [
    { x: -0.3 * L, r: 0.38 },
    { x: 0.32 * L, r: 0.38 },
  ];
  // cargo body with an integrated, lower cab: a long rounded box plus a sloped nose
  roundedBody(b, -L / 2, L * 0.18, W / 2, 0.42, H, 6, (u, top) => (top > -0.2 && top < 0.0 && u > 0.98 ? 'trim' : 'paint'), detailed, axles);
  const nose: LoftOut = { pos: [], quads: [] };
  const K = detailed ? 22 : 12;
  const st: Array<{ x: number; ring: Array<[number, number]> }> = [];
  const S = detailed ? 10 : 5;
  const x0 = L * 0.12;
  const x1 = L * 0.5;
  for (const x of stationsX(x0, x1, S, axles, detailed)) {
    const t = THREE.MathUtils.clamp((x - x0) / (x1 - x0), 0, 1);
    const top = H - (H - 1.08) * Math.pow(t, 1.25) - 0.02;
    const hw = (W / 2) * (1 - 0.08 * Math.pow(t, 3));
    st.push({ x, ring: superRing(hw, archFloor(x, 0.42, axles), Math.max(0.9, top), 5, K, 0.6) });
  }
  loft(
    st,
    true,
    (i, k) => {
      const t = ((st[i].x + st[Math.min(i + 1, st.length - 1)].x) / 2 - x0) / (x1 - x0);
      const a = ((k + 0.5) / K) * Math.PI * 2 - Math.PI / 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      // windscreen on the slope, cab side windows above the beltline
      if (t > 0.2 && t < 0.62 && s > 0.62) return 'glass';
      if (t < 0.45 && s > 0.15 && s < 0.62 && Math.abs(c) > 0.3) return 'glass';
      return 'paint';
    },
    nose,
    'paint',
  );
  finishLoft(nose, b, {}, 1.2);
  axleSet(b, axles, W, 0.25, 6, detailed);
  for (const side of [-1, 1]) {
    b.head.addGeometry(box(0.08, 0.14, 0.38), M(L / 2 - 0.08, 0.86, side * (W / 2 - 0.34)));
    b.tail.addGeometry(box(0.05, 0.42, 0.14), M(-L / 2 - 0.01, 1.1, side * (W / 2 - 0.12)));
    b.paint.addGeometry(box(0.14, 0.24, 0.2), M(L * 0.24, 1.55, side * (W / 2 + 0.12)));
  }
  b.trim.setColor(0x16181b).addGeometry(box(0.08, 0.3, W - 0.2), M(L / 2 - 0.02, 0.6, 0));
  b.trim.addGeometry(box(0.1, 0.24, W - 0.1), M(-L / 2 + 0.03, 0.55, 0));
  return finish(b);
}

function ambulance(detailed: boolean): VehicleGeo {
  const L = 6.4;
  const W = 2.2;
  const b = builders();
  const axles: Axle[] = [
    { x: -0.31 * L, r: 0.38 },
    { x: 0.3 * L, r: 0.38 },
  ];
  // patient module (tall box) behind a van cab
  const H = 2.62;
  roundedBody(b, -L / 2, L * 0.12, W / 2, 0.46, H, 7, () => 'paint', detailed, axles);
  const K = detailed ? 22 : 12;
  const S = detailed ? 10 : 5;
  const st: Array<{ x: number; ring: Array<[number, number]> }> = [];
  const cx0 = L * 0.1;
  const cx1 = L * 0.5;
  for (const x of stationsX(cx0, cx1, S, axles, detailed)) {
    const t = THREE.MathUtils.clamp((x - cx0) / (cx1 - cx0), 0, 1);
    const top = 2.28 - (2.28 - 1.1) * Math.pow(t, 1.3);
    st.push({ x, ring: superRing((W / 2 - 0.05) * (1 - 0.07 * Math.pow(t, 3)), archFloor(x, 0.46, axles), top, 5, K, 0.6) });
  }
  const cab: LoftOut = { pos: [], quads: [] };
  loft(
    st,
    true,
    (i, k) => {
      const t = ((st[i].x + st[Math.min(i + 1, st.length - 1)].x) / 2 - cx0) / (cx1 - cx0);
      const a = ((k + 0.5) / K) * Math.PI * 2 - Math.PI / 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      if (t > 0.22 && t < 0.62 && s > 0.62) return 'glass';
      if (t < 0.45 && s > 0.18 && s < 0.62 && Math.abs(c) > 0.3) return 'glass';
      return 'paint';
    },
    cab,
    'paint',
  );
  finishLoft(cab, b, {}, 1.2);
  // high-visibility livery: a red band over a yellow band, rear chevrons
  for (const side of [-1, 1]) {
    b.trim.setColor(0xd11f2a).addGeometry(box(L * 0.6, 0.3, 0.02), M(-L * 0.18, 1.25, side * (W / 2 + 0.012)));
    b.trim.setColor(0xf2c230).addGeometry(box(L * 0.6, 0.16, 0.02), M(-L * 0.18, 0.96, side * (W / 2 + 0.012)));
    b.trim.setColor(0xd11f2a).addGeometry(box(L * 0.36, 0.22, 0.02), M(L * 0.26, 0.95, side * (W / 2 - 0.02)));
  }
  for (let k = 0; k < 6; k++) b.trim.setColor(k % 2 ? 0xf2c230 : 0xd11f2a).addGeometry(box(0.02, 1.0, 0.3), M(-L / 2 - 0.012, 1.25, -0.75 + k * 0.3));
  // roof lamps on the module's front corners and a light bar over the cab (lit by the renderer)
  // beacon housings on the module's top corners (the renderer lights them)
  for (const [x, s] of [
    [L * 0.12 - 0.22, 1],
    [L * 0.12 - 0.22, -1],
    [-L / 2 + 0.22, 1],
    [-L / 2 + 0.22, -1],
  ])
    b.trim.setColor(0x2f343b).addGeometry(box(0.4, 0.06, 0.4), M(x, 2.6, s * 0.88));
  for (const side of [-1, 1]) {
    b.head.addGeometry(box(0.08, 0.14, 0.36), M(L / 2 - 0.1, 0.9, side * (W / 2 - 0.34)));
    b.tail.addGeometry(box(0.05, 0.45, 0.16), M(-L / 2 - 0.01, 1.2, side * (W / 2 - 0.12)));
    b.paint.addGeometry(box(0.14, 0.26, 0.2), M(L * 0.2, 1.6, side * (W / 2 + 0.12)));
  }
  b.trim.setColor(0x16181b).addGeometry(box(0.08, 0.3, W - 0.2), M(L / 2 - 0.04, 0.62, 0));
  axleSet(b, axles, W, 0.26, 6, detailed);
  return finish(b);
}

function bus(detailed: boolean): VehicleGeo {
  const L = 12;
  const W = 2.55;
  const b = builders();
  const H = 3.15;
  const axles: Axle[] = [
    { x: -0.3 * L, r: 0.5 },
    { x: 0.33 * L, r: 0.5 },
  ];
  roundedBody(
    b,
    -L / 2,
    L / 2,
    W / 2,
    0.36,
    H,
    7,
    (u, top, side) => {
      // a continuous glazed band along both sides, framed by black pillars every 1.6 m
      const x = (u - 0.5) * L;
      const sideFace = Math.abs(side) > 0.55;
      if (sideFace && top > 0.0 && top < 0.62) {
        const bay = ((x + L / 2) % 1.6) / 1.6;
        return bay < 0.07 ? 'trim' : 'glass';
      }
      // windscreen and rear window
      if (u > 0.985 && top > -0.25 && top < 0.8) return 'glass';
      if (u < 0.012 && top > 0.15 && top < 0.7) return 'glass';
      return 'paint';
    },
    detailed,
    axles,
  );
  for (const side of [-1, 1]) b.trim.setColor(0x46c3d6).addGeometry(box(L - 0.8, 0.12, 0.02), M(0, 1.15, side * (W / 2 + 0.008)));
  b.trim.setColor(0xc9ced4).addGeometry(box(2.8, 0.26, W - 0.8), M(-L * 0.22, H + 0.06, 0));
  b.trim.setColor(0x16181b).addGeometry(box(0.06, 0.34, W - 0.3), M(L / 2 + 0.01, 0.6, 0));
  // destination display over the windscreen
  b.head.addGeometry(box(0.04, 0.22, W - 0.7), M(L / 2 + 0.02, H - 0.22, 0));
  axleSet(b, axles, W, 0.3, 8, detailed);
  for (const side of [-1, 1]) {
    b.head.addGeometry(box(0.05, 0.16, 0.42), M(L / 2 + 0.02, 0.78, side * (W / 2 - 0.36)));
    b.tail.addGeometry(box(0.05, 0.36, 0.2), M(-L / 2 - 0.01, 1.0, side * (W / 2 - 0.2)));
    b.trim.setColor(0x16181b).addGeometry(box(0.32, 0.3, 0.05), M(L / 2 - 0.1, 2.2, side * (W / 2 + 0.2)));
  }
  return finish(b);
}

// ------------------------------------------------------------------ catalogue

export type BodyStyle = 'sedan' | 'suv' | 'robotaxi' | 'van' | 'bus' | 'ambulance';
export const BODY_STYLES: BodyStyle[] = ['sedan', 'suv', 'robotaxi', 'van', 'bus', 'ambulance'];

/** Detailed (near) or light (far) model of a body style. */
export function vehicleModel(style: BodyStyle, detailed: boolean): VehicleGeo {
  switch (style) {
    case 'sedan':
      return car(SEDAN, detailed);
    case 'suv':
      return car(SUV, detailed, (b) => {
        // roof rails
        for (const side of [-1, 1]) b.trim.setColor(0x24272c).addGeometry(box(2.0, 0.05, 0.05), M(-0.25, 1.71, side * 0.62));
      });
    case 'robotaxi':
      return car(ROBOTAXI, detailed, (b) => {
        const L = ROBOTAXI.L;
        // roof sensor deck: a low fairing, a lidar dome and corner cameras; a cyan line along the body
        const fair = new THREE.CylinderGeometry(0.62, 0.7, 0.12, detailed ? 28 : 12);
        fair.scale(1.25, 1, 1);
        b.paint.addGeometry(fair, M(-0.1 * L, 1.64, 0));
        const dome = new THREE.SphereGeometry(0.26, detailed ? 20 : 10, detailed ? 10 : 5, 0, Math.PI * 2, 0, Math.PI / 2);
        b.trim.setColor(0x20252b).addGeometry(new THREE.CylinderGeometry(0.24, 0.26, 0.2, detailed ? 20 : 10), M(-0.1 * L, 1.8, 0));
        b.glass.addGeometry(dome, M(-0.1 * L, 1.9, 0));
        for (const side of [-1, 1]) {
          b.trim.setColor(0x20252b).addGeometry(box(0.16, 0.1, 0.1), M(0.12 * L, 1.42, side * 0.86));
          b.trim.setColor(0x2ab3c9).addGeometry(box(0.64 * L, 0.035, 0.02), M(-0.02 * L, 0.8, side * (ROBOTAXI.W / 2 + 0.006)));
        }
        b.trim.setColor(0x20252b).addGeometry(box(0.06, 0.08, 1.1), M(0.5 * L - 0.02, 0.64, 0));
      });
    case 'van':
      return van(detailed);
    case 'bus':
      return bus(detailed);
    case 'ambulance':
      return ambulance(detailed);
  }
}
