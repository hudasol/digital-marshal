import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { formatClock } from '../controller';
import { controller } from '../controller';
import type { SimEvent } from '../../core/sim/types';

const SHOWN = new Set([
  'power-loss',
  'outage-detected',
  'msg-published',
  'assist-request',
  'assist-task',
  'assist-granted',
  'junction-authorized',
  'power-restored',
  'incident-resolved',
  'advisory-batch',
  'inject-rejected',
  'inject-accepted',
  'hard-brake',
]);

export function eventText(t: ReturnType<typeof useT>, e: SimEvent): string {
  const p: Record<string, string | number> = { ref: e.ref ?? '' };
  for (const [k, v] of Object.entries(e.p ?? {})) p[k] = typeof v === 'number' ? Math.round(v * 10) / 10 : String(v);
  return t(`ev.${e.kind}` as I18nKey, p);
}

export function EventFeed() {
  const t = useT();
  const events = useStore((s) => s.events);
  const leftOpen = useStore((s) => s.leftOpen);
  const shown = events.filter((e) => SHOWN.has(e.kind)).slice(0, 5);
  if (!shown.length) return null;
  const click = (e: SimEvent) => {
    if (e.kind === 'outage-detected' || e.kind === 'incident-resolved') {
      if (e.ref) controller.selectIncident(e.ref);
      return;
    }
    if (e.kind === 'assist-request' && e.ref) {
      const st = controller.engine.state;
      const id = st.order.find((i) => st.vehicles[i].tag === e.ref);
      if (id !== undefined) controller.selectVehicle(id);
    }
  };
  return (
    <div className={`feed glass ${leftOpen ? 'shifted' : ''}`} role="log" aria-label={t('feed.title')} aria-live="polite">
      <div className="feed-title">{t('feed.title')}</div>
      <ol>
        {shown.map((e, i) => (
          <li key={`${e.t}-${e.kind}-${i}`} className={`tone-${e.tone}`}>
            <button className="feed-item" onClick={() => click(e)}>
              <span className="feed-dot" aria-hidden="true" />
              <span className="feed-t mono">{formatClock(e.t)}</span>
              <span className="feed-x">{eventText(t, e)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
