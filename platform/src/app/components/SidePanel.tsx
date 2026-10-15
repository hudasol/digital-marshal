import type { ReactNode } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Icon } from './Icons';

export function SidePanel({
  side,
  title,
  children,
  actions,
}: {
  side: 'left' | 'right';
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const t = useT();
  const open = useStore((s) => (side === 'left' ? s.leftOpen : s.rightOpen));
  const toggle = useStore((s) => (side === 'left' ? s.toggleLeft : s.toggleRight));
  return (
    <>
      <aside
        className={`panel ${side} glass ${open ? '' : 'closed'}`}
        aria-label={title}
        aria-hidden={!open}
        // closed panels must not keep keyboard focus
        inert={!open ? true : undefined}
      >
        <div className="panel-head">
          <span className="panel-title">{title}</span>
          {actions}
          <button className="btn sm icon ghost" onClick={toggle} aria-label={t('panel.collapse')} title={t('panel.collapse')}>
            <Icon name={side === 'left' ? 'chevronLeft' : 'chevronRight'} />
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </aside>
      {!open && (
        <button
          className={`panel-toggle ${side} btn glass`}
          onClick={toggle}
          aria-label={side === 'left' ? t('panel.expand.ops') : t('panel.expand.intel')}
          title={side === 'left' ? t('panel.expand.ops') : t('panel.expand.intel')}
        >
          <Icon name={side === 'left' ? 'panelLeft' : 'panelRight'} />
          <span className="hide-sm">{title}</span>
        </button>
      )}
    </>
  );
}

export function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-title">
        <span>{title}</span>
        <span className="spacer" />
        {extra}
      </div>
      {children}
    </section>
  );
}
