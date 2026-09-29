/**
 * The disposal dialog (PLAN D5 FA-DISP, D4.4): "Retired" or "Sold", the sale's fields as typed to input, the book value,
 * gain or loss and "write these on the booklet" from the server's figures, the rendered form, and what it sends taken by
 * the real server (in memory).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { DisposalShown, DisposeAsset } from './Actions.tsx';
import { disposalFigures, emptySale, saleInput, type DisposalFigures, type SaleValues } from './register.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const typed: SaleValues = {
  ...emptySale(), reason: ' Sold, replaced by a newer machine ', buyer: 'typed', buyerName: ' Sample Buyer Corp. ', buyerAddress: '123 Sample St., Example City',
  buyerTin: '555-666-777-000', invoiceNumber: ' 0501 ', price: '33,600.00', cashPlaceId: '3',
};
/** The golden sale (FA/tests/sale.test.ts): book value 88,000.00, sold for 33,600.00. */
const golden: DisposalFigures = { bookValueCents: 8_800_000, gainCents: 0, lossCents: 5_800_000, sale: { grossCents: 3_360_000, vatCents: 360_000, vatableSalesCents: 3_000_000 } };

describe('the sale in the disposal dialog', () => {
  it('turns the typed buyer, invoice, price and cash place into input', () => {
    expect(saleInput('a1', typed)).toEqual({
      input: {
        assetId: 'a1', kind: 'sale', reason: 'Sold, replaced by a newer machine', buyerName: 'Sample Buyer Corp.', buyerAddress: '123 Sample St., Example City',
        buyerTin: '555-666-777-000', invoiceNumber: '0501', priceCents: 3_360_000, cashPlaceId: 3,
      },
      errors: [],
    });
    const toCustomer = { ...typed, buyer: 'customer' as const, customer: { id: 'c1', name: 'Example Garments' } };
    expect(saleInput('a1', toCustomer).input).toEqual({ assetId: 'a1', kind: 'sale', reason: 'Sold, replaced by a newer machine', customerId: 'c1', invoiceNumber: '0501', priceCents: 3_360_000, cashPlaceId: 3 });
  });

  it('names every slip before asking the server', () => {
    expect(saleInput('a1', emptySale()).errors).toEqual([
      'Say why it is being taken off the books (at least 5 characters).',
      'Pick the buyer from the customers.',
      'Type the invoice number from the booklet (digits only).',
      'Type the price the buyer paid, VAT included, like 33,600.00',
      'Pick where the buyer paid.',
    ]);
    expect(saleInput('a1', { ...typed, buyerName: ' ', buyerAddress: 'x', buyerTin: '555666777', invoiceNumber: 'A-1', price: 'abc' }).errors).toEqual([
      'Type the buyer’s name as it goes on the invoice.',
      'Type the buyer’s address.',
      'Type the buyer’s TIN like 123-456-789-000.',
      'Type the invoice number from the booklet (digits only).',
      'Type the price the buyer paid, VAT included, like 33,600.00',
    ]);
  });

  it('shows the book value and the gain or loss; a sale also shows what to write on the booklet', () => {
    expect(disposalFigures(golden)).toEqual({
      result: [['Book value today', 8_800_000], ['Loss on the sale', 5_800_000]],
      booklet: [['VATable sales', 3_000_000], ['VAT', 360_000], ['Total', 3_360_000]],
    });
    expect(disposalFigures({ bookValueCents: 9_850_000, gainCents: 150_000, lossCents: 0, sale: { grossCents: 11_200_000, vatCents: 1_200_000, vatableSalesCents: 10_000_000 } }).result)
      .toEqual([['Book value today', 9_850_000], ['Gain on the sale', 150_000]]);
    expect(disposalFigures({ bookValueCents: 9_850_000, gainCents: 0, lossCents: 9_850_000, sale: null })).toEqual({ result: [['Book value today', 9_850_000], ['Loss (the book value)', 9_850_000]], booklet: null });
    const shown = renderToStaticMarkup(createElement(DisposalShown, { doc: golden }));
    for (const text of ['Book value today', '₱88,000.00', 'Loss on the sale', '₱58,000.00', 'Write these on the booklet', 'VATable sales', '₱30,000.00', 'VAT', '₱3,600.00', 'Total', '₱33,600.00']) expect(shown).toContain(text);
  });

  it('renders "Sold" next to "Retired" with the sale fields, and no "cannot be recorded yet" message', () => {
    const noop = () => undefined;
    const sold = renderToStaticMarkup(createElement(DisposeAsset, { assetId: 'a1', label: 'FA-000001 Industrial sewing machine', onDone: noop, onClose: noop, initial: { kind: 'sale', sale: typed } }));
    expect(sold).toMatch(/role="radio" aria-checked="false"[^>]*>Retired<\/button><button[^>]*role="radio" aria-checked="true"[^>]*>Sold</);
    for (const text of ['Who bought it?', 'Buyer’s name', 'Buyer’s address', 'Buyer’s TIN', 'value="555-666-777-000"', 'Invoice number (from the booklet)', 'Price (VAT included)', 'value="33,600.00"',
      'Where did the buyer pay? (paid in full; a bank transfer counts)', 'Record the sale', 'Run the month’s depreciation first']) expect(sold).toContain(text);
    const retired = renderToStaticMarkup(createElement(DisposeAsset, { assetId: 'a1', label: 'FA-000001 Heat press', onDone: noop, onClose: noop }));
    expect(retired).toContain('Record the disposal');
    expect(retired).not.toContain('Invoice number');
    for (const html of [sold, retired]) expect(html).not.toMatch(/cannot be recorded|Only a retirement/);
  });
});

describe('the dialog against the real server', () => {
  it('previews the figures the dialog shows and records the sale it sends', async () => {
    const env = await createTestEnv(); // today is 2026-09-28
    const setup = await env.as('accountant');
    const supplierId = (await setup.post('/api/pur/suppliers', { name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id as string;
    createUser(env.db, 'acct1', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    const buy = { classCode: 'machinery', description: 'Heat press', supplierId, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: cashPlaceId(env.db, '1111'), paidCents: 11_200_000 };
    const bought = await api.post('fa.buy', buy, 11_200_000, key());
    await api.post('fa.depreciation', { month: '2026-09' }, 150_000, key());

    const { input, errors } = saleInput(bought.id, { ...typed, price: '112,000', cashPlaceId: String(cashPlaceId(env.db, '1101')) });
    expect(errors).toEqual([]);
    const p = await api.preview('fa.disposal', input);
    expect(p.issues).toEqual([]);
    expect(disposalFigures(p.doc as DisposalFigures)).toEqual({
      result: [['Book value today', 9_850_000], ['Gain on the sale', 150_000]],
      booklet: [['VATable sales', 10_000_000], ['VAT', 1_200_000], ['Total', 11_200_000]],
    });
    const recorded = await api.post('fa.disposal', input, p.totalCents, key());
    expect(recorded).toMatchObject({ number: 'FAD-000001', totalCents: 11_200_000 });
    expect((await api.asset(bought.id)).status).toBe('disposed');
  });
});
