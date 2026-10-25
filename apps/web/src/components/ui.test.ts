import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { choosePageRows, Dialog, keepDialogFocus, PAGE_ROWS, PageBar, Pager } from './ui.tsx';

afterEach(() => { choosePageRows(20, () => undefined); vi.restoreAllMocks(); });

it('one page bar: 20, 50 or 100 rows even on short and empty reports, where we are and of how many; loose pages keep their size', () => {
  const onOffset = vi.fn();
  const html = (total: number) => renderToStaticMarkup(createElement(Pager, { page: { limit: 20, offset: 0, total }, onOffset }));
  expect(PAGE_ROWS).toBe(20);
  for (const total of [0, 8, 120]) {
    expect(html(total)).toContain('Rows per page');
    for (const n of [20, 50, 100]) expect(html(total)).toContain(`value="${n}"`);
  }
  expect(html(0)).toContain('Nothing to show');
  const middle = renderToStaticMarkup(createElement(Pager, { page: { limit: 20, offset: 20, total: 63 }, onOffset }));
  expect(middle).toContain('21–40 of 63 · Page 2 of 4');
  expect(middle).toContain('Previous');
  expect(middle).toContain('Next');
  choosePageRows(50, onOffset);
  expect(PAGE_ROWS).toBe(50); expect(onOffset).toHaveBeenLastCalledWith(0);
  choosePageRows(100, onOffset); expect(PAGE_ROWS).toBe(100);
  choosePageRows(200, onOffset); expect(PAGE_ROWS).toBe(100);
  choosePageRows(25, onOffset); expect(PAGE_ROWS).toBe(100); // no longer a choice
  expect(renderToStaticMarkup(createElement(Pager, { page: { limit: 5, offset: 0, total: 10 }, what: 'loose pages', onOffset }))).not.toContain('Rows per page');
});

it('a list read from the newest, page by page, shows where it is without a total', () => {
  const html = renderToStaticMarkup(createElement(PageBar, { first: 41, last: 60, page: 3, hasPrevious: true, hasNext: true, onPrevious: () => undefined, onNext: () => undefined }));
  expect(html).toContain('41–60 · Page 3');
  expect(html).not.toContain(' of ');
  expect(html).not.toContain('Rows per page');
});

/** Minimal event surface: focus changes really emit focusin, so nested boundaries and cleanup are exercised. */
function surface() {
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown });
  const element = (tabIndex = 0, disabled = false, visible = true) => ({
    tabIndex, isConnected: true, ownerDocument: doc,
    focus() { doc.activeElement = this; doc.dispatchEvent(new Event('focusin')); },
    matches: () => disabled, getClientRects: () => visible ? [{}] : [],
  });
  const opener = element(); opener.focus();
  const first = element(); const last = element();
  const children = [first, element(0, true), element(0, false, false), last];
  const root = Object.assign(element(-1), { querySelectorAll: () => children, contains: (el: unknown) => el === root || children.includes(el as typeof first) });
  const key = (name: string, shiftKey = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name, shiftKey });
    doc.dispatchEvent(event); return event;
  };
  return { doc, root: root as unknown as HTMLElement, opener: opener as unknown as HTMLElement, first, last, children, key };
}

it('labels dialogs and provides an initial focus target without putting Record first', () => {
  const html = renderToStaticMarkup(createElement(Dialog, { title: 'Review this record', onClose: () => undefined, children: 'Summary' }));
  expect(html).toContain('aria-modal="true"'); expect(html).toContain('aria-label="Review this record"'); expect(html).toContain('tabindex="-1"');
});

it('contains forward and reverse Tab, catches outside focus, closes on Escape, and restores the opener', () => {
  const s = surface(); const close = vi.fn();
  const stop = keepDialogFocus(s.root, s.opener, close);
  expect(s.doc.activeElement).toBe(s.root);
  expect(s.key('Tab').defaultPrevented).toBe(true); expect(s.doc.activeElement).toBe(s.first);
  s.key('Tab', true); expect(s.doc.activeElement).toBe(s.last);
  s.key('Tab'); expect(s.doc.activeElement).toBe(s.first);
  s.opener.focus(); expect(s.doc.activeElement).toBe(s.root);
  s.key('Escape'); expect(close).toHaveBeenCalledOnce();
  stop(); expect(s.doc.activeElement).toBe(s.opener);
  s.key('Escape'); expect(close).toHaveBeenCalledOnce();
});

it('handles no enabled controls, dynamically revealed controls, and a removed opener', () => {
  const s = surface(); s.children.splice(0);
  const stop = keepDialogFocus(s.root, s.opener, () => undefined);
  expect(s.key('Tab').defaultPrevented).toBe(true); expect(s.doc.activeElement).toBe(s.root);
  s.children.push(s.first); s.key('Tab'); expect(s.doc.activeElement).toBe(s.first);
  Object.assign(s.opener, { isConnected: false }); stop(); expect(s.doc.activeElement).toBe(s.first);
});

it('only the top dialog handles keys and gives focus back to the parent before its opener', () => {
  const s = surface(); const closeParent = vi.fn(); const closeChild = vi.fn();
  const stopParent = keepDialogFocus(s.root, s.opener, closeParent);
  s.first.focus();
  const child = Object.assign({}, s.root, { contains: (el: unknown) => el === child, focus: () => { s.doc.activeElement = child; s.doc.dispatchEvent(new Event('focusin')); }, querySelectorAll: () => [] }) as unknown as HTMLElement;
  const stopChild = keepDialogFocus(child, s.first as unknown as HTMLElement, closeChild);
  s.key('Escape'); expect(closeChild).toHaveBeenCalledOnce(); expect(closeParent).not.toHaveBeenCalled();
  stopChild(); expect(s.doc.activeElement).toBe(s.first);
  s.key('Escape'); expect(closeParent).toHaveBeenCalledOnce(); stopParent(); expect(s.doc.activeElement).toBe(s.opener);
});
