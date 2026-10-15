import { useEffect, useRef } from 'react';
import { useStore, type CamMode, type QualityChoice } from './store';
import { useT } from './i18n';
import { controller } from './controller';
import { Header } from './components/Header';
import { PlaybackBar } from './components/PlaybackBar';
import { CameraToolbar } from './components/CameraToolbar';
import { SidePanel, Section } from './components/SidePanel';
import { PerfOverlay, Toasts } from './components/Overlays';
import { Icon } from './components/Icons';
import { EvidenceView } from './views/EvidenceView';
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

function DisplaySection() {
  const t = useT();
  const overlays = useStore((s) => s.overlays);
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <Section title={t('display.title')}>
      <label className="toggle">
        <span>{t('display.labels')}</span>
        <input type="checkbox" checked={overlays.labels} onChange={(e) => setOverlay('labels', e.target.checked)} />
      </label>
    </Section>
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
  const t = useT();
  useEffect(() => {
    if (host.current && webgl) controller.mount(host.current);
  }, [webgl]);
  return (
    <>
      <div
        ref={host}
        className="stage"
        tabIndex={0}
        role="application"
        aria-label="3D city view. Drag to orbit, right-drag or shift-drag to pan, scroll to zoom. Arrow keys orbit, plus and minus zoom, Home resets the camera."
        onKeyDown={(e) => {
          if (controller.world?.handleKey(e.nativeEvent)) e.preventDefault();
        }}
      />
      <div className="stage-vignette" />
      <div className={`stage-fade ${ready ? 'done' : ''}`} aria-hidden="true" />
      {!webgl && (
        <div className="fallback">
          <div className="card">
            <h2>{t('nowebgl.title')}</h2>
            <p className="muted">{t('nowebgl.body')}</p>
          </div>
        </div>
      )}
    </>
  );
}

export function App() {
  const t = useT();
  const view = useStore((s) => s.view);
  const lang = useStore((s) => s.lang);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);

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

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useStore.getState();
      if (e.key === ' ' && st.view === 'twin' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
        e.preventDefault();
        controller.togglePlay();
      } else if (e.key === 'Home') {
        controller.resetCamera();
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
      <a className="skip-link" href="#main-controls">
        Skip to controls
      </a>
      <TwinStage />
      <Header />
      {view === 'twin' && (
        <>
          <CameraToolbar available={{ incident: false, follow: false, emergency: false }} />
          <SidePanel side="left" title={t('panel.ops')}>
            <div id="main-controls" />
            <DisplaySection />
            <GraphicsSection />
          </SidePanel>
          <SidePanel side="right" title={t('panel.intel')}>
            <Section title={t('intel.network')}>
              <p className="note">
                <Icon name="info" /> {t('intel.pending')}
              </p>
            </Section>
          </SidePanel>
          <DistrictCaption />
          <PlaybackBar length={900} />
          <PerfOverlay />
        </>
      )}
      {view === 'compare' && <EvidenceView />}
      {view === 'engineering' && <EngineeringView />}
      {view === 'about' && <AboutView />}
      <Toasts />
    </div>
  );
}
