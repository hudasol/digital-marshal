import type { Bind, LogEntry } from '../core/sim/types';
import type { I18nKey } from './i18n';

type T = (key: I18nKey, params?: Record<string, string | number>) => string;

/* Plain-language explanations generated from simulation state. Each sentence is a template filled
   with values the engine recorded (binding constraint, gaps, junction ids, seconds to green), not an
   after-the-fact narrative. */

export function bindText(t: T, b: Bind, speedKmh: number): string {
  const gap = Number.isFinite(b.gap) ? Math.max(0, Math.round(b.gap)) : 0;
  const extra = b.extra !== undefined && Number.isFinite(b.extra) ? Math.round(b.extra) : 0;
  const p = { ref: b.ref, gap, extra };
  switch (b.kind) {
    case 'signal':
      return speedKmh < 2 ? t('bind.signal.stop', p) : t('bind.signal.slow', p);
    case 'awsc':
      return b.ref.startsWith('J') ? t('bind.awsc.self', p) : t('bind.awsc.other', p);
    case 'free':
    case 'leader':
    case 'box':
    case 'exit':
    case 'curve':
    case 'closure':
    case 'mrc':
    case 'yield':
    case 'lanechange':
    case 'arrive':
    case 'spawn':
      return t(`bind.${b.kind}` as I18nKey, p);
  }
}

export function logText(t: T, e: LogEntry): string {
  const key = `log.${e.code}` as I18nKey;
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e.p)) p[k] = typeof v === 'number' ? Math.round(v * 10) / 10 : String(v);
  if (e.code === 'YIELD_INFEASIBLE' && typeof e.p.reason === 'string') {
    p.reason = t(`yield.${e.p.reason}` as I18nKey, { by: String(e.p.by ?? ''), gap: Number(e.p.gap ?? 0) });
  }
  return t(key, p);
}

export function bindTone(kind: Bind['kind']): 'ok' | 'info' | 'warn' | 'critical' {
  switch (kind) {
    case 'free':
    case 'leader':
    case 'curve':
    case 'arrive':
      return 'ok';
    case 'signal':
    case 'awsc':
    case 'exit':
    case 'box':
    case 'lanechange':
    case 'spawn':
      return 'info';
    case 'closure':
    case 'yield':
      return 'warn';
    case 'mrc':
      return 'critical';
  }
}

export function fmtDuration(s: number): string {
  const v = Math.max(0, Math.round(s));
  const m = Math.floor(v / 60);
  return m ? `${m} min ${String(v % 60).padStart(2, '0')} s` : `${v} s`;
}
