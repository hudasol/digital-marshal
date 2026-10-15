import { useEffect } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon } from './Icons';
import { TOUR, tour, type TourStepId } from '../tour';

/** Narration for every scene, checked by the compiler: a scene cannot exist without its text. */
const TEXT: Record<TourStepId | 'done', { t: I18nKey; b: I18nKey }> = {
  intro: { t: 'tour.intro.t', b: 'tour.intro.b' },
  traffic: { t: 'tour.traffic.t', b: 'tour.traffic.b' },
  blackout: { t: 'tour.blackout.t', b: 'tour.blackout.b' },
  emergency: { t: 'tour.emergency.t', b: 'tour.emergency.b' },
  roadworks: { t: 'tour.roadworks.t', b: 'tour.roadworks.b' },
  security: { t: 'tour.security.t', b: 'tour.security.b' },
  evidence: { t: 'tour.evidence.t', b: 'tour.evidence.b' },
  about: { t: 'tour.about.t', b: 'tour.about.b' },
  done: { t: 'tour.done.t', b: 'tour.done.b' },
};

/** The narration card of judge mode, shown over every view while the tour runs. */
export function TourCard() {
  const t = useT();
  const state = useStore((s) => s.tour);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tour.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state === null]);
  if (!state) return null;
  const step = TOUR[state.step];
  const id = state.done ? 'done' : step.id;
  const progress = state.done ? 1 : Math.min(1, state.elapsed / step.duration);
  return (
    <div className="tour glass" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className="tour-head">
        <span className="tour-badge">
          <Icon name="flag" /> {t('tour.badge')}
        </span>
        <span className="mono tour-count">
          {state.step + 1}/{TOUR.length}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn sm icon ghost" onClick={() => tour.stop()} aria-label={t('tour.exit')} title={t('tour.exit')}>
          <Icon name="x" />
        </button>
      </div>
      <h3 id="tour-title">{t(TEXT[id].t)}</h3>
      <p aria-live="polite">{t(TEXT[id].b)}</p>
      <div className="tour-steps" aria-hidden="true">
        {TOUR.map((s, i) => (
          <i key={s.id} className={i < state.step || state.done ? 'past' : i === state.step ? 'now' : ''}>
            {i === state.step && !state.done && <b style={{ width: `${progress * 100}%` }} />}
          </i>
        ))}
      </div>
      <div className="tour-controls">
        {state.done ? (
          <>
            <button className="btn primary" onClick={() => tour.start(0)}>
              <Icon name="restart" /> {t('tour.restart')}
            </button>
            <button className="btn" onClick={() => tour.stop()}>
              {t('tour.explore')}
            </button>
          </>
        ) : (
          <>
            <button className="btn sm" onClick={() => tour.prev()} disabled={state.step === 0}>
              {t('tour.prev')}
            </button>
            <button className="btn sm" onClick={() => tour.togglePause()} aria-pressed={state.paused}>
              <Icon name={state.paused ? 'play' : 'pause'} /> {state.paused ? t('tour.resume') : t('tour.pause')}
            </button>
            <button className="btn sm primary" onClick={() => tour.next()}>
              {t('tour.next')} <Icon name="next" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
