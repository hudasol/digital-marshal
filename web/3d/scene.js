/* Digital Marshal 3D scene.
   Pure presentation layer: every vehicle position is derived from the recorded entry and exit times in
   window.DM_DATA (or from window.DM_ENGINE for a live incident time). Nothing here changes a result.
   Layout units: one world unit is about one metre of drawing, not of road. The network is schematic. */
(function (root) {
'use strict';
var THREE = root.THREE;

/* ---------- layout ---------- */
var SX = 0.25, SZ = 0.5, LANE_W = 3.4, ROAD_H = 0.4;
var LEAD_IN = 30, LEAD_OUT = 70;
var POL = ['static', 'independent_periodic', 'coordinated_batch'];
var ZOFF = { static: -165, independent_periodic: 0, coordinated_batch: 165 };
var POLCOL = { static: 0x64748B, independent_periodic: 0xFFB715, coordinated_batch: 0xDA291C };
var LANES = { E1: 4, E2: 1, E3: 1, E4: 1, E5: 1, E6: 1, E7: 2, E8: 2, E9: 2, E10: 2, E11: 4 };
var NODES = { O: [60, 0], P: [600, 0], C: [1200, 100], A1: [1100, -100], A2: [1700, -100], B1: [1100, 0], B2: [1700, 0], B3: [2000, 0], M: [2300, -50], D: [2900, -50] };
var SLAB = { x0: 60 * SX - LEAD_IN - 20, x1: 2900 * SX + LEAD_OUT + 20, hz: 74 };
var COL = { red: 0xDA291C, gold: 0xFFB715, char: 0x242526, asphalt: 0x3B3F45, slab: 0xE7E2D6, sand: 0xE9D9B8 };

function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function rnd(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---------- geometry helpers ---------- */
var M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3(1, 1, 1);
function part(g, x, y, z, color, ry, rx, rz) {
  E.set(rx || 0, ry || 0, rz || 0); Q.setFromEuler(E); V3.set(x, y, z); M4.compose(V3, Q, S3);
  return { g: g, m: M4.clone(), c: color };
}
function box(w, h, d, x, y, z, color, ry, rx, rz) { return part(new THREE.BoxGeometry(w, h, d), x, y, z, color, ry, rx, rz); }
function merge(parts) {
  var pos = [], nor = [], col = [], c = new THREE.Color();
  parts.forEach(function (p) {
    var g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    g.applyMatrix4(p.m);
    var P = g.attributes.position.array, N = g.attributes.normal.array; c.set(p.c);
    for (var i = 0; i < P.length; i += 3) { pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]); col.push(c.r, c.g, c.b); }
    g.dispose();
  });
  var G = new THREE.BufferGeometry();
  G.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  G.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  G.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return G;
}
function textTex(w, h, draw) {
  var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); draw(x, w, h);
  var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
var FONT = '700 {s}px Montserrat, "Noto Sans Arabic", Arial, sans-serif';
function font(s) { return FONT.replace('{s}', s); }

/* ---------- shared materials and vehicle geometry ---------- */
var MAT = {
  lam: new THREE.MeshLambertMaterial({ vertexColors: true }),
  lamFlat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  head: new THREE.MeshBasicMaterial({ color: 0xFFF6D6 }),
  brakeOff: new THREE.MeshBasicMaterial({ color: 0x5A1A1A }),
  brakeOn: new THREE.MeshBasicMaterial({ color: 0xFF3B30 }),
  beaconOff: new THREE.MeshBasicMaterial({ color: 0x6B5A2A }),
  beaconOn: new THREE.MeshBasicMaterial({ color: 0xFFB715 }),
  white: new THREE.MeshBasicMaterial({ color: 0xFFFFFF })
};
var STRIPE = { A: COL.red, B: 0x1B1D21, critical: 0x94A3B8 };
var VGEO = {};
function vehicleGeo(route) {
  if (VGEO[route]) return VGEO[route];
  var s = STRIPE[route] || STRIPE.critical, p = [];
  p.push(box(4.1, 0.95, 1.95, 0, 0.85, 0, 0xF1F3F6));
  p.push(box(2.3, 0.8, 1.7, -0.25, 1.65, 0, 0x1B1D21));
  p.push(box(2.35, 0.1, 1.0, -0.25, 2.1, 0, s));
  p.push(box(4.12, 0.28, 0.5, 0, 0.78, 0, s));
  [[1.3, 0.85], [-1.3, 0.85], [1.3, -0.85], [-1.3, -0.85]].forEach(function (w) { p.push(box(0.8, 0.8, 0.36, w[0], 0.42, w[1] * 1.0 + (w[1] > 0 ? 0.08 : -0.08), 0x101114)); });
  p.push(box(0.5, 0.22, 0.5, -0.25, 2.3, 0, 0x2D3036));
  VGEO[route] = merge(p);
  return VGEO[route];
}
var HEADGEO = merge([box(0.12, 0.22, 0.4, 2.07, 0.95, 0.65, 0xFFFFFF), box(0.12, 0.22, 0.4, 2.07, 0.95, -0.65, 0xFFFFFF)]);
var BRAKEGEO = merge([box(0.12, 0.2, 0.46, -2.07, 0.98, 0.6, 0xFFFFFF), box(0.12, 0.2, 0.46, -2.07, 0.98, -0.6, 0xFFFFFF)]);
var BEACONGEO = merge([box(0.34, 0.24, 0.34, -0.25, 2.56, 0, 0xFFFFFF)]);

/* ---------- environment ---------- */
function buildSky(scene) {
  var g = new THREE.SphereGeometry(3200, 24, 16), col = [], c = new THREE.Color(), top = new THREE.Color(0x7FB0E6), mid = new THREE.Color(0xCFE0F2), hor = new THREE.Color(0xEFE3CF);
  var P = g.attributes.position;
  for (var i = 0; i < P.count; i++) {
    var y = P.getY(i) / 3200;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.75)); else c.copy(hor).lerp(mid, Math.max(0, y) / 0.25);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10; scene.add(m); return m;
}

function buildGround(scene) {
  var W = 5200, H = 3200, sx = 130, sz = 80, g = new THREE.PlaneGeometry(W, H, sx, sz); g.rotateX(-Math.PI / 2);
  var P = g.attributes.position, col = [], c = new THREE.Color(), r = rnd(7);
  var cx = (SLAB.x0 + SLAB.x1) / 2, hx = (SLAB.x1 - SLAB.x0) / 2;
  function n(x, z) { return Math.sin(x * 0.006 + 1.3) * Math.cos(z * 0.007) + 0.6 * Math.sin(x * 0.015 + z * 0.011) + 0.3 * Math.sin(z * 0.031 - x * 0.02); }
  for (var i = 0; i < P.count; i++) {
    var x = P.getX(i), z = P.getZ(i);
    var dx = Math.max(0, Math.abs(x - cx) - hx - 25), dz = Math.max(0, Math.abs(z) - 165 - SLAB.hz - 25), d = Math.hypot(dx, dz);
    var k = smooth(0, 260, d), h = -1.35 + k * (n(x, z) * 22 + 14) * (0.5 + 0.5 * k) + (r() - 0.5) * 2.2 * k;
    P.setY(i, h);
    var t = Math.max(0, Math.min(1, (h + 10) / 70));
    c.setRGB(0.80 - 0.10 * t + (r() - 0.5) * 0.03, 0.68 - 0.12 * t + (r() - 0.5) * 0.03, 0.48 - 0.12 * t);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  var m = new THREE.Mesh(g, MAT.lamFlat); m.receiveShadow = true; scene.add(m); return m;
}

function buildSkyline(scene) {
  var r = rnd(21), parts = [];
  for (var i = 0; i < 70; i++) {
    var x = -900 + i * 36 + r() * 20, h = 25 + r() * r() * 150, w = 14 + r() * 22, d = 14 + r() * 22, z = -980 - r() * 220;
    var shade = 0.70 + r() * 0.18;
    parts.push(box(w, h, d, x, h / 2 - 2, z, new THREE.Color(shade * 0.94, shade * 0.97, shade)));
    if (r() > 0.8) parts.push(part(new THREE.ConeGeometry(w * 0.25, h * 0.35, 6), x, h + h * 0.15, z, 0xC8D2DE));
  }
  var m = new THREE.Mesh(merge(parts), MAT.lam); scene.add(m); return m;
}

function buildPalms(scene, spots) {
  var p = [];
  p.push(part(new THREE.CylinderGeometry(0.28, 0.42, 8, 6), 0, 4, 0, 0x8A6A45, 0, 0, 0.06));
  for (var i = 0; i < 7; i++) {
    var a = i / 7 * Math.PI * 2;
    p.push(part(new THREE.BoxGeometry(5.2, 0.12, 1.3), Math.cos(a) * 2.3, 8.2 - 0.6, Math.sin(a) * 2.3, i % 2 ? 0x3F8A4A : 0x4FA05A, -a, 0, -0.45));
  }
  var g = merge(p), im = new THREE.InstancedMesh(g, MAT.lam, spots.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), r = rnd(5);
  spots.forEach(function (sp, i) { var k = 0.85 + r() * 0.5; e.set(0, r() * 6.28, 0); q.setFromEuler(e); s.set(k, k, k); m.compose(new THREE.Vector3(sp[0], 0, sp[1]), q, s); im.setMatrixAt(i, m); });
  im.castShadow = true; scene.add(im); return im;
}

/* ---------- a policy corridor ---------- */
function Corridor(scene, D, pol, z0) {
  var self = this; this.pol = pol; this.z0 = z0; this.D = D;
  this.group = new THREE.Group(); scene.add(this.group);
  this.W = {}; Object.keys(NODES).forEach(function (n) { self.W[n] = new THREE.Vector2(NODES[n][0] * SX, z0 + NODES[n][1] * SZ); });
  this.E = {};
  D.graph.edges.forEach(function (e) {
    var a = self.W[e.src], b = self.W[e.dst], dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    self.E[e.id] = { id: e.id, a: a, b: b, ux: ux, uz: uz, px: -uz, pz: ux, len: L, n: LANES[e.id], w: LANES[e.id] * LANE_W, free: e.free_min * 60, cap: e.cap_vpm, ang: Math.atan2(dz, dx), src: e.src, dst: e.dst };
  });
  this.lead = { a: new THREE.Vector2(this.W.O.x - LEAD_IN, z0), b: this.W.O.clone(), ux: 1, uz: 0, px: 0, pz: 1, len: LEAD_IN, n: 4, w: 4 * LANE_W, ang: 0 };
  this.out = { a: this.W.D.clone(), b: new THREE.Vector2(this.W.D.x + LEAD_OUT, this.W.D.y), ux: 1, uz: 0, px: 0, pz: 1, len: LEAD_OUT, n: 4, w: 4 * LANE_W, ang: 0 };
  this.build();
}
Corridor.prototype.build = function () {
  var self = this, z0 = this.z0, G = this.group, road = [], mark = [], D = this.D;
  // slab with a policy coloured front rim
  var slabW = SLAB.x1 - SLAB.x0, sl = new THREE.Mesh(new THREE.BoxGeometry(slabW, 1.4, SLAB.hz * 2), new THREE.MeshLambertMaterial({ color: COL.slab }));
  sl.position.set((SLAB.x0 + SLAB.x1) / 2, -0.7, z0); sl.receiveShadow = true; G.add(sl);
  var rim = new THREE.Mesh(new THREE.BoxGeometry(slabW + 1.2, 0.5, 1.6), new THREE.MeshLambertMaterial({ color: POLCOL[this.pol] }));
  rim.position.set((SLAB.x0 + SLAB.x1) / 2, 0.05, z0 + SLAB.hz - 0.8); G.add(rim);
  var rim2 = rim.clone(); rim2.position.z = z0 - SLAB.hz + 0.8; G.add(rim2);
  // roads
  function strip(e, extra) {
    var L = e.len + (extra || 0);
    road.push(part(new THREE.BoxGeometry(L, ROAD_H, e.w), (e.a.x + e.b.x) / 2, ROAD_H / 2, (e.a.y + e.b.y) / 2, COL.asphalt, -e.ang));
    for (var s = -1; s <= 1; s += 2) {
      mark.push(part(new THREE.BoxGeometry(L, 0.04, 0.18), (e.a.x + e.b.x) / 2 + e.px * s * (e.w / 2 - 0.35), ROAD_H + 0.02, (e.a.y + e.b.y) / 2 + e.pz * s * (e.w / 2 - 0.35), 0xF3F4F6, -e.ang));
    }
    for (var i = 1; i < e.n; i++) {
      var off = (i - e.n / 2) * LANE_W;
      for (var t = 3; t < e.len - 3; t += 6.5) {
        var cx = e.a.x + e.ux * (t + 1.4) + e.px * off, cz = e.a.y + e.uz * (t + 1.4) + e.pz * off;
        mark.push(part(new THREE.BoxGeometry(2.8, 0.04, 0.14), cx, ROAD_H + 0.02, cz, 0xFFFFFF, -e.ang));
      }
    }
  }
  var ids = Object.keys(this.E); ids.forEach(function (id) { strip(self.E[id]); });
  strip(this.lead); strip(this.out);
  Object.keys(this.W).forEach(function (n) {
    var mw = 0; ids.forEach(function (id) { var e = self.E[id]; if (e.src === n || e.dst === n) mw = Math.max(mw, e.w); });
    road.push(part(new THREE.CylinderGeometry(mw / 2, mw / 2, ROAD_H, 20), self.W[n].x, ROAD_H / 2, self.W[n].y, COL.asphalt));
  });
  var rm = new THREE.Mesh(merge(road), MAT.lam); rm.receiveShadow = true; G.add(rm);
  G.add(new THREE.Mesh(merge(mark), new THREE.MeshBasicMaterial({ vertexColors: true })));

  // node markers and labels
  Object.keys(this.W).forEach(function (n) {
    var w = self.W[n], isP = n === 'P';
    var ring = new THREE.Mesh(new THREE.RingGeometry(isP ? 5.8 : 2.4, isP ? 7.2 : 3.4, 32), new THREE.MeshBasicMaterial({ color: isP ? COL.gold : 0xFFFFFF, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, ROAD_H + 0.08, w.y); G.add(ring);
    var tex = textTex(256, 128, function (x, W, H) { x.font = font(isP ? 84 : 78); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#FFFFFF'; x.strokeStyle = '#242526'; x.lineWidth = 14; x.lineJoin = 'round'; var t = n === 'O' ? 'O' : n; x.strokeText(t, W / 2, H / 2); x.fillText(t, W / 2, H / 2); });
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(14, 7, 1); sp.position.set(w.x, 9, w.y - (n === 'C' ? -9 : 9)); G.add(sp);
  });
  // edge labels: upright cards beside the road
  this.edgeLabels = new THREE.Group(); G.add(this.edgeLabels);
  var RC = { E1: ['ENTRY', '#242526'], E2: ['CLOSED', '#64748B'], E3: ['CLOSED', '#64748B'], E4: ['ROUTE A', '#DA291C'], E5: ['ROUTE A', '#DA291C'], E6: ['ROUTE A', '#DA291C'], E7: ['ROUTE B', '#1B1D21'], E8: ['ROUTE B', '#1B1D21'], E9: ['ROUTE B', '#1B1D21'], E10: ['ROUTE B', '#1B1D21'], E11: ['EXIT', '#242526'] };
  ids.forEach(function (id) {
    var e = self.E[id], tex = textTex(512, 160, function (x, W, H) {
      x.fillStyle = 'rgba(255,255,255,0.95)'; x.strokeStyle = '#242526'; x.lineWidth = 6; x.beginPath(); x.moveTo(24, 6); x.lineTo(W - 24, 6); x.quadraticCurveTo(W - 6, 6, W - 6, 24); x.lineTo(W - 6, H - 24); x.quadraticCurveTo(W - 6, H - 6, W - 24, H - 6); x.lineTo(24, H - 6); x.quadraticCurveTo(6, H - 6, 6, H - 24); x.lineTo(6, 24); x.quadraticCurveTo(6, 6, 24, 6); x.closePath(); x.fill(); x.stroke();
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = RC[id][1]; x.font = font(76); x.fillText(id, W / 2, 56); x.fillStyle = '#242526'; x.font = font(40); x.fillText(RC[id][0] + ' · ' + e.cap + '/min', W / 2, 120); });
    var m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    m.scale.set(30, 9.4, 1); // upright card that always faces the camera
    var side = (id === 'E2' || id === 'E3') ? 1 : -1, off = e.w / 2 + 3;
    m.position.set((e.a.x + e.b.x) / 2 + e.px * off * side, ROAD_H + 7, (e.a.y + e.b.y) / 2 + e.pz * off * side);
    self.edgeLabels.add(m);
  });

  // Marshal gantry over E1 at P
  var P = this.W.P, gx = P.x - 14, hw = 4 * LANE_W / 2 + 1.4, gp = [];
  gp.push(box(0.9, 9, 0.9, gx, 4.5, z0 - hw, 0x3A3D44)); gp.push(box(0.9, 9, 0.9, gx, 4.5, z0 + hw, 0x3A3D44));
  gp.push(box(1.1, 1.1, hw * 2 + 1.8, gx, 9.2, z0, 0x2B2D32));
  gp.push(box(0.3, 0.35, hw * 2, gx - 0.65, 8.5, z0, COL.gold));
  G.add(new THREE.Mesh(merge(gp), MAT.lam));
  this.signCv = document.createElement('canvas'); this.signCv.width = 1024; this.signCv.height = 256;
  this.signTex = new THREE.CanvasTexture(this.signCv); this.signTex.anisotropy = 4;
  var sg = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.7, hw * 1.7 / 4), new THREE.MeshBasicMaterial({ map: this.signTex }));
  sg.rotation.y = Math.PI / 2; sg.position.set(gx + 0.62, 11.4, z0); sg.rotation.y = Math.PI / 2;
  var sg2 = sg.clone(); sg2.rotation.y = -Math.PI / 2; sg2.position.x = gx - 0.62;
  G.add(sg); G.add(sg2); this.signMode = '';
  this.setSign('normal');

  // closure: hatch decals on E2 and E3, barrier and sign at the E2 entry
  var hatch = textTex(256, 64, function (x, W, H) { x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H); x.fillStyle = '#DA291C'; for (var i = -H; i < W + H; i += 44) { x.beginPath(); x.moveTo(i, H); x.lineTo(i + 22, H); x.lineTo(i + 22 + H, 0); x.lineTo(i + H, 0); x.closePath(); x.fill(); } });
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping; hatch.anisotropy = 4;
  this.hatchMats = []; this.hatch = new THREE.Group(); G.add(this.hatch);
  ['E2', 'E3'].forEach(function (id) {
    var e = self.E[id], t = hatch.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(e.len / 11, 1);
    var mt = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false });
    var m = new THREE.Mesh(new THREE.PlaneGeometry(e.len - 8, e.w - 0.8), mt); m.rotation.x = -Math.PI / 2; m.rotation.z = -e.ang;
    m.position.set((e.a.x + e.b.x) / 2, ROAD_H + 0.07, (e.a.y + e.b.y) / 2); self.hatch.add(m); self.hatchMats.push(mt);
  });
  var e2 = this.E.E2, bp = [];
  var bx = e2.a.x + e2.ux * 9, bz = e2.a.y + e2.uz * 9;
  this.barrier = new THREE.Group(); this.barrier.position.set(bx, ROAD_H, bz); this.barrier.rotation.y = -e2.ang;
  var arm = merge([box(0.4, 0.5, e2.w + 1.6, 0, 1.4, 0, 0xFFFFFF)].concat([0, 1, 2, 3, 4].map(function (i) { return box(0.42, 0.52, (e2.w + 1.6) / 10, 0, 1.4, -(e2.w + 1.6) / 2 + (e2.w + 1.6) / 10 * (i * 2 + 0.5), COL.red); })).concat([box(0.7, 1.4, 0.7, 0, 0.7, -(e2.w / 2 + 1.1), 0x3A3D44)]));
  this.barrier.add(new THREE.Mesh(arm, MAT.lam));
  this.signCv2 = document.createElement('canvas'); this.signCv2.width = 512; this.signCv2.height = 256;
  var c2 = this.signCv2.getContext('2d'); c2.fillStyle = '#DA291C'; c2.fillRect(0, 0, 512, 256); c2.fillStyle = '#fff'; c2.font = font(78); c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.fillText('CLOSED', 256, 100); c2.font = font(52); c2.fillText('E2 · E3', 256, 190);
  var bs = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(this.signCv2), side: THREE.DoubleSide }));
  bs.position.set(0, 4.2, -(e2.w / 2 + 1.1)); this.barrier.add(bs);
  var post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x3A3D44 })); post.position.set(0, 1.9, -(e2.w / 2 + 1.1)); this.barrier.add(post);
  this.barrier.visible = false; G.add(this.barrier);
  // cones near E2
  var cones = []; for (var i = 0; i < 5; i++) { cones.push(part(new THREE.ConeGeometry(0.55, 1.5, 8), 0, 0.75, (i - 2) * 1.9, i % 2 ? COL.red : 0xFFFFFF)); }
  this.cones = new THREE.Mesh(merge(cones), MAT.lam); this.cones.position.set(bx - e2.ux * 4, ROAD_H, bz - e2.uz * 4); this.cones.rotation.y = -e2.ang; this.cones.visible = false; G.add(this.cones);

  // incident scene on E2: a stalled car is hit from behind; flash, debris, smoke, flashing lights (all a function of sim time)
  (function () {
    function glow(rgb) { return textTex(64, 64, function (x, W, H) { var g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); g.addColorStop(0, 'rgba(' + rgb + ',1)'); g.addColorStop(0.4, 'rgba(' + rgb + ',0.45)'); g.addColorStop(1, 'rgba(' + rgb + ',0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }); }
    var I = self.inc = { g: new THREE.Group(), cars: [], debris: [], smoke: [] };
    I.mid = new THREE.Vector3((e2.a.x + e2.b.x) / 2, ROAD_H, (e2.a.y + e2.b.y) / 2);
    I.g.position.copy(I.mid); I.g.rotation.y = -e2.ang; I.g.visible = false; G.add(I.g);
    var sp = function (tex, add) { var m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false })); m.visible = false; I.g.add(m); return m; };
    ['critical', 'A'].forEach(function (r, k) { var c = new THREE.Group(), b = new THREE.Mesh(vehicleGeo(r === 'A' ? 'critical' : r), MAT.lam); b.castShadow = true; c.add(b);
      var l1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: 0xFF2A2A })), l2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: 0x2A6BFF }));
      l1.position.set(-0.25, 2.5, 0.45); l2.position.set(-0.25, 2.5, -0.45); c.add(l1); c.add(l2); I.g.add(c); I.cars.push({ g: c, l1: l1, l2: l2 }); });
    I.flash = sp(glow('255,214,120'), true); I.fire = sp(glow('255,120,30'), true);
    I.gR = sp(glow('255,40,40'), true); I.gB = sp(glow('40,110,255'), true);
    I.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xFF8A1E, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    I.ring.rotation.x = -Math.PI / 2; I.ring.position.y = 0.4; I.ring.visible = false; I.g.add(I.ring);
    I.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xFF3B30, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    I.beam.position.y = 35; I.beam.visible = false; I.g.add(I.beam);
    var smk = glow('70,70,74'), rr = rnd(99), dm = [0xFFFFFF, 0x1B1D21, COL.red, 0x94A3B8];
    for (var i = 0; i < 12; i++) I.smoke.push({ s: sp(smk, false), ph: i * 0.8, dx: (rr() - 0.5) * 2.5, dz: (rr() - 0.5) * 2.5 });
    var dg = new THREE.BoxGeometry(0.5, 0.25, 0.4);
    for (var j = 0; j < 16; j++) { var dmesh = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: dm[j % 4] })); dmesh.visible = false; I.g.add(dmesh);
      var a = rr() * 6.283, v = 5 + rr() * 11; I.debris.push({ m: dmesh, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 9 + rr() * 9, sp: (rr() - 0.5) * 14 }); }
    var lab = textTex(512, 128, function (x, W, H) { x.fillStyle = '#DA291C'; x.fillRect(0, 0, W, H); x.fillStyle = '#FFB715'; x.fillRect(0, 0, W, 10); x.fillRect(0, H - 10, W, 10); x.fillStyle = '#fff'; x.font = font(64); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('INCIDENT · E2', W / 2, H / 2 + 2); });
    I.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lab, transparent: true, depthWrite: false, fog: false })); I.label.scale.set(30, 7.5, 1); I.label.position.y = 22; I.label.visible = false; I.g.add(I.label);
  })();

  // policy name on an upright sign at the front edge of the slab, always facing the camera
  var NAMES = { static: 'STATIC ROUTING', independent_periodic: 'INDEPENDENT PERIODIC ROUTING', coordinated_batch: 'DYNAMIC COORDINATED ROUTING' }, pc = '#' + ('000000' + POLCOL[this.pol].toString(16)).slice(-6);
  var ptx = textTex(2048, 224, function (x, W, H) {
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H); x.fillStyle = pc; x.fillRect(0, 0, W, 34); x.fillRect(0, H - 34, W, 34); x.fillRect(0, 0, 46, H);
    x.fillStyle = '#242526'; x.font = font(112); x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(NAMES[self.pol], W / 2 + 22, H / 2 + 4); });
  var sx0 = SLAB.x0 + 110, sz0 = z0 - SLAB.hz + 7;
  var sgn = new THREE.Sprite(new THREE.SpriteMaterial({ map: ptx, transparent: true, depthWrite: false, fog: false }));
  sgn.scale.set(78, 8.5, 1); sgn.position.set(sx0, 9, sz0); G.add(sgn);
  [-34, 34].forEach(function (dx) { var pst = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), new THREE.MeshLambertMaterial({ color: 0x3A3D44 })); pst.position.set(sx0 + dx, 2.5, sz0); G.add(pst); });
  // advisory rings (pool filled by setPulses)
  this.rings = []; this.pulses = [];
  // marshal beacon column at P
  var col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 22, 16, 1, true), new THREE.MeshBasicMaterial({ color: COL.gold, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  col.position.set(P.x, 11, P.y); G.add(col); this.column = col;
  this.vehicles = []; this.vgroup = new THREE.Group(); G.add(this.vgroup);
};
Corridor.prototype.setSign = function (mode, extra) {
  var key = mode + '|' + (extra || ''); if (key === this.signMode) return; this.signMode = key;
  var c = this.signCv, x = c.getContext('2d'), W = c.width, H = c.height;
  var bg = mode === 'normal' ? '#1B1D21' : (mode === 'advisory' ? '#DA291C' : '#3A3D44');
  x.fillStyle = bg; x.fillRect(0, 0, W, H); x.fillStyle = COL.gold ? '#FFB715' : '#fff'; x.fillRect(0, 0, W, 14); x.fillRect(0, H - 14, W, 14);
  x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = font(86);
  var l1 = this.pol === 'static' ? 'STATIC ROUTE A' : 'MARSHAL';
  x.fillText(l1, W / 2, 98); x.font = font(54); x.fillStyle = mode === 'advisory' ? '#FFFFFF' : '#FFB715';
  var l2 = this.pol === 'static' ? 'NO ADVISORY' : (mode === 'advisory' ? 'ADVISORY ACTIVE' : 'MONITORING');
  if (extra) l2 = extra;
  x.fillText(l2, W / 2, 182); this.signTex.needsUpdate = true;
};
Corridor.prototype.setPulses = function (times) {
  var self = this; this.rings.forEach(function (r) { self.group.remove(r.mesh); r.mesh.material.dispose(); r.mesh.geometry.dispose(); });
  this.rings = []; this.pulses = times;
  times.forEach(function (tp) {
    var m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: COL.gold, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(self.W.P.x, ROAD_H + 0.3, self.W.P.y); m.visible = false; self.group.add(m); self.rings.push({ mesh: m, t: tp });
  });
};

/* ---------- vehicles ---------- */
Corridor.prototype.setRun = function (run) {
  var self = this;
  this.vehicles.forEach(function (v) { self.vgroup.remove(v.g); });
  this.vehicles = []; this.run = run;
  var ids = Object.keys(run.vehicles).sort(), rank = { A: 0, B: 0, critical: 0 };
  ids.forEach(function (id, i) {
    var d = run.vehicles[id], r = d.r in rank ? d.r : 'critical', rk = rank[r]++;
    var g = new THREE.Group(), body = new THREE.Mesh(vehicleGeo(r), MAT.lam); body.castShadow = true; body.userData.veh = id;
    var head = new THREE.Mesh(HEADGEO, MAT.head), brake = new THREE.Mesh(BRAKEGEO, MAT.brakeOff), bea = new THREE.Mesh(BEACONGEO, MAT.beaconOff);
    g.add(body); g.add(head); g.add(brake); g.add(bea); g.visible = false; self.vgroup.add(g);
    body.userData.ref = null;
    var rec = { id: id, d: d, idx: i, rk: rk, r: r, g: g, body: body, brake: brake, bea: bea, lane: {} };
    body.userData.rec = rec; self.vehicles.push(rec);
  });
};
function laneOffset(n, lane) { return (lane - (n - 1) / 2) * LANE_W; }
var DEST_E1 = { E4: function () { return 0; }, E7: function (v) { return 1 + (v.rk % 2); }, E2: function () { return 3; } };
Corridor.prototype.laneOn = function (v, eid) {
  var n = LANES[eid]; if (n === 1) return 0;
  if (eid === 'E1') return v.idx % 4;
  return v.rk % n;
};
Corridor.prototype.destLaneE1 = function (v, nextEdge) {
  var f = DEST_E1[nextEdge]; return f ? f(v) : this.laneOn(v, 'E1');
};
Corridor.prototype.geom = function (eid) { return eid === 'E_IN' ? this.lead : (eid === 'E_OUT' ? this.out : this.E[eid]); };

// position of one vehicle at sim time t; returns false when hidden
Corridor.prototype.place = function (v, t, rowInfo) {
  var d = v.d, g = v.g, E = this.E, ev = d.ev, k, po = null;
  if (t < d.d) { g.visible = false; v.state = 'pre'; return false; }
  if (t >= d.a) {
    var out = t - d.a, o = this.out; if (out > 16) { g.visible = false; v.state = 'done'; return false; }
    var lane = this.laneOn(v, 'E11'), off = laneOffset(4, lane), lastE = E.E11, s = out * 4.2;
    g.position.set(o.a.x + s, ROAD_H, o.a.y + off); g.rotation.y = 0; g.scale.setScalar(1);
    g.visible = true; v.state = 'out'; this.signals(v, false, false); return true;
  }
  for (k = 0; k < ev.length; k++) { var e = ev[k]; if ((t >= e[1] && t < e[2]) || (k === ev.length - 1 && t < e[2])) { po = e; break; } }
  if (!po) { g.visible = false; return false; }
  var eid = po[0], ge = E[eid], free = ge.free, ms = po[2] - free, waiting = t < ms - 1e-9 && (ms - po[1]) > 1e-6;
  var prevId = k > 0 ? ev[k - 1][0] : null, pe = prevId ? E[prevId] : this.lead;
  var x, z, ang, pose;
  if (waiting) {
    var key = (prevId || 'IN') + '>' + eid, ri = rowInfo[key], row = ri.rank[v.id], sp = ri.sp;
    var lane = prevId === 'E1' ? this.destLaneE1(v, eid) : (prevId ? this.laneOn(v, prevId) : this.laneOn(v, 'E1'));
    var off = laneOffset(pe.n, lane), back = 2.6 + row * sp;
    x = pe.b.x - pe.ux * back + pe.px * off; z = pe.b.y - pe.uz * back + pe.pz * off; ang = pe.ang;
    g.visible = true; g.position.set(x, ROAD_H, z); g.rotation.y = -ang; g.scale.setScalar(1);
    v.state = 'wait'; v.edge = eid; return true;
  }
  var fr = Math.max(0, Math.min(1, (t - ms) / free)), s2 = smooth(0, 0.2, fr);
  var offCur = laneOffset(ge.n, this.laneOn(v, eid)), nextId = (k + 1 < ev.length) ? ev[k + 1][0] : null;
  if (eid === 'E1') { var dl = this.destLaneE1(v, nextId); offCur = laneOffset(4, this.laneOn(v, 'E1')) * (1 - smooth(0.55, 0.92, fr)) + laneOffset(4, dl) * smooth(0.55, 0.92, fr); }
  var offPrev = offCur;
  if (prevId) { offPrev = laneOffset(pe.n, prevId === 'E1' ? this.destLaneE1(v, eid) : this.laneOn(v, prevId)); }
  var ox = pe.px * offPrev * (1 - s2) + ge.px * offCur * s2, oz = pe.pz * offPrev * (1 - s2) + ge.pz * offCur * s2;
  x = ge.a.x + (ge.b.x - ge.a.x) * fr + ox; z = ge.a.y + (ge.b.y - ge.a.y) * fr + oz;
  var da = ge.ang - pe.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  ang = pe.ang + da * s2; if (!prevId) ang = ge.ang;
  g.visible = true; g.position.set(x, ROAD_H, z); g.rotation.y = -ang; g.scale.setScalar(0.25 + 0.75 * smooth(0, 3, t - d.d));
  v.state = 'run'; v.edge = eid; v.fr = fr; return true;
};

/* wait ranks per queue group at time t */
Corridor.prototype.rankWaiting = function (t) {
  var groups = {}, E = this.E, self = this;
  this.vehicles.forEach(function (v) {
    var d = v.d; if (t < d.d || t >= d.a) return;
    var ev = d.ev;
    for (var k = 0; k < ev.length; k++) {
      var e = ev[k];
      if ((t >= e[1] && t < e[2]) || (k === ev.length - 1 && t < e[2])) {
        var ms = e[2] - E[e[0]].free;
        if (t < ms - 1e-9 && (ms - e[1]) > 1e-6) { var key = (k > 0 ? ev[k - 1][0] : 'IN') + '>' + e[0]; (groups[key] = groups[key] || []).push([e[1], v.id]); }
        break;
      }
    }
  });
  var info = {};
  Object.keys(groups).forEach(function (key) {
    var arr = groups[key].sort(function (a, b) { return a[0] - b[0] || (a[1] < b[1] ? -1 : 1); }), prev = key.split('>')[0], pe = prev === 'IN' ? self.lead : E[prev];
    var avail = pe.len + (prev === 'E1' || prev === 'IN' ? LEAD_IN : 0), sp = Math.max(2.9, Math.min(4.8, avail * 0.94 / Math.max(1, arr.length)));
    var rk = {}; arr.forEach(function (x, i) { rk[x[1]] = i; }); info[key] = { rank: rk, sp: sp };
  });
  return info;
};
Corridor.prototype.signals = function (v, wait, advise) {
  v.brake.material = wait ? MAT.brakeOn : MAT.brakeOff;
  v.bea.material = (wait || advise) ? MAT.beaconOn : MAT.beaconOff;
};

Corridor.prototype.updateIncident = function (tau, now) {
  var I = this.inc, vis = tau > -4; I.g.visible = vis; if (!vis) return;
  var pre = tau < 0, ease = function (x) { return 1 - Math.exp(-x); };
  var s = pre ? 0 : ease(tau * 2.6), R = I.cars[1], F = I.cars[0], blink = (Math.floor(now * 5) % 2 === 0);
  // F is the stalled car (hazards on), R closes from behind and hits it at tau = 0
  F.g.position.set(pre ? 0 : 3.6 * s, 0, 0); F.g.rotation.y = pre ? 0 : -0.55 * s;
  R.g.position.set(pre ? -4.15 + 12 * tau : -4.15 + 1.3 * s, 0, pre ? 0 : 0.5 * s); R.g.rotation.y = pre ? 0 : 0.4 * s;
  F.l1.visible = F.l2.visible = true; R.l1.visible = R.l2.visible = !pre;
  F.l1.material.color.setHex(pre ? (blink ? 0xFFB715 : 0x5A4510) : (blink ? 0xFF2A2A : 0x4A1010)); F.l2.material.color.setHex(pre ? (blink ? 0xFFB715 : 0x5A4510) : (blink ? 0x2A6BFF : 0x10204A));
  R.l1.material.color.setHex(blink ? 0x2A6BFF : 0x10204A); R.l2.material.color.setHex(blink ? 0xFF2A2A : 0x4A1010);
  var post = !pre;
  // impact flash, shock ring, fire glow
  var f = post ? Math.max(0, 1 - tau / 0.7) : 0;
  I.flash.visible = f > 0; I.flash.material.opacity = f; I.flash.scale.set(14 + (1 - f) * 46, 14 + (1 - f) * 46, 1); I.flash.position.set(0, 3, 0);
  var rg = post && tau < 2.2; I.ring.visible = rg; if (rg) { var q = tau / 2.2, sc = 3 + q * 52; I.ring.scale.set(sc, sc, sc); I.ring.material.opacity = (1 - q) * 0.9; }
  var fi = post && tau < 14, fl = fi ? (0.55 + 0.35 * Math.sin(now * 17) + 0.1 * Math.sin(now * 29)) * (1 - smooth(8, 14, tau)) : 0;
  I.fire.visible = fi; I.fire.material.opacity = fl; I.fire.scale.set(11, 11, 1); I.fire.position.set(3.2, 2.2, 0);
  // flashing emergency glow on the ground
  I.gR.visible = I.gB.visible = post; if (post) { var gs = Math.min(1, tau / 1.5) * 20; I.gR.scale.set(gs, gs, 1); I.gB.scale.set(gs, gs, 1); I.gR.position.set(0.5, 1.2, 1.6); I.gB.position.set(2.5, 1.2, -1.6); I.gR.material.opacity = blink ? 0.85 : 0.15; I.gB.material.opacity = blink ? 0.15 : 0.85; }
  // debris thrown out and landing
  I.debris.forEach(function (d) {
    var tt = Math.max(0, tau), y = d.vy * tt - 15 * tt * tt; if (!post) { d.m.visible = false; return; }
    var land = 2 * d.vy / 15; if (tt > land) { tt = land; y = 0; } d.m.visible = true;
    d.m.position.set(1.5 + d.vx * tt, 0.2 + Math.max(0, y), d.vz * tt); d.m.rotation.set(d.sp * tt * 0.4, d.sp * tt, 0);
  });
  // smoke plume, loops while the incident lasts
  I.smoke.forEach(function (p) {
    var a = tau - p.ph, ok = post && a >= 0; if (!ok) { p.s.visible = false; return; }
    a = a % 10; var q = a / 10; p.s.visible = true;
    p.s.position.set(2 + p.dx + a * 1.1, 2 + a * 2.6, p.dz + a * 0.4); var sc2 = 4 + a * 2.4; p.s.scale.set(sc2, sc2, 1);
    p.s.material.opacity = 0.62 * Math.pow(1 - q, 1.3) * Math.min(1, a * 1.5);
  });
  // warning beam and label
  I.beam.visible = I.label.visible = post; if (post) { I.beam.material.opacity = 0.22 + 0.14 * Math.sin(now * 6); I.label.material.opacity = Math.min(1, tau * 2); I.label.position.y = 24 + Math.sin(now * 2) * 0.8; }
};

/* per frame update for one corridor */
Corridor.prototype.incidentPos = function () { return this.inc.mid; };
Corridor.prototype.update = function (t, incT, hasMarshal, now) {
  var info = this.rankWaiting(t), counts = { inq: 0, arr: 0, A: 0, B: 0, wait: 0 }, self = this, adv = hasMarshal;
  var closed = t >= incT;
  this.vehicles.forEach(function (v) {
    var shown = self.place(v, t, info);
    if (v.d.r === 'A') counts.A += (t >= v.d.p ? 1 : 0); else if (v.d.r === 'B') counts.B += (t >= v.d.p ? 1 : 0);
    if (t >= v.d.a) counts.arr++;
    if (!shown) return;
    var wait = v.state === 'wait', flash = false;
    if (adv && v.state === 'run' && v.edge === 'E1') {
      for (var i = 0; i < self.pulses.length; i++) { var a = t - self.pulses[i]; if (a >= 0 && a < 22) { flash = (Math.floor(now * 6) % 2 === 0); break; } }
    }
    self.signals(v, wait, flash);
    if (wait) { counts.inq++; }
  });
  // closure visuals
  var cl = closed ? smooth(0, 6, t - incT) : 0;
  this.hatchMats.forEach(function (m) { m.opacity = 0.88 * cl; });
  this.barrier.visible = closed; this.cones.visible = closed;
  this.updateIncident(t - incT, now);
  // sign state
  if (this.pol !== 'static') this.setSign(closed ? 'advisory' : 'normal'); else this.setSign(closed ? 'dim' : 'normal');
  // pulses
  var colOp = 0;
  this.rings.forEach(function (r) {
    var a = t - r.t, life = 24;
    if (a < 0 || a > life) { r.mesh.visible = false; return; }
    var p = a / life; r.mesh.visible = true; var s = 6 + p * 56; r.mesh.scale.set(s, s, s); r.mesh.material.opacity = (1 - p) * 0.95;
    colOp = Math.max(colOp, (1 - p));
  });
  this.column.material.opacity = colOp * 0.45; this.column.scale.set(1 + (1 - colOp) * 0.0, 1, 1);
  return counts;
};

/* ---------- world ---------- */
function World(host, D) {
  var self = this; this.D = D; this.host = host;
  var r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(r.domElement);
  var sc = this.scene = new THREE.Scene(); sc.fog = new THREE.Fog(0xEFE3CF, 1400, 3400);
  this.camera = new THREE.PerspectiveCamera(38, 1, 2, 6000);
  var hemi = new THREE.HemisphereLight(0xEAF2FF, 0xCDB892, 0.62); sc.add(hemi);
  var sun = this.sun = new THREE.DirectionalLight(0xFFF1DC, 0.52);
  var cx = (SLAB.x0 + SLAB.x1) / 2; sun.position.set(cx + 380, 520, 360); sun.target.position.set(cx, 0, 0); sc.add(sun); sc.add(sun.target);
  sun.castShadow = true; var ms = Math.min(4096, r.capabilities.maxTextureSize); sun.shadow.mapSize.set(ms, ms);
  var sc2 = sun.shadow.camera; sc2.left = -560; sc2.right = 560; sc2.top = 380; sc2.bottom = -380; sc2.near = 100; sc2.far = 1400; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
  this.sky = buildSky(sc); buildGround(sc); buildSkyline(sc);
  var rr = rnd(99), spots = [];
  for (var i = 0; i < 90; i++) { var side = rr() > 0.5 ? 1 : -1; spots.push([SLAB.x0 + rr() * (SLAB.x1 - SLAB.x0 + 60), side * (240 + rr() * 380) + (rr() - 0.5) * 20]); }
  POL.forEach(function (p) { [-1, 1].forEach(function (sd) { for (var k = 0; k < 16; k++) spots.push([SLAB.x0 + 20 + k * 52 + rr() * 14, ZOFF[p] + sd * (SLAB.hz + 4 + rr() * 3)]); }); });
  buildPalms(sc, spots);
  this.corr = {}; POL.forEach(function (p) { self.corr[p] = new Corridor(sc, D, p, ZOFF[p]); });
  this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
  this.resize();
}
World.prototype.resize = function () {
  var w = this.host.clientWidth || 800, h = this.host.clientHeight || 500;
  this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
  this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
};
World.prototype.setRuns = function (runs, incT) {
  var self = this;
  POL.forEach(function (p) {
    var c = self.corr[p]; c.setRun(runs[p]);
    var pulses = [];
    if (p !== 'static') { pulses.push(incT); (runs[p].batches || []).forEach(function (b) { if (b[1] > 0 && b[0] >= incT) pulses.push(b[0]); }); }
    c.setPulses(pulses);
  });
};
World.prototype.update = function (t, incT, now) {
  var out = {}, self = this;
  POL.forEach(function (p) { out[p] = self.corr[p].update(t, incT, p !== 'static', now); });
  return out;
};
World.prototype.render = function (camPos, camTgt) {
  this.camera.position.copy(camPos); this.camera.lookAt(camTgt); this.sky.position.copy(camPos);
  this.renderer.render(this.scene, this.camera);
};
World.prototype.pick = function (nx, ny) {
  this.mouse.set(nx, ny); this.ray.setFromCamera(this.mouse, this.camera);
  var list = []; POL.forEach(function (p) { }); var self = this;
  POL.forEach(function (p) { self.corr[p].vehicles.forEach(function (v) { if (v.g.visible) list.push(v.body); }); });
  var hit = this.ray.intersectObjects(list, false)[0]; if (!hit) return null;
  var rec = hit.object.userData.rec, pol = null; POL.forEach(function (p) { if (self.corr[p].vehicles.indexOf(rec) >= 0) pol = p; });
  return { rec: rec, pol: pol };
};
World.prototype.project = function (v3) {
  var p = v3.clone().project(this.camera), w = this.host.clientWidth, h = this.host.clientHeight;
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, ok: p.z < 1 && p.z > -1 };
};
World.prototype.setEdgeLabels = function (on) { var self = this; POL.forEach(function (p) { self.corr[p].edgeLabels.visible = on; }); };

root.DM3D = { World: World, POL: POL, ZOFF: ZOFF, SX: SX, SZ: SZ, SLAB: SLAB, NODES: NODES, POLCOL: POLCOL, LANES: LANES };
})(window);
