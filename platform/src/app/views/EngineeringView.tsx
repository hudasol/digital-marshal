import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { controller, formatRel } from '../controller';
import { dmFor } from '../../core/scenarios';
import type { ReasonCode } from '../../core/dm/types';
import { Icon } from '../components/Icons';
import { resolutionText } from '../explain';

/* Engineering inspector: the raw state of the running session, the recipe that reproduces it, exports
   of everything the interface shows, the validation reason codes, and the known limitations. Values are
   read directly from the simulation; nothing on this page is computed for display only. */

const REASONS: ReasonCode[] = [
  'ACCEPTED',
  'SCHEMA_INVALID',
  'DUPLICATE',
  'MAP_VERSION_MISMATCH',
  'UNKNOWN_ISSUER',
  'CERT_EXPIRED',
  'BAD_SIGNATURE',
  'NOT_PERMITTED',
  'UNKNOWN_LOCATION',
  'OUT_OF_SCOPE',
  'FUTURE_TIMESTAMP',
  'NOT_YET_VALID',
  'EXPIRED',
  'STALE',
  'OUTDATED_VERSION',
  'CONFLICTING_UPDATE',
];

const LIMITS = ['district', 'behaviour', 'works', 'radio', 'keys', 'assist', 'benchmark', 'ev', 'render'] as const;

type VehicleFilter = 'all' | 'stopped' | 'mrc' | 'connected';

function csv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stem(): string {
  const e = controller.engine;
  const policy = dmFor(e).s.params.policy;
  return `digital-marshal_seed${e.state.seed}_policy${policy}_t${Math.round(e.state.t)}`;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Everything needed to reproduce the run, plus what it produced. */
function runRecord(): unknown {
  const session = controller.session;
  const e = controller.engine;
  const dm = dmFor(e).s;
  const st = e.state;
  return {
    generator: 'Digital Marshal platform (synthetic district; exploratory prototype)',
    exportedAtSimTime: st.t,
    reproduce: {
      seed: st.seed,
      engine: e.cfg,
      dm: dm.params,
      map: e.net.version,
      interventions: session.interventions.map((iv) => ({ t: iv.t, kind: iv.kind, params: iv.params })),
    },
    counters: st.counters,
    dm: dm.stats,
    incidents: Object.values(dm.incidents),
    exceptions: Object.values(dm.exceptions),
    tasks: Object.values(dm.tasks),
    emergencyRuns: [...dm.evRuns, ...(dm.ev && dm.ev.arrivedAt === null ? [dm.ev] : [])],
    messages: Object.values(dm.messages).map((m) => ({ ...m, nodeVerdict: dm.verdicts[m.header.msgId] ?? null, receivers: dm.rxTally[m.header.msgId] ?? null })),
    trips: st.trips,
    events: st.events,
  };
}

const EXPORTS: Array<{ id: string; label: I18nKey; make: () => { name: string; text: string; type: string } }> = [
  { id: 'run', label: 'eng.exp.run', make: () => ({ name: `${stem()}_run.json`, text: JSON.stringify(runRecord(), null, 1), type: 'application/json' }) },
  {
    id: 'trips',
    label: 'eng.exp.trips',
    make: () => {
      const rows: Array<Array<string | number | boolean>> = [['id', 'class', 'av', 'start_s', 'end_s', 'travel_s', 'free_flow_s', 'delay_s', 'distance_m', 'stopped_s', 'reroutes']];
      for (const t of controller.engine.state.trips) rows.push([t.id, t.cls, t.av, r1(t.t0), r1(t.t1), r1(t.t1 - t.t0), r1(t.ffT), r1(t.t1 - t.t0 - t.ffT), Math.round(t.dist), r1(t.stopped), t.reroutes]);
      return { name: `${stem()}_trips.csv`, text: csv(rows), type: 'text/csv' };
    },
  },
  {
    id: 'messages',
    label: 'eng.exp.messages',
    make: () => {
      const dm = dmFor(controller.engine).s;
      const rows: Array<Array<string | number | null>> = [
        ['msg_id', 'type', 'issuer', 'incident', 'version', 'origin', 'test', 'issued_s', 'valid_from_s', 'valid_until_s', 'node_status', 'node_code', 'rx_accepted', 'rx_rejected', 'rx_flagged', 'text'],
      ];
      for (const m of Object.values(dm.messages)) {
        const v = dm.verdicts[m.header.msgId];
        const rx = dm.rxTally[m.header.msgId];
        rows.push([m.header.msgId, m.body.type, m.header.issuer, m.header.incidentId, m.header.version, m.origin, m.test ?? '', r1(m.header.issuedAt), r1(m.header.validFrom), r1(m.header.validUntil), v?.status ?? '', v?.code ?? '', rx?.accepted ?? null, rx?.rejected ?? null, rx?.flagged ?? null, m.body.text]);
      }
      return { name: `${stem()}_messages.csv`, text: csv(rows), type: 'text/csv' };
    },
  },
  {
    id: 'exceptions',
    label: 'eng.exp.exceptions',
    make: () => {
      const dm = dmFor(controller.engine).s;
      const rows: Array<Array<string | number | boolean | null>> = [['id', 'vehicle', 'type', 'junction', 'incident', 'raised_s', 'status', 'resolved_s', 'wait_s', 'emergency_route', 'resolution']];
      for (const x of Object.values(dm.exceptions)) rows.push([x.id, x.tag, x.type, x.junction, x.incidentId, r1(x.raisedAt), x.status, x.resolvedAt === null ? null : r1(x.resolvedAt), x.resolvedAt === null ? null : r1(x.resolvedAt - x.raisedAt), x.emergencyRoute, x.resolution]);
      return { name: `${stem()}_exceptions.csv`, text: csv(rows), type: 'text/csv' };
    },
  },
  {
    id: 'events',
    label: 'eng.exp.events',
    make: () => {
      const rows: Array<Array<string | number>> = [['t_s', 'kind', 'tone', 'ref', 'params']];
      for (const ev of controller.engine.state.events) rows.push([r1(ev.t), ev.kind, ev.tone, ev.ref ?? '', JSON.stringify(ev.p ?? {})]);
      return { name: `${stem()}_events.csv`, text: csv(rows), type: 'text/csv' };
    },
  },
  {
    id: 'vehicles',
    label: 'eng.exp.vehicles',
    make: () => {
      const st = controller.engine.state;
      const rows: Array<Array<string | number | boolean>> = [['id', 'tag', 'class', 'av', 'connected', 'segment', 'lane', 's_m', 'speed_ms', 'mode', 'binding', 'binding_ref', 'route']];
      for (const id of st.order) {
        const v = st.vehicles[id];
        rows.push([v.id, v.tag, v.cls, v.av, v.connected, `${v.seg.k}:${v.seg.id}`, v.seg.lane, r1(v.s), r1(v.v), v.mode, v.bind.kind, v.bind.ref, v.route.join(' ')]);
      }
      return { name: `${stem()}_vehicles.csv`, text: csv(rows), type: 'text/csv' };
    },
  },
];

function useRefresh(ms: number): void {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function RunRecipe() {
  const t = useT();
  const e = controller.engine;
  const dm = dmFor(e).s;
  const p = dm.params;
  const ivs = controller.session.interventions;
  const rows: Array<[I18nKey, string]> = [
    ['eng.seed', String(e.state.seed)],
    ['eng.policy', `${p.policy} (${[p.grouping && 'grouping', p.advice && 'advice', p.priority && 'priority'].filter(Boolean).join(', ') || '-'})`],
    ['eng.density', `${e.state.densityScale.toFixed(2)}x`],
    ['eng.warmup', `${e.cfg.warmup} s`],
    ['eng.odd', `${e.cfg.oddMaxLanes}`],
    ['eng.map', e.net.version],
    ['eng.operators', `${p.operators} (${p.handleIndividual} s / ${p.handleGroupBase} + ${p.handleGroupPer} s per vehicle)`],
    ['eng.detection', `${p.detectionDelay} s`],
    ['eng.radio', `RSU ${p.rsuLatency[0]}-${p.rsuLatency[1]} ms, ${(p.rsuLoss * 100).toFixed(0)}% loss; cell ${p.cellLatency[0]}-${p.cellLatency[1]} ms, ${(p.cellLoss * 100).toFixed(0)}% loss`],
  ];
  return (
    <div className="card">
      <h2>{t('eng.recipe')}</h2>
      <div className="sub">{t('eng.recipeSub')}</div>
      <table className="data">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{t(k)}</td>
              <td className="r mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mini-title" style={{ marginTop: 12 }}>
        {t('eng.interventions')}
      </div>
      {ivs.length === 0 ? (
        <p className="note">{t('eng.noInterventions')}</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 180 }}>
          <table className="data">
            <tbody>
              {ivs.map((iv) => (
                <tr key={iv.id}>
                  <td className="mono">{formatRel(iv.t)}</td>
                  <td className="mono">{iv.kind}</td>
                  <td className="mono small muted">{JSON.stringify(iv.params).slice(0, 90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Exports() {
  const t = useT();
  return (
    <div className="card">
      <h2>{t('eng.exports')}</h2>
      <div className="sub">{t('eng.exportsSub')}</div>
      <div className="eng-exports">
        {EXPORTS.map((x) => (
          <button
            key={x.id}
            className="btn sm"
            onClick={() => {
              const f = x.make();
              download(f.name, f.text, f.type);
            }}
          >
            <Icon name="download" /> {t(x.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Vehicles() {
  const t = useT();
  const [filter, setFilter] = useState<VehicleFilter>('stopped');
  const st = controller.engine.state;
  const list = st.order
    .map((id) => st.vehicles[id])
    .filter((v) => (filter === 'all' ? true : filter === 'stopped' ? v.v < 0.3 : filter === 'mrc' ? v.mode === 'mrc' : v.connected))
    .slice(0, 80);
  return (
    <div className="card">
      <div className="eng-head">
        <h2>{t('eng.vehicles')}</h2>
        <div className="seg" role="radiogroup" aria-label={t('eng.vehicles')}>
          {(['stopped', 'mrc', 'connected', 'all'] as VehicleFilter[]).map((f) => (
            <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
              {t(`eng.f.${f}` as I18nKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('eng.col.vehicle')}</th>
              <th>{t('eng.col.segment')}</th>
              <th className="r">{t('eng.col.speed')}</th>
              <th>{t('eng.col.mode')}</th>
              <th>{t('eng.col.binding')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr
                key={v.id}
                className="click"
                onClick={() => {
                  controller.selectVehicle(v.id);
                  const st = useStore.getState();
                  if (!st.rightOpen) st.toggleRight();
                  st.setView('twin');
                }}
              >
                <td className="mono">{v.tag}</td>
                <td className="mono small">
                  {v.seg.id}#{v.seg.lane}
                </td>
                <td className="r mono">{(v.v * 3.6).toFixed(0)}</td>
                <td className="mono">{v.mode}</td>
                <td className="mono small">
                  {v.bind.kind}
                  {v.bind.ref ? `:${v.bind.ref}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t('eng.vehiclesNote', { n: list.length, total: st.order.length })}</p>
    </div>
  );
}

function Signals() {
  const t = useT();
  const e = controller.engine;
  return (
    <div className="card">
      <h2>{t('eng.signals')}</h2>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('eng.col.junction')}</th>
              <th>{t('eng.col.phase')}</th>
              <th>{t('eng.col.interval')}</th>
              <th className="r">{t('eng.col.remaining')}</th>
            </tr>
          </thead>
          <tbody>
            {e.net.junctionIds.map((j) => {
              const s = e.signal(j);
              const jd = e.net.junctions[j];
              return (
                <tr key={j}>
                  <td className="mono">{j}</td>
                  <td className="small">{s.dark ? t('eng.dark') : jd.plan.phases[s.phase]?.label}</td>
                  <td className="mono small">{s.dark ? '-' : s.pre ? `${t('eng.preempt')} (${s.pre.stage})` : s.interval}</td>
                  <td className="r mono">{s.dark ? '' : `${s.remaining.toFixed(1)} s`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mini-title" style={{ marginTop: 12 }}>
        {t('eng.closures')}
      </div>
      {e.state.road.closures.length === 0 ? (
        <p className="note">{t('eng.none')}</p>
      ) : (
        <table className="data">
          <tbody>
            {e.state.road.closures.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.id}</td>
                <td className="mono small">
                  {c.link} {t('eng.lanes')} {c.lanes.map((k) => k + 1).join(',')} {c.s0}-{c.s1} m
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MessageLog() {
  const t = useT();
  const dm = dmFor(controller.engine).s;
  const msgs = Object.values(dm.messages).slice(-60).reverse();
  return (
    <div className="card">
      <h2>{t('eng.messages')}</h2>
      <div className="sub">{t('eng.messagesSub', { n: Object.keys(dm.messages).length })}</div>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('eng.col.time')}</th>
              <th>{t('eng.col.message')}</th>
              <th>{t('eng.col.type')}</th>
              <th>{t('eng.col.issuer')}</th>
              <th className="r">v</th>
              <th>{t('eng.col.verdict')}</th>
            </tr>
          </thead>
          <tbody>
            {msgs.map((m) => {
              const v = dm.verdicts[m.header.msgId];
              return (
                <tr key={m.header.msgId}>
                  <td className="mono small">{formatRel(m.header.issuedAt)}</td>
                  <td className="mono small">{m.header.msgId}</td>
                  <td className="mono small">{m.body.type}</td>
                  <td className="mono small">
                    {m.header.issuer}
                    {m.origin !== 'published' ? ` (${m.origin})` : ''}
                  </td>
                  <td className="r mono">{m.header.version}</td>
                  <td className={`mono small ${v?.status === 'accepted' ? 'ok' : 'bad'}`}>{v?.code ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Exceptions() {
  const t = useT();
  const dm = dmFor(controller.engine).s;
  const list = Object.values(dm.exceptions).slice(-60).reverse();
  return (
    <div className="card">
      <h2>{t('eng.exceptions')}</h2>
      {list.length === 0 ? (
        <p className="note">{t('eng.none')}</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('eng.col.id')}</th>
                <th>{t('eng.col.vehicle')}</th>
                <th>{t('eng.col.junction')}</th>
                <th>{t('eng.col.status')}</th>
                <th>{t('eng.col.resolution')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td className="mono small">{x.id}</td>
                  <td className="mono small">{x.tag}</td>
                  <td className="mono">{x.junction}</td>
                  <td className="small">{t(`exc.${x.status}` as I18nKey)}</td>
                  <td className="small muted">{resolutionText(t, x.resolution)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function EngineeringView() {
  const t = useT();
  useRefresh(500);
  const clock = useStore((s) => s.clock);
  const q = useStore((s) => s.effectiveQuality);
  const e = controller.engine;
  return (
    <div className="view" role="main">
      <div className="view-inner stack">
        <div>
          <h1>{t('eng.title')}</h1>
          <p className="lede">{t('eng.lede')}</p>
          <div className="eng-status mono small">
            {formatRel(clock.t)} {'·'} {clock.playing ? t('status.running') : t('status.paused')} {'·'} {clock.speed}x {'·'} {e.state.order.length}{' '}
            {t('eng.vehiclesShort')} {'·'} {t('eng.gfx')} {q}
          </div>
        </div>
        <div className="grid-2">
          <RunRecipe />
          <div className="stack">
            <Exports />
            <div className="card">
              <h2>{t('eng.reasons')}</h2>
              <div className="table-wrap" style={{ maxHeight: 300 }}>
                <table className="data">
                  <tbody>
                    {REASONS.map((r) => (
                      <tr key={r}>
                        <td className="mono small">{r}</td>
                        <td className="small">{t(`rc.${r}` as I18nKey)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <Vehicles />
          <Signals />
        </div>
        <div className="grid-2">
          <MessageLog />
          <Exceptions />
        </div>
        <div className="card">
          <h2>{t('eng.limits')}</h2>
          <ul className="clean">
            {LIMITS.map((k) => (
              <li key={k}>{t(`lim.${k}` as I18nKey)}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
