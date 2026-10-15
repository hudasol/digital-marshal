import { useState } from 'react';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon } from './Icons';
import { Section } from './SidePanel';
import { controller, formatClock, formatRel } from '../controller';
import type { DmFrame, IncidentFrame, MessageView, VehicleDmView } from '../dmframes';

function statusChip(t: ReturnType<typeof useT>, status: string) {
  const cls = status === 'active' ? 'red' : status === 'resolved' ? 'green' : 'muted';
  return <span className={`chip ${cls}`}>{t(`inc.status.${status}` as I18nKey)}</span>;
}

export function DmOverview({ dm }: { dm: DmFrame }) {
  const t = useT();
  return (
    <Section title={t('dm.title')} extra={<span className="chip cyan">{t('dm.policy')} {dm.policy}</span>}>
      <div className="mini-title">{t('dm.incidents')}</div>
      {dm.incidents.length === 0 ? (
        <p className="note">{t('dm.none')}</p>
      ) : (
        <ul className="inc-list">
          {dm.incidents.slice(0, 5).map((i) => (
            <li key={i.id}>
              <button className="inc-item" onClick={() => controller.selectIncident(i.id)}>
                <span className={`inc-dot ${i.status}`} />
                <span className="mono">{i.id}</span>
                <span className="inc-name">{t(`inc.type.${i.type}` as I18nKey)}</span>
                <span className="inc-meta">{(i.junctions.length ? i.junctions : i.links).join(' ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mini-title">{t('dm.exceptions')}</div>
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
      <div className="mini-title">{t('dm.operators')}</div>
      <div className="ops">
        {dm.operators.map((o, i) => (
          <div key={i} className={`op ${o.busy ? 'busy' : ''}`}>
            <Icon name="users" />
            <span>#{i + 1}</span>
            <b>{o.busy ? `${o.kind} · ${o.junction}` : t('dm.idle')}</b>
          </div>
        ))}
      </div>
      <div className="mini-title">{t('dm.messages')}</div>
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
        <span className="mono msg-id">{m.msgId}</span>
        <span className="msg-type">{m.type}</span>
        <span className="msg-v">v{m.version}</span>
        <span className="msg-t mono">{formatRel(m.issuedAt)}</span>
      </button>
      {open && (
        <div className="msg-body">
          <div className="small muted">{m.text}</div>
          <div className="small mono muted" style={{ marginTop: 4 }}>
            {m.issuer} · {m.origin === 'injected' ? t('msg.injected') : t('msg.published')} · {m.signature}
          </div>
          {m.verdict && m.verdict.checks.length > 0 && (
            <>
              <div className="mini-title">{t('msg.checks')}</div>
              <ul className="checks">
                {m.verdict.checks.map((c, i) => (
                  <li key={i} className={c.pass ? 'pass' : 'fail'}>
                    <Icon name={c.pass ? 'check' : 'x'} />
                    <b>{c.name}</b>
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
        <button className="btn sm" onClick={() => controller.selectIncident(inc.id, true)}>
          <Icon name="target" />
        </button>
        <button className="btn sm icon ghost" onClick={() => select(null)} aria-label={t('inc.close')} title={t('inc.close')}>
          <Icon name="x" />
        </button>
      </div>
      <div className={`now tone-${inc.status === 'active' ? 'critical' : 'ok'}`}>
        <div className="now-label">{inc.title}</div>
        <div className="now-text small">{inc.cause}</div>
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
            <div className="mini-title">{t('inc.queues')}</div>
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
                <span className="exc-status">{x.status.replace('_', ' ')}</span>
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
          <div className="mini-title">{t('vdm.exceptions')}</div>
          <ol className="exc">
            {d.exceptions.map((x) => (
              <li key={x.id} className={`exc-${x.status}`}>
                <span className="mono">{x.id}</span>
                <span>{x.junction}</span>
                <span className="exc-status">{x.status.replace('_', ' ')}</span>
                <span className="exc-wait num">{x.resolution}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}
