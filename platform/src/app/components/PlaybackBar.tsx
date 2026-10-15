import { useStore } from '../store';
import { useT } from '../i18n';
import { Icon } from './Icons';
import { controller, formatClock, formatRel } from '../controller';
import type { Marker as TimelineMarker } from '../store';

const SPEEDS = [0.5, 1, 2, 4, 8, 16];

export function PlaybackBar({ markers = [], length }: { markers?: TimelineMarker[]; length: number }) {
  const t = useT();
  const clock = useStore((s) => s.clock);
  const span = Math.max(length, clock.horizon, clock.t, 1);
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / span) * 100))}%`;
  const nextMarker = markers.find((m) => m.t > clock.t + 0.5);

  return (
    <div className="bar glass" role="group" aria-label={t('play.scrub')}>
      <div className="group">
        <button
          className="play-btn"
          onClick={() => controller.togglePlay()}
          aria-label={clock.playing ? t('play.pause') : t('play.play')}
          title={`${clock.playing ? t('play.pause') : t('play.play')} (Space)`}
        >
          <Icon name={clock.playing ? 'pause' : 'play'} />
        </button>
        <button className="btn icon ghost" onClick={() => controller.restart()} aria-label={t('play.restart')} title={t('play.restart')}>
          <Icon name="restart" />
        </button>
        <button
          className="btn icon ghost"
          onClick={() => nextMarker && controller.seek(nextMarker.t)}
          disabled={!nextMarker}
          aria-label={t('play.next')}
          title={t('play.next')}
        >
          <Icon name="next" />
        </button>
      </div>

      <div className="time-readout">
        <span className="clock num">{formatClock(clock.t)}</span>
        <span className="clock-rel">{formatRel(clock.t)}</span>
      </div>

      <div className="timeline">
        <div className="timeline-track">
          <div className="timeline-known" style={{ width: pct(clock.horizon) }} />
          <div className="timeline-fill" style={{ width: pct(clock.t) }} />
        </div>
        {markers.map((m, i) => (
          <span key={i} className={`marker ${m.tone}`} style={{ insetInlineStart: pct(m.t) }} />
        ))}
        <span className="timeline-thumb" style={{ insetInlineStart: pct(clock.t) }} />
        <input
          type="range"
          min={0}
          max={span}
          step={0.5}
          value={clock.t}
          aria-label={t('play.scrub')}
          aria-valuetext={`${formatClock(clock.t)} (${formatRel(clock.t)})`}
          onChange={(e) => controller.seek(parseFloat(e.target.value))}
        />
        <div className="timeline-labels" aria-hidden="true">
          <span>{formatRel(0)}</span>
          <span>{formatRel(span)}</span>
        </div>
      </div>

      <div className="divider hide-sm" />
      <div className="seg hide-sm" role="group" aria-label={t('play.speed')} style={{ width: 236 }}>
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={clock.speed === s} onClick={() => controller.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
