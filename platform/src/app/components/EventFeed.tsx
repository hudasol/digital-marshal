import { useState } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { formatClock } from '../controller';
import { controller } from '../controller';
import type { SimEvent } from '../../core/sim/types';
import { placeName } from '../explain';
import { getNetwork } from '../../core/network/build';

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
  'ev-dispatched',
  'ev-preempt',
  'ev-arrived',
  'works-planned',
  'works-active',
  'works-lifted',
  'works-rejected',
  'conflict-reasserted',
  'restricted-entry',
]);

export function eventText(t: ReturnType<typeof useT>, e: SimEvent): string {
  const p: Record<string, string | number> = { ref: e.ref ?? '' };
  for (const [k, v] of Object.entries(e.p ?? {})) p[k] = typeof v === 'number' ? Math.round(v * 10) / 10 : String(v);
  if (p.stage === 'lane' || p.stage === 'full') p.stage = t(`rw.stage.${p.stage}` as I18nKey);
  if (p.kind === 'individual' || p.kind === 'group') p.kind = t(`ev.kind.${p.kind}` as I18nKey);
  if (e.kind === 'ev-dispatched' && typeof p.to === 'string') {
    const place = Object.values(getNetwork().places).find((x) => x.label === p.to);
    if (place) p.to = placeName(t, place.id, place.label);
  }
  return t(`ev.${e.kind}` as I18nKey, p);
}

export function EventFeed() {
  const t = useT();
  const events = useStore((s) => s.events);
  const leftOpen = useStore((s) => s.leftOpen);
  const shown = events.filter((e) => SHOWN.has(e.kind)).slice(0, 5);
  // Screen readers hear only the newest event, through a live region that is always in the DOM
  // (a region inserted together with its first message usually goes unannounced). The text changes
  // only when a new event arrives, so switching language does not re-announce the last one.
  const newest = shown[0];
  const newestKey = newest ? `${newest.t}-${newest.kind}-${newest.ref ?? ''}` : '';
  const [said, setSaid] = useState({ key: '', text: '' });
  if (said.key !== newestKey) setSaid({ key: newestKey, text: newest ? eventText(t, newest) : '' });
  const click = (e: SimEvent) => {
    if (e.kind === 'outage-detected' || e.kind === 'incident-resolved' || e.kind === 'works-planned' || e.kind === 'works-active' || e.kind === 'works-lifted') {
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
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {said.text}
      </div>
      {shown.length > 0 && (
        <section className={`feed glass ${leftOpen ? 'shifted' : ''}`} aria-labelledby="feed-title">
          <h2 className="feed-title" id="feed-title">
            {t('feed.title')}
          </h2>
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
        </section>
      )}
    </>
  );
}
