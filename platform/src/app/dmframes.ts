import type { Engine } from '../core/sim/engine';
import { dmFor } from '../core/scenarios';
import type { CheckResult, ExceptionRecord, Incident, Policy, ReasonCode, SignedMessage } from '../core/dm/types';
import { INJECTIONS } from '../core/dm/inject';

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

export interface WorksFrame {
  incidentId: string;
  status: Incident['status'];
  version: number;
  /** stage the latest node message describes: lane, full or lifted */
  stage: string;
  link: string;
  road: string;
  lanes: number[];
  s0: number;
  s1: number;
  /** cones physically on the road */
  inPlace: boolean;
  /** when the announced stage takes effect, if it has not yet */
  activatesAt: number | null;
  submission: { msgId: string; status: string; code: ReasonCode; checks: CheckResult[] } | null;
}

export interface SecurityRow {
  msgId: string;
  test: string;
  expect: ReasonCode;
  at: number;
  status: string;
  code: ReasonCode;
  checks: CheckResult[];
  rx: { accepted: number; rejected: number; flagged: number; duplicate: number; codes: Partial<Record<ReasonCode, number>> } | null;
}

export interface DmFrame {
  policy: Policy;
  works: WorksFrame | null;
  security: SecurityRow[];
  /** an active incident whose current version receivers hold (needed by version tests) */
  liveIncident: boolean;
  audit: { restrictedEntries: number; lateDiscoveries: number };
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

function worksFrame(e: Engine): WorksFrame | null {
  const dm = dmFor(e);
  const s = dm.s;
  const all = Object.values(s.incidents).filter((i) => i.type === 'roadworks');
  const inc = all.find((i) => i.status === 'active') ?? all[all.length - 1];
  const subs = Object.values(s.messages).filter((m) => m.origin === 'submitted');
  const sub = subs[subs.length - 1] ?? null;
  const subView = sub
    ? { msgId: sub.header.msgId, status: s.verdicts[sub.header.msgId]?.status ?? '', code: s.verdicts[sub.header.msgId]?.code ?? 'ACCEPTED', checks: s.verdicts[sub.header.msgId]?.checks ?? [] }
    : null;
  if (!inc) {
    // a submission the node refused never became an incident
    if (!sub) return null;
    const ln = sub.body.area.lanes?.[0];
    return {
      incidentId: '',
      status: 'resolved',
      version: 0,
      stage: 'rejected',
      link: ln?.link ?? '',
      road: e.net.links[ln?.link ?? '']?.roadName ?? '',
      lanes: ln?.lanes ?? [],
      s0: ln?.s0 ?? 0,
      s1: ln?.s1 ?? 0,
      inPlace: false,
      activatesAt: null,
      submission: subView,
    };
  }
  const lastId = dm.latestIncidentMessage(inc);
  const last = lastId ? s.messages[lastId] : null;
  const ln = inc.area.lanes?.[0];
  const pend = inc.status === 'active' ? dm.pendingWorks() : null;
  return {
    incidentId: inc.id,
    status: inc.status,
    version: inc.version,
    stage: String(last?.body.detail.stage ?? ''),
    link: ln?.link ?? '',
    road: e.net.links[ln?.link ?? '']?.roadName ?? '',
    lanes: ln?.lanes ?? [],
    s0: ln?.s0 ?? 0,
    s1: ln?.s1 ?? 0,
    inPlace: e.state.road.closures.some((c) => c.id.startsWith(`WZ-${inc.id}-`)),
    activatesAt: pend?.at ?? null,
    submission: subView,
  };
}

function securityRows(e: Engine): SecurityRow[] {
  const s = dmFor(e).s;
  const rows: SecurityRow[] = [];
  for (const m of Object.values(s.messages)) {
    if (m.origin !== 'injected') continue;
    const v = s.verdicts[m.header.msgId];
    const spec = INJECTIONS.find((x) => x.id === m.test);
    const rx = s.rxTally[m.header.msgId];
    rows.push({
      msgId: m.header.msgId,
      test: m.test ?? '',
      expect: spec?.expect ?? 'ACCEPTED',
      at: m.header.issuedAt,
      status: v?.status ?? '',
      code: v?.code ?? 'ACCEPTED',
      checks: v?.checks ?? [],
      rx: rx ? { ...rx, codes: { ...rx.codes } } : null,
    });
  }
  return rows;
}

export function dmFrame(e: Engine): DmFrame {
  const dm = dmFor(e);
  const s = dm.s;
  const incidents = Object.values(s.incidents).map(summary).reverse();
  const ex = Object.values(s.exceptions);
  let mrcNow = 0;
  for (const id of e.state.order) if (e.state.vehicles[id].mode === 'mrc') mrcNow++;
  const live = (['roadworks', 'signal_outage', 'emergency_corridor'] as const).some((type) => {
    const inc = dm.activeIncident(type);
    return !!inc && !!dm.latestIncidentMessage(inc);
  });
  return {
    policy: s.params.policy,
    works: worksFrame(e),
    security: securityRows(e),
    liveIncident: live,
    audit: { restrictedEntries: e.state.counters.restrictedEntries, lateDiscoveries: e.state.counters.lateDiscoveries },
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
