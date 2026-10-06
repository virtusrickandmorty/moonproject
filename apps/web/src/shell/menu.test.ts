import { describe, expect, it } from 'vitest';
import { FOLD_AFTER, applyMenuOrder, buildMenu, labelOf, openGroups, pagePermission, type MenuItem } from './menu.ts';
import type { DocTypeInfo } from '../api.ts';

describe('menu (PLAN H1)', () => {
  it('shows Shop certificate and Practice shop in Admin to every signed-in user', () => {
    expect(buildMenu([], new Set()).find((g) => g.group === 'Admin')?.items).toEqual([
      { group: 'Admin', label: 'Shop certificate', path: '/admin/shop-certificate' },
      { group: 'Admin', label: 'Practice shop', path: '/admin/practice' },
    ]);
  });

  it('groups document lists by module in H1 order and shows other screens only with their exact permission', () => {
    const dt = (key: string, module: string, title: string) => ({ key, module, title }) as DocTypeInfo;
    const types = [dt('cash.transfer', 'CASH', 'Fund Transfer'), dt('jo.order', 'JO', 'Job Order'), dt('eq.money', 'EQ', 'Owner Money')];
    const screens: MenuItem[] = [{ group: 'Overview', label: 'Home', path: '/' }, { group: 'Admin', label: 'Users', path: '/admin/users', permission: 'sec.users.manage' }];
    const labels = (perms: string[]) => buildMenu(types, new Set(perms), screens).map((g) => `${g.group}: ${g.items.map((i) => i.label).join(', ')}`);
    expect(labels([])).toEqual(['Overview: Home', 'Sales: Job Orders', 'Money: Fund Transfers, Owner Money']);
    expect(labels(['sec.users.manage']).at(-1)).toBe('Admin: Users');
  });

  it('folds a long menu: only the group of the screen open, and the groups the person opened or closed', () => {
    const screens = (n: number): MenuItem[] => [
      { group: 'Overview', label: 'Home', path: '/' },
      ...Array.from({ length: n }, (_, k) => ({ group: (k % 2 ? 'Money' : 'Admin') as MenuItem['group'], label: `Screen ${k}`, path: `/s${k}` })),
    ];
    const menu = (n: number) => buildMenu([], new Set(), screens(n));
    const open = (n: number, path: string, chosen: Record<string, boolean> = {}) => {
      const r = openGroups(menu(n), path, chosen);
      return { folds: r.folds, open: [...r.open] };
    };
    // A short menu, as most staff roles have, shows everything.
    expect(open(FOLD_AFTER - 1, '/')).toEqual({ folds: false, open: ['Overview', 'Money', 'Admin'] });
    // A long one shows the group of the screen open, also for a document under a list (/s1/123).
    expect(open(FOLD_AFTER, '/')).toEqual({ folds: true, open: ['Overview'] });
    expect(open(FOLD_AFTER, '/s1/123')).toEqual({ folds: true, open: ['Money'] });
    // What the person opened stays open; the group they are in can be closed too.
    expect(open(FOLD_AFTER, '/s1', { Admin: true })).toEqual({ folds: true, open: ['Money', 'Admin'] });
    expect(open(FOLD_AFTER, '/s1', { Money: false })).toEqual({ folds: true, open: [] });
  });

  it('finds a quick sale and a downpayment invoice under their own names, though both document titles are Invoice Record', () => {
    const types = [
      { key: 'jo.invoice_record', module: 'JO', title: 'Invoice Record' }, { key: 'jo.dp_invoice', module: 'JO', title: 'Invoice Record' },
      { key: 'qs.sale', module: 'QS', title: 'Invoice Record' },
    ] as DocTypeInfo[];
    expect(buildMenu(types, new Set(), []).map((g) => g.items.map((i) => i.label))).toEqual([['Invoice Records', 'Downpayment Invoice Records', 'Quick Sales']]);
    expect(types.map(labelOf)).toEqual(['Invoice Record', 'Downpayment Invoice Record', 'Quick Sale']);
  });

  it('knows the permission a page needs, pages under a menu item included (so a typed address shows no screen it cannot use)', () => {
    expect(pagePermission('/pos')).toBe('shp.pos');
    expect(pagePermission('/sup')).toBe('sup.view');
    expect(pagePermission('/shp/orders')).toBe('shp.orders.view');
    expect(pagePermission('/shp')).toBe('shp.view');
    expect(pagePermission('/pur/suppliers/12')).toBe('pur.supplier.view');
    expect(pagePermission('/com/settings')).toBe('com.settings.manage');
    expect(pagePermission('/admin/practice')).toBeUndefined();
    expect(pagePermission('/shopping')).toBeUndefined();
  });

  it("follows a person's own order, keeping screens they did not place after the placed ones", () => {
    const m = (group: MenuItem['group'], ...paths: string[]) => ({ group, items: paths.map((path) => ({ group, label: path, path })) });
    const menu = [m('Overview', '/'), m('Sales', '/cus', '/pos', '/shp'), m('Admin', '/admin/users')];
    const shaped = applyMenuOrder(menu, { groups: ['Sales', 'Admin'], items: { Sales: ['/pos', '/gone', '/cus'] } });
    expect(shaped.map((g) => g.group)).toEqual(['Sales', 'Admin', 'Overview']);
    expect(shaped[0]!.items.map((i) => i.path)).toEqual(['/pos', '/cus', '/shp']);
    expect(applyMenuOrder(menu, { groups: [], items: {} })).toBe(menu);
    expect(applyMenuOrder(menu, null)).toBe(menu);
  });
});
