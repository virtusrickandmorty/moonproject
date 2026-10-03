import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DocTypeInfo } from '../api.ts';
import { Navigation, NewMenu, newGroups } from './Shell.tsx';

const types: DocTypeInfo[] = [
  { key: 'qs.sale', module: 'QS', title: 'Invoice Record', canCreate: true },
  { key: 'cash.transfer', module: 'CASH', title: 'Fund Transfer', canCreate: true },
  { key: 'jo.dp_invoice', module: 'JO', title: 'Invoice Record', canCreate: true },
  { key: 'pay.run', module: 'PAY', title: 'Payroll Run', canCreate: false },
  { key: 'extra.new', module: 'EXTRA', title: 'Extra Document', canCreate: true },
] as DocTypeInfo[];

describe('+ New menu', () => {
  it('uses the left menu groups and keeps every permitted creation, including unfamiliar modules', () => {
    const groups = newGroups(types, '');
    expect(groups.map((g) => g.group)).toEqual(['Overview', 'Sales', 'Money']);
    expect(groups.flatMap((g) => g.items.map((i) => i.path)).sort()).toEqual(types.filter((d) => d.canCreate).map((d) => `/docs/${d.key}/new`).sort());
    const markup = renderToStaticMarkup(createElement(NewMenu, { docTypes: types, query: '', onQuery: () => undefined, onChoose: () => undefined }));
    expect(markup).toContain('Search new documents');
    expect(markup).toContain('Quick Sale');
    expect(markup).toContain('Downpayment Invoice Record');
    expect(markup).toContain('overflow-y-auto');
    expect(markup).toContain('max-h-[min(60vh,24rem)]');
    expect(markup).not.toContain('/docs/pay.run/new');
  });

  it('searches displayed document names and group names without changing the full list', () => {
    expect(newGroups(types, ' QUICK sale ').flatMap((g) => g.items.map((i) => i.path))).toEqual(['/docs/qs.sale/new']);
    expect(newGroups(types, 'sales')[0]?.items).toHaveLength(2);
    const markup = renderToStaticMarkup(createElement(NewMenu, { docTypes: types, query: 'missing', onQuery: () => undefined, onChoose: () => undefined }));
    expect(markup).toContain('No matching documents');
    expect(newGroups(types, '').flatMap((g) => g.items)).toHaveLength(4);
  });
});

describe('phone navigation', () => {
  it('overlays the page with a dismissible scrolling drawer and keeps desktop navigation in its column', () => {
    const markup = renderToStaticMarkup(createElement(Navigation, { open: true, onClose: () => undefined, children: createElement('a', { href: '/' }, 'Home') }));
    expect(markup).toContain('fixed inset-y-0 left-0');
    expect(markup).toContain('md:static md:block md:w-56');
    expect(markup).toContain('overflow-y-auto');
    expect(markup).toContain('Close menu backdrop');
    expect(markup).toContain('Close menu');
    const closed = renderToStaticMarkup(createElement(Navigation, { open: false, onClose: () => undefined, children: null }));
    expect(closed).toContain('hidden');
    expect(closed).not.toContain('Close menu backdrop');
  });

  it('closes on any chosen screen, including the current one, and on Escape, without closing for folding buttons', () => {
    const close = vi.fn();
    const fragment = Navigation({ open: true, onClose: close, children: null });
    const nav = fragment.props.children[1] as ReactElement<{ onClickCapture: (e: unknown) => void; onKeyDown: (e: unknown) => void }>;
    nav.props.onClickCapture({ target: { closest: () => null } });
    expect(close).not.toHaveBeenCalled();
    nav.props.onClickCapture({ target: { closest: () => ({ href: '/' }) } });
    expect(close).toHaveBeenCalledTimes(1);
    nav.props.onKeyDown({ key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
