import { useLayoutEffect, useRef, type ReactNode } from 'react';
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
  const asideRef = useRef<HTMLElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  // the button that was pressed is replaced by its counterpart, so focus moves to that counterpart
  // instead of falling to the page body (also when the panel was toggled with [ or ] from inside it)
  useLayoutEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const a = document.activeElement;
    const lost = !a || a === document.body || (!open && !!asideRef.current?.contains(a));
    if (!lost) return;
    if (open) collapseRef.current?.focus();
    else expandRef.current?.focus();
  }, [open]);
  const collapseLabel = side === 'left' ? t('panel.collapse.ops') : t('panel.collapse.intel');
  return (
    <>
      <aside
        ref={asideRef}
        id={`panel-${side}`}
        // focus target of the skip link
        tabIndex={-1}
        className={`panel ${side} glass ${open ? '' : 'closed'}`}
        aria-label={title}
        aria-hidden={!open}
        // closed panels must not keep keyboard focus
        inert={!open ? true : undefined}
      >
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}>
            {title}
          </h2>
          {actions}
          <button ref={collapseRef} className="btn sm icon ghost" onClick={toggle} aria-label={collapseLabel} title={collapseLabel}>
            <Icon name={side === 'left' ? 'chevronLeft' : 'chevronRight'} />
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </aside>
      {!open && (
        <button
          ref={expandRef}
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
        <h3 style={{ margin: 0, font: 'inherit' }}>{title}</h3>
        <span className="spacer" />
        {extra}
      </div>
      {children}
    </section>
  );
}
