import { useStore, type CamMode } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon, type IconName } from './Icons';
import { useState } from 'react';
import { controller } from '../controller';
import { rovingKeyDown } from './roving';

interface Item {
  mode: CamMode;
  icon: IconName;
  key: I18nKey;
  hotkey: string;
}

const ITEMS: Item[] = [
  { mode: 'overview', icon: 'city', key: 'cam.overview', hotkey: '1' },
  { mode: 'topdown', icon: 'topdown', key: 'cam.topdown', hotkey: '2' },
  { mode: 'incident', icon: 'target', key: 'cam.incident', hotkey: '3' },
  { mode: 'follow', icon: 'car', key: 'cam.follow', hotkey: '4' },
  { mode: 'emergency', icon: 'ambulance', key: 'cam.emergency', hotkey: '5' },
  { mode: 'street', icon: 'street', key: 'cam.street', hotkey: '6' },
  { mode: 'free', icon: 'move', key: 'cam.free', hotkey: '7' },
];

export function CameraToolbar({ available }: { available: Partial<Record<CamMode, boolean>> }) {
  const t = useT();
  const mode = useStore((s) => s.camMode);
  const rtl = useStore((s) => s.lang === 'ar');
  const shortcuts = useStore((s) => s.shortcuts);
  // roving tabindex: one button is in the tab order (the last focused one, else the current mode)
  const [last, setLast] = useState<CamMode | 'reset' | null>(null);
  const enabledOf = (k: CamMode | 'reset') => k === 'reset' || available[k] !== false;
  const stop = [last, mode, ...ITEMS.map((it) => it.mode), 'reset' as const].find((k) => k !== null && enabledOf(k)) ?? 'reset';
  return (
    <div
      className="cam-toolbar glass"
      role="toolbar"
      aria-label={t('cam.toolbar')}
      onKeyDown={(e) => rovingKeyDown(e, { rtl })}
    >
      {ITEMS.map((it) => {
        const enabled = enabledOf(it.mode);
        return (
          <button
            key={it.mode}
            aria-pressed={mode === it.mode}
            disabled={!enabled}
            tabIndex={stop === it.mode ? 0 : -1}
            onFocus={() => setLast(it.mode)}
            onClick={() => controller.setCamMode(it.mode)}
            title={shortcuts ? `${t(it.key)} (${it.hotkey})` : t(it.key)}
            aria-label={t(it.key)}
          >
            <Icon name={it.icon} />
            <span className="label hide-md">{t(it.key)}</span>
          </button>
        );
      })}
      <span className="sep" />
      <button
        tabIndex={stop === 'reset' ? 0 : -1}
        onFocus={() => setLast('reset')}
        onClick={() => controller.resetCamera()}
        title={`${t('cam.reset')} (Home)`}
        aria-label={t('cam.reset')}
      >
        <Icon name="home" />
      </button>
    </div>
  );
}
