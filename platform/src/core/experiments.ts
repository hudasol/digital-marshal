import type { Network } from './network/types';
import { BLACKOUT_JUNCTIONS, WORKS_STAGES } from './network/district';
import { createSession, dmFor } from './scenarios';
import { DT } from './sim/params';
import type { DmParams, Policy } from './dm/types';

/* The A/B/C benchmark, shared by the headless runner (scripts/run-experiments.ts) and the in-browser
   re-run. Every variant of an experiment sees the same seeds, the same demand and the same
   scenario triggers; only the coordination policy (or one switched feature, for ablations)
   differs. Metrics are computed from the recorded run, nothing is estimated. */

export type ExperimentId = 'blackout' | 'emergency' | 'roadworks' | 'emergency_blackout';

export interface VariantDef {
  id: string;
  policy: Policy;
  /** explicit coordination switches (ablations) */
  dm?: Partial<Pick<DmParams, 'grouping' | 'advice' | 'priority'>>;
  ablation?: boolean;
}

export interface ExperimentDef {
  id: ExperimentId;
  /** seconds simulated after the warm-up */
  horizon: number;
  interventions: Array<{ at: number; kind: string; params: Record<string, unknown> }>;
  variants: VariantDef[];
}

const A: VariantDef = { id: 'A', policy: 'A' };
const B: VariantDef = { id: 'B', policy: 'B' };
const C: VariantDef = { id: 'C', policy: 'C' };

export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: 'blackout',
    horizon: 720,
    interventions: [
      { at: 60, kind: 'blackout', params: { junctions: [...BLACKOUT_JUNCTIONS] } },
      { at: 540, kind: 'restore', params: { junctions: [...BLACKOUT_JUNCTIONS] } },
    ],
    variants: [A, B, C, { id: 'C-nogroup', policy: 'C', dm: { grouping: false }, ablation: true }, { id: 'C-noadvice', policy: 'C', dm: { advice: false }, ablation: true }],
  },
  {
    id: 'emergency',
    horizon: 360,
    interventions: [{ at: 30, kind: 'dispatch', params: { from: 'hospital', to: 'scene' } }],
    variants: [A, B, C, { id: 'B-priority', policy: 'B', dm: { priority: true }, ablation: true }],
  },
  {
    id: 'emergency_blackout',
    horizon: 480,
    interventions: [
      { at: 30, kind: 'blackout', params: { junctions: [...BLACKOUT_JUNCTIONS] } },
      { at: 90, kind: 'dispatch', params: { from: 'hospital', to: 'scene' } },
    ],
    variants: [A, B, C, { id: 'B-priority', policy: 'B', dm: { priority: true }, ablation: true }],
  },
  {
    id: 'roadworks',
    horizon: 600,
    interventions: [
      { at: 20, kind: 'works', params: { ...WORKS_STAGES.lane, lanes: [...WORKS_STAGES.lane.lanes] } },
      { at: 200, kind: 'works', params: { ...WORKS_STAGES.full, lanes: [...WORKS_STAGES.full.lanes] } },
      { at: 420, kind: 'works-lift', params: {} },
    ],
    variants: [A, B, C, { id: 'C-noadvice', policy: 'C', dm: { advice: false }, ablation: true }],
  },
];

/** Seeds used for the committed results. */
export const SEEDS = [20271001, 20271002, 20271003, 20271004, 20271005, 20271006, 20271007, 20271008, 20271009, 20271010];

export interface RunMetrics {
  experiment: ExperimentId;
  variant: string;
  seed: number;
  /** vehicle-hours spent in the district or waiting to enter it over the horizon (same demand in every variant) */
  systemTimeVehH: number;
  trips: number;
  /** mean delay (travel time minus free-flow time) per completed trip, s */
  meanDelay: number;
  meanDelayAV: number;
  meanDelayOther: number;
  /* safety invariants: expected 0 in every run */
  /** AVs entering a dark junction outside their domain without an authorisation, other than vehicles
      already in the junction or committed to it (moving, too close to stop) when the power failed */
  unauthorisedCrossings: number;
  restrictedEntries: number;
  /** pairs of vehicles seen in conflicting movements of the same junction box at once */
  boxConflicts: number;
  hardBrakes: number;
  /* remote assistance */
  exceptions: number;
  withdrawn: number;
  autoResolved: number;
  mrcVehMin: number;
  operatorMin: number;
  /** mean time from request to release for requests an operator or an authorisation resolved, s */
  meanAssistWait: number | null;
  /* messages */
  delivered: number;
  rejected: number;
  reroutes: number;
  /* emergency vehicle: null when no run or not arrived within the horizon */
  /** 1 if the ambulance arrived within the horizon, 0 if not, null if there was no emergency run */
  evArrived: number | null;
  evDelay: number | null;
  evTravel: number | null;
  evFreeFlow: number | null;
  evHeldByVehicles: number | null;
  evHeldBySignals: number | null;
  evYieldOk: number;
  evYieldInfeasible: number;
  preempts: number;
  /* roadworks */
  lateDiscoveries: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Run one variant of one experiment for one seed. */
export function runOne(net: Network, exp: ExperimentDef, variant: VariantDef, seed: number): RunMetrics {
  const s = createSession(net, { seed, dm: { policy: variant.policy, ...(variant.dm ?? {}) } });
  for (const iv of exp.interventions) s.intervene(iv.kind, iv.params, iv.at);
  const crossings = new Set<string>();
  const conflicts = new Set<string>();
  const atOnset = new Set<number>();
  let dark: string[] = [];
  let vehSteps = 0;
  const odd = s.engine.cfg.oddMaxLanes;
  while (s.t < exp.horizon - 1e-9) {
    s.stepOnce();
    const st = s.engine.state;
    let queued = 0;
    for (const g in st.pending) queued += st.pending[g].length;
    vehSteps += st.order.length + queued;
    for (const cid of net.connectorIds) {
      const occ = st.conns[cid];
      if (!occ.length) continue;
      for (const other of net.connectors[cid].conflicts) {
        if (other < cid) continue;
        for (const a of occ) for (const b of st.conns[other]) conflicts.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
    // vehicles already in, or committed to, a junction at the moment its signals fail cannot stop
    for (const j of st.road.dark) {
      if (dark.includes(j)) continue;
      for (const id of st.order) {
        const v = st.vehicles[id];
        const c = v.seg.k === 'C' ? net.connectors[v.seg.id] : v.committed && v.conn ? net.connectors[v.conn] : null;
        if (c && c.junction === j) atOnset.add(v.id);
      }
    }
    dark = [...st.road.dark];
    if (st.road.dark.length) {
      const dm = dmFor(s.engine);
      for (const id of st.order) {
        const v = st.vehicles[id];
        if (!v.av || v.seg.k !== 'C' || v.s > 2 || atOnset.has(v.id)) continue;
        const j = net.connectors[v.seg.id].junction;
        if (!st.road.dark.includes(j) || net.junctions[j].maxApproachLanes <= odd) continue;
        if (!dm.authorized(v, j)) crossings.add(`${v.id}|${v.seg.id}`);
      }
    }
  }
  const st = s.engine.state;
  const dm = dmFor(s.engine).s;
  const delays = st.trips.map((t) => ({ d: t.t1 - t.t0 - t.ffT, av: t.av }));
  const ex = Object.values(dm.exceptions);
  const waits = ex.filter((e) => (e.status === 'resolved' || e.status === 'auto_resolved') && e.resolvedAt !== null).map((e) => e.resolvedAt! - e.raisedAt);
  const ev = dm.evRuns[0] ?? dm.ev;
  const arrived = ev && ev.arrivedAt !== null;
  return {
    experiment: exp.id,
    variant: variant.id,
    seed,
    systemTimeVehH: (vehSteps * DT) / 3600,
    trips: st.trips.length,
    meanDelay: mean(delays.map((x) => x.d)),
    meanDelayAV: mean(delays.filter((x) => x.av).map((x) => x.d)),
    meanDelayOther: mean(delays.filter((x) => !x.av).map((x) => x.d)),
    unauthorisedCrossings: crossings.size,
    restrictedEntries: st.counters.restrictedEntries,
    boxConflicts: conflicts.size,
    hardBrakes: st.counters.hardBrakes,
    exceptions: ex.length,
    withdrawn: ex.filter((e) => e.status === 'withdrawn').length,
    autoResolved: dm.stats.autoResolved,
    mrcVehMin: dm.stats.mrcVehicleSeconds / 60,
    operatorMin: dm.stats.operatorBusy / 60,
    meanAssistWait: waits.length ? mean(waits) : null,
    delivered: dm.stats.delivered,
    rejected: dm.stats.rejected,
    reroutes: dm.stats.reroutes,
    evArrived: ev ? (arrived ? 1 : 0) : null,
    evDelay: arrived ? ev!.arrivedAt! - ev!.dispatchedAt - ev!.ffT : null,
    evTravel: arrived ? ev!.arrivedAt! - ev!.dispatchedAt : null,
    evFreeFlow: ev ? ev.ffT : null,
    evHeldByVehicles: ev ? ev.obstructed.vehicle : null,
    evHeldBySignals: ev ? ev.obstructed.signal : null,
    evYieldOk: ev ? ev.yields.ok : 0,
    evYieldInfeasible: ev ? ev.yields.infeasible : 0,
    preempts: ev ? ev.preempts : 0,
    lateDiscoveries: st.counters.lateDiscoveries,
  };
}

// ---------------------------------------------------------------- statistics

/** Two-sided 95% critical values of Student's t for 1..30 degrees of freedom. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069,
  2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  /** half-width of the 95% confidence interval of the mean (t distribution) */
  ci: number;
  min: number;
  max: number;
}

export function summarise(xs: number[]): Summary | null {
  const n = xs.length;
  if (!n) return null;
  const m = mean(xs);
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1)) : 0;
  const t = n > 1 ? T95[Math.min(n - 2, T95.length - 1)] : 0;
  return { n, mean: m, sd, ci: n > 1 ? (t * sd) / Math.sqrt(n) : 0, min: Math.min(...xs), max: Math.max(...xs) };
}

export interface PairedDiff {
  /** variant compared, and its reference */
  variant: string;
  reference: string;
  metric: keyof RunMetrics;
  /** mean of (variant - reference) over seeds where both are defined */
  diff: Summary;
  /** seeds where the variant was lower, higher, or equal */
  lower: number;
  higher: number;
  equal: number;
}

export function paired(runs: RunMetrics[], variant: string, reference: string, metric: keyof RunMetrics): PairedDiff | null {
  const ds: number[] = [];
  let lower = 0;
  let higher = 0;
  let equal = 0;
  for (const r of runs.filter((x) => x.variant === variant)) {
    const ref = runs.find((x) => x.variant === reference && x.seed === r.seed);
    const a = r[metric];
    const b = ref?.[metric];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const d = a - b;
    ds.push(d);
    if (Math.abs(d) < 1e-9) equal++;
    else if (d < 0) lower++;
    else higher++;
  }
  const diff = summarise(ds);
  return diff ? { variant, reference, metric, diff, lower, higher, equal } : null;
}
