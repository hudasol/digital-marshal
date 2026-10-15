import { ARTERIAL, COAST_LIMIT, COAST_ROAD, COLLECTOR, DISTRICT, EXTENT, GRID, HIGHWAY, LOCAL, ROAD_CLASSES, inset, type Line } from './metro';

/* The ground of the surrounding city, painted by the terrain shader from the layout in metro.ts:
   main roads with their medians, lane markings and sidewalks, local streets, the coast road and
   promenade, car parks, villa plots with walls, lawns and pools, parks with paths and trees, and
   street lamps that light the roads at night. No geometry: one shader on the terrain plane. It
   runs for most of the screen, so the cell under a pixel is found by arithmetic, not a search. */

/** Beyond this radius the villas are painted as roofs instead of modelled (outskirts.ts). */
export const VILLA_3D_R = 5200;

const f = (v: number) => v.toFixed(2);
const lines = (ls: Line[]) => ls.map((l) => `vec2(${f(l.c)}, ${l.cls}.0)`).join(', ');
const xIn = GRID.xInner.length;
const yIn = GRID.yInner.length;
// indices into the sorted line lists of metro.ts (XL, YL), which the zone texture is laid out by
const X_NEG0 = GRID.x.count - 1; // the line at -x.first
const X_POS0 = GRID.x.count + xIn; // the line at +x.first
const Y_NEG0 = GRID.s.count - 1; // the line at -s.first
const Y_POS0 = GRID.s.count + yIn; // the line at +n.first

export const METRO_PARS = /* glsl */ `
uniform sampler2D uMetroZone;
uniform float uLamp;
uniform vec3 uSunDir;
const vec2 DM_XIN[${xIn}] = vec2[${xIn}](${lines(GRID.xInner)});
const vec2 DM_YIN[${yIn}] = vec2[${yIn}](${lines(GRID.yInner)});
const vec4 DM_RC[4] = vec4[4](${ROAD_CLASSES.map((r) => `vec4(${f(r.hw)}, ${f(r.median)}, ${r.lanes}.0, ${f(r.walk)})`).join(', ')});
const float DM_LOCAL_IN = ${f(inset(LOCAL))};

float dmClsX(float k) { return mod(k, 2.0) < 0.5 ? ${ARTERIAL}.0 : ${COLLECTOR}.0; }
float dmClsN(float k) { return mod(k, 2.0) < 0.5 ? ${COLLECTOR}.0 : ${ARTERIAL}.0; }
float dmClsS(float k) { return abs(k - 2.0) < 0.5 ? ${HIGHWAY}.0 : mod(k, 2.0) < 0.5 ? ${COLLECTOR}.0 : ${ARTERIAL}.0; }

/* the main north-south roads either side of x (centre line, class) and the index of the western one */
int dmCellX(float x, out vec2 lo, out vec2 hi) {
  const float F = ${f(GRID.x.first)};
  const float S = ${f(GRID.x.step)};
  const float K = ${GRID.x.count}.0;
  lo = vec2(0.0);
  hi = vec2(1.0);
  float a = abs(x);
  if (a >= F) {
    float k = floor((a - F) / S);
    if (k >= K - 1.0) return -1;
    vec2 n = vec2(F + k * S, dmClsX(k));
    vec2 m = vec2(F + (k + 1.0) * S, dmClsX(k + 1.0));
    if (x > 0.0) { lo = n; hi = m; return ${X_POS0} + int(k); }
    lo = vec2(-m.x, m.y); hi = vec2(-n.x, n.y);
    return ${X_NEG0} - int(k) - 1;
  }
  lo = vec2(-F, dmClsX(0.0));
  int idx = ${X_NEG0};
  for (int i = 0; i < ${xIn}; i++) {
    if (x < DM_XIN[i].x) { hi = DM_XIN[i]; return idx; }
    lo = DM_XIN[i];
    idx++;
  }
  hi = vec2(F, dmClsX(0.0));
  return idx;
}
/* the main east-west roads either side of y and the index of the southern one */
int dmCellY(float y, out vec2 lo, out vec2 hi) {
  const float NF = ${f(GRID.n.first)};
  const float NS = ${f(GRID.n.step)};
  const float NK = ${GRID.n.count}.0;
  const float SF = ${f(GRID.s.first)};
  const float SS = ${f(GRID.s.step)};
  const float SK = ${GRID.s.count}.0;
  lo = vec2(0.0);
  hi = vec2(1.0);
  if (y >= NF) {
    float k = floor((y - NF) / NS);
    if (k >= NK - 1.0) return -1;
    lo = vec2(NF + k * NS, dmClsN(k));
    hi = vec2(NF + (k + 1.0) * NS, dmClsN(k + 1.0));
    return ${Y_POS0} + int(k);
  }
  if (y <= -SF) {
    float k = floor((-y - SF) / SS);
    if (k >= SK - 1.0) return -1;
    lo = vec2(-(SF + (k + 1.0) * SS), dmClsS(k + 1.0));
    hi = vec2(-(SF + k * SS), dmClsS(k));
    return ${Y_NEG0} - int(k) - 1;
  }
  lo = vec2(-SF, dmClsS(0.0));
  int idx = ${Y_NEG0};
  for (int i = 0; i < ${yIn}; i++) {
    if (y < DM_YIN[i].x) { hi = DM_YIN[i]; return idx; }
    lo = DM_YIN[i];
    idx++;
  }
  hi = vec2(NF, dmClsN(0.0));
  return idx;
}
/* metro.ts hash3, bit for bit */
uint dmHashU(int a, int b, int c) {
  uint h = (uint(a) * 73856093u) ^ (uint(b) * 19349663u) ^ (uint(c) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  h ^= h >> 15u;
  return h;
}
/* an anti-aliased stripe of width w centred on c; thinner than a pixel it fades instead of aliasing */
float dmLine(float d, float c, float w, float fw) {
  float aa = max(fw, 0.001);
  return clamp((0.5 * w - abs(d - c)) / aa + 0.5, 0.0, 1.0) * min(1.0, w / aa);
}
struct DmRoad { float asph; float med; float plant; float walk; float white; float yellow; float lamp; };
DmRoad dmNoRoad() { return DmRoad(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0); }
/* one road seen from lateral distance d (>= 0) at position a along it */
DmRoad dmRoadAt(float d, float a, vec4 rc, float fw, float detail, bool lamps) {
  DmRoad r = dmNoRoad();
  float hw = rc.x;
  float med = rc.y * 0.5;
  if (d > hw + rc.w + fw + 1.0) return r;
  float aa = max(fw, 0.03);
  r.med = med > 0.0 ? 1.0 - smoothstep(med - aa, med + aa, d) : 0.0;
  r.plant = rc.y > 7.0 ? r.med : 0.0;
  float inRoad = 1.0 - smoothstep(hw - aa, hw + aa, d);
  r.asph = inRoad * (1.0 - r.med);
  r.walk = (1.0 - inRoad) * (1.0 - smoothstep(hw + rc.w - aa, hw + rc.w + aa, d));
  if (detail > 0.0 && inRoad > 0.0) {
    float dash = dmBoxAA(fract(a / 9.0), 0.02, 0.36, max(fw / 9.0, 0.002));
    float w = dmLine(d, hw - 0.35, 0.15, fw);
    for (int k = 1; k < 5; k++) {
      if (float(k) >= rc.z) break;
      w += dmLine(d, med + float(k) * 3.5, 0.15, fw) * dash;
    }
    r.white = min(1.0, w) * r.asph * detail;
    r.yellow = (med > 0.0 ? dmLine(d, med + 0.3, 0.15, fw) : dmLine(d, 0.16, 0.12, fw)) * inRoad * detail;
  }
  if (lamps) {
    // street lamps every 32 m at both kerbs and down wide medians: overlapping pools along the road
    float da = (fract(a / 32.0 + 0.25) - 0.5) * 32.0;
    float dl = d - (hw - 1.0);
    r.lamp = exp(-da * da * 0.0045 - dl * dl * 0.045) + (med > 2.5 ? exp(-da * da * 0.0045 - d * d * 0.045) : 0.0);
  }
  return r;
}
DmRoad dmScale(DmRoad r, float k) { return DmRoad(r.asph * k, r.med * k, r.plant * k, r.walk * k, r.white * k, r.yellow * k, r.lamp * k); }
/* a tree crown seen from above, at most one per lattice cell (so one cell is enough to look at),
   with its shadow a little way off toward the side away from the sun */
float dmCrowns(vec2 p, float cell, float density, vec2 sunOff, out float shade) {
  vec2 g = floor(p / cell);
  float h = dmHash12(g * 1.7 + 3.1);
  shade = 0.0;
  if (h > density) return 0.0;
  vec2 ctr = (g + 0.5 + (vec2(dmHash12(g + 9.1), dmHash12(g + 4.7)) - 0.5) * 0.2) * cell;
  float r = cell * (0.22 + 0.08 * h / density);
  vec2 so = sunOff * min(1.0, cell * 0.08 / max(length(sunOff), 0.001));
  shade = 1.0 - smoothstep(r * 0.6, r * 1.05, length(p - ctr - so));
  return 1.0 - smoothstep(r * 0.75, r, length(p - ctr));
}

/* Paints the city at sp (simulation metres). Returns how much the city covers the desert here
   (0 where a lot is left as desert), with the city's colour, roughness and night light. */
float dmMetro(vec2 sp, float sd, float viewD, float fw, out vec3 col, out float rough, out vec3 em) {
  em = vec3(0.0);
  col = vec3(0.0);
  rough = 0.9;
  if (sp.x > ${f(DISTRICT.x0)} && sp.x < ${f(DISTRICT.x1)} && sp.y > ${f(DISTRICT.y0)} && sp.y < ${f(DISTRICT.y1)}) {
    col = vec3(0.42, 0.39, 0.35);
    return 1.0;
  }
  float ext = max(abs(sp.x), abs(sp.y));
  if (ext > ${f(EXTENT)}) return 0.0;
  vec2 X0, X1, Y0, Y1;
  int ix = dmCellX(sp.x, X0, X1);
  int iy = dmCellY(sp.y, Y0, Y1);
  if (ix < 0 || iy < 0) return 0.0;
  float detail = 1.0 - smoothstep(2600.0, 4800.0, viewD);
  // painted tree crowns stand in for trees seen from afar; up close the modelled ones take over
  float crowns = detail * smoothstep(350.0, 900.0, viewD);
  bool lamps = uLamp > 0.01;
  vec4 zt = texelFetch(uMetroZone, ivec2(ix, iy), 0);
  int zone = int(zt.r * 255.0 + 0.5);
  float nx = max(1.0, floor(zt.g * 255.0 + 0.5));
  float ny = max(1.0, floor(zt.b * 255.0 + 0.5));

  // the main roads either side, local streets inside the superblock, the coast road
  vec2 RX = (sp.x - X0.x < X1.x - sp.x) ? X0 : X1;
  vec2 RY = (sp.y - Y0.x < Y1.x - sp.y) ? Y0 : Y1;
  DmRoad ra = dmRoadAt(abs(sp.x - RX.x), sp.y, DM_RC[int(RX.y)], fw, detail, lamps);
  DmRoad rb = dmRoadAt(abs(sp.y - RY.x), sp.x, DM_RC[int(RY.y)], fw, detail, lamps);
  float sx = (X1.x - X0.x) / nx;
  float sy = (Y1.x - Y0.x) / ny;
  float fx = (sp.x - X0.x) / sx;
  float fy = (sp.y - Y0.x) / sy;
  DmRoad rc = dmNoRoad();
  DmRoad rd = dmNoRoad();
  if (nx > 1.5) rc = dmRoadAt(abs(sp.x - (X0.x + clamp(floor(fx + 0.5), 1.0, nx - 1.0) * sx)), sp.y, DM_RC[0], fw, detail, lamps);
  if (ny > 1.5) rd = dmRoadAt(abs(sp.y - (Y0.x + clamp(floor(fy + 0.5), 1.0, ny - 1.0) * sy)), sp.x, DM_RC[0], fw, detail, lamps);
  // grid streets end at the coast road; nothing is built or paved seaward of it but the promenade
  if (sd > ${f(COAST_ROAD.sd - COAST_ROAD.hw - 1.0)}) {
    float inland = 1.0 - smoothstep(${f(COAST_ROAD.sd - COAST_ROAD.hw - 1.0)}, ${f(COAST_ROAD.sd - COAST_ROAD.hw + 1.0)}, sd);
    ra = dmScale(ra, inland);
    rb = dmScale(rb, inland);
    rc = dmScale(rc, inland);
    rd = dmScale(rd, inland);
  }
  DmRoad rk = dmNoRoad();
  if (abs(sd - ${f(COAST_ROAD.sd)}) < 40.0) {
    rk = dmRoadAt(abs(sd - ${f(COAST_ROAD.sd)}), dot(sp, vec2(0.85, 0.53)), vec4(${f(COAST_ROAD.hw)}, 2.0, 2.0, ${f(COAST_ROAD.walk)}), fw, detail, lamps);
  }
  float fade = 1.0 - smoothstep(${f(EXTENT - 600)}, ${f(EXTENT)}, ext);

  float asph = max(max(ra.asph, rb.asph), max(max(rc.asph, rd.asph), rk.asph));
  float crossA = max(rb.asph, rd.asph); // carriageways crossing a north-south road
  float crossB = max(ra.asph, rc.asph);
  float med = max(max(ra.med * (1.0 - crossA), rb.med * (1.0 - crossB)), rk.med);
  float plant = max(ra.plant * (1.0 - crossA), rb.plant * (1.0 - crossB));
  float walk = max(max(max(ra.walk, rb.walk), max(rc.walk, rd.walk)), rk.walk) * (1.0 - asph) * (1.0 - med);
  float white = max(max(ra.white * (1.0 - max(crossA, rb.med)), rc.white * (1.0 - crossA)), max(rb.white * (1.0 - max(crossB, ra.med)), rd.white * (1.0 - crossB)));
  white = max(white, rk.white);
  float yellow = max(max(ra.yellow * (1.0 - max(crossA, rb.med)), rc.yellow * (1.0 - crossA)), max(rb.yellow * (1.0 - max(crossB, ra.med)), rd.yellow * (1.0 - crossB)));
  yellow = max(yellow, rk.yellow);
  float lamp = max(max(ra.lamp, rb.lamp), max(max(rc.lamp, rd.lamp), rk.lamp));
  float road = max(max(asph, med), walk) * fade;

  // ---- the lot behind the sidewalks (metro.ts lotOf)
  float lx = clamp(floor(fx), 0.0, nx - 1.0);
  float ly = clamp(floor(fy), 0.0, ny - 1.0);
  vec2 lotMin = vec2(X0.x + lx * sx + (lx < 0.5 ? DM_RC[int(X0.y)].x + DM_RC[int(X0.y)].w : DM_LOCAL_IN),
                     Y0.x + ly * sy + (ly < 0.5 ? DM_RC[int(Y0.y)].x + DM_RC[int(Y0.y)].w : DM_LOCAL_IN));
  vec2 lotMax = vec2(X0.x + (lx + 1.0) * sx - (lx > nx - 1.5 ? DM_RC[int(X1.y)].x + DM_RC[int(X1.y)].w : DM_LOCAL_IN),
                     Y0.x + (ly + 1.0) * sy - (ly > ny - 1.5 ? DM_RC[int(Y1.y)].x + DM_RC[int(Y1.y)].w : DM_LOCAL_IN));
  uint lh = dmHashU(ix * 4096 + iy, int(lx) * 64 + int(ly), 5);
  float lotRough = 0.9;
  float built = 1.0;
  vec3 lotC = vec3(0.6, 0.47, 0.32);
  vec2 sunOff = -vec2(uSunDir.x, -uSunDir.z) / max(uSunDir.y, 0.25) * 4.0;
  // lots under the road surfaces are hidden: skip their detail
  if (road > 0.999) {
  } else if (zone == 0 || zone == 255) {
    built = 0.0; // desert between the outlying roads
  } else if ((zone == 1 || zone == 2) && lh % 11u == 0u) {
    // surface car park: rows of bays either side of the aisles
    lotC = vec3(0.15, 0.148, 0.145) * (0.9 + 0.2 * dmNoise(sp * 0.06));
    lotRough = 0.85;
    if (detail > 0.0) {
      float py = mod(sp.y - lotMin.y, 17.0);
      float bay = dmBoxAA(py, 0.0, 5.5, fw) + dmBoxAA(py, 11.5, 17.0, fw);
      float stall = dmLine(mod(sp.x - lotMin.x, 2.6), 0.0, 0.14, fw) * bay;
      lotC = mix(lotC, vec3(0.7, 0.7, 0.66), stall * detail);
    }
    if (lamps) {
      vec2 q = mod(sp - lotMin, 34.0) - 17.0;
      em += vec3(1.0, 0.85, 0.65) * exp(-dot(q, q) * 0.02) * 0.08;
    }
  } else if (zone == 3) {
    // villa plots: paving and planting behind a boundary wall, a pool in the back garden
    vec2 pn = max(vec2(1.0), floor((lotMax - lotMin) / vec2(30.0, 34.0) + 0.5));
    vec2 psz = (lotMax - lotMin) / pn;
    vec2 pidx = clamp(floor((sp - lotMin) / psz), vec2(0.0), pn - 1.0);
    vec2 pl = sp - lotMin - pidx * psz;
    uint ph = dmHashU(ix * 4096 + iy, int(lx) * 64 + int(ly), int(pidx.x) * 64 + int(pidx.y));
    float g = dmNoise(sp * 0.12 + float(ph & 255u));
    lotC = mix(vec3(0.2, 0.25, 0.11), vec3(0.6, 0.53, 0.42), smoothstep(0.3, 0.55, g));
    float edge = min(min(pl.x, psz.x - pl.x), min(pl.y, psz.y - pl.y));
    lotC = mix(lotC, vec3(0.8, 0.76, 0.68), 1.0 - smoothstep(0.3, 0.3 + fw, edge));
    if ((ph & 3u) != 0u) {
      vec2 pc = vec2(psz.x * 0.5 + (float((ph >> 2u) % 3u) - 1.0) * 3.0, 6.5);
      vec2 dq = abs(pl - pc) - vec2(4.0, 2.0);
      float m = max(dq.x, dq.y);
      lotC = mix(lotC, vec3(0.82, 0.8, 0.74), 1.0 - smoothstep(0.6 - fw, 0.6 + fw, m));
      float pool = 1.0 - smoothstep(-fw, fw, m);
      lotC = mix(lotC, vec3(0.03, 0.26, 0.33), pool);
      lotRough = mix(lotRough, 0.06, pool);
      if (lamps) em += vec3(0.15, 0.55, 0.75) * pool * 0.25;
    }
    if (crowns > 0.0) {
      float shade;
      float crown = dmCrowns(sp, 9.0, 0.3, sunOff, shade) * crowns;
      lotC *= 1.0 - 0.45 * shade * uDay * crowns;
      lotC = mix(lotC, vec3(0.08, 0.15, 0.05), crown);
    }
    // beyond the modelled houses, paint the roofs
    if (length(vec2(sp.x / 1.15, sp.y)) > ${f(VILLA_3D_R)}) {
      vec2 hq = abs(pl - vec2(psz.x * 0.5, psz.y * 0.62)) - vec2(7.0, 6.0);
      lotC = mix(lotC, vec3(0.83, 0.8, 0.74), 1.0 - smoothstep(-fw, fw, max(hq.x, hq.y)));
    }
  } else if (zone == 4) {
    // park: lawn, paths across and around, trees
    vec2 c = (lotMin + lotMax) * 0.5;
    vec2 hs = max((lotMax - lotMin) * 0.5, vec2(1.0));
    lotC = vec3(0.15, 0.22, 0.08) * (0.85 + 0.3 * dmNoise(sp * 0.07));
    vec2 q = (sp - c) / hs;
    float path = max(dmLine((q.x - q.y) * min(hs.x, hs.y) * 0.7, 0.0, 3.0, fw), dmLine((q.x + q.y) * min(hs.x, hs.y) * 0.7, 0.0, 3.0, fw));
    path = max(path, dmLine(length(sp - c), min(hs.x, hs.y) * 0.6, 3.5, fw));
    if (crowns > 0.0) {
      float shade;
      float crown = dmCrowns(sp, 11.0, 0.55, sunOff, shade) * crowns * (1.0 - path);
      lotC *= 1.0 - 0.4 * shade * uDay * crowns;
      lotC = mix(lotC, vec3(0.07, 0.14, 0.04), crown);
    }
    lotC = mix(lotC, vec3(0.62, 0.57, 0.48), path);
    lotRough = 0.95;
  } else if (zone == 5) {
    // yards around the warehouses
    lotC = vec3(0.44, 0.41, 0.36) * (0.85 + 0.25 * dmNoise(sp * 0.02));
  } else {
    // forecourts, gardens and podium decks around the apartment blocks and towers
    lotC = vec3(0.47, 0.43, 0.37) * (0.92 + 0.16 * dmNoise(sp * 0.03));
    float green = smoothstep(0.6, 0.74, dmNoise(sp * 0.035 + float(lh & 63u)));
    lotC = mix(lotC, vec3(0.18, 0.23, 0.1), green * 0.75);
    if (crowns > 0.0) {
      float shade;
      float crown = dmCrowns(sp, 10.0, 0.18, sunOff, shade) * crowns;
      lotC *= 1.0 - 0.4 * shade * uDay * crowns;
      lotC = mix(lotC, vec3(0.08, 0.15, 0.05), crown);
    }
  }
  // promenade between the coast road and the beach
  if (sd > ${f(COAST_LIMIT - 2)}) {
    float prom = smoothstep(${f(COAST_LIMIT - 2)}, ${f(COAST_LIMIT + 2)}, sd);
    lotC = mix(lotC, vec3(0.62, 0.56, 0.46), prom);
    built = max(built, prom);
  }

  vec3 asphC = vec3(0.052, 0.053, 0.058) * (0.88 + 0.24 * dmNoise(sp * 0.045));
  vec3 walkC = vec3(0.46, 0.42, 0.37);
  vec3 medC = mix(vec3(0.42, 0.4, 0.37), vec3(0.2, 0.25, 0.1), plant / max(med, 0.001));
  vec3 c = lotC;
  c = mix(c, walkC, walk);
  c = mix(c, medC, med);
  c = mix(c, asphC, asph);
  c = mix(c, vec3(0.7, 0.7, 0.66), white);
  c = mix(c, vec3(0.72, 0.52, 0.1), yellow);
  col = c;
  rough = mix(lotRough, mix(0.86, 0.6, max(white, yellow)), road);
  em = (em * built * (1.0 - road) + vec3(1.0, 0.78, 0.52) * lamp * (asph + walk + med * 0.6) * 0.32) * uLamp * fade;
  return 1.0 - (1.0 - road) * (1.0 - built);
}
`;
