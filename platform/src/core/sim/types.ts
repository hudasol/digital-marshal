import type { RngState } from '../rng';
import type { DmState } from '../dm/types';

/* Simulation state. Everything that changes during a run lives in SimState and is plain data,
   so a snapshot is a structured clone and a replay from the same seed and interventions is exact. */

export type VehicleClass = 'robotaxi' | 'car' | 'van' | 'bus' | 'ambulance';

export interface Seg {
  k: 'L' | 'C'; // lane of a link, or a junction connector
  id: string; // link id or connector id
  lane: number; // lane index for links; the connector's out lane for connectors
}

/** What currently limits a vehicle's acceleration: the answer to "why is it slow or stopped". */
export type BindKind =
  | 'free' // free road, at or toward desired speed
  | 'leader' // following another vehicle
  | 'signal' // red or amber signal ahead
  | 'awsc' // all-way-stop protocol at a dark junction
  | 'box' // a conflicting vehicle occupies the junction
  | 'exit' // no room on the exit lane (do not block the box)
  | 'curve' // slowing for a turn
  | 'closure' // physical closure (cones or barrier) ahead
  | 'mrc' // minimal risk condition: stopped by the AV's own safety logic, awaiting guidance
  | 'yield' // yielding to an emergency vehicle
  | 'lanechange' // waiting for a gap to reach the lane it needs
  | 'arrive' // stopping at the destination
  | 'spawn'; // waiting to enter at the district edge

export interface Bind {
  kind: BindKind;
  gap: number; // metres to the constraint (or leader)
  ref: string; // vehicle tag, junction id, closure id ...
  extra?: number; // e.g. seconds to green
}

export interface DriverParams {
  a: number; // max acceleration m/s^2
  b: number; // comfortable deceleration m/s^2
  T: number; // desired time headway s
  s0: number; // jam distance m
  vf: number; // desired speed factor relative to the limit
  polite: number; // MOBIL politeness
}

export type LogCode =
  | 'SPAWN'
  | 'ROUTE'
  | 'REROUTE'
  | 'STOP_SIGNAL'
  | 'GO_SIGNAL'
  | 'AMBER_COMMIT'
  | 'AWSC_STOP'
  | 'AWSC_GO'
  | 'LANE_CHANGE'
  | 'MISSED_TURN'
  | 'BOX_WAIT'
  | 'EXIT_WAIT'
  | 'MRC'
  | 'ASSIST_REQUEST'
  | 'ASSIST_GRANTED'
  | 'YIELD'
  | 'YIELD_INFEASIBLE'
  | 'MSG_RX'
  | 'MSG_REJECT'
  | 'CLOSURE_SEEN'
  | 'ARRIVED'
  | 'EXITED'
  | 'NO_ALTERNATIVE'
  | 'ADVICE';

export interface LogEntry {
  t: number;
  code: LogCode;
  p: Record<string, string | number | boolean>;
}

export interface Vehicle {
  id: number;
  tag: string; // display id, e.g. AV-0142
  cls: VehicleClass;
  av: boolean; // autonomous (simulated planner)
  connected: boolean; // receives V2X messages
  len: number;
  width: number;
  p: DriverParams;
  paint: number; // index into the colour palette
  seg: Seg;
  s: number; // front bumper position along the segment, m
  v: number;
  acc: number;
  prev: Seg | null; // segment before the current one (for the rear position)
  prevLen: number;
  lat: number; // lateral offset during a lane change, m (animates to 0)
  route: string[]; // link ids from origin to destination
  ri: number; // index of the current (or last) link in route
  dest: string; // gateway id or place id
  destS: number; // stop position on the final link (Infinity = drive off at a gateway)
  conn: string | null; // connector planned at the end of the current link
  committed: boolean; // past the point where it could stop for the junction
  stopT: number; // continuous time with v < 0.3
  awscAt: number; // time it queued at a dark junction (-1 = not queued)
  bind: Bind;
  mode: 'drive' | 'mrc' | 'arrived';
  lcT: number; // time until the next lane change evaluation
  lcHold: number; // seconds remaining in the current lane change
  log: LogEntry[];
  spawnT: number;
  ffT: number; // free-flow travel time of the planned route, s
  dist: number;
  stopped: number; // accumulated stationary time, s
  reroutes: number;
  laneChanges: number;
  /** last junction gate decision, for change-only logging */
  lastGate: string;
}

export interface TripRecord {
  id: number;
  cls: VehicleClass;
  av: boolean;
  t0: number;
  t1: number;
  ffT: number;
  dist: number;
  stopped: number;
  reroutes: number;
}

export interface SeriesPoint {
  t: number;
  active: number;
  stopped: number;
  meanSpeed: number;
  exits: number;
  delay: number; // cumulative delay of completed trips, vehicle-seconds
}

export interface SimEvent {
  t: number;
  kind: string;
  tone: 'info' | 'warn' | 'critical' | 'ok';
  ref?: string;
  p?: Record<string, string | number | boolean>;
}

export interface PendingSpawn {
  cls: VehicleClass;
  dest: string;
  at: number;
  veh: Vehicle | null; // created on the first insertion attempt, kept until it fits
}

export interface Closure {
  id: string;
  link: string;
  lanes: number[]; // closed lanes (all lanes = segment closed)
  s0: number;
  s1: number;
  since: number;
}

export interface RoadPhysical {
  dark: string[]; // junctions whose signal controllers have failed
  closures: Closure[]; // cones and barriers physically on the road
}

export interface SimState {
  t: number;
  tick: number;
  seed: number;
  nextId: number;
  rng: { demand: RngState; drivers: RngState; misc: RngState };
  vehicles: Record<string, Vehicle>; // keyed by numeric id as string; insertion order = spawn order
  order: number[]; // ids in a fixed processing order
  lanes: Record<string, number[]>; // `${link}#${lane}` -> ids sorted by s ascending
  conns: Record<string, number[]>; // connector id -> ids sorted by s ascending
  pending: Record<string, PendingSpawn[]>; // per gateway
  awsc: Record<string, Array<{ id: number; at: number }>>; // queue per dark junction
  road: RoadPhysical;
  densityScale: number;
  trips: TripRecord[];
  series: SeriesPoint[];
  events: SimEvent[];
  linkTT: Record<string, number>; // smoothed observed link traversal time, s
  moveDelay: Record<string, number>; // smoothed observed delay per movement `${in}>${out}`, s
  linkEnter: Record<string, number>; // vehicle id -> time it entered its current link
  counters: { exits: number; delay: number; spawned: number; boxViolations: number; hardBrakes: number; unroutable: number };
  /** Digital Marshal service state (incidents, messages, deliveries, exceptions); null when not attached */
  dm: DmState | null;
}
