/* Network model shared by the simulation and the renderer. Plain data only, so it can be
   serialised, hashed (map version) and used in Node and in a worker. Coordinates: metres,
   x east, y north. Driving on the right. Lane 0 is the lane next to the centre line or median. */

export interface Vec2 {
  x: number;
  y: number;
}

export type RoadClass = 'arterial' | 'collector' | 'local';
export type Side = 'N' | 'E' | 'S' | 'W';
export type Turn = 'L' | 'S' | 'R';

export interface RoadDef {
  id: string;
  name: string; // synthetic code-style name; not a real street
  cls: RoadClass;
  lanesPerDir: number;
  median: number; // total median width between the two directions, m
  speedKmh: number;
  nodes: string[]; // ordered node ids along the road
}

export interface NodeDef {
  id: string;
  kind: 'junction' | 'gateway';
  x: number;
  y: number;
  label: string;
}

export interface LinkDef {
  id: string;
  from: string;
  to: string;
  road: string;
  roadName: string;
  cls: RoadClass;
  lanes: number;
  speed: number; // m/s
  dir: Vec2; // unit direction of travel
  right: Vec2; // unit vector to the right of travel
  start: Vec2; // centre line point where the link starts (after the upstream junction box)
  end: Vec2; // centre line point at the stop line (or the gateway)
  length: number;
  laneOffsets: number[]; // signed distance of lane centres from the road centre line, along `right`
  halfWidth: number; // centre line to curb, m
  reverse: string | null;
  endsAtJunction: boolean;
  startsAtGateway: boolean;
  /** turns permitted from each lane at the downstream junction */
  laneTurns: Turn[][];
  /** approach side at the downstream junction (where the traffic comes from) */
  approachSide: Side | null;
}

export interface ConnectorDef {
  id: string;
  junction: string;
  inLink: string;
  inLane: number;
  outLink: string;
  outLane: number;
  turn: Turn;
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
  length: number;
  /** cumulative arc length at SAMPLES+1 equally spaced Bezier parameters */
  lut: number[];
  speedLimit: number; // m/s, from curvature
  conflicts: string[]; // connectors at the same junction whose paths cross or merge with this one
  siblings: string[]; // connectors that leave from the same incoming lane (diverge)
  approach: Side;
}

export interface PhaseMove {
  inLink: string;
  turns: Turn[];
}

export interface PhaseDef {
  label: string;
  moves: PhaseMove[];
  green: number;
}

export interface SignalPlan {
  phases: PhaseDef[];
  amber: number;
  allRed: number;
  cycle: number;
  offset: number;
}

export interface JunctionDef {
  id: string;
  label: string;
  x: number;
  y: number;
  /** half extents of the box between stop lines (includes crosswalk bands) */
  boxHalfX: number;
  boxHalfY: number;
  /** curb-to-curb half widths of the crossing roads */
  nsHalf: number;
  ewHalf: number;
  inLinks: Partial<Record<Side, string>>;
  outLinks: Partial<Record<Side, string>>;
  connectors: string[];
  plan: SignalPlan;
  maxApproachLanes: number;
  rsu: { x: number; y: number; range: number; id: string };
}

export interface Network {
  version: string; // short hash of the geometry, carried in every message
  roads: Record<string, RoadDef>;
  nodes: Record<string, NodeDef>;
  links: Record<string, LinkDef>;
  connectors: Record<string, ConnectorDef>;
  junctions: Record<string, JunctionDef>;
  linkIds: string[];
  connectorIds: string[];
  junctionIds: string[];
  gatewayIds: string[];
  /** link ids leaving each gateway (entries) and arriving at each gateway (exits) */
  gatewayIn: Record<string, string>;
  gatewayOut: Record<string, string>;
  /** connectors that start from a given lane end: key `${linkId}#${lane}` */
  fromLane: Record<string, string[]>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  places: Record<string, Place>;
}

export interface Place {
  id: string;
  label: string;
  link: string;
  s: number; // distance along the link from its start
  lane: number;
}
