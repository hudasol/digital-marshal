import type { JunctionDef, Turn } from '../network/types';

/* Fixed-time signal plans evaluated as pure functions of simulation time, so the renderer and the
   simulation always agree on what each signal shows. A junction whose controller has failed shows
   nothing (DARK). Aspects are per movement: an approach can show a green arrow for its left-turn
   lane while its through lanes are red.

   Emergency pre-emption (a common infrastructure capability, requested by the coordination layer
   under policy C): the running phase ends through its normal amber and all-red, then the emergency
   vehicle's approach gets green until the request is released. */

export type Aspect = 'G' | 'A' | 'R' | 'DARK';

export interface Preempt {
  inLink: string; // the emergency vehicle's approach
  since: number; // simulation time the request was granted
  wasGreen: boolean; // the approach already had green when the request arrived
  basePhase: number; // phase running when the request arrived
}

export interface SignalState {
  phase: number; // index of the phase currently running (green, amber, or the all-red after it)
  interval: 'green' | 'amber' | 'allred';
  remaining: number; // seconds left in the interval
  dark: boolean;
  pre?: { inLink: string; basePhase: number; stage: 'amber' | 'clear' | 'green' };
}

export function signalState(j: JunctionDef, t: number, dark = false, pre?: Preempt): SignalState {
  if (dark) return { phase: -1, interval: 'allred', remaining: Infinity, dark: true };
  const plan = j.plan;
  if (pre) {
    const age = t - pre.since;
    const stage = pre.wasGreen ? 'green' : age < plan.amber ? 'amber' : age < plan.amber + plan.allRed ? 'clear' : 'green';
    return {
      phase: -2,
      interval: stage === 'amber' ? 'amber' : stage === 'clear' ? 'allred' : 'green',
      remaining: Infinity,
      dark: false,
      pre: { inLink: pre.inLink, basePhase: pre.basePhase, stage },
    };
  }
  let local = (t + plan.offset) % plan.cycle;
  if (local < 0) local += plan.cycle;
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i];
    const len = p.green + plan.amber + plan.allRed;
    if (local < len) {
      if (local < p.green) return { phase: i, interval: 'green', remaining: p.green - local, dark: false };
      if (local < p.green + plan.amber) return { phase: i, interval: 'amber', remaining: p.green + plan.amber - local, dark: false };
      return { phase: i, interval: 'allred', remaining: len - local, dark: false };
    }
    local -= len;
  }
  return { phase: 0, interval: 'green', remaining: 0, dark: false };
}

export function phaseServes(j: JunctionDef, phase: number, inLink: string, turn: Turn): boolean {
  const p = j.plan.phases[phase];
  return !!p && p.moves.some((m) => m.inLink === inLink && m.turns.includes(turn));
}

/** Aspect shown to a movement (incoming link and turn) in a given signal state. */
export function aspectFor(j: JunctionDef, st: SignalState, inLink: string, turn: Turn): Aspect {
  if (st.dark) return 'DARK';
  if (st.pre) {
    if (st.pre.stage === 'green') return inLink === st.pre.inLink ? 'G' : 'R';
    if (st.pre.stage === 'amber') return phaseServes(j, st.pre.basePhase, inLink, turn) ? 'A' : 'R';
    return 'R';
  }
  if (!phaseServes(j, st.phase, inLink, turn)) return 'R';
  return st.interval === 'green' ? 'G' : st.interval === 'amber' ? 'A' : 'R';
}

/** Seconds from time t until the movement next shows green (0 if green now). */
export function timeToGreen(j: JunctionDef, inLink: string, turn: Turn, t: number): number {
  const plan = j.plan;
  let local = (t + plan.offset) % plan.cycle;
  if (local < 0) local += plan.cycle;
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < plan.phases.length; i++) {
    const p = plan.phases[i];
    if (phaseServes(j, i, inLink, turn)) {
      if (local >= start && local < start + p.green) return 0;
      const wait = local < start ? start - local : plan.cycle - local + start;
      if (wait < best) best = wait;
    }
    start += p.green + plan.amber + plan.allRed;
  }
  return best;
}
