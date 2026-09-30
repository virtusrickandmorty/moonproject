import { describe, expect, it } from 'vitest';
import { buildMenu, labelOf, type MenuItem } from './menu.ts';
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

  it('finds a quick sale under its own name, though its document title is Invoice Record', () => {
    const types = [{ key: 'jo.invoice_record', module: 'JO', title: 'Invoice Record' }, { key: 'qs.sale', module: 'QS', title: 'Invoice Record' }] as DocTypeInfo[];
    expect(buildMenu(types, new Set(), []).map((g) => g.items.map((i) => i.label))).toEqual([['Invoice Records', 'Quick Sales']]);
    expect(types.map(labelOf)).toEqual(['Invoice Record', 'Quick Sale']);
  });
});
