import type { NodeDef, RoadDef } from './types';

/* Synthetic Dubai-inspired district. Invented geometry: a six-lane boulevard with a planted median,
   two four-lane collectors across it, two-lane local streets, twelve signalised junctions and
   fourteen boundary gateways. Names are generic codes, not real streets. */

export const LANE_W = 3.5;
export const CROSSWALK = 5; // stop line set-back from the curb line of the crossing road
export const X_EDGE = 700;
export const Y_EDGE = 520;

const COL = { W: -400, M: -130, T: 140, H: 410 };
const ROW = { N: 250, B: 0, S: -240 };

export const DISTRICT_NAME = 'Synthetic Dubai-Inspired Urban District';

export const NODES: NodeDef[] = [
  { id: 'J1', kind: 'junction', x: COL.W, y: ROW.N, label: 'J1 North Ave × West Rd' },
  { id: 'J2', kind: 'junction', x: COL.M, y: ROW.N, label: 'J2 North Ave × Market St' },
  { id: 'J3', kind: 'junction', x: COL.T, y: ROW.N, label: 'J3 North Ave × Tower Rd' },
  { id: 'J4', kind: 'junction', x: COL.H, y: ROW.N, label: 'J4 North Ave × Harbour Rd' },
  { id: 'J5', kind: 'junction', x: COL.W, y: ROW.B, label: 'J5 Boulevard × West Rd' },
  { id: 'J6', kind: 'junction', x: COL.M, y: ROW.B, label: 'J6 Boulevard × Market St' },
  { id: 'J7', kind: 'junction', x: COL.T, y: ROW.B, label: 'J7 Boulevard × Tower Rd' },
  { id: 'J8', kind: 'junction', x: COL.H, y: ROW.B, label: 'J8 Boulevard × Harbour Rd' },
  { id: 'J9', kind: 'junction', x: COL.W, y: ROW.S, label: 'J9 South St × West Rd' },
  { id: 'J10', kind: 'junction', x: COL.M, y: ROW.S, label: 'J10 South St × Market St' },
  { id: 'J11', kind: 'junction', x: COL.T, y: ROW.S, label: 'J11 South St × Tower Rd' },
  { id: 'J12', kind: 'junction', x: COL.H, y: ROW.S, label: 'J12 South St × Harbour Rd' },

  { id: 'NA-W', kind: 'gateway', x: -X_EDGE, y: ROW.N, label: 'North Avenue, west edge' },
  { id: 'NA-E', kind: 'gateway', x: X_EDGE, y: ROW.N, label: 'North Avenue, east edge' },
  { id: 'BL-W', kind: 'gateway', x: -X_EDGE, y: ROW.B, label: 'Central Boulevard, west edge' },
  { id: 'BL-E', kind: 'gateway', x: X_EDGE, y: ROW.B, label: 'Central Boulevard, east edge' },
  { id: 'SS-W', kind: 'gateway', x: -X_EDGE, y: ROW.S, label: 'South Street, west edge' },
  { id: 'SS-E', kind: 'gateway', x: X_EDGE, y: ROW.S, label: 'South Street, east edge' },
  { id: 'WR-N', kind: 'gateway', x: COL.W, y: Y_EDGE, label: 'West Road, north edge' },
  { id: 'WR-S', kind: 'gateway', x: COL.W, y: -Y_EDGE, label: 'West Road, south edge' },
  { id: 'MS-N', kind: 'gateway', x: COL.M, y: Y_EDGE, label: 'Market Street, north edge' },
  { id: 'MS-S', kind: 'gateway', x: COL.M, y: -Y_EDGE, label: 'Market Street, south edge' },
  { id: 'TR-N', kind: 'gateway', x: COL.T, y: Y_EDGE, label: 'Tower Road, north edge' },
  { id: 'TR-S', kind: 'gateway', x: COL.T, y: -Y_EDGE, label: 'Tower Road, south edge' },
  { id: 'HR-N', kind: 'gateway', x: COL.H, y: Y_EDGE, label: 'Harbour Road, north edge' },
  { id: 'HR-S', kind: 'gateway', x: COL.H, y: -Y_EDGE, label: 'Harbour Road, south edge' },
];

export const ROADS: RoadDef[] = [
  { id: 'NA', name: 'North Avenue (C1)', cls: 'collector', lanesPerDir: 2, median: 1.6, speedKmh: 50, nodes: ['NA-W', 'J1', 'J2', 'J3', 'J4', 'NA-E'] },
  { id: 'BL', name: 'Central Boulevard (A1)', cls: 'arterial', lanesPerDir: 3, median: 8, speedKmh: 60, nodes: ['BL-W', 'J5', 'J6', 'J7', 'J8', 'BL-E'] },
  { id: 'SS', name: 'South Street (C2)', cls: 'collector', lanesPerDir: 2, median: 1.6, speedKmh: 50, nodes: ['SS-W', 'J9', 'J10', 'J11', 'J12', 'SS-E'] },
  { id: 'WR', name: 'West Road (C3)', cls: 'collector', lanesPerDir: 2, median: 1.6, speedKmh: 50, nodes: ['WR-N', 'J1', 'J5', 'J9', 'WR-S'] },
  { id: 'MS', name: 'Market Street (L1)', cls: 'local', lanesPerDir: 1, median: 0, speedKmh: 40, nodes: ['MS-N', 'J2', 'J6', 'J10', 'MS-S'] },
  { id: 'TR', name: 'Tower Road (C4)', cls: 'collector', lanesPerDir: 2, median: 1.6, speedKmh: 50, nodes: ['TR-N', 'J3', 'J7', 'J11', 'TR-S'] },
  { id: 'HR', name: 'Harbour Road (L2)', cls: 'local', lanesPerDir: 1, median: 0, speedKmh: 40, nodes: ['HR-N', 'J4', 'J8', 'J12', 'HR-S'] },
];

/** Green time per approach by road class (split phasing: each approach runs alone). */
export const GREEN_BY_CLASS = { arterial: 24, collector: 17, local: 11 };
export const AMBER = 3;
export const ALL_RED = 2;

/** Named places used by scenarios. `s` is metres from the start of the link. */
export const PLACES = [
  { id: 'hospital', label: 'District hospital access (West Road)', link: 'WR-N>J1', s: 90, lane: 1 },
  { id: 'scene', label: 'Medical call, South Street east', link: 'J11>J12', s: 150, lane: 1 },
];

/** Default blackout cluster: two boulevard junctions and the two South Street junctions below them. */
export const BLACKOUT_JUNCTIONS = ['J6', 'J7', 'J10', 'J11'];
/** Works zone on Tower Road southbound between North Avenue and the boulevard. */
export const WORKS_LINK = 'J3>J7';
