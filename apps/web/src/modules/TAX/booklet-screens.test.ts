import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser, idem } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, type BookletUsage, type Me } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { BookletDetail, BookletTable, RegisterBooklet } from './Booklets.tsx';
import { bookletInput, documentLink, skippedNumbers } from './booklets.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const sample: BookletUsage = {
  booklet: { id: 'book-1', kind: 'SALES_INVOICE', atpNo: 'ATP 12345', printer: 'Example Press', serialFrom: 501, serialTo: 550, receivedOn: '2026-09-01', note: null, isActive: true, version: 1 },
  usedCount: 2, cancelledCount: 1, lastUsed: 504, leftCount: 46, skipped: [501, 503], skippedCount: 2,
  used: [{ n: 502, number: 'IR-000001', status: 'cancelled', documentId: 'sale-1', docType: 'qs.sale' }, { n: 504, number: 'IR-000002', status: 'posted', documentId: 'invoice-2', docType: 'jo.invoice_record' }],
};

describe('booklet screens', () => {
  it('shows Booklets under Accounting & Tax only with its permission, and all three paths', () => {
    expect(buildMenu([], new Set(['tax.booklets.view'])).find((g) => g.group === 'Accounting & Tax')).toMatchObject({ group: 'Accounting & Tax', items: [{ label: 'Booklets', path: '/tax/booklets' }] });
    expect(buildMenu([], new Set()).some((g) => g.group === 'Accounting & Tax')).toBe(false);
    expect(['/tax/booklets', '/tax/booklets/new', '/tax/booklets/:id'].every((path) => path in PAGES)).toBe(true);
  });

  it('shows the register columns, linked documents, cancelled paper, and every skipped number', () => {
    expect(skippedNumbers(sample)).toEqual([501, 503]);
    expect(documentLink('qs.sale', 'sale-1')).toBe('/docs/qs.sale/sale-1');
    const list = renderToStaticMarkup(createElement(BookletTable, { rows: [sample] }));
    for (const label of ['Kind', 'ATP number', 'Serial range', 'Received', 'Status', 'Used', 'Skipped', 'Left']) expect(list).toContain(label);
    expect(list).toContain('/tax/booklets/book-1');
    const detail = renderToStaticMarkup(createElement(BookletDetail, { usage: sample, shownUsed: 100, shownSkipped: 100 }));
    expect(detail).toContain('/docs/qs.sale/sale-1');
    expect(detail).toContain('/docs/jo.invoice_record/invoice-2');
    expect(detail).toContain('Cancelled (all copies kept)');
    expect(detail).toContain('501, 503');
  });

  it('checks the register form before sending and hides it without manage permission', () => {
    const fields = { kind: 'CR' as const, atpNo: ' ATP 123 ', printer: '', serialFrom: '701', serialTo: '750', receivedOn: '2026-09-01', note: '' };
    expect(bookletInput(fields)).toEqual({ input: { kind: 'CR', atpNo: 'ATP 123', serialFrom: 701, serialTo: 750, receivedOn: '2026-09-01' }, errors: [] });
    expect(bookletInput({ ...fields, serialFrom: '751', receivedOn: '2026-02-30' }).errors).toHaveLength(2);
    const me = { permissions: [] } as unknown as Me;
    expect(renderToStaticMarkup(createElement(RegisterBooklet, { me }))).toContain('do not have permission');
    expect(renderToStaticMarkup(createElement(RegisterBooklet, { me: { ...me, permissions: ['tax.booklets.manage'] } }))).toContain('Register booklet');
  });
});

describe('booklet web client against the server', () => {
  it('requires step-up and sends If-Match with a reason; detail links identify quick sale documents', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    const acct = createApi(injectFetch(env.app));
    await acct.login('acct1', PASSWORD);
    const input = { kind: 'SALES_INVOICE' as const, atpNo: 'ATP 98765', serialFrom: 501, serialTo: 550, receivedOn: '2026-09-01' };
    await expect(acct.registerBooklet(input)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await acct.stepUp(PASSWORD);
    const booklet = await acct.registerBooklet(input);
    const receipts = await acct.registerBooklet({ kind: 'CR', atpNo: 'ATP 54321', serialFrom: 701, serialTo: 750, receivedOn: '2026-09-01' });
    expect((await acct.booklets()).find((row) => row.booklet.id === booklet.id)).toMatchObject({ booklet: { id: booklet.id }, usedCount: 0, leftCount: 50 });

    const encoder = await env.as('encoder');
    const customers = seedCustomers(env.db, encoder.userId);
    const sale = (await encoder.post('/api/qs/sales', {
      sale: { customerId: customers.school, invoiceNumber: '0502', lines: [{ kind: 'service', description: 'Hem a shirt', qty: 1, unitPriceCents: 35_000, discountCents: 0 }] },
      payment: { crNumber: '0701', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 35_000 }] }, expectedTotalCents: 35_000,
    }, idem())).json();
    const detail = await acct.booklet(booklet.id);
    expect(detail.used[0]).toMatchObject({ n: 502, documentId: sale.sale.id, docType: 'qs.sale' });
    expect((await acct.booklet(receipts.id)).used[0]).toMatchObject({ n: 701, documentId: sale.payment.id, docType: 'col.collection' });
    expect(skippedNumbers(detail)).toEqual([501]);

    await expect(acct.setBookletActive(booklet.id, 1, false, 'too short')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const retired = await acct.setBookletActive(booklet.id, 1, false, 'Booklet was mislaid');
    expect(retired).toMatchObject({ isActive: false, version: 2 });
    await expect(acct.setBookletActive(booklet.id, 1, true, 'Booklet was found')).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
    expect(await acct.setBookletActive(booklet.id, 2, true, 'Booklet was found')).toMatchObject({ isActive: true, version: 3 });
  });
});
