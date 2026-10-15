import type { JunctionDef, Side } from '../network/types';

/* Fixed-time split-phase signal plans. Pure functions of simulation time, so the renderer and the
   simulation always agree on what each signal shows. A failed controller shows nothing (DARK). */

export type Aspect = 'G' | 'A' | 'R' | 'DARK';

export interface SignalState {
  aspects: Partial<Record<Side, Aspect>>;
  /** index of the phase currently running (green, amber or the all-red that follows it) */
  phase: number;
  /** seconds until the current interval (green, amber, all-red) ends */
  remaining: number;
  interval: 'green' | 'amber' | 'allred';
}

export function signalState(j: JunctionDef, t: number, dark = false): SignalState {
  const plan = j.plan;
  const aspects: Partial<Record<Side, Aspect>> = {};
  if (dark) {
    for (const p of plan.phases) aspects[p.approach] = 'DARK';
    return { aspects, phase: -1, remaining: Infinity, interval: 'allred' };
  }
  let local = (t + plan.offset) % plan.cycle;
  if (local < 0) local += plan.cycle;
  let phase = 0;
  let interval: SignalState['interval'] = 'green';
  let remaining = 0;
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i];
    const len = p.green + plan.amber + plan.allRed;
    if (local < len) {
      phase = i;
      if (local < p.green) {
        interval = 'green';
        remaining = p.green - local;
      } else if (local < p.green + plan.amber) {
        interval = 'amber';
        remaining = p.green + plan.amber - local;
      } else {
        interval = 'allred';
        remaining = len - local;
      }
      break;
    }
    local -= len;
  }
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i];
    if (i === phase && interval === 'green') aspects[p.approach] = 'G';
    else if (i === phase && interval === 'amber') aspects[p.approach] = 'A';
    else aspects[p.approach] = 'R';
  }
  return { aspects, phase, remaining, interval };
}

/** Seconds from time t until the given approach next shows green (0 if green now). */
export function timeToGreen(j: JunctionDef, side: Side, t: number): number {
  const plan = j.plan;
  let local = (t + plan.offset) % plan.cycle;
  if (local < 0) local += plan.cycle;
  let start = 0;
  for (const p of plan.phases) {
    if (p.approach === side) {
      if (local >= start && local < start + p.green) return 0;
      return local < start ? start - local : plan.cycle - local + start;
    }
    start += p.green + plan.amber + plan.allRed;
  }
  return Infinity;
}
