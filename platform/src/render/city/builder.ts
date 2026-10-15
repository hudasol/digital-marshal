import * as THREE from 'three';

/* Small mesh accumulator: collects triangles with positions, normals, uvs and colours and turns
   them into one BufferGeometry per material, so the whole static city costs a handful of draw calls.
   Input coordinates are simulation coordinates (x east, y north, z up); output is three.js
   (x east, y up, z south). */

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private color: [number, number, number] = [1, 1, 1];

  setColor(c: THREE.Color | number | [number, number, number]): this {
    if (Array.isArray(c)) this.color = c;
    else {
      const cc = c instanceof THREE.Color ? c : new THREE.Color(c);
      this.color = [cc.r, cc.g, cc.b];
    }
    return this;
  }

  /** Push a vertex given in simulation coordinates (sx, sy, height). */
  private v(sx: number, sy: number, h: number, nx: number, ny: number, nz: number, u: number, w: number): void {
    this.pos.push(sx, h, -sy);
    this.nor.push(nx, nz, -ny);
    this.uv.push(u, w);
    this.col.push(this.color[0], this.color[1], this.color[2]);
  }

  /** Horizontal quad (z = h) from four corners in counter-clockwise order seen from above. UV in metres / scale. */
  quadH(pts: Array<[number, number]>, h: number, uvScale = 1, uvRot = 0): this {
    const cr = Math.cos(uvRot);
    const sr = Math.sin(uvRot);
    const uvs = pts.map(([x, y]) => [(x * cr - y * sr) / uvScale, (x * sr + y * cr) / uvScale]);
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) this.v(pts[i][0], pts[i][1], h, 0, 0, 1, uvs[i][0], uvs[i][1]);
    return this;
  }

  /** Oriented rectangle on the ground: centre, direction (unit), length along dir, width across. */
  rectH(cx: number, cy: number, dx: number, dy: number, length: number, width: number, h: number, uvScale = 1, uvAlong = false): this {
    const rx = dy;
    const ry = -dx;
    const hl = length / 2;
    const hw = width / 2;
    const p: Array<[number, number]> = [
      [cx - dx * hl - rx * hw, cy - dy * hl - ry * hw],
      [cx + dx * hl - rx * hw, cy + dy * hl - ry * hw],
      [cx + dx * hl + rx * hw, cy + dy * hl + ry * hw],
      [cx - dx * hl + rx * hw, cy - dy * hl + ry * hw],
    ];
    // make winding counter-clockwise when seen from above (normal up)
    const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    if (cross < 0) p.reverse();
    if (uvAlong) {
      // texture u along the strip (for dashes, arrows): use local coordinates
      const local = p.map(([x, y]) => [((x - cx) * dx + (y - cy) * dy) / uvScale, ((x - cx) * rx + (y - cy) * ry) / uvScale]);
      const idx = [0, 1, 2, 0, 2, 3];
      for (const i of idx) this.v(p[i][0], p[i][1], h, 0, 0, 1, local[i][0], local[i][1]);
      return this;
    }
    return this.quadH(p, h, uvScale);
  }

  /** Vertical wall from (x0,y0) to (x1,y1), bottom h0 to top h1, outward normal to the right of the direction. */
  wall(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, tileW = 1, tileH = 1, u0 = 0): this {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-6) return this;
    const nx = dy / L;
    const ny = -dx / L;
    const ua = u0 / tileW;
    const ub = (u0 + L) / tileW;
    const va = h0 / tileH;
    const vb = h1 / tileH;
    // two triangles, counter-clockwise seen from outside
    this.v(x0, y0, h0, nx, ny, 0, ua, va);
    this.v(x1, y1, h0, nx, ny, 0, ub, va);
    this.v(x1, y1, h1, nx, ny, 0, ub, vb);
    this.v(x0, y0, h0, nx, ny, 0, ua, va);
    this.v(x1, y1, h1, nx, ny, 0, ub, vb);
    this.v(x0, y0, h1, nx, ny, 0, ua, vb);
    return this;
  }

  /** Closed prism from a polygon (counter-clockwise from above): walls and a top cap. */
  prism(poly: Array<[number, number]>, h0: number, h1: number, tileW = 1, tileH = 1, top = true, topScale = 1): this {
    let u = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      // walking a counter-clockwise polygon, the outside is on the right of each edge
      this.wall(a[0], a[1], b[0], b[1], h0, h1, tileW, tileH, u);
      u += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (top) this.capH(poly, h1, topScale);
    return this;
  }

  /** Box footprint centred at (cx, cy), rotated by angle a (radians, CCW). */
  box(cx: number, cy: number, w: number, d: number, h0: number, h1: number, a = 0, tileW = 1, tileH = 1, top = true): this {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts: Array<[number, number]> = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    return this.prism(pts, h0, h1, tileW, tileH, top);
  }

  /** Flat convex or simple polygon cap (triangle fan for convex shapes; earcut for others). */
  capH(poly: Array<[number, number]>, h: number, uvScale = 1): this {
    const contour = poly.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      // ensure CCW
      const [a, b, c] = t;
      const cross =
        (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
      const order = cross >= 0 ? [a, b, c] : [a, c, b];
      for (const i of order) this.v(poly[i][0], poly[i][1], h, 0, 0, 1, poly[i][0] / uvScale, poly[i][1] / uvScale);
    }
    return this;
  }

  /** Polygon with holes on the ground (all CCW outer, holes any orientation). */
  shapeH(outer: Array<[number, number]>, holes: Array<Array<[number, number]>>, h: number, uvScale = 1): this {
    const contour = outer.map(([x, y]) => new THREE.Vector2(x, y));
    const hs = holes.map((hole) => hole.map(([x, y]) => new THREE.Vector2(x, y)));
    const all = [...outer, ...holes.flat()];
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    for (const t of tris) {
      const [a, b, c] = t;
      const cross = (all[b][0] - all[a][0]) * (all[c][1] - all[a][1]) - (all[b][1] - all[a][1]) * (all[c][0] - all[a][0]);
      const order = cross >= 0 ? [a, b, c] : [a, c, b];
      for (const i of order) this.v(all[i][0], all[i][1], h, 0, 0, 1, all[i][0] / uvScale, all[i][1] / uvScale);
    }
    return this;
  }

  /** Add an arbitrary three.js geometry (already in three.js coordinates) with a transform. */
  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4): this {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    geo.applyMatrix4(m);
    const p = geo.attributes.position.array;
    const n = geo.attributes.normal?.array;
    const uvAttr = geo.attributes.uv?.array;
    for (let i = 0; i < p.length / 3; i++) {
      this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      if (n) this.nor.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
      else this.nor.push(0, 1, 0);
      this.uv.push(uvAttr ? uvAttr[i * 2] : 0, uvAttr ? uvAttr[i * 2 + 1] : 0);
      this.col.push(this.color[0], this.color[1], this.color[2]);
    }
    geo.dispose();
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Rounded rectangle polygon (counter-clockwise), corners with radius r. */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 6): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  const corners: Array<[number, number, number]> = [
    [x1 - rr, y0 + rr, -Math.PI / 2],
    [x1 - rr, y1 - rr, 0],
    [x0 + rr, y1 - rr, Math.PI / 2],
    [x0 + rr, y0 + rr, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return pts;
}

/** three.js position from simulation coordinates. */
export function toWorld(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, -y);
}
