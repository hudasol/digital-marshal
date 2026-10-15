import type { ConnectorDef, LinkDef, Vec2 } from './types';

/* Geometry helpers shared by the simulation and the renderer.
   Only + - * / and sqrt are used on the simulation path, so lengths are bit-identical everywhere. */

export const LUT_SAMPLES = 32;

export interface Bezier {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

export function bezierPoint(c: Bezier, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

export function bezierTangent(c: Bezier, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return {
    x: a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x),
    y: a * (c.p1.y - c.p0.y) + b * (c.p2.y - c.p1.y) + d * (c.p3.y - c.p2.y),
  };
}

function bezierSecond(c: Bezier, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 6 * u * (c.p2.x - 2 * c.p1.x + c.p0.x) + 6 * t * (c.p3.x - 2 * c.p2.x + c.p1.x),
    y: 6 * u * (c.p2.y - 2 * c.p1.y + c.p0.y) + 6 * t * (c.p3.y - 2 * c.p2.y + c.p1.y),
  };
}

export function buildLut(c: Bezier): number[] {
  const lut = [0];
  let prev = c.p0;
  let acc = 0;
  for (let i = 1; i <= LUT_SAMPLES; i++) {
    const p = bezierPoint(c, i / LUT_SAMPLES);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    acc += Math.sqrt(dx * dx + dy * dy);
    lut.push(acc);
    prev = p;
  }
  return lut;
}

/** Minimum radius of curvature along the curve (Infinity for a straight line). */
export function minRadius(c: Bezier): number {
  let maxK = 0;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const d1 = bezierTangent(c, t);
    const d2 = bezierSecond(c, t);
    const sp = Math.sqrt(d1.x * d1.x + d1.y * d1.y);
    if (sp < 1e-9) continue;
    const k = Math.abs(d1.x * d2.y - d1.y * d2.x) / (sp * sp * sp);
    if (k > maxK) maxK = k;
  }
  return maxK < 1e-6 ? Infinity : 1 / maxK;
}

/** Bezier parameter at arc length s using the lookup table. */
export function paramAtLength(lut: number[], s: number): number {
  const total = lut[lut.length - 1];
  if (s <= 0) return 0;
  if (s >= total) return 1;
  let lo = 0;
  let hi = lut.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lut[mid] < s) lo = mid;
    else hi = mid;
  }
  const seg = lut[hi] - lut[lo];
  const f = seg > 0 ? (s - lut[lo]) / seg : 0;
  return (lo + f) / (lut.length - 1);
}

export interface Pose2 {
  x: number;
  y: number;
  /** heading in radians, 0 = east, counter-clockwise (rendering only) */
  h: number;
}

export function connectorPose(c: ConnectorDef, s: number, lateral = 0): Pose2 {
  const t = paramAtLength(c.lut, s);
  const p = bezierPoint(c, t);
  const d = bezierTangent(c, t);
  const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
  const rx = d.y / len;
  const ry = -d.x / len;
  return { x: p.x + rx * lateral, y: p.y + ry * lateral, h: Math.atan2(d.y, d.x) };
}

/** Position on a lane at distance s from the link start; lateral shifts to the right (m). */
export function lanePose(l: LinkDef, lane: number, s: number, lateral = 0): Pose2 {
  const off = l.laneOffsets[lane] + lateral;
  return {
    x: l.start.x + l.dir.x * s + l.right.x * off,
    y: l.start.y + l.dir.y * s + l.right.y * off,
    h: Math.atan2(l.dir.y, l.dir.x),
  };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
