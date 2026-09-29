/**
 * The "Sold" disposal (PLAN D5 FA-DISP with INV-REC): the form's rules, the dialog as staff see it ("Sold" next to
 * "Retired", the sale's fields, no more "only a retirement"), and the book value, gain or loss and "write these on the
 * booklet" drawn from the real server's preview (in memory), then recorded through the web client.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from '../../api.ts';
import { DisposeAsset, SaleFields, SaleFigures } from './Actions.tsx';
import { emptySale, gainOrLoss, saleBooklet, saleInput, type DisposalDoc, type SaleValues } from './sale.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const typed: SaleValues = { ...emptySale(), invoiceNumber: ' 0521 ', amount: '33,600', cashPlaceId: '4', buyerName: ' Sample Tailoring Shop ', buyerAddress: ' 12 Sample Street ', buyerTin: '987-654-321-000' };

describe('sold: the form rules', () => {
  it('a typed buyer: name, address and TIN go in; a picked customer: only its id (its name and TIN are on file)', () => {
    expect(saleInput('a1', ' Sold to another shop ', typed)).toEqual({
      input: {
        assetId: 'a1', kind: 'sale', reason: 'Sold to another shop', invoiceNumber: '0521', amountCents: 3_360_000, cashPlaceId: 4,
        buyerName: 'Sample Tailoring Shop', buyerTin: '987-654-321-000', buyerAddress: '12 Sample Street',
      },
      errors: [],
    });
    expect(saleInput('a1', 'Sold to the school', { ...typed, customer: { id: 'c1', name: 'Moonlight Test School' }, buyerAddress: '' }).input).toEqual({
      assetId: 'a1', kind: 'sale', reason: 'Sold to the school', invoiceNumber: '0521', amountCents: 3_360_000, cashPlaceId: 4, customerId: 'c1',
    });
  });

  it('names every slip', () => {
    expect(saleInput('a1', 'no', { ...emptySale(), invoiceNumber: 'A-7', amount: '0.50', buyerTin: '12' }).errors).toEqual([
      'Say why it is being taken off the books (at least 5 characters).',
      'Type the invoice number from the booklet (digits only).',
      'Type what the buyer paid, VAT included, like 33,600.00',
      'Pick where the buyer’s money went.',
      'Pick the customer who bought it, or type the buyer’s name.',
      'Type the buyer’s TIN like 123-456-789-000, or leave it empty.',
    ]);
  });

  it('shows the gain or loss and the booklet figures the server worked out', () => {
    const doc: DisposalDoc = { costCents: 10_000_000, accumulatedCents: 1_333_333, bookValueCents: 8_666_667, proceedsCents: 9_000_000, gainCents: 333_333, lossCents: 0, sale: { grossCents: 10_080_000, vatCents: 1_080_000, vatableSalesCents: 9_000_000, buyerName: 'Moonlight Test School' } };
    expect(gainOrLoss(doc).figures.at(-1)).toEqual(['Gain on the sale', 333_333, 'font-semibold text-emerald-700']);
    expect(gainOrLoss(doc).words).toBe('Sold for ₱3,333.33 more than its book value.');
    expect(saleBooklet(doc)).toEqual([['VATable sales', 9_000_000], ['VAT', 1_080_000], ['Total', 10_080_000, 'font-semibold']]);
    expect(saleBooklet({ ...doc, sale: null })).toEqual([]);
  });
});

describe('sold: the dialog', () => {
  it('offers "Sold" next to "Retired"; a sale asks for the invoice, the price, the cash place and the buyer', () => {
    const noop = () => {};
    const retired = text(renderToStaticMarkup(createElement(DisposeAsset, { assetId: 'a1', label: 'FA-000001 Sewing machine', onDone: noop, onClose: noop })));
    expect(retired).toContain('Take FA-000001 Sewing machine off the books');
    expect(retired).toMatch(/Retired Sold/);
    expect(retired).toContain('Nothing is received for it: the book value left is charged as a loss. Run the month’s depreciation first');
    expect(retired).not.toContain('Invoice number');
    expect(retired).not.toMatch(/only a retirement/i);

    const html = renderToStaticMarkup(createElement(DisposeAsset, { assetId: 'a1', label: 'FA-000001 Sewing machine', onDone: noop, onClose: noop, initialKind: 'sale' }));
    expect(html).toMatch(/aria-checked="false"[^>]*>Retired<\/button><button [^>]*aria-checked="true"[^>]*>Sold<\/button>/);
    const sold = text(html);
    for (const words of ['Record the sale from the invoice written for it.', 'Invoice number (from the booklet)', 'Price, VAT included', 'Paid in full now; a bank transfer counts.', 'Buyer', 'Buyer\'s name', 'Buyer\'s TIN', 'Buyer\'s address']) {
      expect(sold).toContain(words);
    }
    expect(sold).not.toMatch(/only a retirement|cannot be recorded yet/i);
    const picked = text(renderToStaticMarkup(createElement(SaleFields, { v: { ...emptySale(), customer: { id: 'c1', name: 'Moonlight Test School' } }, set: noop, places: [] })));
    expect(picked).toContain('Moonlight Test School');
    expect(picked).not.toContain('Buyer\'s name');
  });

  it('shows the book value, the loss and the booklet figures from the server before saving, then records the sale', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    const api = createApi(injectFetch(env.app));
    await api.login('acct1', PASSWORD);
    const { id: supplierId } = await api.addSupplier({ name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true, ewtClass: null, swornDeclarationUntil: null, paymentTermsDays: null, legacyId: null });
    const buy = { classCode: 'machinery', description: 'Sewing machine', supplierId, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 0, cashPlaceId: cashPlaceId(env.db, '1111'), paidCents: 11_200_000 };
    const bought = await api.post('fa.buy', buy, 11_200_000, key());

    const { input, errors } = saleInput(bought.id, 'Sold to another shop', { ...typed, cashPlaceId: String(cashPlaceId(env.db, '1101')) });
    expect(errors).toEqual([]);
    const preview = await api.preview('fa.disposal', input);
    expect(preview.issues.filter((i) => i.level === 'error')).toEqual([]);
    const shown = text(renderToStaticMarkup(createElement(SaleFigures, { doc: preview.doc as DisposalDoc })));
    // Cost 100,000.00, nothing depreciated yet: book value 100,000.00; ₱33,600.00 is 30,000.00 VATable + 3,600.00 VAT: a loss of 70,000.00.
    expect(shown).toContain('Book value ₱100,000.00');
    expect(shown).toContain('Received, VAT excluded ₱30,000.00');
    expect(shown).toContain('Loss on the sale ₱70,000.00');
    expect(shown).toContain('Write these on the booklet VATable sales ₱30,000.00 VAT ₱3,600.00 Total ₱33,600.00');

    const fad = await api.post('fa.disposal', input, preview.totalCents, key());
    expect(fad).toMatchObject({ number: 'FAD-000001', totalCents: 3_360_000 });
    const page = await api.asset(bought.id);
    expect([page.status, page.documents.at(-1)?.docType]).toEqual(['disposed', 'fa.disposal']);
    env.db.close();
  });
});
