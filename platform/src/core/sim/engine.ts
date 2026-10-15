import type { ConnectorDef, LinkDef, Network } from '../network/types';
import { makeRng, pickWeighted, rand, randNormal } from '../rng';
import { aspectFor, signalState, timeToGreen, type SignalState } from './signals';
import { connectorsBetween, planRoute, freeFlowTime, type RouteOptions } from './router';
import {
  CLASSES,
  DEFAULT_MIX,
  DT,
  GATEWAY_RATE,
  PAINT,
  PERCEPTION_M,
  STOP_V,
  WARMUP_S,
} from './params';
import type {
  Bind,
  BindKind,
  LogCode,
  LogEntry,
  SimEvent,
  SimState,
  Vehicle,
  VehicleClass,
} from './types';

/* The traffic simulation. Fixed 0.1 s steps; accelerations for all vehicles are computed from
   the same state before anyone moves (synchronous update). Every stop or slowdown has a recorded
   binding constraint, which the inspector shows as the reason. */

export interface RunConfig {
  seed: number;
  density: number; // demand multiplier
  mix: Record<Exclude<VehicleClass, 'ambulance'>, number>;
  warmup: number;
  /** AV operational design domain: widest approach (lanes) it may cross under all-way-stop rules */
  oddMaxLanes: number;
}

export const DEFAULT_CONFIG: RunConfig = {
  seed: 20271015,
  density: 0.85,
  mix: DEFAULT_MIX,
  warmup: WARMUP_S,
  oddMaxLanes: 2,
};

/** Integration points for the Digital Marshal layer (incidents, V2X, coordination). */
export interface EngineHooks {
  /** route planning options for a vehicle (its knowledge of restrictions and travel times) */
  routeOptions?(v: Vehicle): RouteOptions;
  /** may this AV cross a dark junction outside its domain (remote assistance granted)? */
  authorized?(v: Vehicle, junction: string): boolean;
  /** an AV has stopped in a minimal risk condition at a junction it may not cross */
  onMrc?(v: Vehicle, junction: string): void;
  /** called once per step after vehicles moved */
  afterStep?(): void;
  /** a vehicle left the simulation */
  onExit?(v: Vehicle): void;
  /** has this vehicle accepted a corridor message for this emergency vehicle (early warning)? */
  evInformed?(v: Vehicle, ev: Vehicle): boolean;
  /** outcome of a yield decision */
  onYield?(v: Vehicle, ev: Vehicle, ok: boolean, reason: string): void;
  /** closures this vehicle knows about from accepted messages (active now) */
  knownClosures?(v: Vehicle): Array<{ id: string; link: string; lanes: number[]; s0: number; s1: number }>;
}

const MAX_LOG = 40;
const LOOKAHEAD = 160;
/** an emergency vehicle positions for its next movement this far before the junction, m */
const EV_TURN_PREP = 230;

function idm(v: number, v0: number, gap: number, dv: number, a: number, b: number, T: number, s0: number): number {
  const vr = v0 > 0.1 ? v / v0 : 1;
  const vr2 = vr * vr;
  const free = 1 - vr2 * vr2;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  const g = gap > 0.05 ? gap : 0.05;
  const k = sStar / g;
  return a * (free - k * k);
}

function freeAcc(v: number, v0: number, a: number): number {
  const vr = v0 > 0.1 ? v / v0 : 1;
  const vr2 = vr * vr;
  return a * (1 - vr2 * vr2);
}

export class Engine {
  readonly net: Network;
  readonly cfg: RunConfig;
  state: SimState;
  hooks: EngineHooks = {};
  private recording = true;

  constructor(net: Network, cfg: Partial<RunConfig> = {}) {
    this.net = net;
    this.cfg = { ...DEFAULT_CONFIG, ...cfg, mix: { ...DEFAULT_MIX, ...(cfg.mix ?? {}) } };
    const seed = this.cfg.seed >>> 0;
    this.state = {
      t: -this.cfg.warmup,
      tick: 0,
      seed,
      nextId: 1,
      rng: { demand: makeRng(seed, 'demand'), drivers: makeRng(seed, 'drivers'), misc: makeRng(seed, 'misc') },
      vehicles: {},
      order: [],
      lanes: {},
      conns: {},
      pending: {},
      awsc: {},
      road: { dark: [], closures: [], preempt: {} },
      densityScale: this.cfg.density,
      trips: [],
      series: [],
      events: [],
      linkTT: {},
      moveDelay: {},
      linkEnter: {},
      counters: { exits: 0, delay: 0, spawned: 0, boxViolations: 0, hardBrakes: 0, unroutable: 0, restrictedEntries: 0, lateDiscoveries: 0 },
      dm: null,
    };
    for (const id of net.linkIds) {
      const l = net.links[id];
      for (let k = 0; k < l.lanes; k++) this.state.lanes[`${id}#${k}`] = [];
    }
    for (const id of net.connectorIds) this.state.conns[id] = [];
    for (const g of net.gatewayIds) this.state.pending[g] = [];
  }

  /** Run the warm-up so the district is populated at t = 0. */
  warmUp(): void {
    this.recording = false;
    while (this.state.t < -1e-9) this.step();
    this.state.t = 0;
    this.state.trips = [];
    this.state.series = [];
    this.state.events = [];
    this.state.counters = { exits: 0, delay: 0, spawned: 0, boxViolations: 0, hardBrakes: 0, unroutable: 0, restrictedEntries: 0, lateDiscoveries: 0 };
    for (const id of this.state.order) {
      const v = this.state.vehicles[id];
      v.stopped = 0;
      v.log = v.log.slice(-6);
    }
    this.recording = true;
    this.sample();
  }

  // ------------------------------------------------------------------ helpers

  veh(id: number): Vehicle {
    return this.state.vehicles[id];
  }

  segLen(seg: Vehicle['seg']): number {
    return seg.k === 'L' ? this.net.links[seg.id].length : this.net.connectors[seg.id].length;
  }

  laneList(link: string, lane: number): number[] {
    return this.state.lanes[`${link}#${lane}`];
  }

  /** Insert a vehicle id into a list kept sorted by position (ascending s). */
  private insertSorted(list: number[], v: Vehicle): void {
    let idx = 0;
    while (idx < list.length && this.veh(list[idx]).s < v.s) idx++;
    list.splice(idx, 0, v.id);
  }

  /** Vehicles still inside junction connectors that will arrive in this lane, as positions before its start. */
  private incoming(link: string, lane: number): Array<{ v: Vehicle; s: number }> {
    const out: Array<{ v: Vehicle; s: number }> = [];
    const l = this.net.links[link];
    if (!this.net.nodes[l.from] || this.net.nodes[l.from].kind !== 'junction') return out;
    const j = this.net.junctions[l.from];
    for (const cid of j.connectors) {
      const c = this.net.connectors[cid];
      if (c.outLink !== link || c.outLane !== lane) continue;
      for (const id of this.state.conns[cid]) {
        const w = this.veh(id);
        out.push({ v: w, s: w.s - c.length });
      }
    }
    return out;
  }

  isDark(junction: string): boolean {
    return this.state.road.dark.includes(junction);
  }

  private sigTick = -1;
  private sigCache: Record<string, SignalState> = {};

  /** Call after changing what signals show (dark junctions, pre-emption) within a step. */
  invalidateSignals(): void {
    this.sigTick = -1;
  }
  /** Signal state of a junction at the current time (cached per step). */
  signal(junction: string): SignalState {
    if (this.sigTick !== this.state.tick) {
      this.sigTick = this.state.tick;
      this.sigCache = {};
    }
    return (this.sigCache[junction] ??= signalState(
      this.net.junctions[junction],
      this.state.t,
      this.isDark(junction),
      this.state.road.preempt[junction],
    ));
  }

  log(v: Vehicle, code: LogCode, p: LogEntry['p'] = {}): void {
    v.log.push({ t: this.state.t, code, p });
    if (v.log.length > MAX_LOG) v.log.splice(0, v.log.length - MAX_LOG);
  }

  event(kind: string, tone: SimEvent['tone'], ref?: string, p?: SimEvent['p']): void {
    if (!this.recording) return;
    this.state.events.push({ t: this.state.t, kind, tone, ref, p });
  }

  /** Desired speed on the current segment. */
  private desired(v: Vehicle): number {
    const limit =
      v.seg.k === 'L' ? this.net.links[v.seg.id].speed : Math.min(this.net.connectors[v.seg.id].speedLimit, 99);
    const base = limit * v.p.vf;
    return v.cls === 'ambulance' ? Math.min(base, 22) : base;
  }

  // ------------------------------------------------------------------ routing

  /** Route planning options for a vehicle: everyone sees typical movement delays (a navigation
      service); the Digital Marshal layer adds what a connected vehicle has accepted. */
  routeOptions(v: Vehicle): RouteOptions {
    const base: RouteOptions = { moveDelay: this.state.moveDelay };
    const extra = this.hooks.routeOptions?.(v);
    const out = extra ? { ...base, ...extra, moveDelay: extra.moveDelay ?? base.moveDelay } : base;
    if (v.blocked.length) out.avoidLinks = new Set([...(out.avoidLinks ?? []), ...v.blocked]);
    return out;
  }

  /** A closure that covers every lane of a link from near its start: the segment cannot be entered
      (except by vehicles that were let through when it was set up). */
  fullyClosed(link: string, v?: Vehicle): boolean {
    const l = this.net.links[link];
    for (const cl of this.state.road.closures) {
      if (cl.link === link && cl.s0 < 25 && cl.lanes.length >= l.lanes && !(v && cl.pass.includes(v.id))) return true;
    }
    return false;
  }

  /**
   * Put cones or barriers on the road. Vehicles that can no longer stop before them (inside the zone,
   * in the junction on their way into it, or committed to entering it) are let through, as a works
   * crew waits for them before closing; everyone else must stop, merge or re-route.
   */
  placeClosure(c: { id: string; link: string; lanes: number[]; s0: number; s1: number }): void {
    const st = this.state;
    const l = this.net.links[c.link];
    const full = c.s0 < 25 && c.lanes.length >= l.lanes;
    const pass = new Set<number>();
    for (const lane of c.lanes) {
      for (const id of this.laneList(c.link, lane)) {
        const v = this.veh(id);
        if (full || v.s > c.s0 - ((v.v * v.v) / (2 * v.p.b) + 3)) pass.add(id);
      }
    }
    if (full) {
      for (const cid of this.net.connectorIds) if (this.net.connectors[cid].outLink === c.link) for (const id of st.conns[cid]) pass.add(id);
      for (const id of st.order) {
        const v = st.vehicles[id];
        if (v.committed && v.conn && this.net.connectors[v.conn].outLink === c.link) pass.add(id);
      }
    }
    st.road.closures.push({ ...c, lanes: [...c.lanes], since: st.t, pass: [...pass].sort((a, b) => a - b) });
  }

  destLink(dest: string): { link: string; s: number } {
    const place = this.net.places[dest];
    if (place) return { link: place.link, s: place.s };
    return { link: this.net.gatewayOut[dest], s: Infinity };
  }

  /** Plan (or re-plan) a vehicle's route from its current link. Returns false when no route exists. */
  plan(v: Vehicle, reason: string | null): boolean {
    const cur = v.seg.k === 'L' ? v.seg.id : this.net.connectors[v.seg.id].outLink;
    const { link: target, s } = this.destLink(v.dest);
    const r = planRoute(this.net, cur, target, this.routeOptions(v));
    if (!r) return false;
    const changed = r.join('|') !== v.route.slice(v.route.indexOf(cur)).join('|');
    v.route = r;
    v.ri = 0;
    v.destS = s;
    if (reason && changed) {
      v.reroutes++;
      this.log(v, 'REROUTE', { reason, via: r.slice(1, 4).map((x) => this.net.links[x].to).join(' ') });
    }
    if (v.seg.k === 'L') this.planConn(v);
    return true;
  }

  /** Choose the connector at the end of the current link toward the next link of the route. */
  planConn(v: Vehicle): void {
    if (v.seg.k !== 'L') return;
    const link = this.net.links[v.seg.id];
    if (!link.endsAtJunction || v.ri >= v.route.length - 1) {
      v.conn = null;
      return;
    }
    const next = v.route[v.ri + 1];
    const cands = connectorsBetween(this.net, link.id, next);
    if (!cands.length) {
      v.conn = null;
      return;
    }
    // plan two junctions ahead: prefer a movement whose exit lane already serves the turn after it
    const after = v.ri + 2 < v.route.length ? v.route[v.ri + 2] : null;
    const need = after ? connectorsBetween(this.net, next, after).map((c) => this.net.connectors[c].inLane) : [];
    let best = cands[0];
    let bd = Infinity;
    for (const c of cands) {
      const cc = this.net.connectors[c];
      let d = Math.abs(cc.inLane - v.seg.lane);
      if (need.length) {
        let m = Infinity;
        for (const k of need) m = Math.min(m, Math.abs(cc.outLane - k));
        d += 1.5 * m;
      }
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    v.conn = best;
  }

  // ------------------------------------------------------------------ demand

  private spawnDemand(): void {
    const st = this.state;
    const gws = this.net.gatewayIds;
    const weights = gws.map((g) => GATEWAY_RATE[g] ?? 100);
    const classes = Object.keys(this.cfg.mix) as Array<Exclude<VehicleClass, 'ambulance'>>;
    const shares = classes.map((c) => this.cfg.mix[c]);
    for (let gi = 0; gi < gws.length; gi++) {
      const g = gws[gi];
      const p = ((GATEWAY_RATE[g] ?? 100) * st.densityScale * DT) / 3600;
      if (rand(st.rng.demand) < p) {
        // destination: weighted by gateway size, not the origin itself
        let di = pickWeighted(st.rng.demand, weights);
        if (gws[di] === g) di = (di + 1 + Math.floor(rand(st.rng.demand) * (gws.length - 1))) % gws.length;
        let cls = classes[pickWeighted(st.rng.demand, shares)];
        // buses run on the boulevard and collectors only
        if (cls === 'bus' && (this.net.links[this.net.gatewayIn[g]].cls === 'local' || this.net.links[this.net.gatewayOut[gws[di]]].cls === 'local')) cls = 'car';
        st.pending[g].push({ cls, dest: gws[di], at: st.t, veh: null });
      }
    }
    for (const g of gws) this.tryInsert(g);
  }

  private tryInsert(g: string): void {
    const st = this.state;
    const q = st.pending[g];
    if (!q.length) return;
    const req = q[0];
    const link = this.net.links[this.net.gatewayIn[g]];
    if (!req.veh) req.veh = this.makeVehicle(req.cls, req.dest, link.id, 0);
    const v = req.veh;
    if (!v) {
      st.counters.unroutable++;
      q.shift();
      return;
    }
    // lane: the one the first turn needs, otherwise the least occupied
    const want = v.conn ? this.net.connectors[v.conn].inLane : -1;
    const lanes = [...Array(link.lanes).keys()].sort((a, b) => {
      const pa = a === want ? -1000 : 0;
      const pb = b === want ? -1000 : 0;
      return pa + this.laneList(link.id, a).length - (pb + this.laneList(link.id, b).length);
    });
    for (const lane of lanes) {
      const list = this.laneList(link.id, lane);
      const rear = list.length ? this.veh(list[0]) : null;
      const room = rear ? rear.s - rear.len : Infinity;
      if (room < v.len + 7) continue;
      v.seg = { k: 'L', id: link.id, lane };
      v.s = v.len;
      const v0 = this.desired(v);
      v.v = rear ? Math.min(v0 * 0.75, rear.v, Math.max(0, (room - v.len - 4) / 2.5)) : v0 * 0.75;
      list.unshift(v.id);
      st.vehicles[v.id] = v;
      st.order.push(v.id);
      st.linkEnter[v.id] = st.t;
      this.planConn(v);
      q.shift();
      st.counters.spawned++;
      this.log(v, 'SPAWN', { from: g, to: v.dest, waited: Math.round(st.t - req.at) });
      return;
    }
  }

  /** Create a vehicle (not yet placed) with a planned route; null when the destination is unreachable. */
  makeVehicle(cls: VehicleClass, dest: string, startLink: string, lane: number): Vehicle | null {
    const st = this.state;
    const spec = CLASSES[cls];
    const r = st.rng.drivers;
    const base = spec.base;
    const vf = base.vf * (1 + spec.jitter * randNormal(r));
    const id = st.nextId++;
    const prefix = cls === 'robotaxi' ? 'AV' : cls === 'ambulance' ? 'EMS' : cls === 'bus' ? 'BUS' : cls === 'van' ? 'VAN' : 'CAR';
    const palette = PAINT[cls];
    const v: Vehicle = {
      id,
      tag: `${prefix}-${String(id).padStart(4, '0')}`,
      cls,
      av: spec.av,
      connected: spec.connected,
      len: spec.len,
      width: spec.width,
      p: { ...base, vf },
      paint: Math.floor(rand(r) * palette.length),
      seg: { k: 'L', id: startLink, lane },
      s: 0,
      v: 0,
      acc: 0,
      prev: null,
      prevLen: 0,
      lat: 0,
      route: [startLink],
      ri: 0,
      dest,
      destS: Infinity,
      conn: null,
      committed: false,
      stopT: 0,
      awscAt: -1,
      bind: { kind: 'free', gap: Infinity, ref: '' },
      mode: 'drive',
      lcT: rand(r) * 0.5,
      lcHold: 0,
      log: [],
      spawnT: st.t,
      ffT: 0,
      dist: 0,
      stopped: 0,
      reroutes: 0,
      laneChanges: 0,
      lastGate: '',
      evAware: -1,
      evYield: '',
      blocked: [],
      noticed: [],
    };
    if (!this.plan(v, null)) return null;
    v.ffT = this.freeFlow(v.route);
    this.log(v, 'ROUTE', { to: dest, links: v.route.length, ff: Math.round(v.ffT) });
    return v;
  }

  freeFlow(route: string[]): number {
    let t = 0;
    for (let i = 0; i < route.length; i++) {
      t += freeFlowTime(this.net, route[i]);
      if (i > 0) {
        const c = connectorsBetween(this.net, route[i - 1], route[i])[0];
        if (c) t += this.net.connectors[c].length / this.net.connectors[c].speedLimit;
      }
    }
    return t;
  }

  /** Insert an already-created vehicle at a position on a link lane (used for the ambulance). */
  place(v: Vehicle, link: string, lane: number, s: number, speed: number): boolean {
    const list = this.laneList(link, lane);
    let idx = 0;
    while (idx < list.length && this.veh(list[idx]).s < s) idx++;
    const ahead = idx < list.length ? this.veh(list[idx]) : null;
    const behind = idx > 0 ? this.veh(list[idx - 1]) : null;
    if (ahead && ahead.s - ahead.len - s < 3) return false;
    if (behind && s - v.len - behind.s < 3) return false;
    v.seg = { k: 'L', id: link, lane };
    v.s = s;
    v.v = speed;
    list.splice(idx, 0, v.id);
    this.state.vehicles[v.id] = v;
    this.state.order.push(v.id);
    this.state.linkEnter[v.id] = this.state.t;
    this.planConn(v);
    return true;
  }

  // ------------------------------------------------------------------ junction gate

  /**
   * May vehicle v enter connector c (it is `dist` metres before the stop line)?
   * Returns null when it may, otherwise the binding reason.
   */
  gate(v: Vehicle, c: ConnectorDef, dist: number): Bind | null {
    const st = this.state;
    const j = this.net.junctions[c.junction];
    const link = this.net.links[c.inLink];
    const ev = v.cls === 'ambulance';
    if (!v.committed) {
      if (!this.isDark(j.id)) {
        const aspect = aspectFor(j, this.signal(j.id), link.id, c.turn);
        if (!ev) {
          if (aspect === 'R') return { kind: 'signal', gap: dist, ref: j.id, extra: timeToGreen(j, link.id, c.turn, st.t) };
          if (aspect === 'A') {
            const need = (v.v * v.v) / (2 * Math.max(0.5, dist - 0.5));
            if (need < 3.4) return { kind: 'signal', gap: dist, ref: j.id, extra: timeToGreen(j, link.id, c.turn, st.t) };
          }
        } else if (aspect !== 'G' && v.v > 6 && dist < 25) {
          // an emergency vehicle may pass a red signal, but only slowly and with the box clear
          return { kind: 'signal', gap: dist, ref: j.id };
        }
      } else {
        // dark junction: all-way stop. AVs check their operational design domain first.
        if (v.av && j.maxApproachLanes > this.cfg.oddMaxLanes && !(this.hooks.authorized?.(v, j.id) ?? false)) {
          return { kind: 'mrc', gap: dist, ref: j.id };
        }
        if (!ev) {
          if (v.awscAt < 0) return { kind: 'awsc', gap: dist, ref: j.id };
          const q = st.awsc[j.id] ?? [];
          for (const e of q) {
            if (e.id === v.id || e.at > v.awscAt || (e.at === v.awscAt && e.id > v.id)) continue;
            const other = st.vehicles[e.id];
            if (!other || !other.conn) continue;
            if (other.conn === c.id || c.conflicts.includes(other.conn)) {
              return { kind: 'awsc', gap: dist, ref: other.tag };
            }
          }
        }
      }
    }
    // a segment closed at its entrance cannot be entered, whatever the signals show
    if (this.fullyClosed(c.outLink, v)) return { kind: 'closure', gap: dist, ref: c.outLink };
    // safety layer, always applied (also to committed vehicles until they cross the line)
    for (const cid of c.conflicts) {
      const occ = st.conns[cid];
      if (occ.length) {
        if (v.committed && dist < 2) continue; // already in the box; checked at entry for the audit
        return { kind: 'box', gap: dist, ref: st.vehicles[occ[occ.length - 1]].tag };
      }
    }
    // do not block the box: room on the exit lane for the whole vehicle
    const out = this.laneList(c.outLink, c.outLane);
    let room = Infinity;
    if (out.length) {
      const rear = this.veh(out[0]);
      room = rear.s - rear.len;
    }
    // vehicles already on this connector will also need room
    for (const id of st.conns[c.id]) room -= this.veh(id).len + 2;
    if (room < v.len + 2 && !v.committed) return { kind: 'exit', gap: dist, ref: out.length ? this.veh(out[0]).tag : '' };
    return null;
  }

  // ------------------------------------------------------------------ car following

  // reusable accumulator for the binding constraint (no per-vehicle closures or allocations)
  private A = { best: 0, kind: 'free' as BindKind, gap: Infinity, ref: '', extra: undefined as number | undefined, v: 0, v0: 0, p: null as unknown as Vehicle['p'] };

  private cons(acc: number, kind: BindKind, gap: number, ref: string, extra?: number): void {
    const A = this.A;
    if (acc < A.best) {
      A.best = acc;
      A.kind = kind;
      A.gap = gap;
      A.ref = ref;
      A.extra = extra;
    }
  }

  private fol(gap: number, lv: number, ref: string): void {
    const A = this.A;
    const p = A.p;
    this.cons(idm(A.v, A.v0, gap, A.v - lv, p.a, p.b, p.T, p.s0), 'leader', gap, ref);
  }

  /** A stop position treated as a standing obstacle with a small jam distance. */
  private stp(gap: number, kind: BindKind, ref: string, extra?: number): void {
    const A = this.A;
    const p = A.p;
    this.cons(idm(A.v, A.v0, gap > 0.05 ? gap : 0.05, A.v, p.a, p.b, p.T, 0.6), kind, gap, ref, extra);
  }

  private accel(v: Vehicle): { acc: number; bind: Bind } {
    const st = this.state;
    const p = v.p;
    const v0 = this.desired(v);
    const A = this.A;
    A.best = freeAcc(v.v, v0, p.a);
    A.kind = 'free';
    A.gap = Infinity;
    A.ref = '';
    A.extra = undefined;
    A.v = v.v;
    A.v0 = v0;
    A.p = p;

    if (v.mode === 'arrived') return { acc: -p.b, bind: { kind: 'arrive', gap: 0, ref: v.dest } };

    if (v.seg.k === 'L') {
      const link = this.net.links[v.seg.id];
      const list = this.laneList(link.id, v.seg.lane);
      const idx = list.indexOf(v.id);
      const D = link.length - v.s;
      let found = false;
      if (idx >= 0 && idx < list.length - 1) {
        const w = this.veh(list[idx + 1]);
        this.fol(w.s - w.len - v.s, w.v, w.tag);
        found = true;
      }
      const c = v.conn ? this.net.connectors[v.conn] : null;
      if (c) {
        // anticipate the turn speed
        const vc = c.speedLimit * Math.min(1, p.vf + 0.05);
        const vAllowed = Math.sqrt(vc * vc + 2 * p.b * Math.max(0, D - 2));
        if (vAllowed < v0) this.cons(freeAcc(v.v, vAllowed, p.a) - (v.v > vAllowed ? p.b * 0.5 : 0), 'curve', D, c.junction);
        if (!found && D < LOOKAHEAD) {
          // leaders beyond the stop line: on the connector, diverging siblings, then the exit lane
          const occ = st.conns[c.id];
          if (occ.length) {
            const w = this.veh(occ[0]);
            this.fol(D + w.s - w.len, w.v, w.tag);
            found = true;
          }
          for (const sib of c.siblings) {
            const o = st.conns[sib];
            for (let k = 0; k < o.length; k++) {
              const w = this.veh(o[k]);
              if (w.s < 10) this.fol(D + w.s - w.len, w.v, w.tag);
            }
          }
          if (!found) {
            const out = this.laneList(c.outLink, c.outLane);
            if (out.length) {
              const w = this.veh(out[0]);
              this.fol(D + c.length + w.s - w.len, w.v, w.tag);
            }
          }
        }
        if (D < LOOKAHEAD) {
          const g = this.gate(v, c, D);
          if (g) this.stp(D - 0.8, g.kind, g.ref, g.extra);
        }
        // never start a movement from a lane it does not begin in: wait for a gap to reach that lane
        if (c.inLane !== v.seg.lane && D < 18) this.stp(D - 0.8, 'lanechange', c.junction);
      } else if (link.endsAtJunction && v.ri < v.route.length - 1) {
        // no usable connector (should not happen): stop at the line
        this.stp(D - 0.8, 'exit', link.to);
      }
      // destination stop on the final link
      if (v.ri === v.route.length - 1 && v.destS !== Infinity) this.stp(v.destS - v.s, 'arrive', v.dest);
      // physical closures in this lane within perception range
      const cls = st.road.closures;
      for (let k = 0; k < cls.length; k++) {
        const cl = cls[k];
        if (cl.link !== link.id || !cl.lanes.includes(v.seg.lane) || cl.pass.includes(v.id)) continue;
        const gap = cl.s0 - v.s;
        if (gap > -v.len && gap < PERCEPTION_M) this.stp(gap - 2, 'closure', cl.id);
      }
      // minimal risk condition: stop and hold
      if (v.mode === 'mrc') this.stp(D - 0.8, 'mrc', link.to);
    } else {
      const c = this.net.connectors[v.seg.id];
      const occ = st.conns[c.id];
      const idx = occ.indexOf(v.id);
      if (idx >= 0 && idx < occ.length - 1) {
        const w = this.veh(occ[idx + 1]);
        this.fol(w.s - w.len - v.s, w.v, w.tag);
      } else {
        const out = this.laneList(c.outLink, c.outLane);
        if (out.length) {
          const w = this.veh(out[0]);
          this.fol(c.length - v.s + w.s - w.len, w.v, w.tag);
        }
      }
      for (const sib of c.siblings) {
        const o = st.conns[sib];
        for (let k = 0; k < o.length; k++) {
          const w = this.veh(o[k]);
          if (w.s > v.s && w.s < 10) this.fol(w.s - w.len - v.s, w.v, w.tag);
        }
      }
    }
    return { acc: Math.max(-9, A.best), bind: { kind: A.kind, gap: A.gap, ref: A.ref, extra: A.extra } };
  }

  // ------------------------------------------------------------------ lane changes (MOBIL)

  /** Nearest emergency vehicle approaching this vehicle from behind along its own route, if any. */
  evBehind(v: Vehicle): { ev: Vehicle; dist: number; via: 'perception' | 'v2x' } | null {
    if (v.cls === 'ambulance' || v.seg.k !== 'L' || !this.evList.length) return null;
    let best: { ev: Vehicle; dist: number; via: 'perception' | 'v2x' } | null = null;
    for (const id of this.evList) {
      const e = this.state.vehicles[id];
      if (!e) continue;
      const link = e.seg.k === 'L' ? e.seg.id : this.net.connectors[e.seg.id].outLink;
      let pos = e.seg.k === 'L' ? e.s : -(this.net.connectors[e.seg.id].length - e.s);
      const idx = e.route.indexOf(link);
      if (idx < 0) continue;
      let acc = 0;
      let dist = -1;
      for (let k = idx; k < e.route.length && k <= idx + 3; k++) {
        const L = e.route[k];
        if (L === v.seg.id) {
          dist = acc + v.s - pos;
          break;
        }
        acc += this.net.links[L].length - pos + 25;
        pos = 0;
        if (acc > 460) break;
      }
      if (dist <= 0) continue;
      const informed = this.hooks.evInformed?.(v, e) ?? false;
      const via: 'perception' | 'v2x' | null = dist < 140 ? 'perception' : informed && dist < 420 ? 'v2x' : null;
      if (!via) continue;
      if (!best || dist < best.dist) best = { ev: e, dist, via: informed ? 'v2x' : via };
    }
    return best;
  }

  /** Why moving into `lane` is not safe right now (for the record of an infeasible yield). */
  private blockedReason(v: Vehicle, lane: number): { reason: string; by: string; gap: number } {
    const list = this.laneList(v.seg.id, lane);
    let by = '';
    let gap = Infinity;
    for (const id of list) {
      const w = this.veh(id);
      const g = w.s > v.s ? w.s - w.len - v.s : v.s - v.len - w.s;
      if (g < gap) {
        gap = g;
        by = w.tag;
      }
    }
    return { reason: 'adjacent_lane_occupied', by, gap: Number.isFinite(gap) ? Math.round(gap * 10) / 10 : -1 };
  }

  /** Yield to an emergency vehicle behind, if one is close enough and this vehicle is in its way. */
  private yieldToEv(v: Vehicle): boolean {
    const enc = this.evBehind(v);
    if (!enc) {
      v.evAware = -1;
      return false;
    }
    const { ev, via } = enc;
    if (v.evAware < 0) v.evAware = this.state.t;
    const reaction = via === 'v2x' ? 0.3 : v.av ? 0.6 : 1.5;
    if (this.state.t - v.evAware < reaction) return true;
    const link = this.net.links[v.seg.id];
    const evLane = ev.seg.k === 'L' && ev.seg.id === link.id ? ev.seg.lane : 0;
    if (v.seg.lane !== evLane) return true; // not in its way; hold the lane
    if (v.evYield === `ok:${ev.tag}`) return true;
    let reason = '';
    let by = '';
    let gap = -1;
    if (v.mode === 'mrc') reason = 'stopped_minimal_risk';
    else if (link.lanes < 2) reason = 'single_lane_no_shoulder';
    else if (v.v < 0.3 && v.bind.kind === 'signal') reason = 'held_at_red_signal';
    else {
      const target = evLane < link.lanes - 1 ? evLane + 1 : evLane - 1;
      if (this.tryChange(v, target, true, 1, 3.0)) {
        this.log(v, 'YIELD', { ev: ev.tag, to: target + 1, via });
        v.evYield = `ok:${ev.tag}`;
        this.hooks.onYield?.(v, ev, true, via);
        return true;
      }
      const b = this.blockedReason(v, target);
      reason = b.reason;
      by = b.by;
      gap = b.gap;
    }
    if (v.evYield !== `no:${ev.tag}`) {
      v.evYield = `no:${ev.tag}`;
      this.log(v, 'YIELD_INFEASIBLE', by ? { ev: ev.tag, reason, by, gap } : { ev: ev.tag, reason });
      this.hooks.onYield?.(v, ev, false, reason);
    }
    return true;
  }

  /** The emergency vehicle prefers the lane with the most free road ahead (inner lane on ties). */
  private evLaneChoice(v: Vehicle): void {
    const link = this.net.links[v.seg.id];
    const D = link.length - v.s;
    const next = v.ri < v.route.length - 1 ? v.route[v.ri + 1] : null;
    const allowed: number[] = [];
    if (next) for (const c of connectorsBetween(this.net, link.id, next)) allowed.push(this.net.connectors[c].inLane);
    else for (let k = 0; k < link.lanes; k++) allowed.push(k);
    if (D < EV_TURN_PREP && v.conn && !allowed.includes(v.seg.lane)) return; // the turn-lane logic handles it
    const freeAhead = (lane: number) => {
      let g = Infinity;
      for (const id of this.laneList(link.id, lane)) {
        const w = this.veh(id);
        if (w.s > v.s) g = Math.min(g, w.s - w.len - v.s);
      }
      return Math.min(g, D + 40);
    };
    const cur = freeAhead(v.seg.lane);
    let best = v.seg.lane;
    let bestGap = cur;
    for (const lane of [v.seg.lane - 1, v.seg.lane + 1]) {
      if (lane < 0 || lane >= link.lanes || (D < EV_TURN_PREP && !allowed.includes(lane))) continue;
      const g = freeAhead(lane);
      if (g > bestGap + 20 || (lane < best && g >= bestGap && g > 60)) {
        best = lane;
        bestGap = g;
      }
    }
    if (best !== v.seg.lane && this.tryChange(v, best, true, 1, 4.0)) {
      this.log(v, 'LANE_CHANGE', { from: v.seg.lane + (best > v.seg.lane ? -1 : 1), to: v.seg.lane, reason: 'clear_lane' });
    }
  }

  private laneChange(v: Vehicle): void {
    if (v.seg.k !== 'L') return;
    // yielding to an emergency vehicle comes before anything else
    if (v.cls !== 'ambulance' && this.yieldToEv(v)) return;
    if (v.mode !== 'drive') return;
    const link = this.net.links[v.seg.id];
    if (link.lanes < 2) return;
    if (v.cls === 'ambulance') {
      const target = v.conn ? this.net.connectors[v.conn].inLane : null;
      if (target === null || target === v.seg.lane || link.length - v.s > EV_TURN_PREP) {
        this.evLaneChoice(v);
        return;
      }
    }
    const D = link.length - v.s;
    const target = v.conn ? this.net.connectors[v.conn].inLane : null;
    let mandatoryDir = 0;
    let reason = '';
    let urgency = 0;
    if (target !== null && target !== v.seg.lane) {
      mandatoryDir = target > v.seg.lane ? 1 : -1;
      reason = 'turn';
      urgency = Math.max(0, Math.min(1, 1 - (D - 25) / 160));
    }
    // closure ahead in my lane: seen (within sight), or known from accepted messages (much earlier)
    const known = this.hooks.knownClosures?.(v) ?? [];
    const physical = this.state.road.closures;
    for (let i = 0; i < physical.length + known.length; i++) {
      const isKnown = i >= physical.length;
      const cl = isKnown ? known[i - physical.length] : physical[i];
      if (cl.link !== link.id || !cl.lanes.includes(v.seg.lane)) continue;
      if (cl.lanes.length >= link.lanes) continue; // a full closure is handled by routing, not merging
      if (!isKnown && physical[i].pass.includes(v.id)) continue;
      const gap = cl.s0 - v.s;
      const range = isKnown ? 420 : PERCEPTION_M;
      if (!isKnown && gap > -v.len && gap < range && !v.noticed.includes(cl.id)) {
        // first sight of cones in its own lane: was it already known from an accepted message?
        v.noticed.push(cl.id);
        if (!known.some((k) => k.link === cl.link && k.lanes.includes(v.seg.lane))) {
          this.state.counters.lateDiscoveries++;
          this.log(v, 'CLOSURE_SEEN', { where: cl.link });
        }
      }
      if (gap > -v.len && gap < range) {
        const left = v.seg.lane - 1;
        const right = v.seg.lane + 1;
        const okL = left >= 0 && !cl.lanes.includes(left);
        const okR = right < link.lanes && !cl.lanes.includes(right);
        mandatoryDir = okR ? 1 : okL ? -1 : 0;
        reason = 'closure';
        urgency = Math.max(0, Math.min(1, 1 - (gap - 10) / 100));
      }
    }
    if (mandatoryDir !== 0) {
      // drivers make room for an ambulance that has to reach its turn lane: accept a firmer merge
      if (this.tryChange(v, v.seg.lane + mandatoryDir, true, urgency, v.cls === 'ambulance' ? 4.5 : undefined)) {
        this.log(v, 'LANE_CHANGE', { from: v.seg.lane - mandatoryDir, to: v.seg.lane, reason });
      }
      return;
    }
    // discretionary: only between lanes that serve the next movement, not in the solid-line zone,
    // and only when moving and actually held up (no queue hopping)
    if (D < 30 || v.v < 4 || v.bind.kind !== 'leader' || v.bind.gap > 45) return;
    const next = v.ri < v.route.length - 1 ? v.route[v.ri + 1] : null;
    const allowed = new Set<number>();
    if (next) for (const c of connectorsBetween(this.net, link.id, next)) allowed.add(this.net.connectors[c].inLane);
    else for (let k = 0; k < link.lanes; k++) allowed.add(k);
    for (const dir of [1, -1]) {
      const nl = v.seg.lane + dir;
      if (nl < 0 || nl >= link.lanes || !allowed.has(nl)) continue;
      if (this.tryChange(v, nl, false, 0)) {
        this.log(v, 'LANE_CHANGE', { from: v.seg.lane - dir, to: v.seg.lane, reason: 'speed' });
        return;
      }
    }
  }

  /** MOBIL safety and incentive test, and the change itself when accepted. */
  tryChange(v: Vehicle, lane: number, mandatory: boolean, urgency: number, bSafeOverride?: number): boolean {
    const link = this.net.links[v.seg.id];
    if (lane < 0 || lane >= link.lanes) return false;
    // never into a lane that is closed ahead within sight, or known to be closed ahead
    for (const cl of this.state.road.closures) {
      if (cl.link === link.id && cl.lanes.includes(lane) && cl.s0 - v.s < PERCEPTION_M && v.s - v.len < cl.s1) return false;
    }
    if (v.connected) {
      for (const cl of this.hooks.knownClosures?.(v) ?? []) {
        if (cl.link === link.id && cl.lanes.includes(lane) && cl.s0 - v.s < 420 && v.s - v.len < cl.s1) return false;
      }
    }
    const list = this.laneList(link.id, lane);
    let ahead: Vehicle | null = null;
    let behind: Vehicle | null = null;
    let behindS = -Infinity;
    for (const id of list) {
      const w = this.veh(id);
      if (w.s > v.s) {
        if (!ahead || w.s < ahead.s) ahead = w;
      } else if (w.s > behindS) {
        behind = w;
        behindS = w.s;
      }
    }
    // vehicles about to arrive from the junction also count as followers
    for (const inc of this.incoming(link.id, lane)) {
      if (inc.s > behindS) {
        behind = inc.v;
        behindS = inc.s;
      }
    }
    const p = v.p;
    const v0 = this.desired(v);
    const bSafe = bSafeOverride ?? (mandatory ? 2.2 + 2.0 * urgency : 2.0);
    const gapA = ahead ? ahead.s - ahead.len - v.s : Infinity;
    const gapB = behind ? v.s - v.len - behindS : Infinity;
    if (gapA < 1.5 || gapB < 1.5) return false;
    const accNew = ahead ? idm(v.v, v0, gapA, v.v - ahead.v, p.a, p.b, p.T, p.s0) : freeAcc(v.v, v0, p.a);
    if (accNew < -bSafe) return false;
    let accB = 0;
    if (behind) {
      const bp = behind.p;
      const bv0 = this.desired(behind);
      accB = idm(behind.v, bv0, gapB, behind.v - v.v, bp.a, bp.b, bp.T, bp.s0);
      if (accB < -bSafe) return false;
    }
    if (!mandatory) {
      const gain = accNew - v.acc + p.polite * Math.min(0, accB - (behind?.acc ?? 0));
      if (gain < 0.6) return false;
    }
    // perform: move to the new lane list in s order; animate the sideways motion
    const old = this.laneList(link.id, v.seg.lane);
    old.splice(old.indexOf(v.id), 1);
    let idx = 0;
    while (idx < list.length && this.veh(list[idx]).s < v.s) idx++;
    list.splice(idx, 0, v.id);
    v.lat += link.laneOffsets[v.seg.lane] - link.laneOffsets[lane];
    v.seg = { k: 'L', id: link.id, lane };
    v.lcHold = 3;
    v.laneChanges++;
    v.committed = false;
    this.planConn(v);
    return true;
  }

  // ------------------------------------------------------------------ step

  /** emergency vehicles currently driving (refreshed every step) */
  private evList: number[] = [];

  step(): void {
    const st = this.state;
    st.t = Math.round((st.t + DT) * 1000) / 1000;
    st.tick++;
    this.spawnDemand();
    this.evList = st.order.filter((id) => st.vehicles[id].cls === 'ambulance' && st.vehicles[id].mode !== 'arrived');

    // 1. accelerations from a consistent snapshot of positions
    const ids = st.order;
    const accs = new Array<number>(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const v = st.vehicles[ids[i]];
      const r = this.accel(v);
      accs[i] = r.acc;
      v.bind = r.bind;
    }

    // 2. integrate
    for (let i = 0; i < ids.length; i++) {
      const v = st.vehicles[ids[i]];
      const a = accs[i];
      let nv = v.v + a * DT;
      let ds: number;
      if (nv < 0) {
        ds = a < 0 ? (-v.v * v.v) / (2 * a) : 0;
        nv = 0;
      } else {
        ds = v.v * DT + 0.5 * a * DT * DT;
      }
      v.acc = a;
      v.v = nv;
      const prevS = v.s;
      v.s += ds;
      v.dist += ds;
      if (st.road.closures.length) this.auditClosures(v, prevS);
      if (nv < STOP_V) {
        v.stopT += DT;
        if (this.recording) v.stopped += DT;
      } else v.stopT = 0;
      if (v.lat !== 0) {
        const step = 1.4 * DT;
        v.lat = Math.abs(v.lat) <= step ? 0 : v.lat - Math.sign(v.lat) * step;
      }
      if (v.lcHold > 0) v.lcHold = Math.max(0, v.lcHold - DT);
    }

    // 3. junction bookkeeping, transitions and exits (fixed order)
    const exited: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const v = st.vehicles[ids[i]];
      if (this.advance(v)) exited.push(v.id);
    }
    if (exited.length) {
      const gone = new Set(exited);
      st.order = st.order.filter((id) => !gone.has(id));
      for (const id of exited) {
        this.hooks.onExit?.(st.vehicles[id]);
        delete st.vehicles[id];
        delete st.linkEnter[id];
      }
    }

    // 4. lane changes, each vehicle every 0.5 s
    for (const id of st.order) {
      const v = st.vehicles[id];
      v.lcT -= DT;
      if (v.lcT <= 0) {
        v.lcT += 0.5;
        if (v.lcHold <= 0) this.laneChange(v);
      }
    }

    this.hooks.afterStep?.();
    if (this.recording && st.tick % 50 === 0) this.sample();
  }

  /** Commitment, junction queues, segment transitions. Returns true when the vehicle left. */
  private advance(v: Vehicle): boolean {
    const st = this.state;
    if (v.seg.k === 'L') {
      const link = this.net.links[v.seg.id];
      const D = link.length - v.s;
      const c = v.conn ? this.net.connectors[v.conn] : null;

      // arrival at a place
      if (v.ri === v.route.length - 1 && Number.isFinite(v.destS) && v.mode === 'drive') {
        if (v.destS - v.s < 1.5 && v.v < 0.5) {
          v.mode = 'arrived';
          this.log(v, 'ARRIVED', { place: v.dest });
        }
      }

      if (c && link.endsAtJunction) {
        const dark = this.isDark(c.junction);
        // decided now, not from the constraint computed at the start of the step: an AV may not
        // cross a dark junction wider than its operating domain without an authorisation
        const outsideOdd =
          dark && v.av && !v.committed && this.net.junctions[c.junction].maxApproachLanes > this.cfg.oddMaxLanes && !(this.hooks.authorized?.(v, c.junction) ?? false);
        // dark junction: join the all-way-stop queue once stopped at the line. Only vehicles that may
        // cross join; a vehicle waiting for assistance would otherwise hold up every conflicting movement.
        if (dark && !outsideOdd && v.mode === 'drive' && v.awscAt < 0 && D < 2.5 && v.v < STOP_V && v.stopT >= 0.8) {
          v.awscAt = st.t;
          (st.awsc[c.junction] ??= []).push({ id: v.id, at: st.t });
          this.log(v, 'AWSC_STOP', { junction: c.junction });
        }
        if (v.mode === 'mrc' && !outsideOdd) {
          // guidance granted or signals working again: leave the minimal risk condition
          v.mode = 'drive';
          this.log(v, 'ASSIST_GRANTED', { junction: c.junction, by: dark ? 'remote_assistance' : 'signals_restored' });
        } else if (v.mode === 'drive' && outsideOdd && v.bind.kind === 'mrc' && D < 60) {
          // stopping for that reason: minimal risk condition, and ask for remote assistance
          v.mode = 'mrc';
          this.log(v, 'MRC', { junction: c.junction, reason: 'odd_uncontrolled_junction', lanes: this.net.junctions[c.junction].maxApproachLanes });
          this.hooks.onMrc?.(v, c.junction);
        }
        // log signal decisions once per approach
        const stopping = v.bind.kind === 'signal';
        const gateKey = `${c.junction}:${stopping ? 'stop' : 'go'}`;
        if (D < 40 && v.lastGate !== gateKey && (stopping || v.lastGate.endsWith('stop'))) {
          v.lastGate = gateKey;
          this.log(v, stopping ? 'STOP_SIGNAL' : 'GO_SIGNAL', { junction: c.junction });
        }
        // commitment: moving and too close to stop comfortably. A vehicle at rest is never committed;
        // it can always stay where it is if the situation changes before it moves off.
        if (!v.committed && v.mode === 'drive') {
          const stopDist = (v.v * v.v) / (2 * v.p.b) + 1.5;
          if (D < stopDist && v.v > 1 && this.gate(v, c, D) === null) {
            v.committed = true;
            const sig = dark ? null : aspectFor(this.net.junctions[c.junction], this.signal(c.junction), link.id, c.turn);
            if (sig === 'A') this.log(v, 'AMBER_COMMIT', { junction: c.junction });
          }
        }
      }

      // a barrier across the next segment comes into view: re-plan around it
      if (c && D < PERCEPTION_M && v.mode === 'drive' && this.fullyClosed(c.outLink, v) && !v.blocked.includes(c.outLink)) {
        const knew = (this.hooks.knownClosures?.(v) ?? []).some((k) => k.link === c.outLink);
        v.blocked.push(c.outLink);
        if (!knew) st.counters.lateDiscoveries++;
        this.log(v, 'CLOSURE_SEEN', { where: c.outLink });
        if (!this.plan(v, 'closure_seen')) this.log(v, 'NO_ALTERNATIVE', { reason: 'closure_seen' });
      }

      // missed lane for the planned turn: take any movement from this lane and re-plan. An ambulance
      // does not: it holds at the line until it can reach its lane rather than drive a long detour.
      if (c && c.inLane !== v.seg.lane && D < 18 && v.mode === 'drive' && v.cls !== 'ambulance') {
        // never a movement into a segment that is closed, or that the vehicle knows is about to close
        const avoid = this.routeOptions(v).avoidLinks;
        const options = (this.net.fromLane[`${link.id}#${v.seg.lane}`] ?? []).filter((x) => {
          const out = this.net.connectors[x].outLink;
          return !this.fullyClosed(out, v) && !avoid?.has(out);
        });
        const pick =
          options.find((x) => this.net.connectors[x].turn === 'S') ??
          options.find((x) => this.net.connectors[x].turn === 'R') ??
          options[0];
        if (pick) {
          const cc = this.net.connectors[pick];
          this.log(v, 'MISSED_TURN', { wanted: c.outLink, took: cc.outLink });
          // route: current link, then the forced link, then the cheapest path from there
          const rest = planRoute(this.net, cc.outLink, this.destLink(v.dest).link, this.routeOptions(v));
          if (rest) {
            v.route = [link.id, ...rest];
            v.ri = 0;
            v.reroutes++;
          }
          v.conn = pick;
        }
      }

      if (v.s >= link.length) {
        if (!link.endsAtJunction) {
          // left the district
          this.recordTrip(v);
          return true;
        }
        if (!v.conn) {
          v.s = link.length - 0.01;
          v.v = 0;
          return false;
        }
        const cc = this.net.connectors[v.conn];
        if (cc.inLane !== v.seg.lane) {
          v.s = link.length - 0.01;
          v.v = 0;
          return false;
        }
        if (!v.committed) {
          const g = this.gate(v, cc, 0);
          if (g) {
            // physically could not stop in time for a change it was not committed to: hold at the line
            if (v.v > 1) {
              st.counters.hardBrakes++;
              this.event('hard-brake', 'warn', v.tag, { reason: g.kind, junction: cc.junction, speed: Math.round(v.v * 10) / 10 });
            }
            v.s = link.length - 0.01;
            v.v = 0;
            return false;
          }
        }
        // safety layer: never enter while a conflicting movement occupies the box (for example two
        // vehicles reaching their lines in the same step); hold at the line instead and count it
        if (cc.conflicts.some((x) => st.conns[x].length > 0)) {
          if (v.v > 1) {
            st.counters.hardBrakes++;
            this.event('hard-brake', 'warn', v.tag, { reason: 'box-at-entry', junction: cc.junction, speed: Math.round(v.v * 10) / 10 });
          }
          v.s = link.length - 0.01;
          v.v = 0;
          return false;
        }
        const lane = this.laneList(link.id, v.seg.lane);
        lane.splice(lane.indexOf(v.id), 1);
        this.observeLink(v, link.id, cc.outLink);
        v.prev = v.seg;
        v.prevLen = link.length;
        v.s -= link.length;
        v.seg = { k: 'C', id: cc.id, lane: cc.outLane };
        st.conns[cc.id].unshift(v.id);
        v.committed = false;
        v.lastGate = '';
        if (v.awscAt >= 0) {
          const q = st.awsc[cc.junction];
          if (q) q.splice(q.findIndex((e) => e.id === v.id), 1);
          v.awscAt = -1;
          this.log(v, 'AWSC_GO', { junction: cc.junction });
        }
        if (v.mode === 'mrc') v.mode = 'drive';
      }
      return false;
    }

    // on a connector
    const c = this.net.connectors[v.seg.id];
    if (v.s >= c.length) {
      const occ = st.conns[c.id];
      occ.splice(occ.indexOf(v.id), 1);
      v.prev = v.seg;
      v.prevLen = c.length;
      v.s -= c.length;
      v.seg = { k: 'L', id: c.outLink, lane: c.outLane };
      this.insertSorted(this.laneList(c.outLink, c.outLane), v);
      st.linkEnter[v.id] = st.t;
      // advance along the route
      const at = v.route.indexOf(c.outLink, v.ri);
      if (at >= 0) v.ri = at;
      else this.plan(v, 'off_route');
      this.planConn(v);
    }
    return false;
  }

  private observeLink(v: Vehicle, link: string, next: string): void {
    const st = this.state;
    const t0 = st.linkEnter[v.id];
    if (t0 === undefined) return;
    const tt = st.t - t0;
    const prev = st.linkTT[link];
    st.linkTT[link] = prev === undefined ? tt : prev * 0.8 + tt * 0.2;
    if (v.cls === 'ambulance') return;
    // movement delay: time on the link beyond driving it freely, attributed to the movement taken
    const l = this.net.links[link];
    const d = Math.max(0, tt - l.length / (l.speed * 0.95));
    const key = `${link}>${next}`;
    const pd = st.moveDelay[key];
    st.moveDelay[key] = pd === undefined ? d : pd * 0.85 + d * 0.15;
  }

  /** Audit: did this vehicle just move into a closed lane extent? (Should never happen.) */
  private auditClosures(v: Vehicle, prevS: number): void {
    if (v.seg.k !== 'L') return;
    for (const cl of this.state.road.closures) {
      if (cl.link !== v.seg.id || !cl.lanes.includes(v.seg.lane) || cl.pass.includes(v.id)) continue;
      if (prevS < cl.s0 && v.s >= cl.s0 && cl.since < this.state.t - 0.05) {
        this.state.counters.restrictedEntries++;
        this.event('restricted-entry', 'critical', v.tag, { link: cl.link, lane: v.seg.lane });
      }
    }
  }

  private recordTrip(v: Vehicle): void {
    const st = this.state;
    const lane = this.laneList(v.seg.id, v.seg.lane);
    const i = lane.indexOf(v.id);
    if (i >= 0) lane.splice(i, 1);
    if (!this.recording) return;
    const travel = st.t - v.spawnT;
    st.trips.push({
      id: v.id,
      cls: v.cls,
      av: v.av,
      t0: v.spawnT,
      t1: st.t,
      ffT: v.ffT,
      dist: v.dist,
      stopped: v.stopped,
      reroutes: v.reroutes,
    });
    st.counters.exits++;
    st.counters.delay += Math.max(0, travel - v.ffT);
    this.log(v, 'EXITED', { at: v.dest });
  }

  sample(): void {
    const st = this.state;
    let stopped = 0;
    let sum = 0;
    for (const id of st.order) {
      const v = st.vehicles[id];
      sum += v.v;
      if (v.v < STOP_V) stopped++;
    }
    st.series.push({
      t: st.t,
      active: st.order.length,
      stopped,
      meanSpeed: st.order.length ? sum / st.order.length : 0,
      exits: st.counters.exits,
      delay: st.counters.delay,
    });
  }

  /** Vehicles currently on a link (all lanes), front first. */
  vehiclesOnLink(link: string): Vehicle[] {
    const l: LinkDef = this.net.links[link];
    const out: Vehicle[] = [];
    for (let k = 0; k < l.lanes; k++) for (const id of this.laneList(link, k)) out.push(this.veh(id));
    return out.sort((a, b) => b.s - a.s);
  }
}
