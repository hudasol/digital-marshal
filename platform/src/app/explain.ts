import type { Bind, LogEntry } from '../core/sim/types';
import { hasKey, type I18nKey } from './i18n';

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

/** A recorded reason or channel word in the reader's language (codes without a translation stay as they are). */
export function why(t: T, value: string): string {
  const key = `why.${value}`;
  return hasKey(key) ? t(key as I18nKey) : value;
}

/** A named place (hospital access, the medical call) in the reader's language. */
export function placeName(t: T, id: string, fallback: string): string {
  const key = `place.${id}`;
  return hasKey(key) ? t(key as I18nKey) : fallback;
}

export function logText(t: T, e: LogEntry): string {
  const key = `log.${e.code}` as I18nKey;
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e.p)) p[k] = typeof v === 'number' ? Math.round(v * 10) / 10 : String(v);
  if (e.code === 'YIELD_INFEASIBLE' && typeof e.p.reason === 'string') {
    p.reason = t(`yield.${e.p.reason}` as I18nKey, { by: String(e.p.by ?? ''), gap: Number(e.p.gap ?? 0) });
  } else if ((e.code === 'REROUTE' || e.code === 'NO_ALTERNATIVE' || e.code === 'LANE_CHANGE' || e.code === 'MRC') && typeof e.p.reason === 'string') {
    p.reason = why(t, e.p.reason);
  }
  if (e.code === 'YIELD' && typeof e.p.via === 'string') p.via = why(t, e.p.via);
  if (e.code === 'ASSIST_GRANTED' && typeof e.p.by === 'string') p.by = why(t, e.p.by);
  if (e.code === 'ARRIVED' && typeof e.p.place === 'string') p.place = placeName(t, e.p.place, e.p.place);
  return t(key, p);
}

/** Exception resolutions are recorded as fixed sentences by the core; show them in the reader's language. */
export function resolutionText(t: T, r: string): string {
  let m: RegExpMatchArray | null;
  if (r === 'Individual authorisation by an operator') return t('res.individual');
  if ((m = r.match(/^Covered by junction authorisation (M-[0-9a-f]+)$/))) return t('res.covered', { msg: m[1] });
  if ((m = r.match(/^Junction authorisation (M-[0-9a-f]+)$/))) return t('res.junction', { msg: m[1] });
  if (r === 'Vehicle left the district') return t('res.left');
  if (r === 'Released') return t('res.released');
  if (r === 'Signals restored before an operator was free') return t('res.restored');
  return r;
}

/** Validation check names (the details stay technical). */
export function checkName(t: T, name: string): string {
  const key = `chk.${name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}`;
  return hasKey(key) ? t(key as I18nKey) : name;
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
