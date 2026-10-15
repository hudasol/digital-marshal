import type { Network } from '../network/types';
import { Engine, type RunConfig } from './engine';
import { DT, SNAPSHOT_EVERY_S } from './params';
import type { SimEvent, SimState } from './types';

/* A simulation session: one engine plus its timeline. Interventions (incident triggers, injected
   messages, parameter changes) are recorded with their simulation time, so the run can be replayed
   exactly, scrubbed backwards (restore a snapshot and re-simulate) or re-run under another policy. */

export interface Intervention {
  id: number;
  t: number;
  kind: string;
  params: Record<string, unknown>;
}

export type Applier = (engine: Engine, iv: Intervention) => void;

/** Engine configuration plus settings owned by layers above the engine (for example the DM policy). */
export type SessionCfg = Partial<RunConfig> & { dm?: Record<string, unknown> };

interface Snapshot {
  t: number;
  state: SimState;
  applied: number[];
  extra: unknown; // state owned by layers above the engine (Digital Marshal services)
}

export interface SessionLayer {
  /** serialisable state of the layer, captured with every snapshot */
  save(): unknown;
  load(data: unknown): void;
}

export class SimSession {
  readonly net: Network;
  engine: Engine;
  cfg: SessionCfg;
  interventions: Intervention[] = [];
  applied = new Set<number>();
  horizon = 0;
  /** events up to the horizon, kept when scrubbing back so the timeline can show them */
  knownEvents: SimEvent[] = [];
  private snapshots: Snapshot[] = [];
  private nextIv = 1;
  private appliers: Applier[] = [];
  private layers: SessionLayer[] = [];
  private onReset: Array<(e: Engine) => void> = [];

  constructor(net: Network, cfg: SessionCfg = {}) {
    this.net = net;
    this.cfg = cfg;
    this.engine = this.makeEngine();
  }

  private makeEngine(): Engine {
    const e = new Engine(this.net, this.cfg);
    for (const f of this.onReset) f(e);
    e.warmUp();
    return e;
  }

  /** Called with each new engine (initial, after reset or policy change) before warm-up. */
  onEngine(f: (e: Engine) => void): void {
    this.onReset.push(f);
    f(this.engine);
  }

  addApplier(a: Applier): void {
    this.appliers.push(a);
  }

  addLayer(l: SessionLayer): void {
    this.layers.push(l);
  }

  /** Start from scratch with a (possibly different) configuration; keeps the interventions. */
  reset(cfg: SessionCfg = this.cfg, keepInterventions = true): void {
    this.cfg = cfg;
    if (!keepInterventions) this.interventions = [];
    this.snapshots = [];
    this.applied = new Set();
    this.horizon = 0;
    this.knownEvents = [];
    this.engine = this.makeEngine();
    this.snap();
  }

  get t(): number {
    return this.engine.state.t;
  }

  private snap(): void {
    const t = this.engine.state.t;
    this.snapshots.push({
      t,
      state: structuredClone(this.engine.state),
      applied: [...this.applied],
      extra: this.layers.map((l) => structuredClone(l.save())),
    });
  }

  private restore(s: Snapshot): void {
    this.engine.state = structuredClone(s.state);
    this.applied = new Set(s.applied);
    s.extra && (s.extra as unknown[]).forEach((d, i) => this.layers[i]?.load(structuredClone(d)));
  }

  /** One simulation step, applying any interventions that are due first. */
  stepOnce(): void {
    if (!this.snapshots.length) this.snap(); // the t = 0 snapshot, taken once all layers are attached
    const st = this.engine.state;
    for (const iv of this.interventions) {
      if (!this.applied.has(iv.id) && iv.t <= st.t + DT / 2) {
        this.applied.add(iv.id);
        for (const a of this.appliers) a(this.engine, iv);
      }
    }
    this.engine.step();
    const t = this.engine.state.t;
    if (t > this.horizon + 1e-9) {
      this.horizon = t;
      // remember events we have not seen before
      const ev = this.engine.state.events;
      const lastKnown = this.knownEvents.length ? this.knownEvents[this.knownEvents.length - 1].t : -Infinity;
      for (let i = ev.length - 1; i >= 0 && ev[i].t > lastKnown; i--) this.knownEvents.splice(this.indexAfter(lastKnown), 0, ev[i]);
    }
    const last = this.snapshots[this.snapshots.length - 1];
    if (!last || t - last.t >= SNAPSHOT_EVERY_S - 1e-9) {
      if (!this.snapshots.some((s) => Math.abs(s.t - t) < 1e-6)) {
        // keep snapshots ordered by time
        const idx = this.snapshots.findIndex((s) => s.t > t);
        const snap: Snapshot = {
          t,
          state: structuredClone(this.engine.state),
          applied: [...this.applied],
          extra: this.layers.map((l) => structuredClone(l.save())),
        };
        if (idx < 0) this.snapshots.push(snap);
        else this.snapshots.splice(idx, 0, snap);
      }
    }
  }

  private indexAfter(t: number): number {
    let i = this.knownEvents.length;
    while (i > 0 && this.knownEvents[i - 1].t > t) i--;
    return i;
  }

  /** Simulate forward until time t (no-op if already there). Returns steps taken. */
  advanceTo(t: number, maxSteps = Infinity): number {
    let n = 0;
    while (this.engine.state.t < t - DT / 2 && n < maxSteps) {
      this.stepOnce();
      n++;
    }
    return n;
  }

  /**
   * Move to time t. Backwards (or within known history) restores the nearest snapshot and
   * re-simulates; forwards beyond the horizon simulates in place.
   * Returns the number of steps that remain (when limited by maxSteps).
   */
  seek(t: number, maxSteps = Infinity): number {
    t = Math.max(0, t);
    const cur = this.engine.state.t;
    if (t < cur - 1e-9 || (t > cur && t <= this.horizon)) {
      let best: Snapshot | null = null;
      for (const s of this.snapshots) if (s.t <= t + 1e-9 && (!best || s.t > best.t)) best = s;
      if (best && (t < cur || best.t > cur)) this.restore(best);
    }
    this.advanceTo(t, maxSteps);
    return Math.max(0, Math.round((t - this.engine.state.t) / DT));
  }

  /**
   * Record an intervention at the current time (or a given time). Everything simulated after it is
   * no longer valid, so later snapshots and known events are discarded.
   */
  intervene(kind: string, params: Record<string, unknown> = {}, at?: number): Intervention {
    const t = at ?? this.engine.state.t;
    const iv: Intervention = { id: this.nextIv++, t, kind, params };
    this.interventions.push(iv);
    this.interventions.sort((a, b) => a.t - b.t || a.id - b.id);
    this.invalidateAfter(t);
    return iv;
  }

  /** Remove interventions of a kind (for example when a scenario is reset). */
  removeInterventions(pred: (iv: Intervention) => boolean): void {
    const removed = this.interventions.filter(pred);
    if (!removed.length) return;
    const earliest = Math.min(...removed.map((r) => r.t));
    this.interventions = this.interventions.filter((iv) => !pred(iv));
    // the state after the earliest removed intervention may depend on it: replay from before it
    const cur = this.engine.state.t;
    this.invalidateAfter(earliest - DT);
    if (earliest <= cur) {
      let best: Snapshot | null = null;
      for (const s of this.snapshots) if (s.t < earliest - 1e-9 && (!best || s.t > best.t)) best = s;
      if (best) this.restore(best);
      else this.reset(this.cfg, true);
      this.advanceTo(cur);
    }
  }

  private invalidateAfter(t: number): void {
    this.snapshots = this.snapshots.filter((s) => s.t <= t + 1e-9);
    this.horizon = Math.min(this.horizon, Math.max(t, this.engine.state.t));
    this.knownEvents = this.knownEvents.filter((e) => e.t <= t + 1e-9);
  }

  get snapshotCount(): number {
    return this.snapshots.length;
  }
}
