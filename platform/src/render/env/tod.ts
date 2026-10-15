import * as THREE from 'three';

/* Time of day. Four art-directed keys (midday, golden hour, dusk, night) and a continuous phase
   0..3 between them, so a change of lighting is a smooth blend of every value: sun or moon, sky
   gradient, haze, exposure, window and street lighting, bloom. Colours are linear RGB. */

export type TodKey = 'day' | 'golden' | 'dusk' | 'night';
export const TOD_KEYS: TodKey[] = ['day', 'golden', 'dusk', 'night'];

export interface TodState {
  /** key light direction: elevation and azimuth (deg, azimuth 0 = north, 90 = east) */
  lightEl: number;
  lightAz: number;
  lightColor: THREE.Color;
  lightIntensity: number;
  /** where the sun disc and its glow sit in the sky (below the horizon at dusk) */
  sunEl: number;
  sunAz: number;
  sunDisc: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  /** horizon on the side away from the sun (cooler) */
  horizonAway: THREE.Color;
  /** warm glow around the sun direction near the horizon */
  glow: THREE.Color;
  glowSpread: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  clouds: number;
  stars: number;
  /** light pollution dome over the city at night */
  cityGlow: THREE.Color;
  fogDensity: number;
  fogTint: THREE.Color;
  winLit: number;
  lamp: number;
  bloom: number;
  sand: THREE.Color;
  sea: THREE.Color;
  shadowStrength: number;
}

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
/** sRGB hex to linear */
const h = (hex: string) => new THREE.Color(hex);

export const TOD: Record<TodKey, TodState> = {
  day: {
    lightEl: 54,
    lightAz: 205,
    lightColor: c(1.0, 0.95, 0.88),
    lightIntensity: 3.1,
    sunEl: 54,
    sunAz: 205,
    sunDisc: 1,
    hemiSky: h('#bcd2f0'),
    hemiGround: h('#b39a7a'),
    hemiIntensity: 0.62,
    envIntensity: 0.55,
    exposure: 0.9,
    zenith: h('#2d6cc4'),
    mid: h('#6f9fdc'),
    horizon: h('#d8e4ee'),
    horizonAway: h('#c9dcef'),
    glow: h('#fff3dc'),
    glowSpread: 0.35,
    cloudLit: c(1.05, 1.05, 1.05),
    cloudShade: h('#9eaec4'),
    clouds: 0.28,
    stars: 0,
    cityGlow: c(0, 0, 0),
    fogDensity: 0.00011,
    fogTint: c(1, 1, 1),
    winLit: 0,
    lamp: 0,
    bloom: 0.12,
    sand: h('#dcc39c'),
    sea: h('#1f6f8f'),
    shadowStrength: 1,
  },
  golden: {
    lightEl: 11,
    lightAz: 252,
    lightColor: c(1.0, 0.7, 0.44),
    lightIntensity: 3.3,
    sunEl: 7,
    sunAz: 252,
    sunDisc: 1,
    hemiSky: h('#a7bbe2'),
    hemiGround: h('#8f7860'),
    hemiIntensity: 0.42,
    envIntensity: 0.45,
    exposure: 0.95,
    zenith: h('#3b5c97'),
    mid: h('#a19fbe'),
    horizon: h('#ffc890'),
    horizonAway: h('#c2c8dc'),
    glow: h('#ffb26a'),
    glowSpread: 1,
    cloudLit: h('#ffc79a'),
    cloudShade: h('#7a7488'),
    clouds: 0.36,
    stars: 0,
    cityGlow: c(0, 0, 0),
    fogDensity: 0.00015,
    fogTint: c(1, 1, 1),
    winLit: 0.12,
    lamp: 0.05,
    bloom: 0.22,
    sand: h('#d8b086'),
    sea: h('#2b6d86'),
    shadowStrength: 1,
  },
  dusk: {
    lightEl: 7,
    lightAz: 262,
    lightColor: c(0.95, 0.52, 0.42),
    lightIntensity: 0.9,
    sunEl: -3,
    sunAz: 262,
    sunDisc: 0,
    hemiSky: h('#6670a6'),
    hemiGround: h('#4b3a40'),
    hemiIntensity: 0.5,
    envIntensity: 0.42,
    exposure: 1.2,
    zenith: h('#18234d'),
    mid: h('#4d4f80'),
    horizon: h('#ef9566'),
    horizonAway: h('#6a6a9a'),
    glow: h('#ff8f52'),
    glowSpread: 1.2,
    cloudLit: h('#e2808a'),
    cloudShade: h('#3e3a5c'),
    clouds: 0.34,
    stars: 0.18,
    cityGlow: c(0.03, 0.018, 0.012),
    fogDensity: 0.00014,
    fogTint: c(0.92, 0.9, 1),
    winLit: 0.7,
    lamp: 1,
    bloom: 0.38,
    sand: h('#8a6f62'),
    sea: h('#1d2f4c'),
    shadowStrength: 0.65,
  },
  night: {
    lightEl: 38,
    lightAz: 118,
    lightColor: c(0.52, 0.62, 0.95),
    lightIntensity: 0.36,
    sunEl: -30,
    sunAz: 262,
    sunDisc: 0,
    hemiSky: h('#2a3866'),
    hemiGround: h('#1c1820'),
    hemiIntensity: 0.46,
    envIntensity: 0.32,
    exposure: 1.32,
    zenith: h('#03081a'),
    mid: h('#0a1229'),
    horizon: h('#18203a'),
    horizonAway: h('#121a30'),
    glow: h('#1c2340'),
    glowSpread: 0.6,
    cloudLit: h('#3a3e5a'),
    cloudShade: h('#0d1020'),
    clouds: 0.22,
    stars: 1,
    cityGlow: c(0.05, 0.03, 0.018),
    fogDensity: 0.00016,
    fogTint: c(0.6, 0.62, 0.8),
    winLit: 1,
    lamp: 1,
    bloom: 0.42,
    sand: h('#3a3440'),
    sea: h('#0a1426'),
    shadowStrength: 0.45,
  },
};

const clone = (s: TodState): TodState => {
  const o = { ...s } as TodState;
  for (const k of Object.keys(s) as Array<keyof TodState>) {
    const v = s[k];
    if (v instanceof THREE.Color) (o as unknown as Record<string, unknown>)[k] = v.clone();
  }
  return o;
};

/** Blend two states (angles take the short way round). */
export function lerpTod(a: TodState, b: TodState, t: number, out: TodState = clone(a)): TodState {
  for (const k of Object.keys(a) as Array<keyof TodState>) {
    const va = a[k];
    const vb = b[k];
    if (va instanceof THREE.Color) (out[k] as THREE.Color).copy(va).lerp(vb as THREE.Color, t);
    else if (k === 'lightAz' || k === 'sunAz') {
      let d = (vb as number) - (va as number);
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      (out as unknown as Record<string, number>)[k] = (va as number) + d * t;
    } else (out as unknown as Record<string, number>)[k] = (va as number) + ((vb as number) - (va as number)) * t;
  }
  return out;
}

/** State at a continuous phase (0 day, 1 golden, 2 dusk, 3 night). */
export function todAt(phase: number, out?: TodState): TodState {
  const p = THREE.MathUtils.clamp(phase, 0, 3);
  const i = Math.min(2, Math.floor(p));
  const t = p - i;
  // ease inside each segment so the keys read as plateaus
  const e = t * t * (3 - 2 * t);
  return lerpTod(TOD[TOD_KEYS[i]], TOD[TOD_KEYS[i + 1]], e, out);
}

export function phaseOf(k: TodKey): number {
  return TOD_KEYS.indexOf(k);
}

/** Unit direction toward elevation/azimuth in three.js coordinates (x east, y up, z south). */
export function dirFrom(elDeg: number, azDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elDeg);
  const az = THREE.MathUtils.degToRad(azDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
