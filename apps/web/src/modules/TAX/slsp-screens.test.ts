/**
 * SLSP and SAWT screens: the menu next to the 2550Q worksheet, the tables and ties drawn without a browser, and the web
 * client against the real server (a sale with no VAT marked zero-rated; an encoder is refused).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, encoderOwnDefaults, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key, taxQuarterPath, type Sawt, type SlspSales } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { SalesList, SawtList, TieTable, saleClassWords } from './SlspSawt.tsx';
import { excelUrl } from './reports.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('SLSP and SAWT screens', () => {
  it('sit under Accounting & Tax right after the 2550Q worksheet, with the permission their routes check', () => {
    const items = buildMenu([], new Set(['tax.registers.view'])).find((g) => g.group === 'Accounting & Tax')!.items.map((i) => `${i.label} ${i.path}`);
    const at = items.indexOf('2550Q worksheet /tax/2550q');
    expect(items.slice(at + 1, at + 4)).toEqual(['SLSP: sales /tax/slsp-sales', 'SLSP: purchases /tax/slsp-purchases', 'SAWT /tax/sawt']);
    expect(['/tax/slsp-sales', '/tax/slsp-purchases', '/tax/sawt'].every((p) => p in PAGES)).toBe(true);
    expect(buildMenu([], new Set(['tax.calendar.view'])).find((g) => g.group === 'Accounting & Tax')!.items.map((i) => i.path)).not.toContain('/tax/sawt');
    expect(excelUrl(taxQuarterPath('sawt', 2026, 3))).toBe('/api/tax/sawt?year=2026&quarter=3&format=csv');
    expect(['zero_rated', 'exempt', 'not_a_sale', null].map((c) => saleClassWords(c as 'exempt'))).toEqual(['Zero-rated', 'Exempt', 'Not a sale', 'To classify']);
  });

  it('draw the rows, the no-TIN flag, pending 2307s, and a difference with the books in red', () => {
    const sales = {
      rows: [
        { customerId: 'c1', tin: '111-222-333-00000', registeredName: 'Made-up School Foundation, Inc.', address: null, exemptCents: 200_000, zeroRatedCents: 0, vatableCents: 900_000, outputTaxCents: 108_000, grossTaxableCents: 1_008_000, toClassifyCents: 0, customers: 1 },
        { customerId: null, tin: null, registeredName: 'Walk-in and other customers without a TIN', address: null, exemptCents: 0, zeroRatedCents: 0, vatableCents: 100_000, outputTaxCents: 12_000, grossTaxableCents: 112_000, toClassifyCents: 0, customers: 3 },
      ],
      totals: { exemptCents: 200_000, zeroRatedCents: 0, vatableCents: 1_000_000, outputTaxCents: 120_000, grossTaxableCents: 1_120_000, toClassifyCents: 0 },
    } as SlspSales;
    const html = renderToStaticMarkup(createElement(SalesList, { d: sales }));
    for (const text of ['Made-up School Foundation, Inc.', 'No TIN', '3 customers', '9,000.00', '1,200.00', 'Total']) expect(html).toContain(text);

    const ties = renderToStaticMarkup(createElement(TieTable, { ties: [
      { key: 'output_gl', label: 'Output tax = 2301 output VAT in the books', listCents: 120_000, bookCents: 120_000, differenceCents: 0 },
      { key: 'revenue_gl', label: 'Revenue', listCents: 120_000, bookCents: 100_000, differenceCents: 20_000 },
    ] }));
    expect(ties).toMatch(/<tr class="border-t border-slate-100 ">.*Output tax = 2301/);
    expect(ties).toMatch(/text-red-700"><td[^>]*>Revenue<\/td>.*200.00/);

    const sawt = {
      rows: [{ customerId: 'c1', tin: '111-222-333-00000', registeredName: 'Made-up School Foundation, Inc.', atc: 'WC158', nature: 'Goods', rateBp: 100, incomePaymentCents: 1_000_000, cwtCents: 10_000, vatWithheldCents: 0, certificate: 'pending', period: null, documents: ['COL-000001'] }],
      totals: { cwtCents: 10_000, vatWithheldCents: 0, incomePaymentCents: 1_000_000 },
    } as Sawt;
    const s = renderToStaticMarkup(createElement(SawtList, { d: sawt }));
    for (const text of ['WC158', '1%', 'Pending', 'COL-000001', '10,000.00', '100.00']) expect(s).toContain(text);
  });

  it('the web client loads the lists and marks a sale with no VAT; an encoder is refused', async () => {
    const env = await createTestEnv('2026-09-28T02:00:00Z'); encoderOwnDefaults(env);
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'enc1', ['encoder']);
    const [acct, enc] = [createApi(injectFetch(env.app)), createApi(injectFetch(env.app))];
    await acct.login('acct1', PASSWORD);
    await enc.login('enc1', PASSWORD);
    const customer = (await (await env.as('accountant')).post('/api/cus/customers', { kind: 'organization', displayName: 'Sample Export Buyer' })).json().id as string;
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const input = { memo: 'Export sale of jerseys', lines: [{ accountId: account('1101'), debitCents: 300_000 }, { accountId: account('4101'), party: { type: 'customer', id: customer }, creditCents: 300_000 }] };
    await acct.post('acc.jv', input, 300_000, key());

    let s = await acct.slspSales(2026, 3);
    expect(s.noVatSales.map((r) => [r.customerName, r.amountCents, saleClassWords(r.saleClass)])).toEqual([['Sample Export Buyer', 300_000, 'To classify']]);
    await acct.classifySale(s.noVatSales[0]!.journalId, 'zero_rated', 'Export papers on file');
    s = await acct.slspSales(2026, 3);
    expect([s.totals.zeroRatedCents, s.rows[0]?.registeredName, s.ties.every((t) => t.differenceCents === 0)]).toEqual([300_000, 'Walk-in and other customers without a TIN', true]);
    expect((await acct.slspPurchases(2026, 3)).rows).toEqual([]);
    expect((await acct.sawt(2026, 3)).rows).toEqual([]);
    await expect(enc.slspSales(2026, 3)).rejects.toThrow();
    await expect(enc.sawt(2026, 3)).rejects.toThrow();
    await expect(acct.classifySale(s.noVatSales[0]!.journalId, 'zero_rated', 'Export papers on file')).rejects.toThrow(/already marked/);
  });
});
