import { describe, expect, it } from 'vitest';
import { crumbsFor } from './crumbs.tsx';
import type { MenuGroup, MenuItem } from './menu.ts';

const menu: { group: MenuGroup; items: MenuItem[] }[] = [
  { group: 'Sales', items: [{ group: 'Sales', label: 'Job Orders', path: '/docs/jo.job_order' }, { group: 'Sales', label: 'Customers', path: '/cus' }] },
  { group: 'Purchases & Expenses', items: [{ group: 'Purchases & Expenses', label: 'Suppliers', path: '/pur/suppliers' }] },
];

describe('breadcrumbs', () => {
  it('are Home › group › page, the page itself not a link', () => {
    expect(crumbsFor('/cus', menu)).toEqual([{ label: 'Home', to: '/' }, { label: 'Sales' }, { label: 'Customers' }]);
  });

  it('link back to the list from what is open in it, named by the page (a number) or New, Edit, Details', () => {
    const list = { label: 'Job Orders', to: '/docs/jo.job_order' };
    expect(crumbsFor('/docs/jo.job_order/abc', menu, 'JO-000004')).toEqual([{ label: 'Home', to: '/' }, { label: 'Sales' }, list, { label: 'JO-000004' }]);
    expect(crumbsFor('/docs/jo.job_order/new', menu)).toEqual([{ label: 'Home', to: '/' }, { label: 'Sales' }, list, { label: 'New' }]);
    expect(crumbsFor('/docs/jo.job_order/abc/edit', menu).slice(-2)).toEqual([{ label: 'Details' }, { label: 'Edit' }]);
    expect(crumbsFor('/pur/suppliers/12', menu, 'Sample Textiles').at(-1)).toEqual({ label: 'Sample Textiles' });
  });

  it('show nothing on the home page, and Home › the page for one outside the menu', () => {
    expect(crumbsFor('/', menu)).toEqual([]);
    expect(crumbsFor('/account/password', menu)).toEqual([{ label: 'Home', to: '/' }, { label: 'Change password' }]);
  });
});
