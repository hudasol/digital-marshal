import { useEffect, useRef, useState } from 'react';
import { useT, type I18nKey } from '../i18n';
import type { ExperimentDef, PairedDiff, RunMetrics, Summary, VariantDef } from '../../core/experiments';
import results from '../../data/experiments.json';

/* The A/B/C benchmark from src/data/experiments.json (written by `npm run experiments`). Every
   sentence about a difference is generated from the paired per-seed data and its interval, so the
   page cannot say more than the numbers do. */

interface ExperimentResult {
  id: ExperimentDef['id'];
  horizon: number;
  interventions: ExperimentDef['interventions'];
  variants: VariantDef[];
  runs: RunMetrics[];
  summary: Record<string, Record<string, Summary | null>>;
  comparisons: PairedDiff[];
}

interface BenchmarkDoc {
  schema: number;
  generatedAt: string;
  commit: string;
  configHash: string;
  network: string;
  seeds: number[];
  experiments: ExperimentResult[];
}

const DOC = results as unknown as BenchmarkDoc;

type MetricKey = keyof RunMetrics;

const COLORS: Record<string, string> = {
  A: '#8b98a8',
  B: '#f4b740',
  C: '#45d4e8',
  'C-nogroup': '#a78bfa',
  'C-noadvice': '#5aa9ff',
  'B-priority': '#e58f5a',
};

/** Headline metrics per experiment (charted), and the table rows. */
const HEADLINE: Record<string, MetricKey[]> = {
  blackout: ['systemTimeVehH', 'mrcVehMin', 'operatorMin'],
  emergency: ['evDelay', 'meanDelayOther'],
  emergency_blackout: ['evDelay', 'mrcVehMin'],
  roadworks: ['lateDiscoveries', 'systemTimeVehH'],
};
const TABLE: Record<string, MetricKey[]> = {
  blackout: ['systemTimeVehH', 'meanDelay', 'meanDelayAV', 'meanDelayOther', 'trips', 'exceptions', 'mrcVehMin', 'operatorMin', 'meanAssistWait', 'reroutes'],
  emergency: ['evArrived', 'evDelay', 'evHeldByVehicles', 'evHeldBySignals', 'systemTimeVehH', 'meanDelay', 'meanDelayOther'],
  emergency_blackout: ['evArrived', 'evDelay', 'evHeldByVehicles', 'evHeldBySignals', 'systemTimeVehH', 'meanDelay', 'trips', 'exceptions', 'mrcVehMin', 'operatorMin'],
  roadworks: ['lateDiscoveries', 'systemTimeVehH', 'meanDelay', 'meanDelayAV', 'meanDelayOther', 'trips', 'reroutes'],
};
const INVARIANTS: MetricKey[] = ['unauthorisedCrossings', 'boxConflicts', 'restrictedEntries'];
const DECIMALS: Partial<Record<MetricKey, number>> = { systemTimeVehH: 2, trips: 0, exceptions: 0, lateDiscoveries: 1, reroutes: 0 };

function dec(m: MetricKey): number {
  return DECIMALS[m] ?? 1;
}

function CiChart({ exp, metric }: { exp: ExperimentResult; metric: MetricKey }) {
  const t = useT();
  const rows = exp.variants.map((v) => ({ v, s: exp.summary[v.id]?.[metric] ?? null, pts: exp.runs.filter((r) => r.variant === v.id).map((r) => r[metric]).filter((x): x is number => typeof x === 'number') }));
  const max = Math.max(1e-9, ...rows.flatMap((r) => [...r.pts, r.s ? r.s.mean + r.s.ci : 0]));
  const W = 440;
  const label = 82;
  const valueW = metric === 'evDelay' ? 206 : 96;
  const plot = W - label - valueW;
  const rowH = 28;
  const x = (val: number) => label + (val / max) * plot;
  // ambulance delay is defined only for runs where it arrived: say how many did
  const valueText = (s: Summary | null, vid: string) => {
    const base = s ? `${s.mean.toFixed(dec(metric))} ± ${s.ci.toFixed(dec(metric))}` : '';
    if (metric !== 'evDelay') return base || t('bm.na');
    const all = exp.runs.filter((r) => r.variant === vid);
    const k = all.filter((r) => r.evArrived === 1).length;
    return s ? `${base} (${t('bm.arrivals', { k, n: all.length })})` : t('bm.noArrival', { n: all.length });
  };
  return (
    <figure className="bm-chart">
      <figcaption>{t(`bm.m.${metric}` as I18nKey)}</figcaption>
      <svg viewBox={`0 0 ${W} ${rows.length * rowH + 6}`} role="img" aria-label={t(`bm.m.${metric}` as I18nKey)}>
        {rows.map((r, i) => {
          const y = i * rowH + 4;
          const c = COLORS[r.v.id] ?? '#c3cdd8';
          return (
            <g key={r.v.id}>
              <text x={0} y={y + 14} className="bm-lab">
                {r.v.id}
              </text>
              <rect x={label} y={y + 5} width={plot} height={12} rx={3} className="bm-track" />
              {r.s && (
                <>
                  <rect x={label} y={y + 5} width={Math.max(0, x(r.s.mean) - label)} height={12} rx={3} fill={c} opacity={0.32} />
                  <line x1={x(Math.max(0, r.s.mean - r.s.ci))} x2={x(r.s.mean + r.s.ci)} y1={y + 11} y2={y + 11} stroke={c} strokeWidth={1.6} />
                  <line x1={x(r.s.mean)} x2={x(r.s.mean)} y1={y + 3} y2={y + 19} stroke={c} strokeWidth={2.2} />
                </>
              )}
              {r.pts.map((p, k) => (
                <circle key={k} cx={x(Math.max(0, p))} cy={y + 11} r={2.1} fill={c} opacity={0.75} />
              ))}
              <text x={W} y={y + 14} textAnchor="end" className="bm-val">
                {valueText(r.s, r.v.id)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function verdict(t: ReturnType<typeof useT>, d: PairedDiff): { tone: string; text: string } {
  const m = d.diff;
  const k = dec(d.metric);
  const lo = (m.mean - m.ci).toFixed(k);
  const hi = (m.mean + m.ci).toFixed(k);
  const p = { v: d.variant, r: d.reference, d: Math.abs(m.mean).toFixed(k), lo, hi, n: m.n };
  if (m.n > 1 && m.mean + m.ci < 0) return { tone: 'lower', text: t('bm.lower', { ...p, k: d.lower }) };
  if (m.n > 1 && m.mean - m.ci > 0) return { tone: 'higher', text: t('bm.higher', { ...p, k: d.higher }) };
  return { tone: 'unclear', text: t('bm.unclear', { ...p, k: d.lower }) };
}

function Comparisons({ exp }: { exp: ExperimentResult }) {
  const t = useT();
  const metrics = HEADLINE[exp.id] ?? [];
  const pairs: Array<[string, string]> = [
    ['B', 'A'],
    ['C', 'B'],
  ];
  for (const v of exp.variants.filter((x) => x.ablation)) pairs.push(v.policy === 'C' ? [v.id, 'C'] : [v.id, 'B']);
  return (
    <ul className="bm-verdicts">
      {pairs.flatMap(([a, b]) =>
        metrics.map((m) => {
          const d = exp.comparisons.find((x) => x.variant === a && x.reference === b && x.metric === m);
          if (!d) return null;
          const v = verdict(t, d);
          return (
            <li key={`${a}-${b}-${m}`} className={`bm-v ${v.tone}`}>
              <span className="bm-v-m">{t(`bm.m.${m}` as I18nKey)}</span>
              <span>{v.text}</span>
            </li>
          );
        }),
      )}
    </ul>
  );
}

function ExperimentCard({ exp }: { exp: ExperimentResult }) {
  const t = useT();
  const rows = TABLE[exp.id] ?? [];
  const inv = INVARIANTS.map((m) => ({ m, total: exp.runs.reduce((a, r) => a + ((r[m] as number) ?? 0), 0) }));
  const hard = exp.runs.reduce((a, r) => a + r.hardBrakes, 0);
  return (
    <section className="card bm-card" aria-labelledby={`bm-${exp.id}`}>
      <h2 id={`bm-${exp.id}`}>{t(`bm.e.${exp.id}` as I18nKey)}</h2>
      <div className="sub">{t(`bm.e.${exp.id}.d` as I18nKey, { h: Math.round(exp.horizon / 60) })}</div>
      <div className="bm-charts">
        {(HEADLINE[exp.id] ?? []).map((m) => (
          <CiChart key={m} exp={exp} metric={m} />
        ))}
      </div>
      <div className="note">{t('bm.ci')}</div>
      <h3 className="mini-title">{t('bm.paired')}</h3>
      <Comparisons exp={exp} />
      <h3 className="mini-title">{t('bm.table')}</h3>
      <div className="table-wrap" style={{ maxHeight: 'none' }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('bm.metric')}</th>
              {exp.variants.map((v) => (
                <th key={v.id} className="r">
                  {v.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m}>
                <td>{t(`bm.m.${m}` as I18nKey)}</td>
                {exp.variants.map((v) => {
                  const s = exp.summary[v.id]?.[m];
                  const text = !s ? t('bm.na') : m === 'evArrived' ? `${Math.round(s.mean * s.n)}/${s.n}` : `${s.mean.toFixed(dec(m))} ± ${s.ci.toFixed(dec(m))}`;
                  return (
                    <td key={v.id} className="r mono">
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t('bm.tripsNote')}</p>
      <div className={`status-line ${inv.every((x) => x.total === 0) ? 'ok' : 'critical'}`}>
        {t('bm.invariants', { n: exp.runs.length })}: {inv.map((x) => `${t(`bm.m.${x.m}` as I18nKey)} ${x.total}`).join(' · ')}
        {' · '}
        {t('bm.m.hardBrakes')} {hard}
      </div>
    </section>
  );
}

type RerunState = { exp: string; seed: number; rows: Array<{ variant: string; ok: boolean; diffs: string[]; ms: number }>; running: string | null; error?: string };

function round4(v: unknown): unknown {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v;
}

function Rerun() {
  const t = useT();
  const [exp, setExp] = useState(DOC.experiments[0]?.id ?? 'blackout');
  const [seed, setSeed] = useState(DOC.seeds[0]);
  const [state, setState] = useState<RerunState | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const run = () => {
    worker.current?.terminate();
    const e = DOC.experiments.find((x) => x.id === exp)!;
    const w = new Worker(new URL('../rerun.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setState({ exp, seed, rows: [], running: e.variants[0].id });
    w.onmessage = (ev: MessageEvent<{ variant?: string; metrics?: RunMetrics; ms?: number; next?: string; done?: boolean; error?: string }>) => {
      const msg = ev.data;
      if (msg.error) {
        setState((s) => (s ? { ...s, running: null, error: msg.error } : s));
        return;
      }
      if (msg.metrics && msg.variant) {
        const stored = e.runs.find((r) => r.variant === msg.variant && r.seed === seed);
        const diffs: string[] = [];
        if (stored) {
          for (const k of Object.keys(stored) as MetricKey[]) {
            if (round4(msg.metrics[k]) !== stored[k]) diffs.push(`${k}: ${String(round4(msg.metrics[k]))} vs ${String(stored[k])}`);
          }
        } else diffs.push('no stored run');
        setState((s) => (s ? { ...s, rows: [...s.rows, { variant: msg.variant!, ok: diffs.length === 0, diffs, ms: msg.ms ?? 0 }], running: msg.next ?? null } : s));
      }
      if (msg.done) w.terminate();
    };
    w.postMessage({ experiment: exp, seed, variants: e.variants.map((v) => v.id) });
  };
  return (
    <section className="card" aria-labelledby="bm-rerun">
      <h2 id="bm-rerun">{t('bm.verify')}</h2>
      <div className="sub">{t('bm.verifyNote')}</div>
      <div className="bm-rerun-controls">
        <label>
          <span>{t('bm.experiment')}</span>
          <select value={exp} onChange={(e) => setExp(e.target.value as ExperimentDef['id'])}>
            {DOC.experiments.map((x) => (
              <option key={x.id} value={x.id}>
                {t(`bm.e.${x.id}` as I18nKey)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('bm.seed')}</span>
          <select value={seed} onChange={(e) => setSeed(Number(e.target.value))}>
            {DOC.seeds.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" onClick={run} disabled={!!state?.running}>
          {t('bm.run')}
        </button>
      </div>
      {state && (
        <ul className="bm-rerun-rows">
          {state.rows.map((r) => (
            <li key={r.variant} className={r.ok ? 'ok' : 'bad'}>
              <b>{r.variant}</b> {r.ok ? t('bm.match', { s: (r.ms / 1000).toFixed(1) }) : t('bm.mismatch', { n: r.diffs.length })}
              {!r.ok && <div className="mono small muted">{r.diffs.slice(0, 4).join(' · ')}</div>}
            </li>
          ))}
          {state.running && <li className="running">{t('bm.running', { v: state.running })}</li>}
          {state.error && <li className="bad">{state.error}</li>}
        </ul>
      )}
    </section>
  );
}

export function Benchmark() {
  const t = useT();
  if (!DOC?.experiments?.length) {
    return (
      <section className="card">
        <h2>{t('bm.title')}</h2>
        <p className="note">{t('bm.noData')}</p>
      </section>
    );
  }
  return (
    <section className="stack" aria-labelledby="bm-h">
      <div>
        <h2 id="bm-h" className="bm-h">
          {t('bm.title')}
        </h2>
        <div className="muted small">{t('bm.meta', { hash: DOC.configHash, commit: DOC.commit, map: DOC.network, date: DOC.generatedAt.slice(0, 10), n: DOC.seeds.length })}</div>
      </div>
      <div className="callout">
        <b>{t('bm.statusTitle')}</b> {t('bm.status', { n: DOC.seeds.length })}
      </div>
      <div className="card">
        <h2>{t('bm.variants')}</h2>
        <ul className="bm-legend">
          {['A', 'B', 'C', 'C-nogroup', 'C-noadvice', 'B-priority'].map((id) => (
            <li key={id}>
              <i style={{ background: COLORS[id] }} />
              <b className="mono">{id}</b>
              <span>{t(`bm.v.${id}` as I18nKey)}</span>
            </li>
          ))}
        </ul>
      </div>
      {DOC.experiments.map((e) => (
        <ExperimentCard key={e.id} exp={e} />
      ))}
      <Rerun />
    </section>
  );
}
