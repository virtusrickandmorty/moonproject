/** The tax report screens' rules (dates, range check, cancel marks, words), the menu, and the web client against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key, taxRegisterPath } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import {
  cancelMark, certificateWords, closeDate, closeLink, excelUrl, lastEndedQuarter, ledgerWarnings, movedFrom, nextSixtyDays, pendingWords, quarterRange, quarterSoFar,
  quarterTitle, rangeError, vatBottomLine, vatLines, withheldPendingWords, yearChoices,
} from './reports.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('tax report screen rules', () => {
  it('opens the registers on this quarter so far, the calendar on the next 60 days, the VAT screen on recent years', () => {
    expect(quarterSoFar('2026-09-28')).toEqual({ from: '2026-07-01', to: '2026-09-28' });
    expect(quarterSoFar('2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(quarterSoFar('2027-02-28')).toEqual({ from: '2027-01-01', to: '2027-02-28' });
    expect([1, 2, 3, 4].map((q) => quarterRange(2028, q as 1).to)).toEqual(['2028-03-31', '2028-06-30', '2028-09-30', '2028-12-31']);
    expect(nextSixtyDays('2026-09-28')).toEqual({ from: '2026-09-28', to: '2026-11-27' });
    expect(nextSixtyDays('2026-12-15').to).toBe('2027-02-13');
    expect(yearChoices('2026-09-28')).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it('checks a range the way the server does', () => {
    expect(rangeError('2026-07-01', '2026-09-30')).toBeNull();
    expect(rangeError('2026-07-01', '2026-07-01')).toBeNull();
    expect(rangeError('', '2026-09-30')).toBe('Pick the first and last dates.');
    expect(rangeError('2026-02-30', '2026-09-30')).toBe('Pick the first and last dates.');
    expect(rangeError('2026-09-30', '2026-07-01')).toBe('The last date is before the first.');
    expect(rangeError('2021-01-01', '2026-12-31')).toBeNull();
    expect(rangeError('2020-12-31', '2026-01-01')).toBe('Pick at most five years at a time.');
  });

  it('marks a cancel on both rows, names the 2307 and the pending count, and warns when a total is not the ledger', () => {
    expect(cancelMark({ posting: 'original', documentStatus: 'posted' })).toBeNull();
    expect(cancelMark({ posting: 'original', documentStatus: null })).toBeNull();
    expect(cancelMark({ posting: 'original', documentStatus: 'cancelled' })?.text).toBe('Cancelled later');
    expect(cancelMark({ posting: 'reversal', documentStatus: 'cancelled' })?.text).toBe('Cancelled');
    expect(['received', 'pending', null].map((c) => certificateWords(c as 'pending'))).toEqual(['In hand', 'Pending', '—']);
    expect([0, 1, 3].map(pendingWords)).toEqual(['No 2307 is still to come.', '1 2307 is still to come.', '3 2307s are still to come.']);
    expect(ledgerWarnings([['VAT', 'output VAT', 123_750, 123_750]])).toEqual([]);
    expect(ledgerWarnings([['CWT', 'creditable withholding tax', 10_000, 10_000], ['VAT withheld', 'VAT withheld', 50_000, 60_000]])).toEqual([
      'The VAT withheld in this register (₱500.00) is not what the ledger shows on VAT withheld for these dates (₱600.00). Look at the general ledger before filing.',
    ]);
    expect(excelUrl(taxRegisterPath('sales', '2026-07-01', '2026-09-30'))).toBe('/api/tax/registers/sales?from=2026-07-01&to=2026-09-30&format=csv');
  });

  it('says when a deadline moved, never that it is late; says what is payable or carried over', () => {
    expect(movedFrom({ statutoryDate: '2026-10-10', dueDate: '2026-10-12' })).toBe('moved from 2026-10-10');
    expect(movedFrom({ statutoryDate: '2026-10-20', dueDate: '2026-10-20' })).toBeNull();
    expect(quarterTitle(2026, 3, '2026-09-28')).toBe('Q3 2026 (July to September), so far');
    expect(quarterTitle(2026, 2, '2026-09-28')).toBe('Q2 2026 (April to June)');
    expect(quarterTitle(2026, 4, '2026-09-28')).toBe('Q4 2026 (October to December), not started yet');
    expect(vatBottomLine({ payableCents: 40_000, carryForwardCents: 0, returnDue: '2026-10-26' })).toBe('VAT payable ₱400.00 with the 2550Q, due 2026-10-26');
    expect(vatBottomLine({ payableCents: 0, carryForwardCents: 25_000, returnDue: '2026-10-26' })).toBe('Carried over to next quarter: ₱250.00');
    expect(vatBottomLine({ payableCents: 0, carryForwardCents: 0, returnDue: '2026-10-26' })).toBe('VAT payable ₱0.00 with the 2550Q, due 2026-10-26');
    expect(withheldPendingWords(0)).toBeNull();
    expect(withheldPendingWords(50_000)).toBe('Not counted: ₱500.00 more still waits for its 2307. It is claimed in the quarter the certificate comes.');
    // The VAT close's preview has no due date: its plain summary gives it.
    expect(vatBottomLine({ payableCents: 120_000, carryForwardCents: 0 })).toBe('VAT payable ₱1,200.00 with the 2550Q');
    expect(vatLines({ outputVatCents: 120_000, inputVatCents: 20_000, vatWithheldCents: 5_000, carryOverCents: 0, vatWithheldPendingCents: 2_500 })).toEqual([
      ['Output VAT on sales', 120_000, null],
      ['Less input VAT on purchases', 20_000, null],
      ['Less VAT withheld by government buyers', 5_000, 'Not counted: ₱25.00 more still waits for its 2307. It is claimed in the quarter the certificate comes.'],
      ['Less input VAT carried over from earlier quarters', 0, null],
    ]);
  });

  it('the VAT close opens on the quarter before today, is offered once a quarter ends unclosed, and is dated on its last day', () => {
    expect(lastEndedQuarter('2026-09-28')).toEqual({ year: 2026, quarter: 2 });
    expect(lastEndedQuarter('2026-01-05')).toEqual({ year: 2025, quarter: 4 });
    const q2 = { year: 2026, quarter: 2 as const, to: '2026-06-30', close: null };
    expect(closeLink(q2, '2026-09-28')).toBe('/docs/tax.vat_close/new?year=2026&quarter=2');
    expect(closeLink(q2, '2026-06-30')).toBeNull(); // the quarter's last day: not ended yet
    expect(closeLink(q2, '')).toBeNull(); // the server date is not known yet
    expect(closeLink({ ...q2, close: { documentId: 'd', number: 'VATC-000001', date: '2026-06-30' } }, '2026-09-28')).toBeNull();
    expect(closeDate('2026-06-30', '2026-09-28', true, true)).toBe('2026-06-30');
    expect(closeDate('2026-06-30', '2026-09-28', true, false)).toBeUndefined(); // today
    expect(closeDate('2026-06-30', '2026-09-28', false, true)).toBeUndefined(); // may not backdate: today
    expect(closeDate('2026-09-30', '2026-09-28', true, true)).toBeUndefined(); // not ended: the server says so
  });

  it('the menu shows each screen under Accounting & Tax only with the permission its route checks', () => {
    const tax = (permissions: string[]) => buildMenu([], new Set(permissions)).find((g) => g.group === 'Accounting & Tax')?.items.map((i) => `${i.label} ${i.path}`);
    expect(tax(['tax.registers.view', 'tax.calendar.view'])).toEqual([
      'Sales register /tax/sales', '2307s received /tax/2307-received', 'Purchases register /tax/purchases', 'EWT register /tax/ewt',
      '2307s to issue /tax/2307-to-issue', 'VAT this quarter /tax/vat', '2550Q worksheet /tax/2550q',
      'SLSP: sales /tax/slsp-sales', 'SLSP: purchases /tax/slsp-purchases', 'SAWT /tax/sawt', '0619-E (monthly EWT) /tax/0619e', '1601-EQ (quarterly EWT) /tax/1601eq',
      '1702Q worksheet /tax/1702q', 'Tax calendar /tax/calendar',
    ]);
    expect(tax(['tax.calendar.view', 'tax.booklets.view'])).toEqual(['Tax calendar /tax/calendar', 'Booklets /tax/booklets']);
    expect(tax([])).toBeUndefined();
  });
});

describe('web client for the tax reports', () => {
  it('registers, their Excel download, the calendar and the VAT of a quarter, as the screens ask for them; a cancel shows on both rows', async () => {
    const env = await createTestEnv(); // 2026-09-28, a Monday
    createUser(env.db, 'acct1', ['accountant']);
    const encoderId = createUser(env.db, 'enc1', ['encoder']);
    const c = seedCustomers(env.db, encoderId);
    env.db.prepare(`UPDATE cus_customers SET registered_name = 'Made-up School Foundation, Inc.', tin = '111-222-333-00000' WHERE id = ?`).run(c.school);
    const jar = { cookie: '' };
    const acctFetch = injectFetch(env.app, jar);
    const acct = createApi(acctFetch);
    const enc = createApi(injectFetch(env.app));
    await acct.login('acct1', PASSWORD);
    await enc.login('enc1', PASSWORD);

    // A government buyer: ₱11,200.00 (VAT ₱1,200.00), paid as ₱10,600.00 cash, 1% CWT ₱100.00 and 5% VAT withheld ₱500.00, 2307 to follow.
    const sale = await enc.qsRecord({
      sale: { customerId: c.school, invoiceNumber: '0601', lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: 1_120_000, discountCents: 0 }] },
      payment: { crNumber: '0801', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 1_060_000 }], withholding: { atc: 'WC158', certificate: 'pending', cwtCents: 10_000, vatWithheldCents: 50_000 } },
    }, 1_120_000, key());

    const { from, to } = quarterSoFar('2026-09-28');
    const sales = await acct.salesRegister(from, to);
    expect(sales.rows).toEqual([expect.objectContaining({
      date: '2026-09-28', docType: 'qs.sale', documentId: sale.sale.id, docTitle: 'Invoice Record', documentNumber: sale.sale.number, formNumber: '0601',
      customerName: 'Made-up School Foundation, Inc.', tin: '111-222-333-00000', netCents: 1_000_000, vatCents: 120_000, totalCents: 1_120_000,
    })]);
    expect(sales.totals).toEqual({ netCents: 1_000_000, vatCents: 120_000, totalCents: 1_120_000 });
    expect(ledgerWarnings([['VAT', 'output VAT', sales.totals.vatCents, sales.glVatCents]])).toEqual([]);
    const csv = await (await acctFetch(excelUrl(taxRegisterPath('sales', from, to)), { method: 'GET', headers: {} })).text();
    expect(csv.split('\r\n')[0]).toContain('"Date","Journal","Cancel","Document","Number","Form no.","Customer","TIN","VATable sales","VAT","Total"');
    expect(csv.split('\r\n')[1]).toContain('"0601","Made-up School Foundation, Inc.","111-222-333-00000","10000.00","1200.00","11200.00"');

    const held = await acct.withholdingReceived(from, to);
    expect(held.rows).toEqual([expect.objectContaining({ docTitle: 'Collection Receipt', documentId: sale.payment.id, formNumber: '0801', atc: 'WC158', certificate: 'pending', cwtCents: 10_000, vatWithheldCents: 50_000 })]);
    expect(held).toMatchObject({ totals: { cwtCents: 10_000, vatWithheldCents: 50_000 }, glCwtCents: 10_000, glVatWithheldCents: 50_000, pendingCount: 1 });
    expect((await acctFetch(excelUrl(taxRegisterPath('withholding-received', from, to)), { method: 'GET', headers: {} })).status).toBe(200);

    const vat = await acct.vatSummary(2026, 3);
    expect(vat).toMatchObject({ year: 2026, quarter: 3, returnDue: '2026-10-26', outputVatCents: 120_000, inputVatCents: 0, vatWithheldCents: 0, vatWithheldPendingCents: 50_000, carryOverCents: 0, close: null });
    expect(vatBottomLine(vat)).toBe('VAT payable ₱1,200.00 with the 2550Q, due 2026-10-26');
    expect(await acct.vatSummary()).toEqual(vat); // no year and quarter: today's quarter
    expect(vatBottomLine(await acct.vatSummary(2026, 2))).toBe('VAT payable ₱0.00 with the 2550Q, due 2026-07-27');

    const range = nextSixtyDays('2026-09-28');
    const due = await acct.taxCalendar(range.from, range.to);
    expect(due.map((d) => [d.form, d.periodLabel, d.dueDate, movedFrom(d)])).toEqual([
      ['1601-C', 'September 2026', '2026-10-12', 'moved from 2026-10-10'],
      ['2307', 'Q3 2026 (July to September)', '2026-10-20', null],
      ['2550Q', 'Q3 2026 (July to September)', '2026-10-26', 'moved from 2026-10-25'],
      ['1601-EQ', 'Q3 2026 (July to September)', '2026-11-02', 'moved from 2026-10-31'],
      ['0619-E', 'October 2026', '2026-11-10', null],
      ['1601-C', 'October 2026', '2026-11-10', null],
    ]);

    // The encoder sees none of it; the server refuses a range the screen would not send.
    for (const call of [() => enc.salesRegister(from, to), () => enc.withholdingReceived(from, to), () => enc.taxCalendar(from, to), () => enc.vatSummary()]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
    await expect(acct.salesRegister(to, from)).rejects.toMatchObject({ code: 'BAD_RANGE', message: rangeError(to, from) });

    // Cancelled the next day: the original row stays on its day, marked, and the cancel is its own negative row.
    env.clock.advance(24 * 3600_000);
    const acct2 = createApi(injectFetch(env.app));
    await acct2.login('acct1', PASSWORD);
    await acct2.qsCancel(sale.sale.id, 'Recorded against the wrong buyer', key());
    const after = await acct2.salesRegister('2026-07-01', '2026-09-29');
    expect(after.rows.map((r) => [r.date, r.vatCents, cancelMark(r)?.text ?? null])).toEqual([['2026-09-28', 120_000, 'Cancelled later'], ['2026-09-29', -120_000, 'Cancelled']]);
    expect([after.totals.vatCents, after.glVatCents]).toEqual([0, 0]);
    expect((await acct2.withholdingReceived('2026-07-01', '2026-09-29')).pendingCount).toBe(0);
  });
});
