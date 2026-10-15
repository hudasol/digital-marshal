import type { RngState } from '../rng';

/* Digital Marshal service state. Plain data stored inside the simulation state, so incidents,
   messages, deliveries and exception handling are part of every snapshot and replay. */

export type Policy = 'A' | 'B' | 'C';

export type MessageType =
  | 'SIGNAL_OUTAGE'
  | 'SIGNAL_RESTORED'
  | 'ROAD_RESTRICTION'
  | 'RESTRICTION_LIFTED'
  | 'EMERGENCY_CORRIDOR'
  | 'CORRIDOR_CLEARED'
  | 'ASSISTANCE_AUTHORIZATION'
  | 'ROUTE_ADVISORY';

export interface MessageArea {
  junctions?: string[];
  links?: string[];
  /** closed lanes per link, with the closed extent along the link */
  lanes?: Array<{ link: string; lanes: number[]; s0: number; s1: number }>;
}

export interface MessageHeader {
  msgId: string;
  incidentId: string;
  version: number;
  issuer: string;
  issuedAt: number; // simulation seconds
  validFrom: number;
  validUntil: number;
  mapVersion: string;
}

export interface MessageBody {
  type: MessageType;
  severity: number; // 1 (info) to 5 (critical)
  area: MessageArea;
  /** what the message asks vehicles to treat as true: restriction, corridor or authorization detail */
  detail: Record<string, string | number | boolean | string[]>;
  text: string;
}

export interface SignedMessage {
  header: MessageHeader;
  body: MessageBody;
  sig: { alg: 'ECDSA-P256-SHA256'; keyId: string; value: string };
  /** how the message entered the channel: published by the node, submitted to it, or injected for a security test */
  origin: 'published' | 'submitted' | 'injected';
  /** for injected messages: which security test produced it */
  test?: string;
}

export type ReasonCode =
  | 'ACCEPTED'
  | 'SCHEMA_INVALID'
  | 'MAP_VERSION_MISMATCH'
  | 'UNKNOWN_ISSUER'
  | 'CERT_EXPIRED'
  | 'BAD_SIGNATURE'
  | 'NOT_PERMITTED'
  | 'OUT_OF_SCOPE'
  | 'UNKNOWN_LOCATION'
  | 'NOT_YET_VALID'
  | 'EXPIRED'
  | 'STALE'
  | 'FUTURE_TIMESTAMP'
  | 'DUPLICATE'
  | 'OUTDATED_VERSION'
  | 'CONFLICTING_UPDATE';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Verdict {
  status: 'accepted' | 'rejected' | 'flagged' | 'duplicate';
  code: ReasonCode;
  checks: CheckResult[];
}

export type IncidentType = 'signal_outage' | 'emergency_corridor' | 'roadworks';
export type IncidentStatus = 'detected' | 'active' | 'resolved';

export interface Incident {
  id: string;
  type: IncidentType;
  status: IncidentStatus;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  version: number;
  area: MessageArea;
  issuer: string;
  messages: string[]; // msgIds in publication order
  title: string;
  /** physical ground truth that triggered it (for the inspector and the audit) */
  cause: string;
  /** roadworks: which planned stage is current (a new stage replaces the cones of the previous one) */
  stage?: number;
}

export interface Delivery {
  msgId: string;
  veh: number;
  at: number; // arrival time (simulation seconds)
  path: 'rsu' | 'cell';
  rsu?: string;
}

export interface VehicleKnowledge {
  /** messages received, with the vehicle's own validation verdict */
  rx: Record<string, { at: number; latency: number; path: 'rsu' | 'cell'; status: Verdict['status']; code: ReasonCode }>;
  /** incident versions the vehicle accepted */
  incidents: Record<string, { version: number; msgId: string; type: MessageType; acceptedAt: number; active: boolean; flagged: boolean }>;
  /** junction authorizations the vehicle holds (from remote assistance) */
  authorizations: Record<string, { incidentId: string; until: number; msgId: string | null; scope: 'vehicle' | 'junction' }>;
  /** route advice received under coordination */
  advice: { msgId: string; route: string[]; at: number } | null;
}

export type ExceptionType = 'ODD_EXIT_DARK_JUNCTION' | 'NO_FEASIBLE_ROUTE' | 'BLOCKED_BY_CLOSURE' | 'CORRIDOR_CONFLICT';

export interface ExceptionRecord {
  id: string;
  veh: number;
  tag: string;
  type: ExceptionType;
  junction: string;
  incidentId: string | null;
  raisedAt: number;
  status: 'open' | 'in_progress' | 'resolved' | 'auto_resolved' | 'withdrawn';
  resolvedAt: number | null;
  resolution: string;
  task: string | null;
  obstructing: boolean;
  emergencyRoute: boolean;
}

export interface AssistTask {
  id: string;
  operator: number;
  kind: 'individual' | 'group';
  exceptions: string[];
  junction: string;
  incidentId: string | null;
  startedAt: number;
  doneAt: number;
  priority: number;
  rationale: string;
}

export interface Pulse {
  t: number;
  kind: 'publish' | 'rsu' | 'reject' | 'authorize';
  x: number;
  y: number;
  ref: string;
}

export interface EvRecord {
  id: number;
  tag: string;
  from: string;
  to: string;
  dispatchedAt: number;
  arrivedAt: number | null;
  /** travel time with the road to itself at the ambulance's own desired speed, s */
  ffT: number;
  incidentId: string;
  route: string[];
  /** seconds the ambulance was held below 80% of its desired speed, by cause */
  obstructed: { vehicle: number; signal: number; junction: number; other: number };
  yields: { ok: number; infeasible: number; byReason: Record<string, number> };
  preempts: number;
  lastUpdate: number;
}

export interface DmParams {
  policy: Policy;
  detectionDelay: number; // s from controller failure to detection
  operators: number; // remote assistance capacity
  handleIndividual: number; // s per individual request
  handleGroupBase: number; // s per group task
  handleGroupPer: number; // additional s per vehicle in a group
  rsuLatency: [number, number]; // ms range
  cellLatency: [number, number]; // ms range
  rsuLoss: number; // probability
  cellLoss: number; // probability
  repeatEvery: number; // s between rebroadcasts of active messages
  rsuBattery: boolean; // RSUs keep working when their junction loses power
  cellular: boolean;
  extraLatencyMs: number; // communication fault: added latency
  extraLoss: number; // communication fault: added loss probability
  rsuDown: string[]; // communication fault: RSUs out of service
}

export interface DmState {
  params: DmParams;
  nextIncident: number;
  nextException: number;
  nextTask: number;
  incidents: Record<string, Incident>;
  messages: Record<string, SignedMessage>;
  /** DM's own validation of every message that reached it or was injected */
  verdicts: Record<string, Verdict>;
  inbox: Delivery[]; // pending deliveries, sorted by arrival time
  lastBroadcast: Record<string, number>; // msgId -> last time it was (re)broadcast
  knowledge: Record<string, VehicleKnowledge>; // vehicle id -> knowledge
  exceptions: Record<string, ExceptionRecord>;
  tasks: Record<string, AssistTask>;
  operators: Array<{ busyUntil: number; task: string | null }>;
  /** junction-wide authorizations issued by remote assistance under coordination */
  junctionAuth: Record<string, { incidentId: string; msgId: string; at: number }>;
  pending: Array<{ at: number; kind: string; params: Record<string, unknown> }>; // scheduled service actions
  pulses: Pulse[];
  rng: RngState; // radio loss and latency draws
  pendingKeys: Record<string, true>; // `${veh}|${msgId}` deliveries in flight
  lastAdvice: number;
  lastRefresh: Record<string, number>;
  /** the current (or last) emergency run */
  ev: EvRecord | null;
  evRuns: EvRecord[];
  /** receiver verdicts per injected message (security demonstration) */
  rxTally: Record<string, { accepted: number; rejected: number; flagged: number; duplicate: number; codes: Partial<Record<ReasonCode, number>> }>;
  /** cumulative reach per incident: vehicles that received, accepted or rejected any of its messages */
  reach: Record<string, { received: Record<string, true>; accepted: Record<string, true>; rejected: Record<string, true> }>;
  stats: {
    published: number;
    delivered: number;
    lost: number;
    rejected: number;
    flagged: number;
    latencySum: number;
    latencyN: number;
    exceptionsRaised: number;
    exceptionsResolved: number;
    autoResolved: number;
    mrcVehicleSeconds: number;
    operatorBusy: number; // operator-seconds spent
    reroutes: number;
  };
}
