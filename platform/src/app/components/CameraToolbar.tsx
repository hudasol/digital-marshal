import { useStore, type CamMode } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon, type IconName } from './Icons';
import { controller } from '../controller';

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
  return (
    <div className="cam-toolbar glass" role="toolbar" aria-label={t('cam.toolbar')}>
      {ITEMS.map((it) => {
        const enabled = available[it.mode] !== false;
        return (
          <button
            key={it.mode}
            aria-pressed={mode === it.mode}
            disabled={!enabled}
            onClick={() => controller.setCamMode(it.mode)}
            title={`${t(it.key)} (${it.hotkey})`}
            aria-label={t(it.key)}
          >
            <Icon name={it.icon} />
            <span className="label hide-md">{t(it.key)}</span>
          </button>
        );
      })}
      <span className="sep" />
      <button onClick={() => controller.resetCamera()} title={`${t('cam.reset')} (Home)`} aria-label={t('cam.reset')}>
        <Icon name="home" />
      </button>
    </div>
  );
}
