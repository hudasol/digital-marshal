import { useStore, type View } from '../store';
import { useT } from '../i18n';
import { BrandMark } from './Icons';
import { formatClock, formatRel } from '../controller';
import { Icon } from './Icons';
import { tour } from '../tour';
import { rovingKeyDown } from './roving';

const VIEWS: View[] = ['twin', 'compare', 'engineering', 'about'];

export function Header() {
  const t = useT();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const clock = useStore((s) => s.clock);
  const scenarioLabel = useStore((s) => s.scenarioLabel);
  const alertLevel = useStore((s) => s.alertLevel);
  const touring = useStore((s) => s.tour !== null);

  return (
    <header className="header" role="banner">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">{t('brand.name')}</span>
          <span className="brand-sub">{t('brand.sub')}</span>
        </div>
      </div>

      <div className="header-center">
        <div className="status-cluster" role="status" aria-live="off">
          <div className="status-item scn hide-sm">
            <span className={`status-dot ${alertLevel === 'critical' ? 'critical' : alertLevel === 'warn' ? 'paused' : ''}`} />
            <span className="muted">{t('status.scenario')}</span>
            <b>{scenarioLabel || t('scenario.normal')}</b>
          </div>
          <div className="status-item run">
            <span className={`status-dot ${clock.playing ? '' : 'paused'}`} />
            <span>{clock.playing ? t('status.running') : t('status.paused')}</span>
          </div>
          <div className="status-item" aria-label={t('play.time')}>
            <span className="clock">{formatClock(clock.t)}</span>
            <span className="clock-rel hide-md">{formatRel(clock.t)}</span>
          </div>
        </div>
      </div>

      <div className="header-right">
        <button
          id="judge-btn"
          className={`btn sm judge ${touring ? 'on' : ''}`}
          onClick={() => (touring ? tour.stop() : tour.start(0))}
          title={t('tour.startTitle')}
          aria-pressed={touring}
        >
          <Icon name="flag" /> <span className="hide-sm">{touring ? t('tour.exit') : t('tour.start')}</span>
        </button>
        <nav
          className="tabs"
          role="tablist"
          aria-label={t('nav.views')}
          onKeyDown={(e) => rovingKeyDown(e, { rtl: lang === 'ar', activate: true })}
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              className="tab"
              aria-selected={view === v}
              tabIndex={view === v ? 0 : -1}
              onClick={() => setView(v)}
            >
              {t(`view.${v}`)}
            </button>
          ))}
        </nav>
        <button
          className="btn sm ghost"
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          aria-label={t('lang.toggle.label')}
        >
          {/* only the visible label is in the other language; the button's name stays in this one */}
          <span lang={lang === 'en' ? 'ar' : 'en'}>{t('lang.toggle')}</span>
        </button>
        <span className="chip hide-md" title={t('chip.prototype.title')}>
          {t('chip.prototype')}
        </span>
      </div>
    </header>
  );
}
