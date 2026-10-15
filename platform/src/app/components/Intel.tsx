import { useLayoutEffect, useRef } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon } from './Icons';
import { Section } from './SidePanel';
import { bindText, bindTone, fmtDuration, logText, placeName } from '../explain';
import { controller, formatRel } from '../controller';
import type { NetworkFrame, VehicleFrame } from '../frames';
import type { VehicleClass } from '../../core/sim/types';
import { DmOverview, EvMission, IncidentInspector, VehicleDmSection } from './IncidentInspector';

const CLASS_COLOR: Record<VehicleClass, string> = {
  robotaxi: '#45d4e8',
  car: '#8b98a8',
  van: '#c3cdd8',
  bus: '#2f8fae',
  ambulance: '#ef5350',
};

function Sparkline({ data, max }: { data: Array<{ t: number; v: number }>; max: number }) {
  if (data.length < 2) return <div className="spark-empty" />;
  const W = 300;
  const H = 54;
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const pts = data.map((d) => `${(((d.t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - (d.v / Math.max(1, max)) * (H - 6) - 3).toFixed(1)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <polyline points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="rgba(69,212,232,0.12)" stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke="#45d4e8" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function NetworkOverview({ n }: { n: NetworkFrame }) {
  const t = useT();
  const total = Object.values(n.byClass).reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...n.series.map((p) => p.active), 1);
  return (
    <>
      <Section title={t('intel.network')}>
        <div className="kpis">
          <div className="kpi-s">
            <b className="num">{n.active}</b>
            <span>{t('intel.active')}</span>
          </div>
          <div className="kpi-s">
            <b className="num">{n.meanSpeedKmh.toFixed(0)}<small> km/h</small></b>
            <span>{t('intel.speed')}</span>
          </div>
          <div className="kpi-s">
            <b className="num">{n.moving}</b>
            <span>{t('intel.moving')}</span>
          </div>
          <div className="kpi-s">
            <b className="num">{n.stopped}</b>
            <span>
              {t('intel.stopped')} · {n.waitingAtSignals} {t('intel.atSignals')}
            </span>
          </div>
          <div className="kpi-s">
            <b className="num">{n.exits}</b>
            <span>{t('intel.trips')}</span>
          </div>
          <div className="kpi-s">
            <b className="num">{n.exits ? n.meanDelay.toFixed(0) : '–'}<small> s</small></b>
            <span>{t('intel.delay')}</span>
          </div>
        </div>
        <div className="mini-title">{t('intel.stoppedSeries')}</div>
        <Sparkline data={n.series.map((p) => ({ t: p.t, v: p.stopped }))} max={max} />
      </Section>
      <Section title={t('intel.mix')}>
        <div className="mixbar" role="img" aria-label={t('intel.mix')}>
          {(Object.keys(n.byClass) as VehicleClass[]).map((c) =>
            n.byClass[c] ? <i key={c} style={{ width: `${(n.byClass[c] / total) * 100}%`, background: CLASS_COLOR[c] }} /> : null,
          )}
        </div>
        <div className="legend">
          {(Object.keys(n.byClass) as VehicleClass[]).map((c) => (
            <span key={c}>
              <i style={{ background: CLASS_COLOR[c] }} />
              {t(`cls.${c}` as I18nKey)} <b className="num">{n.byClass[c]}</b>
            </span>
          ))}
        </div>
        <div className="kv small" style={{ marginTop: 10 }}>
          <span>{t('intel.nearMiss')}</span>
          <b className="num">{n.hardBrakes}</b>
          <span>{t('intel.queued')}</span>
          <b className="num">{n.queuedEntries}</b>
        </div>
      </Section>
      <p className="note hint">
        <Icon name="info" /> {t('intel.hint')}
      </p>
    </>
  );
}

export function VehicleInspector({ v }: { v: VehicleFrame }) {
  const t = useT();
  const select = useStore((s) => s.select);
  const vdm = useStore((s) => s.vehicleDm);
  const evFrame = useStore((s) => s.dm?.ev ?? null);
  const camMode = useStore((s) => s.camMode);
  const tone = v.exited ? 'info' : bindTone(v.bind.kind);
  const junctionSteps = v.route.slice(0, -1);
  return (
    <div className="inspector">
      <div className="insp-head">
        <div>
          <div className="insp-tag mono">{v.tag}</div>
          <div className="insp-chips">
            <span className="chip muted">{t(`cls.${v.cls}` as I18nKey)}</span>
            {v.connected ? <span className="chip cyan">{t('veh.connected')}</span> : <span className="chip muted">{t('veh.notConnected')}</span>}
            {v.mode === 'mrc' && <span className="chip red">{t('veh.mode.mrc')}</span>}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <button
          className="btn sm"
          aria-pressed={camMode === 'follow'}
          onClick={() => controller.setCamMode(camMode === 'follow' ? 'free' : 'follow')}
          disabled={v.exited}
        >
          <Icon name="car" /> {t('veh.follow')}
        </button>
        <button className="btn sm icon ghost" onClick={() => select(null)} aria-label={t('veh.close')} title={t('veh.close')}>
          <Icon name="x" />
        </button>
      </div>

      {/* not a live region: the plan is rewritten several times a second and would keep a screen reader talking */}
      <div className={`now tone-${tone}`}>
        <div className="now-label">{t('veh.planning')}</div>
        <div className="now-text">{v.exited ? t('veh.exited') : bindText(t, v.bind, v.speedKmh)}</div>
      </div>

      {v.cls === 'ambulance' && evFrame && evFrame.id === v.id && <EvMission ev={evFrame} />}
      {v.cls !== 'ambulance' && <VehicleDmSection d={vdm} connected={v.connected} />}

      <Section title={t('veh.motion')}>
        <div className="kv">
          <span>{t('veh.speed')}</span>
          <b className="num">{v.speedKmh.toFixed(0)} km/h</b>
          <span>{t('veh.accel')}</span>
          <b className="num">{v.acc.toFixed(1)} m/s²</b>
          <span>{t('veh.road')}</span>
          <b>{v.road}</b>
          <span>{t('veh.lane')}</span>
          <b className="num">{v.inJunction ? '\u2014' : t('veh.laneOf', { lane: v.lane + 1, lanes: v.lanes })}</b>
        </div>
      </Section>

      <Section title={t('veh.route')}>
        <div className="kv">
          <span>{t('veh.from')}</span>
          <b>{v.originPlace ? placeName(t, v.originPlace, v.origin) : v.origin}</b>
          <span>{t('veh.to')}</span>
          <b>{v.destPlace ? placeName(t, v.destPlace, v.destLabel) : v.destLabel}</b>
          <span>{t('veh.remaining')}</span>
          <b className="num">{(v.remainingM / 1000).toFixed(2)} km</b>
        </div>
        <ol className="route-chain" aria-label={t('veh.route')}>
          {junctionSteps.map((r) => (
            <li key={r.link} className={r.done ? 'done' : r.current ? 'current' : ''}>
              <span className="mono">{r.to}</span>
            </li>
          ))}
          <li className="dest">
            <Icon name="flag" />
          </li>
        </ol>
      </Section>

      <Section title={t('veh.identity')}>
        <div className="kv">
          <span>{t('veh.autonomy')}</span>
          <b>{v.av ? t('veh.autonomy.av') : t('veh.autonomy.human')}</b>
          <span>{t('veh.inDistrict')}</span>
          <b className="num">{fmtDuration(v.age)}</b>
          <span>{t('veh.stoppedFor')}</span>
          <b className="num">{fmtDuration(v.stopped)}</b>
          <span>{t('veh.reroutes')}</span>
          <b className="num">{v.reroutes}</b>
          <span>{t('veh.laneChanges')}</span>
          <b className="num">{v.laneChanges}</b>
        </div>
      </Section>

      <Section title={t('veh.timeline')}>
        <ol className="log">
          {v.log.map((e, i) => (
            <li key={`${e.t}-${i}`}>
              <span className="log-t mono">{formatRel(e.t)}</span>
              <span className="log-x">{logText(t, e)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export function IntelPanel() {
  const network = useStore((s) => s.network);
  const vehicle = useStore((s) => s.vehicle);
  const incident = useStore((s) => s.incident);
  const dm = useStore((s) => s.dm);
  const selection = useStore((s) => s.selection);
  const selKey = selection ? `${selection.kind}:${selection.id}` : null;
  const prevKey = useRef(selKey);
  const opener = useRef<HTMLElement | null>(null);
  // when an inspector closes, its close button disappears with it: return focus to whatever opened
  // the inspector (the 3D view, an event in the feed), or to this panel if that is gone
  useLayoutEffect(() => {
    const was = prevKey.current;
    prevKey.current = selKey;
    if (was === selKey) return;
    if (!was) {
      opener.current = document.activeElement as HTMLElement | null;
      return;
    }
    if (selKey) return;
    const back = opener.current;
    opener.current = null;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    if (back && back !== document.body && back.isConnected && !back.closest('[inert]')) back.focus();
    else document.getElementById('panel-right')?.focus();
  }, [selKey]);
  if (selection?.kind === 'vehicle' && vehicle) return <VehicleInspector v={vehicle} />;
  if (selection?.kind === 'incident' && incident) return <IncidentInspector f={incident} />;
  return (
    <>
      {dm && <DmOverview dm={dm} />}
      {network ? <NetworkOverview n={network} /> : null}
    </>
  );
}
