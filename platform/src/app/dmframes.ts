import type { Engine } from '../core/sim/engine';
import { dmFor } from '../core/scenarios';
import type { CheckResult, ExceptionRecord, Incident, Policy, ReasonCode, SignedMessage } from '../core/dm/types';

/* Plain-data views of the Digital Marshal layer for the interface. */

export interface IncidentSummary {
  id: string;
  type: Incident['type'];
  status: Incident['status'];
  title: string;
  version: number;
  createdAt: number;
  junctions: string[];
  links: string[];
}

export interface EvFrame {
  id: number;
  tag: string;
  active: boolean;
  dispatchedAt: number;
  arrivedAt: number | null;
  elapsed: number;
  ffT: number;
  obstructed: { vehicle: number; signal: number; junction: number; other: number };
  yields: { ok: number; infeasible: number; byReason: Record<string, number> };
  preempts: number;
  route: string[];
  incidentId: string;
}

export interface DmFrame {
  policy: Policy;
  incidents: IncidentSummary[];
  activeCount: number;
  exceptions: { open: number; inProgress: number; resolved: number; auto: number; withdrawn: number; raised: number };
  operators: Array<{ busy: boolean; task: string | null; junction: string; kind: string; until: number }>;
  stats: { published: number; delivered: number; lost: number; rejected: number; flagged: number; meanLatencyMs: number; mrcVehicleSeconds: number; operatorBusy: number; reroutes: number };
  mrcNow: number;
  dark: string[];
  ev: EvFrame | null;
}

export interface MessageView {
  msgId: string;
  type: string;
  issuer: string;
  version: number;
  issuedAt: number;
  validUntil: number;
  origin: SignedMessage['origin'];
  text: string;
  verdict: { status: string; code: ReasonCode; checks: CheckResult[] } | null;
  signature: string;
}

export interface IncidentFrame {
  incident: IncidentSummary & { cause: string; issuer: string; resolvedAt: number | null; updatedAt: number };
  messages: MessageView[];
  reach: { received: number; accepted: number; rejected: number };
  exceptions: ExceptionRecord[];
  queueAtJunctions: Record<string, number>;
  mrcAtJunctions: Record<string, number>;
}

export interface VehicleDmView {
  incidents: Array<{ id: string; version: number; type: string; active: boolean; flagged: boolean; acceptedAt: number }>;
  messages: Array<{ msgId: string; at: number; latencyMs: number; path: string; status: string; code: ReasonCode; type: string }>;
  authorizations: Array<{ junction: string; scope: string; incidentId: string }>;
  exceptions: ExceptionRecord[];
  avoid: string[];
}

function summary(inc: Incident): IncidentSummary {
  return {
    id: inc.id,
    type: inc.type,
    status: inc.status,
    title: inc.title,
    version: inc.version,
    createdAt: inc.createdAt,
    junctions: inc.area.junctions ?? [],
    links: inc.area.links ?? (inc.area.lanes ?? []).map((l) => l.link),
  };
}

export function dmFrame(e: Engine): DmFrame {
  const dm = dmFor(e);
  const s = dm.s;
  const incidents = Object.values(s.incidents).map(summary).reverse();
  const ex = Object.values(s.exceptions);
  let mrcNow = 0;
  for (const id of e.state.order) if (e.state.vehicles[id].mode === 'mrc') mrcNow++;
  return {
    policy: s.params.policy,
    incidents,
    activeCount: incidents.filter((i) => i.status === 'active').length,
    exceptions: {
      open: ex.filter((x) => x.status === 'open').length,
      inProgress: ex.filter((x) => x.status === 'in_progress').length,
      resolved: ex.filter((x) => x.status === 'resolved').length,
      auto: ex.filter((x) => x.status === 'auto_resolved').length,
      withdrawn: ex.filter((x) => x.status === 'withdrawn').length,
      raised: ex.length,
    },
    operators: s.operators.map((o) => {
      const t = o.task ? s.tasks[o.task] : null;
      return { busy: !!t, task: o.task, junction: t?.junction ?? '', kind: t?.kind ?? '', until: t?.doneAt ?? 0 };
    }),
    stats: {
      published: s.stats.published,
      delivered: s.stats.delivered,
      lost: s.stats.lost,
      rejected: s.stats.rejected,
      flagged: s.stats.flagged,
      meanLatencyMs: s.stats.latencyN ? (s.stats.latencySum / s.stats.latencyN) * 1000 : 0,
      mrcVehicleSeconds: s.stats.mrcVehicleSeconds,
      operatorBusy: s.stats.operatorBusy,
      reroutes: s.stats.reroutes,
    },
    mrcNow,
    dark: [...e.state.road.dark],
    ev: s.ev
      ? {
          id: s.ev.id,
          tag: s.ev.tag,
          active: s.ev.arrivedAt === null,
          dispatchedAt: s.ev.dispatchedAt,
          arrivedAt: s.ev.arrivedAt,
          elapsed: (s.ev.arrivedAt ?? e.state.t) - s.ev.dispatchedAt,
          ffT: s.ev.ffT,
          obstructed: { ...s.ev.obstructed },
          yields: { ok: s.ev.yields.ok, infeasible: s.ev.yields.infeasible, byReason: { ...s.ev.yields.byReason } },
          preempts: s.ev.preempts,
          route: [...s.ev.route],
          incidentId: s.ev.incidentId,
        }
      : null,
  };
}

function messageView(e: Engine, m: SignedMessage): MessageView {
  const s = dmFor(e).s;
  const v = s.verdicts[m.header.msgId];
  return {
    msgId: m.header.msgId,
    type: m.body.type,
    issuer: m.header.issuer,
    version: m.header.version,
    issuedAt: m.header.issuedAt,
    validUntil: m.header.validUntil,
    origin: m.origin,
    text: m.body.text,
    verdict: v ? { status: v.status, code: v.code, checks: v.checks } : null,
    signature: `${m.sig.alg} · ${m.sig.keyId} · ${m.sig.value.slice(0, 16)}…`,
  };
}

export function incidentFrame(e: Engine, id: string): IncidentFrame | null {
  const dm = dmFor(e);
  const inc = dm.s.incidents[id];
  if (!inc) return null;
  const msgs = inc.messages.map((m) => dm.s.messages[m]).filter(Boolean).map((m) => messageView(e, m));
  const queue: Record<string, number> = {};
  const mrc: Record<string, number> = {};
  for (const j of inc.area.junctions ?? []) {
    queue[j] = 0;
    mrc[j] = 0;
    const jd = e.net.junctions[j];
    for (const side of ['N', 'E', 'S', 'W'] as const) {
      const l = jd.inLinks[side];
      if (!l) continue;
      for (const v of e.vehiclesOnLink(l)) {
        if (v.v < 0.5) queue[j]++;
        if (v.mode === 'mrc') mrc[j]++;
      }
    }
  }
  return {
    incident: { ...summary(inc), cause: inc.cause, issuer: inc.issuer, resolvedAt: inc.resolvedAt, updatedAt: inc.updatedAt },
    messages: msgs.slice(-14).reverse(),
    reach: dm.affectedVehicles(id),
    exceptions: Object.values(dm.s.exceptions)
      .filter((x) => x.incidentId === id || (inc.area.junctions ?? []).includes(x.junction))
      .slice(-30)
      .reverse(),
    queueAtJunctions: queue,
    mrcAtJunctions: mrc,
  };
}

export function vehicleDmView(e: Engine, vid: number): VehicleDmView | null {
  const dm = dmFor(e);
  const k = dm.s.knowledge[vid];
  const v = e.state.vehicles[vid];
  const exceptions = Object.values(dm.s.exceptions).filter((x) => x.veh === vid);
  if (!k) return { incidents: [], messages: [], authorizations: [], exceptions, avoid: [] };
  return {
    incidents: Object.entries(k.incidents).map(([id, x]) => ({ id, version: x.version, type: x.type, active: x.active, flagged: x.flagged, acceptedAt: x.acceptedAt })),
    messages: Object.entries(k.rx)
      .map(([msgId, r]) => ({
        msgId,
        at: r.at,
        latencyMs: r.latency * 1000,
        path: r.path,
        status: r.status,
        code: r.code,
        type: dm.s.messages[msgId]?.body.type ?? '',
      }))
      .filter((m) => m.status !== 'duplicate')
      .sort((a, b) => b.at - a.at)
      .slice(0, 8),
    authorizations: Object.entries(k.authorizations).map(([junction, a]) => ({ junction, scope: a.scope, incidentId: a.incidentId })),
    exceptions,
    avoid: v ? [...(dm.routeOptions(v).avoidJunctions ?? [])] : [],
  };
}

export function messageDetail(e: Engine, msgId: string): MessageView | null {
  const m = dmFor(e).s.messages[msgId];
  return m ? messageView(e, m) : null;
}
