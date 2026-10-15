import type { DriverParams, VehicleClass } from './types';

/* Simulation parameters. Car following uses the Intelligent Driver Model (Treiber, Hennecke and
   Helbing, 2000); lane changes use MOBIL (Kesting, Treiber and Helbing, 2007). Values are typical
   textbook values, not calibrated to Dubai traffic. */

export const DT = 0.1; // simulation step, s
export const WARMUP_S = 240; // seconds simulated before t = 0 so the city starts populated
export const SNAPSHOT_EVERY_S = 10;
export const PERCEPTION_M = 110; // range at which a vehicle sees signals, cones and barriers
export const STOP_V = 0.3; // below this a vehicle counts as stationary, m/s

export interface ClassSpec {
  len: number;
  width: number;
  av: boolean;
  connected: boolean;
  base: DriverParams;
  jitter: number; // relative spread of desired speed between drivers
}

export const CLASSES: Record<VehicleClass, ClassSpec> = {
  robotaxi: {
    len: 4.9,
    width: 1.92,
    av: true,
    connected: true,
    base: { a: 1.5, b: 2.2, T: 1.3, s0: 2.4, vf: 0.97, polite: 0.5 },
    jitter: 0.02,
  },
  car: {
    len: 4.6,
    width: 1.84,
    av: false,
    connected: false,
    base: { a: 1.8, b: 2.4, T: 1.15, s0: 2.0, vf: 1.0, polite: 0.25 },
    jitter: 0.08,
  },
  van: {
    len: 5.6,
    width: 2.0,
    av: false,
    connected: false,
    base: { a: 1.3, b: 2.2, T: 1.4, s0: 2.4, vf: 0.94, polite: 0.3 },
    jitter: 0.06,
  },
  bus: {
    len: 12.0,
    width: 2.55,
    av: false,
    connected: false,
    base: { a: 1.0, b: 1.8, T: 1.6, s0: 3.0, vf: 0.88, polite: 0.4 },
    jitter: 0.04,
  },
  ambulance: {
    len: 6.4,
    width: 2.2,
    av: false,
    connected: true,
    base: { a: 2.2, b: 3.2, T: 0.9, s0: 2.0, vf: 1.35, polite: 0 },
    jitter: 0,
  },
};

/** Entering flow per gateway at density 1.0, vehicles per hour. Also used as destination weight. */
export const GATEWAY_RATE: Record<string, number> = {
  'BL-W': 560,
  'BL-E': 540,
  'NA-W': 250,
  'NA-E': 240,
  'SS-W': 250,
  'SS-E': 240,
  'WR-N': 220,
  'WR-S': 210,
  'TR-N': 230,
  'TR-S': 220,
  'MS-N': 110,
  'MS-S': 100,
  'HR-N': 110,
  'HR-S': 100,
};

/** Share of each class in generated demand (robotaxi share is the connected-AV penetration). */
export const DEFAULT_MIX: Record<Exclude<VehicleClass, 'ambulance'>, number> = {
  robotaxi: 0.45,
  car: 0.43,
  van: 0.07,
  bus: 0.05,
};

/** Paint colours (sRGB hex) per class; private cars draw from a Dubai-typical palette. */
export const PAINT: Record<VehicleClass, number[]> = {
  robotaxi: [0xf4f6f8],
  car: [0xe9ebee, 0xc9ccd1, 0x1d2025, 0x8e949b, 0x3a4250, 0xd9cfbf, 0x6d1f24, 0x2b3a55, 0xf2f2f0, 0x5c6066],
  van: [0xf1f1ef, 0xdfe2e6],
  bus: [0x1f6f8b],
  ambulance: [0xf7f7f2],
};

/** Movement delay assumed by route planning before observations exist, s (protected lefts wait longest). */
export const TURN_DELAY_GUESS = { S: 18, R: 12, L: 36 };
/** Extra cost added by a planner for each junction known to be dark (all-way stop), s. */
export const DARK_JUNCTION_PENALTY = 75;
