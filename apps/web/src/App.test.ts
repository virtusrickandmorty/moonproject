import { describe, expect, it } from 'vitest';
import type { DocTypeInfo, Me } from './api.ts';
import { dailyActions } from './App.tsx';

const me = (permissions: string[]): Me => ({ userId: 'test', username: 'test', displayName: 'Sample', roles: [], permissions, mustChangePassword: false, csrfToken: '' });
const types = ['jo.job_order', 'col.collection', 'exp.voucher', 'cash.count', 'ap.payment', 'pay.run', 'acc.jv', 'jo.release', 'qs.sale', 'prd.entry', 'quo.quotation']
  .map((key) => ({ key, title: key, canCreate: true }) as DocTypeInfo);

describe('daily Home actions', () => {
  it.each([
    ['owner', ['jo.job_order', 'col.collection', 'exp.voucher', 'cash.count']],
    ['accountant', ['exp.voucher', 'ap.payment', 'pay.run', 'acc.jv']],
    ['encoder', ['jo.job_order', 'col.collection', 'jo.release', 'qs.sale']],
  ])('keeps the %s shortcuts to four permitted daily documents', (role, keys) => {
    expect(dailyActions(me([`dash.home.${role}`]), types).map((a) => a.href)).toEqual((keys as string[]).map((k) => `/docs/${k}/new`));
  });

  it('uses exact home and viewing permissions for the production board', () => {
    expect(dailyActions(me(['dash.home.production', 'prd.view']), [])).toEqual([{ label: 'Production board', href: '/prd/board' }]);
    expect(dailyActions(me(['dash.home.production']), [])).toEqual([]);
  });

  it('never offers a document the server says cannot be created and gives owner home precedence', () => {
    const limited = types.map((d) => ({ ...d, canCreate: d.key === 'col.collection' }));
    expect(dailyActions(me(['dash.home.owner', 'dash.home.accountant', 'dash.home.production', 'prd.view']), limited)).toEqual([{ label: '+ New col.collection', href: '/docs/col.collection/new' }]);
  });
});
