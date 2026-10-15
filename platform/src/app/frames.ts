import type { Engine } from '../core/sim/engine';
import type { Bind, LogEntry, VehicleClass } from '../core/sim/types';
import { CLASSES } from '../core/sim/params';
import { STOP_V } from '../core/sim/params';

/* Compact, plain-data views of the simulation for the React panels. Built a few times per second
   from engine state; React never reads the engine directly. */

export interface NetworkFrame {
  t: number;
  active: number;
  moving: number;
  stopped: number;
  meanSpeedKmh: number;
  exits: number;
  meanDelay: number; // s per completed trip
  byClass: Record<VehicleClass, number>;
  waitingAtSignals: number;
  series: Array<{ t: number; stopped: number; active: number }>;
  hardBrakes: number;
  queuedEntries: number;
}

export interface VehicleFrame {
  id: number;
  tag: string;
  cls: VehicleClass;
  av: boolean;
  connected: boolean;
  mode: string;
  speedKmh: number;
  acc: number;
  road: string; // road name of the current link or "junction J7"
  segment: string; // link or connector id
  lane: number;
  lanes: number;
  bind: Bind;
  origin: string;
  /** named places (hospital access, medical call) by id, so the interface can name them in its language */
  originPlace?: string;
  destPlace?: string;
  dest: string;
  destLabel: string;
  route: Array<{ link: string; road: string; to: string; done: boolean; current: boolean }>;
  remainingM: number;
  log: LogEntry[];
  age: number;
  stopped: number;
  dist: number;
  reroutes: number;
  laneChanges: number;
  exited: boolean;
  lengthM: number;
  inJunction: boolean;
}

export function networkFrame(e: Engine): NetworkFrame {
  const st = e.state;
  const byClass: Record<VehicleClass, number> = { robotaxi: 0, car: 0, van: 0, bus: 0, ambulance: 0 };
  let stopped = 0;
  let sum = 0;
  let atSignal = 0;
  for (const id of st.order) {
    const v = st.vehicles[id];
    byClass[v.cls]++;
    sum += v.v;
    if (v.v < STOP_V) {
      stopped++;
      if (v.bind.kind === 'signal') atSignal++;
    }
  }
  const n = st.order.length;
  const series = st.series.slice(-72).map((p) => ({ t: p.t, stopped: p.stopped, active: p.active }));
  return {
    t: st.t,
    active: n,
    moving: n - stopped,
    stopped,
    meanSpeedKmh: n ? (sum / n) * 3.6 : 0,
    exits: st.counters.exits,
    meanDelay: st.counters.exits ? st.counters.delay / st.counters.exits : 0,
    byClass,
    waitingAtSignals: atSignal,
    series,
    hardBrakes: st.counters.hardBrakes,
    queuedEntries: Object.values(st.pending).reduce((a, q) => a + q.length, 0),
  };
}

export function vehicleFrame(e: Engine, id: number, last: VehicleFrame | null): VehicleFrame | null {
  const v = e.state.vehicles[id];
  if (!v) return last ? { ...last, exited: true, speedKmh: 0 } : null;
  const net = e.net;
  const onLink = v.seg.k === 'L';
  const link = onLink ? net.links[v.seg.id] : null;
  const conn = !onLink ? net.connectors[v.seg.id] : null;
  const road = link ? link.roadName : `${conn!.junction} (${net.junctions[conn!.junction].label.split(' ').slice(1).join(' ')})`;
  const cur = onLink ? v.seg.id : conn!.outLink;
  const curIdx = v.route.indexOf(cur);
  let remaining = 0;
  if (link) remaining += link.length - v.s;
  else remaining += conn!.length - v.s;
  for (let i = Math.max(0, curIdx) + (onLink ? 1 : 0); i < v.route.length; i++) remaining += net.links[v.route[i]].length;
  if (Number.isFinite(v.destS) && v.route.length) {
    const lastLink = net.links[v.route[v.route.length - 1]];
    remaining -= lastLink.length - v.destS;
  }
  const origin = v.log.find((x) => x.code === 'SPAWN')?.p.from as string | undefined;
  const destNode = net.nodes[v.dest];
  return {
    id: v.id,
    tag: v.tag,
    cls: v.cls,
    av: v.av,
    connected: v.connected,
    mode: v.mode,
    speedKmh: v.v * 3.6,
    acc: v.acc,
    road,
    segment: v.seg.id,
    lane: v.seg.lane,
    lanes: link ? link.lanes : 1,
    bind: v.bind,
    origin: (origin && (net.nodes[origin]?.label ?? net.places[origin]?.label)) || origin || net.links[v.route[0]]?.from || '',
    originPlace: origin && net.places[origin] ? origin : undefined,
    destPlace: net.places[v.dest] ? v.dest : undefined,
    dest: v.dest,
    destLabel: destNode ? destNode.label : net.places[v.dest]?.label ?? v.dest,
    route: v.route.map((l, i) => ({
      link: l,
      road: net.links[l].roadName,
      to: net.links[l].to,
      done: curIdx >= 0 && (i < curIdx || (i === curIdx && !onLink)),
      current: i === curIdx && onLink,
    })),
    remainingM: Math.max(0, remaining),
    log: v.log.slice(-18).reverse(),
    age: e.state.t - v.spawnT,
    stopped: v.stopped,
    dist: v.dist,
    reroutes: v.reroutes,
    laneChanges: v.laneChanges,
    exited: false,
    lengthM: CLASSES[v.cls].len,
    inJunction: !onLink,
  };
}
