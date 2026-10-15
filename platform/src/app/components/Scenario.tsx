import { useState } from 'react';
import { useStore, type ScenarioKey } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon, type IconName } from './Icons';
import { Section } from './SidePanel';
import { controller } from '../controller';
import { BLACKOUT_JUNCTIONS, WORKS_STAGES } from '../../core/network/district';
import { getNetwork } from '../../core/network/build';
import { INJECTIONS } from '../../core/dm/inject';
import { TRUST_STORE } from '../../core/dm/trust';
import type { Policy } from '../../core/dm/types';
import type { WorksFrame } from '../dmframes';
import { placeName } from '../explain';

const CARDS: Array<{ key: ScenarioKey; icon: IconName; ready: boolean }> = [
  { key: 'normal', icon: 'city', ready: true },
  { key: 'blackout', icon: 'signal', ready: true },
  { key: 'emergency', icon: 'ambulance', ready: true },
  { key: 'roadworks', icon: 'cone', ready: true },
];

export function ScenarioCards() {
  const t = useT();
  const scenario = useStore((s) => s.scenario);
  const setScenario = useStore((s) => s.setScenario);
  return (
    <Section title={t('scn.title')}>
      <div className="scn-cards" role="radiogroup" aria-label={t('scn.title')}>
        {CARDS.map((c) => (
          <button
            key={c.key}
            role="radio"
            aria-checked={scenario === c.key}
            className={`scn-card ${scenario === c.key ? 'on' : ''}`}
            onClick={() => setScenario(c.key)}
            disabled={!c.ready}
          >
            <span className="scn-ico">
              <Icon name={c.icon} />
            </span>
            <span className="scn-txt">
              <b>{t(`scn.${c.key}` as I18nKey)}</b>
              <span>{t(`scn.${c.key}.d` as I18nKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

export function BlackoutControls() {
  const t = useT();
  const dm = useStore((s) => s.dm);
  const [sel, setSel] = useState<string[]>([...BLACKOUT_JUNCTIONS]);
  const [restoreMin, setRestoreMin] = useState(8);
  const net = getNetwork();
  const dark = dm?.dark ?? [];
  const odd = controller.engine.cfg.oddMaxLanes;
  return (
    <Section title={t('scn.blackout')}>
      <div className="field">
        <div className="field-row">
          <span>{t('bo.junctions')}</span>
        </div>
        <div className="chips-grid" role="group" aria-label={t('bo.junctions')}>
          {net.junctionIds.map((j) => {
            const wide = net.junctions[j].maxApproachLanes > odd;
            return (
              <button
                key={j}
                className={`jchip ${sel.includes(j) ? 'on' : ''} ${dark.includes(j) ? 'dark' : ''}`}
                aria-pressed={sel.includes(j)}
                onClick={() => setSel((x) => (x.includes(j) ? x.filter((y) => y !== j) : [...x, j].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))))}
                title={`${net.junctions[j].label}${wide ? ' · 3-lane approaches' : ''}`}
              >
                {j}
                {wide ? <i className="wide" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <div className="field-row">
          <span>{t('bo.restoreAfter')}</span>
          <b>{restoreMin === 0 ? t('bo.manual') : t('bo.minutes', { n: restoreMin })}</b>
        </div>
        <input type="range" min={0} max={12} step={1} value={restoreMin} onChange={(e) => setRestoreMin(parseInt(e.target.value, 10))} aria-label={t('bo.restoreAfter')} />
      </div>
      <div className="btn-row">
        <button className="btn danger" onClick={() => controller.triggerBlackout(sel, restoreMin ? restoreMin * 60 : null)} disabled={!sel.length}>
          <Icon name="bolt" /> {t('bo.trigger')}
        </button>
        <button className="btn" onClick={() => controller.restorePower()} disabled={!dark.length}>
          {t('bo.restore')}
        </button>
      </div>
      {dark.length > 0 && <div className="status-line critical">{t('bo.active', { list: dark.join(', ') })}</div>}
      <p className="note">{t('bo.note', { lanes: odd })}</p>
    </Section>
  );
}

export function EmergencyControls() {
  const t = useT();
  const dm = useStore((s) => s.dm);
  const net = getNetwork();
  const ev = dm?.ev;
  const active = !!ev?.active;
  return (
    <Section title={t('scn.emergency')}>
      <div className="kv small" style={{ marginBottom: 10 }}>
        <span>{t('ev.from')}</span>
        <b>{placeName(t, 'hospital', net.places.hospital.label)}</b>
        <span>{t('ev.to')}</span>
        <b>{placeName(t, 'scene', net.places.scene.label)}</b>
      </div>
      <div className="btn-row">
        <button className="btn danger" onClick={() => controller.dispatchAmbulance()} disabled={active}>
          <Icon name="ambulance" /> {t('ev.dispatch')}
        </button>
        <button className="btn" onClick={() => controller.setCamMode('emergency')} disabled={!active}>
          <Icon name="car" /> {t('ev.follow')}
        </button>
      </div>
      {active && ev && <div className="status-line critical">{t('ev.active', { tag: ev.tag })}</div>}
      <p className="note">{t('ev.notePolicy')}</p>
    </Section>
  );
}

function WorksStatus({ w, now }: { w: WorksFrame; now: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const lanes = w.lanes.map((k) => k + 1).join(', ');
  let line: { tone: string; text: string } | null = null;
  if (w.stage === 'rejected') line = { tone: 'critical', text: t('rw.rejected', { code: w.submission?.code ?? '' }) };
  else if (w.status === 'resolved') line = { tone: 'ok', text: t('rw.lifted') };
  else if (w.activatesAt !== null) {
    const what = t(w.stage === 'full' ? 'rw.what.full' : 'rw.what.lane');
    line = { tone: 'warn', text: t('rw.pending', { what, n: Math.max(0, Math.ceil(w.activatesAt - now)) }) };
  } else if (w.inPlace) {
    line =
      w.stage === 'full'
        ? { tone: 'critical', text: t('rw.inPlace.full', { road: w.road }) }
        : { tone: 'critical', text: t('rw.inPlace.lane', { lanes, s0: w.s0.toFixed(0), s1: w.s1.toFixed(0) }) };
  }
  const sub = w.submission;
  return (
    <>
      {line && <div className={`status-line ${line.tone}`}>{line.text}</div>}
      {sub && (
        <div className="sub-check">
          <button className="sub-head" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
            <Icon name={sub.status === 'accepted' ? 'check' : 'x'} />
            <span>{t('rw.submission')}</span>
            <b className={sub.status === 'accepted' ? 'ok' : 'bad'}>{t('rw.subText', { code: sub.code, n: sub.checks.length })}</b>
          </button>
          {open && (
            <ul className="checks">
              {sub.checks.map((c, i) => (
                <li key={i} className={c.pass ? 'pass' : 'fail'}>
                  <Icon name={c.pass ? 'check' : 'x'} />
                  <b>{c.name}</b>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export function RoadworksControls() {
  const t = useT();
  const dm = useStore((s) => s.dm);
  const now = useStore((s) => s.clock.t);
  const w = dm?.works ?? null;
  const net = getNetwork();
  const link = net.links[WORKS_STAGES.lane.link];
  const active = w?.status === 'active';
  const scope = TRUST_STORE['WORKS-C07'].scope;
  return (
    <Section title={t('scn.roadworks')}>
      <div className="kv small" style={{ marginBottom: 10 }}>
        <span>{t('rw.contractor')}</span>
        <b className="mono">WORKS-C07</b>
        <span>{t('rw.where')}</span>
        <b>
          {link.roadName} <span className="mono muted">{link.id}</span>
        </b>
        <span>{t('rw.permit')}</span>
        <b className="mono">{'links' in scope ? scope.links.join(', ') : ''}</b>
      </div>
      <div className="btn-row">
        <button className="btn warn" onClick={() => controller.planWorks('lane')} disabled={active}>
          <Icon name="cone" /> {t('rw.planLane')}
        </button>
        <button className="btn danger" onClick={() => controller.planWorks('full')} disabled={!active || w?.stage === 'full'}>
          {t('rw.escalate')}
        </button>
        <button className="btn" onClick={() => controller.liftWorks()} disabled={!active}>
          {t('rw.lift')}
        </button>
      </div>
      {w && <WorksStatus w={w} now={now} />}
      {dm && (
        <>
          <div className="mini-title">{t('rw.audit')}</div>
          <div className="kv small">
            <span>{t('rw.late')}</span>
            <b className="num">{dm.audit.lateDiscoveries}</b>
            <span>{t('rw.restricted')}</span>
            <b className={`num ${dm.audit.restrictedEntries ? 'bad' : 'ok'}`}>{dm.audit.restrictedEntries}</b>
          </div>
        </>
      )}
      <p className="note">{t('rw.note')}</p>
    </Section>
  );
}

export function SecurityTests() {
  const t = useT();
  const dm = useStore((s) => s.dm);
  const policy = dm?.policy ?? 'C';
  const rows = dm?.security ?? [];
  const live = dm?.liveIncident ?? false;
  return (
    <Section title={t('sec.title')}>
      <p className="note" style={{ marginTop: 0 }}>
        {t('sec.intro')}
      </p>
      {policy === 'A' && <div className="callout small-callout">{t('sec.policyA')}</div>}
      <ul className="sec-list">
        {INJECTIONS.map((x) => {
          let last = null;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].test === x.id) {
              last = rows[i];
              break;
            }
          }
          const blocked = x.needsIncident && !live;
          const ok = last ? last.code === x.expect && !(last.rx?.accepted ?? 0) : null;
          return (
            <li key={x.id} className={`sec-row ${ok === null ? '' : ok ? 'pass' : 'fail'}`}>
              <div className="sec-main">
                <b>{t(`sec.${x.id}` as I18nKey)}</b>
                <span>{t(`sec.${x.id}.d` as I18nKey)}</span>
                <span className="sec-expect">
                  {t('sec.expect')} <span className="mono">{x.expect}</span>
                </span>
              </div>
              <button
                className="btn sm"
                onClick={() => controller.injectTest(x.id)}
                disabled={policy === 'A' || blocked}
                title={blocked ? t('sec.needsIncident') : undefined}
              >
                {t('sec.inject')}
              </button>
              {last && (
                <div className="sec-result">
                  <span className={`chip ${last.status === 'accepted' ? 'red' : last.status === 'flagged' ? 'amber' : 'green'}`}>
                    {t('sec.node')} <span className="mono">{last.code}</span>
                  </span>
                  <span className="sec-rx">
                    {last.rx
                      ? t('sec.vehicles', { rejected: last.rx.rejected, flagged: last.rx.flagged, accepted: last.rx.accepted })
                      : now() - last.at < 3
                        ? t('sec.inflight')
                        : t('sec.none')}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="note">{t('sec.note')}</p>
    </Section>
  );
}

function now(): number {
  return controller.engine.state.t;
}

export function PolicyControls() {
  const t = useT();
  const dm = useStore((s) => s.dm);
  const policy = dm?.policy ?? 'C';
  const busy = useStore((s) => s.busy);
  return (
    <Section title={t('pol.title')}>
      <div className="seg" role="radiogroup" aria-label={t('pol.title')}>
        {(['A', 'B', 'C'] as Policy[]).map((p) => (
          <button key={p} role="radio" aria-checked={policy === p} aria-pressed={policy === p} onClick={() => controller.setPolicy(p)} disabled={!!busy}>
            {p}
          </button>
        ))}
      </div>
      <div className="policy-desc">
        <b>{t(`pol.${policy}` as I18nKey)}</b>
        <span>{t(`pol.${policy}.d` as I18nKey)}</span>
      </div>
      {policy === 'C' && <div className="callout small-callout">{t('pol.assumption')}</div>}
      <p className="note">{t('pol.replay')}</p>
    </Section>
  );
}

export function CommsControls() {
  const t = useT();
  const [loss, setLoss] = useState(0);
  const [lat, setLat] = useState(0);
  const [battery, setBattery] = useState(false);
  const [cell, setCell] = useState(true);
  const commit = (p: Record<string, unknown>) => controller.setComms(p);
  return (
    <Section title={t('comms.title')}>
      <div className="field">
        <div className="field-row">
          <span>{t('comms.loss')}</span>
          <b>{Math.round(loss * 100)}%</b>
        </div>
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.05}
          value={loss}
          onChange={(e) => setLoss(parseFloat(e.target.value))}
          onPointerUp={() => commit({ extraLoss: loss })}
          onKeyUp={() => commit({ extraLoss: loss })}
          aria-label={t('comms.loss')}
        />
      </div>
      <div className="field">
        <div className="field-row">
          <span>{t('comms.latency')}</span>
          <b>{lat} ms</b>
        </div>
        <input
          type="range"
          min={0}
          max={5000}
          step={250}
          value={lat}
          onChange={(e) => setLat(parseInt(e.target.value, 10))}
          onPointerUp={() => commit({ extraLatencyMs: lat })}
          onKeyUp={() => commit({ extraLatencyMs: lat })}
          aria-label={t('comms.latency')}
        />
      </div>
      <label className="toggle">
        <span>{t('comms.battery')}</span>
        <input
          type="checkbox"
          checked={battery}
          onChange={(e) => {
            setBattery(e.target.checked);
            commit({ rsuBattery: e.target.checked });
          }}
        />
      </label>
      <label className="toggle">
        <span>{t('comms.cell')}</span>
        <input
          type="checkbox"
          checked={cell}
          onChange={(e) => {
            setCell(e.target.checked);
            commit({ cellular: e.target.checked });
          }}
        />
      </label>
    </Section>
  );
}

export function ScenarioPanel() {
  const t = useT();
  const scenario = useStore((s) => s.scenario);
  const engineering = useStore((s) => s.engineering);
  const toggleEngineering = useStore((s) => s.toggleEngineering);
  return (
    <>
      <ScenarioCards />
      {scenario === 'blackout' && <BlackoutControls />}
      {scenario === 'emergency' && <EmergencyControls />}
      {scenario === 'roadworks' && <RoadworksControls />}
      <PolicyControls />
      {(scenario === 'roadworks' || engineering) && <SecurityTests />}
      <label className="toggle eng-toggle">
        <span>
          <Icon name="code" /> {t('eng.toggle')}
        </span>
        <input type="checkbox" checked={engineering} onChange={toggleEngineering} />
      </label>
      {engineering && <CommsControls />}
      <Section title={t('scn.reset')}>
        <button className="btn" onClick={() => controller.resetScenario()}>
          <Icon name="restart" /> {t('scn.reset')}
        </button>
        <p className="note">{t('scn.resetNote')}</p>
      </Section>
    </>
  );
}
