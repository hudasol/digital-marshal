import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { controller } from '../controller';
import { Icon } from './Icons';
import type { BindKind } from '../../core/sim/types';

/* Callouts in the 3D view: the ambulance with what limits it right now, junctions whose signals
   are dark, and the roadworks zone. Content comes from the simulation frames; the controller moves
   each callout to the screen position of its anchor every frame. They repeat what the panels say,
   so they are hidden from assistive technology and switch off with the information overlays. */

function evStatus(kind: BindKind | undefined): { key: I18nKey; tone: 'ok' | 'info' | 'warn' } {
  switch (kind) {
    case 'leader':
    case 'lanechange':
      return { key: 'lbl.ev.leader', tone: 'warn' };
    case 'signal':
      return { key: 'lbl.ev.signal', tone: 'info' };
    case 'box':
    case 'exit':
    case 'awsc':
    case 'closure':
      return { key: 'lbl.ev.junction', tone: 'info' };
    case 'arrive':
      return { key: 'lbl.ev.arrive', tone: 'ok' };
    default:
      return { key: 'lbl.ev.free', tone: 'ok' };
  }
}

export function SceneLabels() {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const ev = useStore((s) => s.dm?.ev ?? null);
  const dark = useStore((s) => s.dm?.dark ?? null);
  const works = useStore((s) => s.dm?.works ?? null);
  const evLive = useStore((s) => s.evLive);
  const on = useStore((s) => s.overlays.v2x);

  useEffect(() => {
    const el = host.current;
    controller.labelHost = el;
    return () => {
      if (controller.labelHost === el) controller.labelHost = null;
    };
  }, []);

  const st = evStatus(evLive?.kind);
  const showWorks = works && works.status === 'active' && (works.inPlace || works.activatesAt !== null);
  return (
    <div className="scene-labels" ref={host} aria-hidden="true">
      {on && ev?.active && (
        <div className="slabel slabel-ev" data-anchor="ev">
          <div className="slabel-card">
            <div className="slabel-row">
              <b className="mono">{ev.tag}</b>
              <span className="mono">{ev.incidentId}</span>
            </div>
            <div className="slabel-row">
              <span className={`slabel-chip tone-${st.tone}`}>{t(st.key)}</span>
              {evLive && <span className="mono slabel-speed">{t('lbl.ev.speed', { n: Math.round(evLive.speedKmh) })}</span>}
            </div>
          </div>
          <i className="slabel-stem" />
        </div>
      )}
      {on &&
        dark?.map((j) => (
          <div key={j} className="slabel slabel-alert" data-anchor={`j:${j}`}>
            <div className="slabel-pill">
              <Icon name="alert" />
              <span>{t('lbl.dark')}</span>
              <b className="mono">{j}</b>
            </div>
            <i className="slabel-stem" />
          </div>
        ))}
      {on && showWorks && (
        <div className="slabel slabel-works" data-anchor="works">
          <div className="slabel-pill">
            <Icon name="cone" />
            <span>{t(works.inPlace ? (works.stage === 'full' ? 'lbl.works.full' : 'lbl.works.lane') : 'lbl.works.planned')}</span>
            <b className="mono">{works.incidentId}</b>
          </div>
          <i className="slabel-stem" />
        </div>
      )}
    </div>
  );
}
