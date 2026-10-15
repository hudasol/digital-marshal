import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useStore, type CamMode, type QualityChoice } from './store';
import { useT } from './i18n';
import { controller, TIMELINE_S } from './controller';
import { Header } from './components/Header';
import { PlaybackBar } from './components/PlaybackBar';
import { CameraToolbar } from './components/CameraToolbar';
import { SidePanel, Section } from './components/SidePanel';
import { PerfOverlay, Toasts } from './components/Overlays';
import { IntelPanel } from './components/Intel';
import { ScenarioPanel } from './components/Scenario';
import { EventFeed } from './components/EventFeed';
import { TourCard } from './components/Tour';
import { MapFallback } from './components/MapFallback';
// the evidence view carries the benchmark data; load it only when it is opened
const EvidenceView = lazy(() => import('./views/EvidenceView').then((m) => ({ default: m.EvidenceView })));
import { EngineeringView } from './views/EngineeringView';
import { AboutView } from './views/AboutView';

const QUALITY_CHOICES: QualityChoice[] = ['auto', 'high', 'balanced', 'performance'];
const HOTKEY_MODES: Record<string, CamMode> = {
  '1': 'overview',
  '2': 'topdown',
  '3': 'incident',
  '4': 'follow',
  '5': 'emergency',
  '6': 'street',
  '7': 'free',
};

function GraphicsSection() {
  const t = useT();
  const quality = useStore((s) => s.quality);
  const eff = useStore((s) => s.effectiveQuality);
  const perfOpen = useStore((s) => s.perfOpen);
  const togglePerf = useStore((s) => s.togglePerf);
  return (
    <Section title={t('gfx.title')} extra={quality === 'auto' ? <span className="chip muted">{t(`gfx.${eff}`)}</span> : null}>
      <div className="seg" role="group" aria-label={t('gfx.title')}>
        {QUALITY_CHOICES.map((q) => (
          <button key={q} aria-pressed={quality === q} onClick={() => controller.setQualityChoice(q)}>
            {t(`gfx.${q}`)}
          </button>
        ))}
      </div>
      <label className="toggle" style={{ marginTop: 8 }}>
        <span>{t('gfx.perf')}</span>
        <input type="checkbox" checked={perfOpen} onChange={togglePerf} />
      </label>
    </Section>
  );
}

function SimulationSection() {
  const t = useT();
  const [density, setDensity] = useState(() => controller.engine.state.densityScale);
  const committed = useRef(density);
  const commit = () => {
    if (Math.abs(density - committed.current) > 1e-6) {
      committed.current = density;
      controller.setDensity(density);
    }
  };
  return (
    <Section title={t('sim.title')}>
      <div className="field">
        <div className="field-row">
          <span>{t('sim.density')}</span>
          <b>{Math.round(density * 100)}%</b>
        </div>
        <input
          type="range"
          min={0.4}
          max={1.3}
          step={0.05}
          value={density}
          aria-label={t('sim.density')}
          aria-valuetext={t('sim.densityValue', { pct: Math.round(density * 100) })}
          onChange={(e) => setDensity(parseFloat(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <div className="note">{t('sim.densityNote')}</div>
      </div>
      <div className="field-row small">
        <span className="muted">{t('sim.seed')}</span>
        <b>{controller.engine.state.seed}</b>
      </div>
    </Section>
  );
}

function DisplaySection() {
  const t = useT();
  const overlays = useStore((s) => s.overlays);
  const setOverlay = useStore((s) => s.setOverlay);
  const shortcuts = useStore((s) => s.shortcuts);
  const setShortcuts = useStore((s) => s.setShortcuts);
  return (
    <Section title={t('display.title')}>
      <label className="toggle">
        <span>{t('display.labels')}</span>
        <input type="checkbox" checked={overlays.labels} onChange={(e) => setOverlay('labels', e.target.checked)} />
      </label>
      <label className="toggle">
        <span>{t('display.v2x')}</span>
        <input type="checkbox" checked={overlays.v2x} onChange={(e) => setOverlay('v2x', e.target.checked)} />
      </label>
      <label className="toggle">
        <span>{t('keys.toggle')}</span>
        <input type="checkbox" checked={shortcuts} onChange={(e) => setShortcuts(e.target.checked)} aria-describedby="keys-note" />
      </label>
      <div className="note" id="keys-note">
        {t('keys.note')}
      </div>
    </Section>
  );
}

function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  // the live region is always present (and empty while idle), so the first message is announced too
  return (
    <div role="status" aria-live="polite">
      {busy && (
        <div className="busy-overlay glass">
          {busy.label}
          <div className="bar-line" aria-hidden="true">
            <i style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function DistrictCaption() {
  const t = useT();
  const rightOpen = useStore((s) => s.rightOpen);
  return (
    <div className={`district-caption ${rightOpen ? 'shifted' : ''}`} aria-hidden="true">
      <b>{t('caption.district')}</b>
      <span>{t('caption.district.sub')}</span>
    </div>
  );
}

function TwinStage() {
  const host = useRef<HTMLDivElement>(null);
  const webgl = useStore((s) => s.webgl);
  const ready = useStore((s) => s.ready);
  // the 3D view stays mounted under the other views: there it must leave the tab order and the
  // accessibility tree, or keyboard and screen reader users land on a city they cannot see
  const hidden = useStore((s) => s.view !== 'twin');
  const t = useT();
  useEffect(() => {
    if (host.current && webgl) controller.mount(host.current);
    else if (!webgl) controller.startHeadless();
  }, [webgl]);
  return (
    <div style={{ display: 'contents' }} inert={hidden ? true : undefined} aria-hidden={hidden || undefined}>
      <div
        ref={host}
        id="stage"
        className="stage"
        tabIndex={0}
        role="application"
        aria-label={t('a11y.stage')}
        onKeyDown={(e) => {
          if (controller.world?.handleKey(e.nativeEvent)) e.preventDefault();
        }}
      />
      <div className="stage-vignette" />
      <div className={`stage-fade ${ready ? 'done' : ''}`} aria-hidden="true" />
      {!webgl && (
        <>
          <MapFallback />
          <div className="fallback-banner glass" role="status">
            <b>{t('nowebgl.title')}</b>
            <span>{t('nowebgl.body')}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** The skip link goes to the main content of the current view; in the twin view that is the first
    open side panel, or the 3D view when both are collapsed. */
function skipToMain(e: ReactMouseEvent<HTMLAnchorElement>): void {
  e.preventDefault();
  const st = useStore.getState();
  const target =
    st.view !== 'twin'
      ? document.querySelector<HTMLElement>('[role="main"], main')
      : document.getElementById(st.leftOpen ? 'panel-left' : st.rightOpen ? 'panel-right' : 'stage');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus();
}

export function App() {
  const t = useT();
  const view = useStore((s) => s.view);
  const lang = useStore((s) => s.lang);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const selection = useStore((s) => s.selection);
  const hasIncidents = useStore((s) => (s.dm?.incidents.length ?? 0) > 0);
  const evActive = useStore((s) => !!s.dm?.ev?.active);
  const markers = useStore((s) => s.markers);

  // language and direction on the document element
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // keep the city's focus centred in the space between the open panels
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const px = (v: string) => parseFloat(css.getPropertyValue(v)) || 0;
    const gutter = px('--gutter');
    const narrow = window.innerWidth <= 860;
    const l = leftOpen && !narrow ? px('--left-w') + gutter * 2 : 0;
    const r = rightOpen && !narrow ? px('--right-w') + gutter * 2 : 0;
    controller.updateViewShift(l, r);
  }, [leftOpen, rightOpen, lang]);

  // global keyboard shortcuts; the single-character ones can be turned off (WCAG 2.1.4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useStore.getState();
      if (e.key === 'Escape') {
        st.select(null);
        return;
      }
      if (e.key === 'Home') {
        controller.resetCamera();
        return;
      }
      if (!st.shortcuts) return;
      if (e.key === ' ') {
        // Space keeps its own meaning on anything that can be activated
        if (st.view !== 'twin' || el?.closest('button, a, summary, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="link"]')) return;
        e.preventDefault();
        controller.togglePlay();
      } else if (HOTKEY_MODES[e.key] && st.view === 'twin') {
        controller.setCamMode(HOTKEY_MODES[e.key]);
      } else if (e.key === '[') {
        st.toggleLeft();
      } else if (e.key === ']') {
        st.toggleRight();
      } else if (e.key.toLowerCase() === 'p' && e.shiftKey) {
        st.togglePerf();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={skipToMain}>
        {t('a11y.skip')}
      </a>
      <TwinStage />
      <Header />
      {view === 'twin' && (
        <>
          <h1 className="sr-only">{t('a11y.twin')}</h1>
          <CameraToolbar available={{ incident: hasIncidents, follow: selection?.kind === 'vehicle', emergency: evActive }} />
          <SidePanel side="left" title={t('panel.ops')}>
            <ScenarioPanel />
            <SimulationSection />
            <DisplaySection />
            <GraphicsSection />
          </SidePanel>
          <SidePanel side="right" title={t('panel.intel')}>
            <IntelPanel />
          </SidePanel>
          <DistrictCaption />
          <EventFeed />
          <PlaybackBar length={TIMELINE_S} markers={markers} />
          <BusyOverlay />
          <PerfOverlay />
        </>
      )}
      {view === 'compare' && (
        <Suspense fallback={<div className="view" />}>
          <EvidenceView />
        </Suspense>
      )}
      {view === 'engineering' && <EngineeringView />}
      {view === 'about' && <AboutView />}
      <TourCard />
      <Toasts />
    </div>
  );
}
