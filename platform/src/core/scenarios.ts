import type { Network } from './network/types';
import { SimSession } from './sim/session';
import type { Engine, RunConfig } from './sim/engine';
import { DigitalMarshal, DEFAULT_DM } from './dm/service';
import type { DmParams, SignedMessage } from './dm/types';
import { buildInjection, type InjectionId } from './dm/inject';

/* Scenario plumbing shared by the interface and the headless experiment runner: a session with the
   Digital Marshal layer attached, and the interventions that scenarios record on its timeline. */

export interface SessionConfig extends Partial<RunConfig> {
  dm?: Partial<DmParams> & Record<string, unknown>;
}

const dmOf = new WeakMap<Engine, DigitalMarshal>();

export function dmFor(engine: Engine): DigitalMarshal {
  const d = dmOf.get(engine);
  if (!d) throw new Error('Digital Marshal layer not attached');
  return d;
}

export function createSession(net: Network, cfg: SessionConfig = {}): SimSession {
  const session = new SimSession(net, cfg);
  session.onEngine((engine) => {
    const c = session.cfg as SessionConfig;
    dmOf.set(engine, new DigitalMarshal(engine, { ...DEFAULT_DM, ...(c.dm ?? {}) }));
  });
  session.addApplier((engine, iv) => applyIntervention(engine, iv.kind, iv.params));
  return session;
}

export function applyIntervention(engine: Engine, kind: string, params: Record<string, unknown>): void {
  const dm = dmFor(engine);
  switch (kind) {
    case 'density':
      engine.state.densityScale = Number(params.scale);
      break;
    case 'blackout':
      dm.blackout(params.junctions as string[]);
      break;
    case 'restore':
      dm.restore(params.junctions as string[]);
      break;
    case 'dispatch':
      dm.dispatch(String(params.from ?? 'hospital'), String(params.to ?? 'scene'));
      break;
    case 'works':
      dm.submitWorks(params as unknown as Parameters<typeof dm.submitWorks>[0]);
      break;
    case 'works-lift':
      dm.liftWorks();
      break;
    case 'inject': {
      // built from the situation at the moment of injection, so a replay rebuilds the same message
      const msg = params.test ? buildInjection(dm, params.test as InjectionId) : structuredClone(params.message as SignedMessage);
      if (msg) dm.inject(msg);
      break;
    }
    case 'comms': {
      const p = dm.s.params;
      if (params.extraLatencyMs !== undefined) p.extraLatencyMs = Number(params.extraLatencyMs);
      if (params.extraLoss !== undefined) p.extraLoss = Number(params.extraLoss);
      if (params.rsuDown !== undefined) p.rsuDown = [...(params.rsuDown as string[])];
      if (params.cellular !== undefined) p.cellular = Boolean(params.cellular);
      if (params.rsuBattery !== undefined) p.rsuBattery = Boolean(params.rsuBattery);
      break;
    }
  }
}
