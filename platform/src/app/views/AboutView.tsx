import { useT, type I18nKey } from '../i18n';

/* About: the research question, the architecture, what is and is not claimed, and the roadmap.
   Written for judges and engineers; it states limits as plainly as results. */

type T = ReturnType<typeof useT>;

function ArchitectureDiagram({ t }: { t: T }) {
  const box = (x: number, y: number, w: number, h: number, k: string, tone = '#45d4e8') => (
    <g key={k}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="rgba(23,33,49,0.9)" stroke={tone} strokeOpacity={0.55} />
      <text x={x + 12} y={y + 22} fill="#f3f6f9" fontSize={13} fontWeight={650}>
        {t(`ab.b.${k}` as I18nKey)}
      </text>
      <text x={x + 12} y={y + 40} fill="#8b98a8" fontSize={11}>
        {t(`ab.b.${k}.s` as I18nKey)}
      </text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, label?: string) => (
    <g key={`${x1}-${y1}-${x2}-${y2}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5e6b7b" strokeWidth={1.6} markerEnd="url(#arr)" />
      {label ? (
        <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2 - 4} fill="#8b98a8" fontSize={10.5}>
          {t(`ab.a.${label}` as I18nKey)}
        </text>
      ) : null}
    </g>
  );
  return (
    <svg viewBox="0 0 1000 430" role="img" aria-label={t('ab.arch')} style={{ width: '100%', height: 'auto', direction: 'ltr' }}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#5e6b7b" />
        </marker>
      </defs>
      <text x={20} y={24} fill="#8b98a8" fontSize={11} letterSpacing="0.1em">
        {t('ab.d.infra')}
      </text>
      {box(20, 36, 210, 54, 'signals', '#8b98a8')}
      {box(250, 36, 210, 54, 'works', '#8b98a8')}
      {box(480, 36, 210, 54, 'dispatch', '#8b98a8')}
      {box(710, 36, 270, 54, 'desk', '#8b98a8')}

      <text x={20} y={128} fill="#45d4e8" fontSize={11} letterSpacing="0.1em">
        {t('ab.d.core')}
      </text>
      {box(20, 140, 220, 58, 'incident')}
      {box(260, 140, 220, 58, 'trust')}
      {box(500, 140, 220, 58, 'state')}
      {box(740, 140, 240, 58, 'exceptions')}
      {box(140, 226, 260, 58, 'v2x')}
      {box(420, 226, 300, 58, 'measure')}

      <text x={20} y={322} fill="#3ccb8f" fontSize={11} letterSpacing="0.1em">
        {t('ab.d.vehicles')}
      </text>
      {box(20, 334, 300, 58, 'adapter', '#3ccb8f')}
      {box(340, 334, 300, 58, 'planner', '#3ccb8f')}
      {box(660, 334, 320, 58, 'twin', '#a78bfa')}

      {arrow(125, 90, 125, 140, 'outage')}
      {arrow(355, 90, 355, 140, 'submit')}
      {arrow(585, 90, 610, 140, 'request')}
      {arrow(845, 140, 845, 90, 'tasks')}
      {arrow(240, 169, 260, 169)}
      {arrow(480, 169, 500, 169)}
      {arrow(370, 198, 300, 226)}
      {arrow(270, 284, 170, 334, 'signed')}
      {arrow(320, 363, 340, 363)}
      {arrow(640, 363, 660, 363)}
      {arrow(560, 334, 820, 198, 'exceptions')}
      {arrow(570, 284, 570, 334)}
    </svg>
  );
}

function List({ t, keys }: { t: T; keys: string[] }) {
  return (
    <ul className="clean">
      {keys.map((k) => (
        <li key={k}>{t(k as I18nKey)}</li>
      ))}
    </ul>
  );
}

export function AboutView() {
  const t = useT();
  return (
    <div className="view" role="main">
      <div className="view-inner stack">
        <div>
          <h1>{t('brand.name')}</h1>
          <p className="lede">{t('ab.lede')}</p>
        </div>

        <div className="grid-2">
          <div className="card">
            <h2>{t('ab.question')}</h2>
            <p style={{ color: 'var(--text-1)', lineHeight: 1.6, margin: '6px 0 0' }}>{t('ab.questionText')}</p>
            <div className="note" style={{ marginTop: 10 }}>
              {t('ab.questionNote')}
            </div>
          </div>
          <div className="card">
            <h2>{t('ab.scenarios')}</h2>
            <ul className="clean">
              {(['s1', 's2', 's5'] as const).map((k) => (
                <li key={k}>
                  <b>{t(`ab.${k}` as I18nKey)}</b> - {t(`ab.${k}d` as I18nKey)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <h2>{t('ab.arch')}</h2>
          <div className="sub">{t('ab.archSub')}</div>
          <ArchitectureDiagram t={t} />
        </div>

        <div className="grid-3">
          <div className="card">
            <h2>{t('ab.real')}</h2>
            <List t={t} keys={['ab.real.1', 'ab.real.2', 'ab.real.3']} />
          </div>
          <div className="card">
            <h2>{t('ab.sim')}</h2>
            <List t={t} keys={['ab.sim.1', 'ab.sim.2', 'ab.sim.3']} />
          </div>
          <div className="card">
            <h2>{t('ab.not')}</h2>
            <List t={t} keys={['ab.not.1', 'ab.not.2', 'ab.not.3']} />
          </div>
        </div>

        <div className="card">
          <h2>{t('ab.roadmap')}</h2>
          <div className="grid-3" style={{ marginTop: 8 }}>
            <div>
              <div className="chip cyan">{t('ab.now')}</div>
              <List t={t} keys={['ab.now.1', 'ab.now.2', 'ab.now.3']} />
            </div>
            <div>
              <div className="chip muted">{t('ab.next')}</div>
              <List t={t} keys={['ab.next.1', 'ab.next.2', 'ab.next.3']} />
            </div>
            <div>
              <div className="chip muted">{t('ab.later')}</div>
              <List t={t} keys={['ab.later.1', 'ab.later.2']} />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>{t('ab.visual')}</h2>
          <List t={t} keys={['ab.visual.1', 'ab.visual.2', 'ab.visual.3', 'ab.visual.4']} />
        </div>
      </div>
    </div>
  );
}
