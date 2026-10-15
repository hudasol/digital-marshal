import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { BrandMark } from './Icons';

/* Opening screen while the 3D district streams in and is built. It reports real progress (bytes of
   the 3D kit received), then fades out over the first frame of the city. */

export function LoadingScreen() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const webgl = useStore((s) => s.webgl);
  const k = useStore((s) => s.loadProgress);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => setGone(true), 1600);
    return () => window.clearTimeout(id);
  }, [ready]);
  if (gone || !webgl) return null;
  const pct = Math.round(k * 100);
  const building = k >= 0.999 && !ready;
  return (
    <div className={`loader ${ready ? 'done' : ''}`} role="status" aria-live="polite">
      <div className="loader-inner">
        <BrandMark />
        <div className="loader-title">{t('brand.name')}</div>
        <div className="loader-tag">{t('brand.tagline')}</div>
        <div className="loader-sub">{t('brand.sub')}</div>
        <div className="loader-bar" aria-hidden="true">
          <i style={{ width: `${building || ready ? 100 : Math.max(4, pct)}%` }} />
        </div>
        <div className="loader-stage">
          {building || ready ? t('load.build') : `${t('load.kit')} · ${pct}%`}
        </div>
        <div className="loader-note">{t('load.note')}</div>
      </div>
    </div>
  );
}
