import type { KeyboardEvent } from 'react';

/* Arrow-key navigation for composite widgets (tablist, radiogroup, toolbar) with a roving tabindex:
   only one item sits in the tab order, and the arrow keys, Home and End move between the items.
   Left and Right follow the reading direction, so they swap in Arabic. Disabled items are skipped. */

export interface RovingOptions {
  rtl: boolean;
  /** Up and Down move too (radio groups); a horizontal tablist or toolbar uses Left and Right only. */
  vertical?: boolean;
  /** Moving also selects the item (tabs and radio buttons follow focus); a toolbar only moves focus. */
  activate?: boolean;
  selector?: string;
}

export function rovingKeyDown(e: KeyboardEvent<HTMLElement>, opts: RovingOptions): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const fwd = opts.rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = opts.rtl ? 'ArrowRight' : 'ArrowLeft';
  const isFwd = e.key === fwd || (opts.vertical && e.key === 'ArrowDown');
  const isBack = e.key === back || (opts.vertical && e.key === 'ArrowUp');
  if (!isFwd && !isBack && e.key !== 'Home' && e.key !== 'End') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(opts.selector ?? 'button')].filter((b) => !b.disabled);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const n = items.length;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : isFwd ? (i < 0 ? 0 : (i + 1) % n) : i < 0 ? n - 1 : (i - 1 + n) % n;
  e.preventDefault();
  // Home and End belong to this widget here: they must not also reach the global camera shortcut
  e.stopPropagation();
  items[next].focus();
  if (opts.activate && items[next] !== items[i]) items[next].click();
}
