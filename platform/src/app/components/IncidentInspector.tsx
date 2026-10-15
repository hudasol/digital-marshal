import { useState } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon } from './Icons';
import { Section } from './SidePanel';
import { controller, formatClock, formatRel } from '../controller';
import type { DmFrame, EvFrame, IncidentFrame, IncidentSummary, MessageView, VehicleDmView } from '../dmframes';
import { checkName, placeName, resolutionText } from '../explain';
import { getNetwork } from '../../core/network/build';

type T = ReturnType<typeof useT>;

/** Title and cause of an incident in the reader's language, built from its structured data. */
export function incidentText(t: T, inc: IncidentSummary & { issuer?: string }): { title: string; cause: string } {
  const sep = t('list.sep');
  const net = getNetwork();
  const place = (id?: string) => (id ? placeName(t, id, net.places[id]?.label ?? id) : '');
  switch (inc.type) {
    case 'signal_outage': {
      const area = inc.junctions.join(sep);
      return { title: t('incT.signal_outage', { area }), cause: t('incC.signal_outage', { area }) };
    }
    case 'roadworks': {
      const road = inc.subject.road ?? inc.links[0] ?? '';
      return {
        title: t('incT.roadworks', { road }),
        cause: t('incC.roadworks', { issuer: inc.issuer ?? '', road, link: inc.subject.link ?? inc.links[0] ?? '' }),
      };
    }
    case 'emergency_corridor': {
      const ev = inc.subject.ev ?? '';
      return { title: t('incT.emergency_corridor', { ev }), cause: t('incC.emergency_corridor', { ev, from: place(inc.subject.from), to: place(inc.subject.to) }) };
    }
  }
}

export function EvMission({ ev }: { ev: EvFrame }) {
  const t = useT();
  const total = ev.obstructed.vehicle + ev.obstructed.signal + ev.obstructed.junction + ev.obstructed.other;
  return (
    <div className={`now tone-${ev.active ? 'critical' : 'ok'}`}>
      <div className="now-label">
        {t('ev.mission')} {'\u00b7'} {ev.tag} {ev.active ? '' : `\u00b7 ${t('ev.arrived')}`}
      </div>
      <div className="kv small" style={{ marginTop: 6 }}>
        <span>{ev.active ? t('ev.elapsed') : t('ev.travel')}</span>
        <b className="num">{ev.elapsed.toFixed(0)} s</b>
        <span>{t('ev.ffT')}</span>
        <b className="num">{ev.ffT.toFixed(0)} s</b>
        {!ev.active && (
          <>
            <span>{t('ev.delay')}</span>
            <b className="num">{(ev.elapsed - ev.ffT).toFixed(1)} s</b>
          </>
        )}
        <span>{t('ev.obstructed')}</span>
        <b className="num">
          {total.toFixed(0)} s{' '}
          <span className="muted">
            ({t('ev.obs.vehicle')} {ev.obstructed.vehicle.toFixed(0)} {'\u00b7'} {t('ev.obs.signal')} {ev.obstructed.signal.toFixed(0)})
          </span>
        </b>
        <span>{t('ev.yields')}</span>
        <b>{t('ev.yieldsText', { ok: ev.yields.ok, no: ev.yields.infeasible })}</b>
        <span>{t('ev.preempts')}</span>
        <b className="num">{ev.preempts}</b>
      </div>
    </div>
  );
}

function statusChip(t: ReturnType<typeof useT>, status: string) {
  const cls = status === 'active' ? 'red' : status === 'resolved' ? 'green' : 'muted';
  return <span className={`chip ${cls}`}>{t(`inc.status.${status}` as I18nKey)}</span>;
}

export function DmOverview({ dm }: { dm: DmFrame }) {
  const t = useT();
  return (
    <Section title={t('dm.title')} extra={<span className="chip cyan">{t('dm.policy')} {dm.policy}</span>}>
      {dm.ev && <EvMission ev={dm.ev} />}
      <h4 className="mini-title">{t('dm.incidents')}</h4>
      {dm.incidents.length === 0 ? (
        <p className="note">{t('dm.none')}</p>
      ) : (
        <ul className="inc-list">
          {dm.incidents.slice(0, 5).map((i) => (
            <li key={i.id}>
              <button className="inc-item" onClick={() => controller.selectIncident(i.id)}>
                <span className={`inc-dot ${i.status}`} aria-hidden="true" title={t(`inc.status.${i.status}` as I18nKey)} />
                <span className="mono">{i.id}</span>
                <span className="inc-name">
                  {t(`inc.type.${i.type}` as I18nKey)}
                  <span className="sr-only">, {t(`inc.status.${i.status}` as I18nKey)}</span>
                </span>
                <span className="inc-meta">{(i.junctions.length ? i.junctions : i.links).join(' ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <h4 className="mini-title">{t('dm.exceptions')}</h4>
      <div className="kv small">
        <span>{t('dm.open')}</span>
        <b className="num">{dm.exceptions.open}</b>
        <span>{t('dm.inProgress')}</span>
        <b className="num">{dm.exceptions.inProgress}</b>
        <span>{t('dm.resolved')}</span>
        <b className="num">
          {dm.exceptions.resolved} <span className="muted">+ {dm.exceptions.auto} {t('dm.auto')}</span>
        </b>
        <span>{t('dm.withdrawn')}</span>
        <b className="num">{dm.exceptions.withdrawn}</b>
        <span>{t('dm.mrcNow')}</span>
        <b className="num">{dm.mrcNow}</b>
        <span>{t('dm.mrcTime')}</span>
        <b className="num">{(dm.stats.mrcVehicleSeconds / 60).toFixed(1)} veh·min</b>
      </div>
      <h4 className="mini-title">{t('dm.operators')}</h4>
      <div className="ops">
        {dm.operators.map((o, i) => (
          <div key={i} className={`op ${o.busy ? 'busy' : ''}`}>
            <Icon name="users" />
            <span>#{i + 1}</span>
            <b>{o.busy ? `${t(o.kind === 'group' ? 'op.group' : 'op.individual')} · ${o.junction}` : t('dm.idle')}</b>
          </div>
        ))}
      </div>
      <h4 className="mini-title">{t('dm.messages')}</h4>
      <div className="kv small">
        <span>{t('dm.published')}</span>
        <b className="num">{dm.stats.published}</b>
        <span>{t('dm.delivered')}</span>
        <b className="num">{dm.stats.delivered}</b>
        <span>{t('dm.rejectedN')}</span>
        <b className="num">{dm.stats.rejected + dm.stats.flagged}</b>
        <span>{t('dm.latency')}</span>
        <b className="num">{dm.stats.meanLatencyMs ? `${dm.stats.meanLatencyMs.toFixed(0)} ms` : '–'}</b>
      </div>
    </Section>
  );
}

function MessageRow({ m }: { m: MessageView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const tone = m.verdict ? (m.verdict.status === 'accepted' ? 'ok' : m.verdict.status === 'flagged' ? 'warn' : 'bad') : 'ok';
  return (
    <li className={`msg tone-${tone}`}>
      <button className="msg-head" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <span className="mono msg-id">
          {m.verdict && <Icon name={tone === 'ok' ? 'check' : tone === 'warn' ? 'alert' : 'x'} className={`msg-mark ${tone}`} />}
          {m.verdict && <span className="sr-only">{t(`msg.v.${tone}` as I18nKey)}: </span>}
          {m.msgId}
        </span>
        <span className="msg-type">{m.type}</span>
        <span className="msg-v">v{m.version}</span>
        <span className="msg-t mono">{formatRel(m.issuedAt)}</span>
      </button>
      {open && (
        <div className="msg-body">
          <div className="small muted">{m.text}</div>
          <div className="small mono muted" style={{ marginTop: 4 }}>
            {m.issuer} · {m.origin === 'injected' ? t('msg.injected') : m.origin === 'submitted' ? t('msg.submitted') : t('msg.published')} · {m.signature}
          </div>
          {m.verdict && m.verdict.checks.length > 0 && (
            <>
              <h4 className="mini-title">{t('msg.checks')}</h4>
              <ul className="checks">
                {m.verdict.checks.map((c, i) => (
                  <li key={i} className={c.pass ? 'pass' : 'fail'}>
                    <Icon name={c.pass ? 'check' : 'x'} />
                    <b>{checkName(t, c.name)}</b>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function IncidentInspector({ f }: { f: IncidentFrame }) {
  const t = useT();
  const select = useStore((s) => s.select);
  const dm = useStore((s) => s.dm);
  const inc = f.incident;
  const text = incidentText(t, inc);
  return (
    <div className="inspector">
      <div className="insp-head">
        <div>
          <div className="insp-tag mono">{inc.id}</div>
          <div className="insp-chips">
            <span className="chip muted">{t(`inc.type.${inc.type}` as I18nKey)}</span>
            {statusChip(t, inc.status)}
            <span className="chip cyan">v{inc.version}</span>
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => controller.selectIncident(inc.id, true)} aria-label={t('inc.focus')} title={t('inc.focus')}>
          <Icon name="target" />
        </button>
        <button className="btn sm icon ghost" onClick={() => select(null)} aria-label={t('inc.close')} title={t('inc.close')}>
          <Icon name="x" />
        </button>
      </div>
      <div className={`now tone-${inc.status === 'active' ? 'critical' : 'ok'}`}>
        <div className="now-label">{text.title}</div>
        <div className="now-text small">{text.cause}</div>
      </div>
      {dm?.policy === 'A' && <div className="callout small-callout">{t('inc.notPublished')}</div>}
      <Section title={t('inc.title')}>
        <div className="kv">
          <span>{t('inc.area')}</span>
          <b>{(inc.junctions.length ? inc.junctions : inc.links).join(', ')}</b>
          <span>{t('inc.issuer')}</span>
          <b className="mono">{inc.issuer}</b>
          <span>{t('inc.created')}</span>
          <b className="num">{formatClock(inc.createdAt)}</b>
          {inc.resolvedAt !== null && (
            <>
              <span>{t('inc.resolvedAt')}</span>
              <b className="num">{formatClock(inc.resolvedAt)}</b>
            </>
          )}
          <span>{t('inc.reach')}</span>
          <b>{t('inc.reachText', f.reach)}</b>
        </div>
        {Object.keys(f.queueAtJunctions).length > 0 && (
          <>
            <h4 className="mini-title">{t('inc.queues')}</h4>
            <div className="jbars">
              {Object.entries(f.queueAtJunctions).map(([j, n]) => (
                <div key={j} className="jbar">
                  <span className="mono">{j}</span>
                  <div className="jbar-track">
                    <i style={{ width: `${Math.min(100, n * 3)}%` }} />
                  </div>
                  <b className="num">{n}</b>
                  {f.mrcAtJunctions[j] ? (
                    <span className="chip red">
                      {f.mrcAtJunctions[j]} {t('inc.mrc')}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </Section>
      <Section title={t('inc.lifecycle')}>
        <ol className="msgs">
          {f.messages.map((m) => (
            <MessageRow key={m.msgId} m={m} />
          ))}
        </ol>
      </Section>
      <Section title={t('inc.exceptions')}>
        {f.exceptions.length === 0 ? (
          <p className="note">{t('inc.noExceptions')}</p>
        ) : (
          <ol className="exc">
            {f.exceptions.map((x) => (
              <li key={x.id} className={`exc-${x.status}`}>
                <span className="mono">{x.id}</span>
                <span className="mono">{x.tag}</span>
                <span>{x.junction}</span>
                <span className="exc-status">{t(`exc.${x.status}` as I18nKey)}</span>
                <span className="exc-wait num">{x.resolvedAt !== null ? `${(x.resolvedAt - x.raisedAt).toFixed(0)} s` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

export function VehicleDmSection({ d, connected }: { d: VehicleDmView | null; connected: boolean }) {
  const t = useT();
  if (!connected) {
    return (
      <Section title={t('vdm.title')}>
        <p className="note">{t('vdm.notConnected')}</p>
      </Section>
    );
  }
  if (!d) return null;
  return (
    <Section title={t('vdm.title')}>
      {d.messages.length === 0 && <p className="note">{t('vdm.none')}</p>}
      {d.avoid.length > 0 && <div className="status-line warn">{t('vdm.avoid', { list: d.avoid.join(', ') })}</div>}
      {d.authorizations.map((a) => (
        <div key={a.junction} className="status-line ok">
          {t('vdm.auth', { junction: a.junction, scope: a.scope })}
        </div>
      ))}
      {d.messages.length > 0 && (
        <ol className="rx">
          {d.messages.map((m) => (
            <li key={m.msgId} className={`rx-${m.status}`}>
              <span className="mono">{m.msgId}</span>
              <span>{m.type}</span>
              <span className="rx-code">{m.code}</span>
              <span className="num muted">
                {m.path.toUpperCase()} · {m.latencyMs.toFixed(0)} ms
              </span>
            </li>
          ))}
        </ol>
      )}
      {d.exceptions.length > 0 && (
        <>
          <h4 className="mini-title">{t('vdm.exceptions')}</h4>
          <ol className="exc">
            {d.exceptions.map((x) => (
              <li key={x.id} className={`exc-${x.status}`}>
                <span className="mono">{x.id}</span>
                <span>{x.junction}</span>
                <span className="exc-status">{t(`exc.${x.status}` as I18nKey)}</span>
                <span className="exc-wait num">{resolutionText(t, x.resolution)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}
