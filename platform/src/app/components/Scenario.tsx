import { useState } from 'react';
import { useStore, type ScenarioKey } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon, type IconName } from './Icons';
import { Section } from './SidePanel';
import { controller } from '../controller';
import { BLACKOUT_JUNCTIONS } from '../../core/network/district';
import { getNetwork } from '../../core/network/build';
import type { Policy } from '../../core/dm/types';

const CARDS: Array<{ key: ScenarioKey; icon: IconName; ready: boolean }> = [
  { key: 'normal', icon: 'city', ready: true },
  { key: 'blackout', icon: 'signal', ready: true },
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
      <PolicyControls />
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
