import type { Engine } from '../sim/engine';
import type { Vehicle } from '../sim/types';
import { DT, DARK_JUNCTION_PENALTY } from '../sim/params';
import { planRoute, junctionsOf, type RouteOptions } from '../sim/router';
import { connectorPose, lanePose } from '../network/geometry';
import { makeRng, rand, randRange } from '../rng';
import { digestHex, sign, signedBytes } from './crypto';
import { issuerKey } from './trust';
import { bodyDigest, validate, type ValidationCtx } from './validate';
import type {
  Delivery,
  DmParams,
  DmState,
  ExceptionRecord,
  Incident,
  MessageArea,
  MessageBody,
  MessageType,
  SignedMessage,
  VehicleKnowledge,
} from './types';

/* The Digital Marshal coordination layer, attached to a simulation engine.

   Logical services (all state lives in engine.state.dm, so it is part of every snapshot):
   - incident management: detection, versions, resolution
   - V2X message service: signing, geocast over roadside units or cellular, loss, latency, repetition
   - trust and validation: every receiver validates every message (validate.ts)
   - vehicle adapter: accepted messages become planning constraints; final authority stays on board
   - exception coordination: the fleet's remote-assistance requests, FIFO or coordinated
   Policies (identical traffic, seeds and vehicle capabilities):
   A  no shared city information; AVs discover problems with their own sensors; assistance FIFO
   B  validated incident broadcast; each AV responds independently; assistance FIFO
   C  B plus fleet coordination: grouped, prioritised assistance with junction-scoped authorisations,
      and capacity-aware detour advice */

export const DEFAULT_DM: DmParams = {
  policy: 'C',
  detectionDelay: 4,
  operators: 2,
  handleIndividual: 40,
  handleGroupBase: 50,
  handleGroupPer: 4,
  rsuLatency: [20, 90],
  cellLatency: [350, 900],
  rsuLoss: 0.01,
  cellLoss: 0.03,
  repeatEvery: 2,
  rsuBattery: false,
  cellular: true,
  extraLatencyMs: 0,
  extraLoss: 0,
  rsuDown: [],
};

const REFRESH_EVERY = 60;
const ADVICE_EVERY = 20;
const AUTH_VALID = 1800;

export function initDmState(params: DmParams, seed: number): DmState {
  return {
    params: { ...params, rsuDown: [...params.rsuDown] },
    nextIncident: 1,
    nextException: 1,
    nextTask: 1,
    incidents: {},
    messages: {},
    verdicts: {},
    inbox: [],
    lastBroadcast: {},
    knowledge: {},
    exceptions: {},
    tasks: {},
    operators: Array.from({ length: params.operators }, () => ({ busyUntil: 0, task: null })),
    junctionAuth: {},
    pending: [],
    pulses: [],
    stats: {
      published: 0,
      delivered: 0,
      lost: 0,
      rejected: 0,
      flagged: 0,
      latencySum: 0,
      latencyN: 0,
      exceptionsRaised: 0,
      exceptionsResolved: 0,
      autoResolved: 0,
      mrcVehicleSeconds: 0,
      operatorBusy: 0,
      reroutes: 0,
    },
    rng: makeRng(seed, 'radio'),
    pendingKeys: {},
    lastAdvice: -Infinity,
    lastRefresh: {},
    reach: {},
  };
}

export class DigitalMarshal {
  readonly engine: Engine;

  constructor(engine: Engine, params: Partial<DmParams> = {}) {
    this.engine = engine;
    if (!engine.state.dm) engine.state.dm = initDmState({ ...DEFAULT_DM, ...params }, engine.state.seed);
    const prevAfter = engine.hooks.afterStep;
    engine.hooks.routeOptions = (v) => this.routeOptions(v);
    engine.hooks.authorized = (v, j) => this.authorized(v, j);
    engine.hooks.onMrc = (v, j) => this.onMrc(v, j);
    engine.hooks.onExit = (v) => this.onExit(v);
    engine.hooks.afterStep = () => {
      prevAfter?.();
      this.tick();
    };
  }

  get s(): DmState {
    return this.engine.state.dm as DmState;
  }

  get now(): number {
    return this.engine.state.t;
  }

  get policy() {
    return this.s.params.policy;
  }

  // ================================================================== physical events (scenario triggers)

  /** Signal controllers at these junctions lose power. Their signals go dark at once. */
  blackout(junctions: string[]): void {
    const road = this.engine.state.road;
    const added = junctions.filter((j) => !road.dark.includes(j));
    if (!added.length) return;
    road.dark.push(...added);
    road.dark.sort();
    this.engine.event('power-loss', 'critical', added.join(' '), { junctions: added.join(', ') });
    this.s.pending.push({ at: this.now + this.s.params.detectionDelay, kind: 'detect_outage', params: { junctions: added } });
  }

  /** Power returns: signals restart, all-way-stop queues dissolve. */
  restore(junctions: string[]): void {
    const st = this.engine.state;
    const removed = junctions.filter((j) => st.road.dark.includes(j));
    if (!removed.length) return;
    st.road.dark = st.road.dark.filter((j) => !removed.includes(j));
    for (const j of removed) {
      const q = st.awsc[j] ?? [];
      for (const e of q) {
        const v = st.vehicles[e.id];
        if (v) v.awscAt = -1;
      }
      delete st.awsc[j];
    }
    this.engine.event('power-restored', 'ok', removed.join(' '), { junctions: removed.join(', ') });
    this.s.pending.push({ at: this.now + this.s.params.detectionDelay, kind: 'detect_restore', params: { junctions: removed } });
  }

  // ================================================================== incident management

  private newIncident(type: Incident['type'], area: MessageArea, title: string, cause: string): Incident {
    const s = this.s;
    const id = `INC-${String(s.nextIncident++).padStart(4, '0')}`;
    const inc: Incident = {
      id,
      type,
      status: 'active',
      createdAt: this.now,
      updatedAt: this.now,
      resolvedAt: null,
      version: 1,
      area,
      issuer: 'DM-TMC',
      messages: [],
      title,
      cause,
    };
    s.incidents[id] = inc;
    return inc;
  }

  activeIncident(type: Incident['type'], junction?: string): Incident | null {
    for (const id of Object.keys(this.s.incidents)) {
      const inc = this.s.incidents[id];
      if (inc.type === type && inc.status === 'active' && (!junction || inc.area.junctions?.includes(junction))) return inc;
    }
    return null;
  }

  // ================================================================== messages

  /** Sign and record a message. Delivery depends on the policy and is done by `broadcast`. */
  private makeMessage(
    issuer: string,
    inc: { id: string; version: number },
    type: MessageType,
    area: MessageArea,
    detail: MessageBody['detail'],
    text: string,
    severity: number,
    validFor: number,
  ): SignedMessage {
    const t = this.now;
    const header = {
      msgId: '',
      incidentId: inc.id,
      version: inc.version,
      issuer,
      issuedAt: t,
      validFrom: t,
      validUntil: t + validFor,
      mapVersion: this.engine.net.version,
    };
    const body: MessageBody = { type, severity, area, detail, text };
    header.msgId = `M-${digestHex(signedBytes(header, body)).slice(0, 10)}`;
    const key = issuerKey(issuer);
    const msg: SignedMessage = {
      header,
      body,
      sig: { alg: 'ECDSA-P256-SHA256', keyId: key.keyId, value: sign(signedBytes(header, body), key) },
      origin: 'published',
    };
    return msg;
  }

  private publish(inc: Incident, type: MessageType, detail: MessageBody['detail'], text: string, severity: number, validFor = 3600): SignedMessage {
    const msg = this.makeMessage('DM-TMC', inc, type, inc.area, detail, text, severity, validFor);
    const s = this.s;
    s.messages[msg.header.msgId] = msg;
    s.verdicts[msg.header.msgId] = { status: 'accepted', code: 'ACCEPTED', checks: [{ name: 'Origin', pass: true, detail: 'Issued by this coordination node' }] };
    inc.messages.push(msg.header.msgId);
    s.stats.published++;
    s.lastRefresh[inc.id] = this.now;
    this.engine.event('msg-published', 'info', msg.header.msgId, { type, incident: inc.id, version: inc.version, policy: this.policy });
    if (this.policy !== 'A') this.broadcast(msg);
    return msg;
  }

  /** Put a message on the channel to every connected vehicle that does not have it yet. */
  broadcast(msg: SignedMessage, only?: number[]): void {
    const st = this.engine.state;
    const s = this.s;
    s.lastBroadcast[msg.header.msgId] = this.now;
    const keys = s.pendingKeys;
    const ids = only ?? st.order;
    let rsuUsed = false;
    for (const id of ids) {
      const v = st.vehicles[id];
      if (!v || !v.connected) continue;
      const k = this.know(v.id);
      if (k.rx[msg.header.msgId] || keys[`${v.id}|${msg.header.msgId}`]) continue;
      const d = this.route(v, msg.header.msgId);
      if (!d) continue;
      if (d.path === 'rsu') rsuUsed = true;
      keys[`${v.id}|${msg.header.msgId}`] = true;
      // keep the inbox sorted by arrival time
      let i = s.inbox.length;
      while (i > 0 && s.inbox[i - 1].at > d.at) i--;
      s.inbox.splice(i, 0, d);
    }
    if (rsuUsed || msg.origin === 'published') {
      for (const jid of this.engine.net.junctionIds) {
        if (!this.rsuUp(jid)) continue;
        const r = this.engine.net.junctions[jid].rsu;
        s.pulses.push({ t: this.now, kind: msg.origin === 'injected' ? 'reject' : msg.body.type === 'ASSISTANCE_AUTHORIZATION' ? 'authorize' : 'rsu', x: r.x, y: r.y, ref: msg.header.msgId });
      }
      if (s.pulses.length > 400) s.pulses.splice(0, s.pulses.length - 400);
    }
  }

  rsuUp(junction: string): boolean {
    const p = this.s.params;
    if (p.rsuDown.includes(junction)) return false;
    if (!p.rsuBattery && this.engine.state.road.dark.includes(junction)) return false;
    return true;
  }

  /** Choose the radio path for one delivery and draw loss and latency. Null when the message is lost. */
  private route(v: Vehicle, msgId: string): Delivery | null {
    const s = this.s;
    const p = s.params;
    const pos = this.position(v);
    let best: string | null = null;
    let bd = Infinity;
    for (const jid of this.engine.net.junctionIds) {
      if (!this.rsuUp(jid)) continue;
      const r = this.engine.net.junctions[jid].rsu;
      const d = Math.hypot(pos.x - r.x, pos.y - r.y);
      if (d <= r.range && d < bd) {
        bd = d;
        best = jid;
      }
    }
    const path: 'rsu' | 'cell' | null = best ? 'rsu' : p.cellular ? 'cell' : null;
    if (!path) return null;
    const loss = (path === 'rsu' ? p.rsuLoss : p.cellLoss) + p.extraLoss;
    if (rand(s.rng) < loss) {
      s.stats.lost++;
      return null;
    }
    const [lo, hi] = path === 'rsu' ? p.rsuLatency : p.cellLatency;
    const ms = randRange(s.rng, lo, hi) + p.extraLatencyMs;
    // deliveries happen at step boundaries
    const at = Math.ceil((this.now + ms / 1000) / DT) * DT;
    return { msgId, veh: v.id, at: Math.round(at * 1000) / 1000, path, rsu: best ?? undefined };
  }

  position(v: Vehicle): { x: number; y: number } {
    const net = this.engine.net;
    return v.seg.k === 'L' ? lanePose(net.links[v.seg.id], v.seg.lane, v.s) : connectorPose(net.connectors[v.seg.id], v.s);
  }

  /** Inject a message onto the channel (security demonstration). It is delivered like any other and validated by every receiver. */
  inject(msg: SignedMessage): void {
    const s = this.s;
    msg.origin = 'injected';
    s.messages[msg.header.msgId] = msg;
    // the coordination node validates it too, as if it had been submitted to it
    const v = validate(msg, this.ctxFor(null));
    s.verdicts[msg.header.msgId] = v;
    this.engine.event(v.status === 'accepted' ? 'inject-accepted' : 'inject-rejected', v.status === 'accepted' ? 'warn' : 'info', msg.header.msgId, {
      code: v.code,
      type: msg.body.type,
      issuer: msg.header.issuer,
    });
    // rogue broadcasters bypass the node: put it on the air regardless, so vehicle-side checks are exercised
    this.broadcast(msg);
  }

  // ================================================================== vehicle adapter

  know(id: number): VehicleKnowledge {
    const s = this.s;
    return (s.knowledge[id] ??= { rx: {}, incidents: {}, authorizations: {}, advice: null });
  }

  private ctxFor(v: Vehicle | null): ValidationCtx {
    const k = v ? this.know(v.id) : null;
    const s = this.s;
    return {
      now: this.now,
      net: this.engine.net,
      seen: (msgId) => (k ? !!k.rx[msgId] : false),
      current: (incidentId) => {
        if (k) {
          const e = k.incidents[incidentId];
          return e ? { version: e.version, bodyDigest: bodyDigest(s.messages[e.msgId]) } : null;
        }
        const inc = s.incidents[incidentId];
        if (!inc || !inc.messages.length) return null;
        const last = s.messages[inc.messages[inc.messages.length - 1]];
        return { version: last.header.version, bodyDigest: bodyDigest(last) };
      },
    };
  }

  private receive(d: Delivery): void {
    const st = this.engine.state;
    const s = this.s;
    delete s.pendingKeys[`${d.veh}|${d.msgId}`];
    const v = st.vehicles[d.veh];
    const msg = s.messages[d.msgId];
    if (!v || !msg) return;
    const k = this.know(v.id);
    const verdict = validate(msg, this.ctxFor(v));
    const latency = this.now - msg.header.issuedAt;
    k.rx[d.msgId] = { at: this.now, latency, path: d.path, status: verdict.status, code: verdict.code };
    s.stats.delivered++;
    if (verdict.status === 'duplicate') return;
    const reach = (s.reach[msg.header.incidentId] ??= { received: {}, accepted: {}, rejected: {} });
    reach.received[v.id] = true;
    if (verdict.status === 'accepted') reach.accepted[v.id] = true;
    else reach.rejected[v.id] = true;
    if (msg.origin === 'published') {
      s.stats.latencySum += Math.max(0, this.now - (s.lastBroadcast[d.msgId] ?? msg.header.issuedAt));
      s.stats.latencyN++;
    }
    if (verdict.status === 'rejected') {
      s.stats.rejected++;
      this.engine.log(v, 'MSG_REJECT', { msg: d.msgId, reason: verdict.code });
      return;
    }
    if (verdict.status === 'flagged') {
      s.stats.flagged++;
      this.engine.log(v, 'MSG_REJECT', { msg: d.msgId, reason: verdict.code });
      const e = k.incidents[msg.header.incidentId];
      if (e) e.flagged = true;
      return;
    }
    this.apply(v, msg, k);
  }

  private apply(v: Vehicle, msg: SignedMessage, k: VehicleKnowledge): void {
    const h = msg.header;
    const b = msg.body;
    switch (b.type) {
      case 'SIGNAL_OUTAGE':
      case 'ROAD_RESTRICTION':
      case 'EMERGENCY_CORRIDOR': {
        const prev = k.incidents[h.incidentId];
        k.incidents[h.incidentId] = { version: h.version, msgId: h.msgId, type: b.type, acceptedAt: this.now, active: true, flagged: false };
        if (!prev || prev.version !== h.version || !prev.active) {
          this.engine.log(v, 'MSG_RX', { msg: h.msgId, type: b.type, incident: h.incidentId, version: h.version });
          this.replan(v, b.type === 'SIGNAL_OUTAGE' ? 'signal_outage' : b.type === 'ROAD_RESTRICTION' ? 'restriction' : 'corridor');
        }
        break;
      }
      case 'SIGNAL_RESTORED':
      case 'RESTRICTION_LIFTED':
      case 'CORRIDOR_CLEARED': {
        const prev = k.incidents[h.incidentId];
        k.incidents[h.incidentId] = { version: h.version, msgId: h.msgId, type: b.type, acceptedAt: this.now, active: false, flagged: false };
        if (prev?.active) {
          this.engine.log(v, 'MSG_RX', { msg: h.msgId, type: b.type, incident: h.incidentId, version: h.version });
          this.replan(v, 'restriction_lifted');
        }
        break;
      }
      case 'ASSISTANCE_AUTHORIZATION': {
        if (!v.av) break;
        const j = String(b.detail.junction);
        k.authorizations[j] = { incidentId: h.incidentId, until: h.validUntil, msgId: h.msgId, scope: 'junction' };
        this.engine.log(v, 'MSG_RX', { msg: h.msgId, type: b.type, incident: h.incidentId, version: h.version });
        break;
      }
      case 'ROUTE_ADVISORY': {
        const mine = ((b.detail.assignments as string[]) ?? []).find((e) => e.startsWith(`${v.tag}|`));
        if (!mine) break;
        const route = mine.split('|')[1].split(' ');
        k.advice = { msgId: h.msgId, route, at: this.now };
        this.adoptAdvice(v, route, h.msgId);
        break;
      }
    }
  }

  /** The vehicle re-plans with what it now knows; if nothing feasible exists it keeps its route. */
  private replan(v: Vehicle, reason: string): void {
    const before = v.route.join('|');
    const ok = this.engine.plan(v, reason);
    if (!ok) {
      this.engine.log(v, 'NO_ALTERNATIVE', { reason });
    } else if (v.route.join('|') !== before) {
      this.s.stats.reroutes++;
    }
  }

  /** Coordinated advice is adopted only if it is consistent with the vehicle's own constraints. */
  private adoptAdvice(v: Vehicle, route: string[], msgId: string): void {
    const cur = v.seg.k === 'L' ? v.seg.id : this.engine.net.connectors[v.seg.id].outLink;
    const at = route.indexOf(cur);
    if (at < 0) return; // the vehicle has already moved past the advised start
    const suffix = route.slice(at);
    const opts = this.routeOptions(v);
    const blocked = junctionsOf(this.engine.net, suffix).some((j) => opts.avoidJunctions?.has(j));
    const dest = this.engine.destLink(v.dest).link;
    if (blocked || suffix[suffix.length - 1] !== dest) return;
    if (suffix.join('|') === v.route.slice(v.route.indexOf(cur)).join('|')) return;
    v.route = suffix;
    v.ri = 0;
    v.reroutes++;
    this.s.stats.reroutes++;
    this.engine.planConn(v);
    this.engine.log(v, 'ADVICE', { msg: msgId, via: suffix.slice(1, 4).map((x) => this.engine.net.links[x].to).join(' ') });
  }

  /** Planning constraints from accepted messages (the vehicle's knowledge, not ground truth). */
  routeOptions(v: Vehicle): RouteOptions {
    if (!v.connected) return {};
    const k = this.s.knowledge[v.id];
    if (!k) return {};
    const avoid = new Set<string>();
    const pen = new Map<string, number>();
    const odd = this.engine.cfg.oddMaxLanes;
    for (const incId of Object.keys(k.incidents)) {
      const e = k.incidents[incId];
      if (!e.active || e.type !== 'SIGNAL_OUTAGE') continue;
      const msg = this.s.messages[e.msgId];
      for (const j of msg?.body.area.junctions ?? []) {
        if (v.av && this.engine.net.junctions[j].maxApproachLanes > odd && !this.authorized(v, j)) avoid.add(j);
        else pen.set(j, (pen.get(j) ?? 0) + DARK_JUNCTION_PENALTY);
      }
    }
    return { avoidJunctions: avoid, junctionPenalty: pen };
  }

  authorized(v: Vehicle, junction: string): boolean {
    const k = this.s.knowledge[v.id];
    const a = k?.authorizations[junction];
    return !!a && a.until > this.now;
  }

  // ================================================================== exceptions and remote assistance

  private onMrc(v: Vehicle, junction: string): void {
    const s = this.s;
    // which incident does the vehicle associate this with? (needs shared information: B and C)
    const k = s.knowledge[v.id];
    let incidentId: string | null = null;
    if (k && this.policy !== 'A') {
      for (const id of Object.keys(k.incidents)) {
        const e = k.incidents[id];
        if (e.active && e.type === 'SIGNAL_OUTAGE' && s.messages[e.msgId]?.body.area.junctions?.includes(junction)) incidentId = id;
      }
    }
    const ex: ExceptionRecord = {
      id: `EX-${String(s.nextException++).padStart(4, '0')}`,
      veh: v.id,
      tag: v.tag,
      type: 'ODD_EXIT_DARK_JUNCTION',
      junction,
      incidentId,
      raisedAt: this.now,
      status: 'open',
      resolvedAt: null,
      resolution: '',
      task: null,
      obstructing: true,
      emergencyRoute: false,
    };
    s.exceptions[ex.id] = ex;
    s.stats.exceptionsRaised++;
    this.engine.log(v, 'ASSIST_REQUEST', { exception: ex.id, junction });
    this.engine.event('assist-request', 'warn', v.tag, { exception: ex.id, junction });
    // coordinated: a junction authorisation for this incident already exists -> resolve at once
    if (this.policy === 'C' && incidentId) {
      const ja = s.junctionAuth[junction];
      if (ja && ja.incidentId === incidentId) {
        this.grant(v, junction, incidentId, 'junction', ja.msgId);
        ex.status = 'auto_resolved';
        ex.resolvedAt = this.now;
        ex.resolution = `Covered by junction authorisation ${ja.msgId}`;
        s.stats.autoResolved++;
        s.stats.exceptionsResolved++;
      }
    }
  }

  private grant(v: Vehicle, junction: string, incidentId: string | null, scope: 'vehicle' | 'junction', msgId: string | null): void {
    const k = this.know(v.id);
    k.authorizations[junction] = { incidentId: incidentId ?? '', until: this.now + AUTH_VALID, msgId, scope };
  }

  /** Pick the next task for a free operator. FIFO for A and B; grouped WSPT for C. */
  private nextTask(): { exceptions: ExceptionRecord[]; kind: 'individual' | 'group'; junction: string; incidentId: string | null; priority: number; rationale: string } | null {
    const s = this.s;
    const open = Object.values(s.exceptions).filter((e) => e.status === 'open');
    if (!open.length) return null;
    const p = s.params;
    if (this.policy !== 'C') {
      open.sort((a, b) => a.raisedAt - b.raisedAt || (a.id < b.id ? -1 : 1));
      const e = open[0];
      return { exceptions: [e], kind: 'individual', junction: e.junction, incidentId: e.incidentId, priority: 0, rationale: 'First come, first served' };
    }
    // group by shared incident, location and type (only possible when the incident identity is shared)
    const groups = new Map<string, ExceptionRecord[]>();
    for (const e of open) {
      const key = e.incidentId ? `${e.incidentId}|${e.junction}|${e.type}` : `solo|${e.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    // weighted shortest processing time: weight / processing time, emergency routes first
    let best: { key: string; score: number; w: number; P: number; earliest: number } | null = null;
    for (const [key, list] of groups) {
      let w = 0;
      let earliest = Infinity;
      let emergency = false;
      for (const e of list) {
        w += 1 + (e.obstructing ? 1 : 0) + (e.emergencyRoute ? 3 : 0);
        earliest = Math.min(earliest, e.raisedAt);
        emergency ||= e.emergencyRoute;
      }
      const P = list.length > 1 || !key.startsWith('solo') ? p.handleGroupBase + p.handleGroupPer * list.length : p.handleIndividual;
      const score = (emergency ? 1000 : 0) + w / P;
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && earliest < best.earliest)) {
        best = { key, score, w, P, earliest };
      }
    }
    const list = groups.get(best!.key)!;
    const solo = best!.key.startsWith('solo');
    return {
      exceptions: list,
      kind: solo ? 'individual' : 'group',
      junction: list[0].junction,
      incidentId: list[0].incidentId,
      priority: best!.score,
      rationale: solo
        ? 'No shared incident identity: handled individually'
        : `${list.length} request(s) share ${list[0].incidentId} at ${list[0].junction}; weight ${best!.w.toFixed(0)} / ${best!.P.toFixed(0)} s = ${best!.score.toFixed(3)}`,
    };
  }

  private runAssistance(): void {
    const s = this.s;
    const p = s.params;
    const now = this.now;
    for (let i = 0; i < s.operators.length; i++) {
      const op = s.operators[i];
      if (op.task) {
        s.stats.operatorBusy += DT;
        const task = s.tasks[op.task];
        if (now >= task.doneAt - 1e-9) {
          this.completeTask(task);
          op.task = null;
        }
      }
    }
    for (let i = 0; i < s.operators.length; i++) {
      const op = s.operators[i];
      if (op.task) continue;
      const next = this.nextTask();
      if (!next) break;
      const id = `RA-${String(s.nextTask++).padStart(4, '0')}`;
      const duration = next.kind === 'group' ? p.handleGroupBase + p.handleGroupPer * next.exceptions.length : p.handleIndividual;
      s.tasks[id] = {
        id,
        operator: i,
        kind: next.kind,
        exceptions: next.exceptions.map((e) => e.id),
        junction: next.junction,
        incidentId: next.incidentId,
        startedAt: now,
        doneAt: now + duration,
        priority: next.priority,
        rationale: next.rationale,
      };
      for (const e of next.exceptions) {
        e.status = 'in_progress';
        e.task = id;
      }
      op.task = id;
      this.engine.event('assist-task', 'info', id, { operator: i + 1, kind: next.kind, n: next.exceptions.length, junction: next.junction });
    }
  }

  private completeTask(task: { id: string; kind: string; exceptions: string[]; junction: string; incidentId: string | null }): void {
    const s = this.s;
    const st = this.engine.state;
    if (task.kind === 'group' && task.incidentId) {
      // one decision for the whole location under this incident, published to the fleet
      const inc = s.incidents[task.incidentId];
      const auth = this.makeMessage(
        'FLEET-RA',
        { id: task.incidentId, version: 1 },
        'ASSISTANCE_AUTHORIZATION',
        { junctions: [task.junction] },
        { junction: task.junction, protocol: 'all_way_stop', scope: 'fleet' },
        `Fleet AVs may cross ${task.junction} under all-way-stop rules while ${task.incidentId} is active; onboard safety checks still apply`,
        3,
        AUTH_VALID,
      );
      s.messages[auth.header.msgId] = auth;
      s.verdicts[auth.header.msgId] = { status: 'accepted', code: 'ACCEPTED', checks: [] };
      inc?.messages.push(auth.header.msgId);
      s.junctionAuth[task.junction] = { incidentId: task.incidentId, msgId: auth.header.msgId, at: this.now };
      for (const exId of task.exceptions) {
        const e = s.exceptions[exId];
        const v = st.vehicles[e.veh];
        if (v) this.grant(v, task.junction, task.incidentId, 'junction', auth.header.msgId);
        if (e.status === 'in_progress') {
          e.status = 'resolved';
          e.resolvedAt = this.now;
          e.resolution = `Junction authorisation ${auth.header.msgId}`;
          s.stats.exceptionsResolved++;
        }
      }
      // waiting requests at the same junction for the same incident are covered too
      for (const e of Object.values(s.exceptions)) {
        if (e.status === 'open' && e.junction === task.junction && e.incidentId === task.incidentId) {
          const v = st.vehicles[e.veh];
          if (v) this.grant(v, task.junction, task.incidentId, 'junction', auth.header.msgId);
          e.status = 'auto_resolved';
          e.resolvedAt = this.now;
          e.resolution = `Covered by junction authorisation ${auth.header.msgId}`;
          s.stats.autoResolved++;
          s.stats.exceptionsResolved++;
        }
      }
      this.broadcast(auth);
      this.engine.event('junction-authorized', 'ok', task.junction, { incident: task.incidentId, msg: auth.header.msgId, n: task.exceptions.length });
    } else {
      for (const exId of task.exceptions) {
        const e = s.exceptions[exId];
        const v = st.vehicles[e.veh];
        if (v) this.grant(v, e.junction, e.incidentId, 'vehicle', null);
        if (e.status === 'in_progress') {
          e.status = 'resolved';
          e.resolvedAt = this.now;
          e.resolution = 'Individual authorisation by an operator';
          s.stats.exceptionsResolved++;
        }
      }
      this.engine.event('assist-granted', 'ok', task.exceptions.join(' '), { junction: task.junction, n: task.exceptions.length });
    }
  }

  /** Requests that no longer need an operator (vehicle moved on or left) are withdrawn. */
  private reviewExceptions(): void {
    const s = this.s;
    const st = this.engine.state;
    for (const id of Object.keys(s.exceptions)) {
      const e = s.exceptions[id];
      if (e.status !== 'open') continue;
      const v = st.vehicles[e.veh];
      if (!v || v.mode !== 'mrc') {
        e.status = 'withdrawn';
        e.resolvedAt = this.now;
        e.resolution = !v ? 'Vehicle left the district' : st.road.dark.includes(e.junction) ? 'Released' : 'Signals restored before an operator was free';
      }
    }
  }

  private onExit(v: Vehicle): void {
    delete this.s.knowledge[v.id];
  }

  // ================================================================== coordinated detours (policy C)

  /**
   * Capacity-aware detour allocation. Vehicles whose plan crosses a junction they must avoid are
   * assigned routes one by one, nearest first; every assignment adds a load penalty to the links it
   * uses, so later vehicles are spread over other detours instead of all choosing the same one.
   * One signed allocation table per round; each vehicle reads its own entry and still checks it.
   */
  private adviseDetours(): void {
    const s = this.s;
    const st = this.engine.state;
    const net = this.engine.net;
    const inc = this.activeIncident('signal_outage');
    if (!inc) return;
    const candidates: Array<{ v: Vehicle; d: number }> = [];
    for (const id of st.order) {
      const v = st.vehicles[id];
      if (!v.av || !v.connected) continue;
      const k = s.knowledge[v.id];
      if (!k || !k.incidents[inc.id]?.active) continue;
      if (k.advice && this.now - k.advice.at < 60) continue;
      const opts = this.routeOptions(v);
      if (!opts.avoidJunctions?.size) continue;
      const cur = v.seg.k === 'L' ? v.seg.id : net.connectors[v.seg.id].outLink;
      // a vehicle already on the approach to an avoided junction cannot be helped by a detour
      if (opts.avoidJunctions.has(net.links[cur].to)) continue;
      const start = Math.max(0, v.route.indexOf(cur));
      const remaining = junctionsOf(net, v.route, start);
      // vehicles that already avoid the area are counted as load but not re-advised
      const p = this.position(v);
      candidates.push({ v, d: Math.hypot(p.x, p.y) + (remaining.some((j) => opts.avoidJunctions!.has(j)) ? 0 : 1e6) });
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a.d - b.d || a.v.id - b.v.id);
    const load = new Map<string, number>();
    const entries: string[] = [];
    const targets: number[] = [];
    for (const { v } of candidates) {
      const opts = this.routeOptions(v);
      const pen = new Map<string, number>();
      for (const [l, n] of load) pen.set(l, n * 9);
      const cur = v.seg.k === 'L' ? v.seg.id : net.connectors[v.seg.id].outLink;
      const route = planRoute(net, cur, this.engine.destLink(v.dest).link, { ...opts, moveDelay: st.moveDelay, linkPenalty: pen });
      if (!route) continue;
      for (const l of route.slice(1)) load.set(l, (load.get(l) ?? 0) + 1);
      entries.push(`${v.tag}|${route.join(' ')}`);
      targets.push(v.id);
    }
    if (!entries.length) return;
    const msg = this.makeMessage(
      'DM-TMC',
      inc,
      'ROUTE_ADVISORY',
      { junctions: inc.area.junctions },
      { round: Math.round(this.now), assignments: entries },
      `Detour allocation for ${entries.length} vehicles around ${inc.id}`,
      2,
      90,
    );
    s.messages[msg.header.msgId] = msg;
    s.verdicts[msg.header.msgId] = { status: 'accepted', code: 'ACCEPTED', checks: [] };
    inc.messages.push(msg.header.msgId);
    this.broadcast(msg, targets);
    this.engine.event('advisory-batch', 'info', msg.header.msgId, { n: entries.length, incident: inc.id });
  }

  // ================================================================== per step

  private tick(): void {
    const s = this.s;
    const st = this.engine.state;
    const now = this.now;

    // scheduled service actions (detections)
    if (s.pending.length) {
      const due = s.pending.filter((x) => x.at <= now + 1e-9);
      if (due.length) {
        s.pending = s.pending.filter((x) => x.at > now + 1e-9);
        for (const a of due) this.runAction(a);
      }
    }

    // deliveries due this step
    while (s.inbox.length && s.inbox[0].at <= now + 1e-9) this.receive(s.inbox.shift()!);

    // repetition and refresh of active messages
    for (const incId of Object.keys(s.incidents)) {
      const inc = s.incidents[incId];
      if (inc.status !== 'active' || !inc.messages.length) continue;
      const lastId = this.latestIncidentMessage(inc);
      if (!lastId) continue;
      if (this.policy !== 'A' && now - (s.lastBroadcast[lastId] ?? -Infinity) >= s.params.repeatEvery - 1e-9) this.broadcast(s.messages[lastId]);
      if (now - (s.lastRefresh[incId] ?? inc.createdAt) >= REFRESH_EVERY) this.refresh(inc, lastId);
      const auth = Object.entries(s.junctionAuth).filter(([, a]) => a.incidentId === incId);
      for (const [, a] of auth) if (now - (s.lastBroadcast[a.msgId] ?? -Infinity) >= s.params.repeatEvery * 2 - 1e-9) this.broadcast(s.messages[a.msgId]);
    }

    // coordinated detour advice
    if (this.policy === 'C' && this.activeIncident('signal_outage') && now - s.lastAdvice >= ADVICE_EVERY - 1e-9) {
      s.lastAdvice = now;
      this.adviseDetours();
    }

    // remote assistance
    this.reviewExceptions();
    this.runAssistance();

    // accounting
    for (const id of st.order) if (st.vehicles[id].mode === 'mrc') s.stats.mrcVehicleSeconds += DT;
  }

  private latestIncidentMessage(inc: Incident): string | null {
    for (let i = inc.messages.length - 1; i >= 0; i--) {
      const m = this.s.messages[inc.messages[i]];
      if (m && m.header.issuer === 'DM-TMC' && m.body.type !== 'ROUTE_ADVISORY') return m.header.msgId;
    }
    return null;
  }

  /** Re-sign the current version with a new timestamp so late receivers do not see it as stale. */
  private refresh(inc: Incident, lastId: string): void {
    const s = this.s;
    const last = s.messages[lastId];
    s.lastRefresh[inc.id] = this.now;
    const msg = this.makeMessage('DM-TMC', inc, last.body.type, last.body.area, last.body.detail, last.body.text, last.body.severity, Math.max(60, last.header.validUntil - this.now));
    s.messages[msg.header.msgId] = msg;
    s.verdicts[msg.header.msgId] = { status: 'accepted', code: 'ACCEPTED', checks: [] };
    inc.messages.push(msg.header.msgId);
    if (this.policy !== 'A') this.broadcast(msg);
  }

  private runAction(a: { kind: string; params: Record<string, unknown> }): void {
    const st = this.engine.state;
    if (a.kind === 'detect_outage') {
      const js = (a.params.junctions as string[]).filter((j) => st.road.dark.includes(j));
      if (!js.length) return;
      let inc = this.activeIncident('signal_outage');
      if (inc) {
        // the outage grew: new version of the same incident
        inc.area = { junctions: [...new Set([...(inc.area.junctions ?? []), ...js])].sort() };
        inc.version++;
        inc.updatedAt = this.now;
      } else {
        inc = this.newIncident('signal_outage', { junctions: js }, `Signal outage at ${js.join(', ')}`, `Controllers at ${js.join(', ')} stopped reporting (power loss)`);
      }
      this.engine.event('outage-detected', 'critical', inc.id, { junctions: (inc.area.junctions ?? []).join(', '), delay: this.s.params.detectionDelay });
      const wide = (inc.area.junctions ?? []).filter((j) => this.engine.net.junctions[j].maxApproachLanes > this.engine.cfg.oddMaxLanes);
      this.publish(
        inc,
        'SIGNAL_OUTAGE',
        { restriction: 'uncontrolled_junction', protocol: 'all_way_stop', wide: wide },
        `Signals dark at ${(inc.area.junctions ?? []).join(', ')}: treat as all-way stop`,
        4,
      );
    } else if (a.kind === 'detect_restore') {
      const inc = this.activeIncident('signal_outage');
      if (!inc) return;
      const still = (inc.area.junctions ?? []).filter((j) => st.road.dark.includes(j));
      inc.version++;
      inc.updatedAt = this.now;
      if (still.length) {
        inc.area = { junctions: still };
        this.publish(inc, 'SIGNAL_OUTAGE', { restriction: 'uncontrolled_junction', protocol: 'all_way_stop' }, `Signals still dark at ${still.join(', ')}`, 4);
        return;
      }
      this.publish(inc, 'SIGNAL_RESTORED', { restriction: 'none' }, `Signals working again at ${(inc.area.junctions ?? []).join(', ')}`, 1, 600);
      inc.status = 'resolved';
      inc.resolvedAt = this.now;
      for (const [j, auth] of Object.entries(this.s.junctionAuth)) if (auth.incidentId === inc.id) delete this.s.junctionAuth[j];
      this.engine.event('incident-resolved', 'ok', inc.id, {});
    }
  }

  // ================================================================== queries for the interface

  affectedVehicles(incidentId: string): { received: number; accepted: number; rejected: number } {
    const r = this.s.reach[incidentId];
    if (!r) return { received: 0, accepted: 0, rejected: 0 };
    return { received: Object.keys(r.received).length, accepted: Object.keys(r.accepted).length, rejected: Object.keys(r.rejected).length };
  }
}

export type { DmState };
