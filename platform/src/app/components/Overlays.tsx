import { useStore } from '../store';
import { useT } from '../i18n';
import { Icon } from './Icons';

export function PerfOverlay() {
  const t = useT();
  const open = useStore((s) => s.perfOpen);
  const perf = useStore((s) => s.perf);
  const q = useStore((s) => s.effectiveQuality);
  const toggle = useStore((s) => s.togglePerf);
  if (!open) return null;
  const tone = perf.fps >= 50 ? 'var(--green)' : perf.fps >= 30 ? 'var(--amber)' : 'var(--red-text)';
  return (
    <div className="perf glass" role="region" aria-label={t('gfx.perf')}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span className="fps-big" style={{ color: tone }}>
          {perf.fps.toFixed(0)}
        </span>
        <span className="muted">{t('perf.fps')}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm icon ghost" onClick={toggle} aria-label={t('perf.close')} title={t('perf.close')}>
          <Icon name="x" />
        </button>
      </div>
      <table>
        <tbody>
          <tr>
            <td>{t('perf.frame')}</td>
            <td>{perf.frameMs.toFixed(1)} ms</td>
          </tr>
          <tr>
            <td>{t('perf.sim')}</td>
            <td>{perf.simMs.toFixed(2)} ms</td>
          </tr>
          <tr>
            <td>{t('perf.calls')}</td>
            <td>{perf.calls}</td>
          </tr>
          <tr>
            <td>{t('perf.tris')}</td>
            <td>{(perf.tris / 1000).toFixed(0)}k</td>
          </tr>
          <tr>
            <td>{t('perf.geo')}</td>
            <td>{perf.geometries}</td>
          </tr>
          <tr>
            <td>{t('perf.tex')}</td>
            <td>{perf.textures}</td>
          </tr>
          <tr>
            <td>{t('perf.pr')}</td>
            <td>{perf.pixelRatio.toFixed(2)}</td>
          </tr>
          <tr>
            <td>{t('perf.quality')}</td>
            <td>{t(`gfx.${q}`)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toast-area" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div
          key={x.id}
          className="toast glass"
          style={{
            borderColor: x.tone === 'warn' ? 'rgba(244,183,64,0.45)' : x.tone === 'critical' ? 'rgba(239,83,80,0.5)' : undefined,
          }}
        >
          {x.text}
        </div>
      ))}
    </div>
  );
}
