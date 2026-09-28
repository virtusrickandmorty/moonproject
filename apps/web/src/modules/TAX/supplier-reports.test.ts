/**
 * Tax screens, part 2: the purchases and EWT registers, the 2307s to issue and the 2550Q worksheet. Their rules and
 * tables without a browser, the menu, and the web client against the real server.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key, taxQuarterPath, taxRegisterPath, type CertificatesToIssue, type WorksheetCheck } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { CertificateTable, WorksheetChecks, WorksheetTable } from './QuarterReports.tsx';
import {
  atcToConfirmWords, atcWords, checkTone, classTotals, classWords, ewtClassWords, excelUrl, isWorksheetTotal, ledgerWarnings, monthName, quarterSoFar, rateWords,
  returnQuarter, sortedChecks, worksheetCloseLink,
} from './reports.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const sums = (netCents: number, vatCents: number) => ({ netCents, vatCents, totalCents: netCents + vatCents });
const check = (code: string, level: WorksheetCheck['level']): WorksheetCheck => ({ code, level, message: `${code} message` });

describe('tax screens, part 2: rules', () => {
  it('the quarter reports open on the quarter whose 2307s and 2550Q are due: the one just ended in a quarter\'s first month, else today\'s', () => {
    expect(returnQuarter('2026-09-28')).toEqual({ year: 2026, quarter: 3 });
    expect(returnQuarter('2026-10-05')).toEqual({ year: 2026, quarter: 3 });
    expect(returnQuarter('2026-10-31')).toEqual({ year: 2026, quarter: 3 });
    expect(returnQuarter('2026-11-01')).toEqual({ year: 2026, quarter: 4 });
    expect(returnQuarter('2027-01-15')).toEqual({ year: 2026, quarter: 4 });
    expect(returnQuarter('2027-02-01')).toEqual({ year: 2027, quarter: 1 });
    expect(returnQuarter('2026-04-01')).toEqual({ year: 2026, quarter: 1 });
    expect(['2026-07', '2026-08', '2026-09', '2026-12'].map(monthName)).toEqual(['July', 'August', 'September', 'December']);
  });

  it('names the class of a purchase and lists the totals by class in the order of the 2550Q', () => {
    expect(['capital_goods', 'goods', 'services', null].map((c) => classWords(c as 'goods'))).toEqual(['Capital goods', 'Goods', 'Services', 'To classify']);
    const by = { capital_goods: sums(100, 12), goods: sums(200, 24), services: sums(300, 36), unclassified: sums(0, 50) };
    expect(classTotals(by)).toEqual([['Capital goods', by.capital_goods], ['Goods', by.goods], ['Services', by.services], ['To classify', by.unclassified]]);
    expect(ledgerWarnings([['VAT', 'input VAT', 840_000, 790_000]])).toEqual([
      'The VAT in this register (₱8,400.00) is not what the ledger shows on input VAT for these dates (₱7,900.00). Look at the general ledger before filing.',
    ]);
  });

  it('shows the ATC, or the ATCs to choose from while the supplier file does not say individual or company', () => {
    expect(atcWords({ ewtClass: 'prof_firm_10', atc: 'WC010', atcChoices: ['WC010'] })).toBe('WC010');
    expect(atcWords({ ewtClass: 'rent_5', atc: null, atcChoices: ['WI100', 'WC100'] })).toBe('ATC to confirm (WI100 or WC100)');
    expect(atcWords({ ewtClass: null, atc: null, atcChoices: [] })).toBe('—'); // a journal voucher on EWT payable
    expect([0, 1, 2].map(atcToConfirmWords)).toEqual([
      'Every row has its ATC.',
      "1 row has its ATC to confirm: the supplier's file does not say whether the payee is an individual or a company.",
      "2 rows have their ATC to confirm: the supplier's file does not say whether the payee is an individual or a company.",
    ]);
    expect([ewtClassWords('rent_5'), ewtClassWords('contractor_2'), ewtClassWords(null)]).toEqual(['Rent', 'Contractors and printers', '—']);
    expect([rateWords(500), rateWords(150), rateWords(null)]).toEqual(['5%', '1.5%', '—']);
  });

  it('colours the 2550Q checks, errors first, and links to the VAT close only while NOT_CLOSED shows', () => {
    expect(['error', 'warning', 'info'].map((l) => checkTone(l as 'info'))).toEqual(['error', 'warning', 'note']);
    const checks = [check('QUARTER_OPEN', 'info'), check('TO_CLASSIFY', 'warning'), check('NOT_CLOSED', 'info'), check('CHANGED_AFTER_CLOSE', 'warning'), check('SALES_NOT_TIED', 'error')];
    expect(sortedChecks(checks).map((c) => c.code)).toEqual(['SALES_NOT_TIED', 'TO_CLASSIFY', 'CHANGED_AFTER_CLOSE', 'QUARTER_OPEN', 'NOT_CLOSED']);
    expect(checks[0]!.code).toBe('QUARTER_OPEN'); // the server's list is left as it came
    expect(worksheetCloseLink({ year: 2026, quarter: 2, checks })).toBe('/docs/tax.vat_close/new?year=2026&quarter=2');
    expect(worksheetCloseLink({ year: 2026, quarter: 3, checks: [check('QUARTER_OPEN', 'info')] })).toBeNull();
    expect(['output_tax', 'input_tax', 'net_vat', 'payable', 'carry_forward', 'goods', 'vatable_sales'].map(isWorksheetTotal)).toEqual([true, true, true, true, true, false, false]);
    expect(excelUrl(taxQuarterPath('2550q', 2026, 3))).toBe('/api/tax/2550q?year=2026&quarter=3&format=csv');
    expect(excelUrl(taxRegisterPath('ewt', '2026-07-01', '2026-09-30'))).toBe('/api/tax/registers/ewt?from=2026-07-01&to=2026-09-30&format=csv');
  });

  it('draws the checks in red, amber and grey, blanks an amount the form has none of, and gives each month of a 2307 its base and EWT', () => {
    const notes = renderToStaticMarkup(createElement(WorksheetChecks, { checks: [check('NOT_CLOSED', 'info'), check('PENDING_2307', 'warning'), check('PURCHASES_NOT_TIED', 'error')] }));
    expect([...notes.matchAll(/class="[^"]*(bg-\w+-50)[^"]*">(\w+) message/g)].map((m) => [m[1], m[2]])).toEqual([
      ['bg-red-50', 'PURCHASES_NOT_TIED'], ['bg-amber-50', 'PENDING_2307'], ['bg-slate-50', 'NOT_CLOSED'],
    ]);
    const table = renderToStaticMarkup(createElement(WorksheetTable, { lines: [
      { key: 'input_carried_over', label: 'Input tax carried over from the previous quarter', amountCents: null, taxCents: 0 },
      { key: 'output_tax', label: 'Total output tax due', amountCents: 1_000_000, taxCents: 120_000 },
    ] }));
    expect(table).toContain('<td class="whitespace-nowrap py-1 pl-3 text-right tabular-nums"></td>');
    expect(table).toMatch(/font-semibold"><td[^>]*>Total output tax due<\/td><td[^>]*>10,000.00<\/td><td[^>]*>1,200.00<\/td>/);

    const c: CertificatesToIssue = {
      year: 2026, quarter: 3, from: '2026-07-01', to: '2026-09-30', months: ['2026-07', '2026-08', '2026-09'],
      lines: [{
        supplierId: 's1', supplierName: 'Sample Lessor Corp.', tin: '333-444-555-000', ewtClass: 'rent_5', atc: null, atcChoices: ['WI100', 'WC100'],
        months: [{ month: '2026-07', baseCents: 4_000_000, ewtCents: 200_000 }, { month: '2026-08', baseCents: 0, ewtCents: 0 }, { month: '2026-09', baseCents: 4_000_000, ewtCents: 200_000 }],
        baseCents: 8_000_000, ewtCents: 400_000,
      }],
      totals: { baseCents: 8_000_000, ewtCents: 400_000 },
    };
    const certs = renderToStaticMarkup(createElement(CertificateTable, { c }));
    for (const text of ['July', 'August', 'September', 'Quarter', 'ATC to confirm (WI100 or WC100)', 'Rent', '40,000.00', '80,000.00', '4,000.00']) expect(certs).toContain(text);
    expect(certs.match(/<th class="pl-3 text-right">Base<\/th>/g)).toHaveLength(4);
    expect(renderToStaticMarkup(createElement(CertificateTable, { c: { ...c, lines: [] } }))).toContain('there is no 2307 to issue');
  });

  it('puts every tax screen, the booklets included, under Accounting & Tax (PLAN H1) with the permission its route checks', () => {
    const groups = buildMenu([], new Set(['tax.registers.view', 'tax.calendar.view', 'tax.booklets.view']));
    expect(groups.map((g) => g.group)).toEqual(['Overview', 'Accounting & Tax', 'Admin']); // no separate Tax group; Admin has the Shop certificate for everyone
    const tax = groups[1]!.items;
    expect(tax.map((i) => i.label).at(-1)).toBe('Booklets');
    expect(tax.slice(2, 7).map((i) => `${i.label} ${i.path}`)).toEqual([
      'Purchases register /tax/purchases', 'EWT register /tax/ewt', '2307s to issue /tax/2307-to-issue', 'VAT this quarter /tax/vat', '2550Q worksheet /tax/2550q',
    ]);
    expect(tax.every((i) => i.path in PAGES)).toBe(true);
  });
});

describe('web client for tax screens, part 2', () => {
  it('purchases and EWT registers, 2307s to issue and the 2550Q worksheet, each with its Excel download, as the screens ask for them', async () => {
    const env = await createTestEnv('2026-06-20T02:00:00Z');
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'enc1', ['encoder']);
    const server = await env.as('accountant');
    const supplier = async (s: object) => (await server.post('/api/pur/suppliers', s)).json().id as string;
    const fabric = await supplier({ name: 'Sample Fabric', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: true });
    const lessor = await supplier({ name: 'Sample Lessor', registeredName: 'Sample Lessor Corp.', tin: '333-444-555-000', isVatRegistered: true, ewtClass: 'rent_5' });
    const auditor = await supplier({ name: 'Sample Audit', registeredName: 'Sample Audit Firm', tin: '555-666-777-000', isVatRegistered: true, ewtClass: 'prof_firm_10' });
    /** Signs in on the clock's day (a session from an earlier day has timed out). */
    const signIn = async () => {
      const acctFetch = injectFetch(env.app);
      const [acct, enc] = [createApi(acctFetch), createApi(injectFetch(env.app))];
      await acct.login('acct1', PASSWORD);
      await enc.login('enc1', PASSWORD);
      return { acctFetch, acct, enc };
    };
    let { acctFetch, acct, enc } = await signIn();
    const categories = await enc.expCategories();
    const cat = (name: string) => categories.find((c) => c.name === name)!.id;
    const bill = async (supplierId: string, supplierInvoiceNo: string, supplierInvoiceDate: string, lines: { categoryId: number; amountCents: number }[]) => {
      const input = { supplierId, supplierInvoiceNo, supplierInvoiceDate, lines };
      return enc.post('ap.bill', input, (await enc.preview('ap.bill', input)).totalCents, key());
    };
    // June: office supplies ₱5,600.00 (input VAT ₱600.00), no EWT.
    await bill(fabric, 'SI-0050', '2026-06-18', [{ categoryId: cat('Office supplies'), amountCents: 560_000 }]);

    // September: rent ₱44,800.00 (VAT ₱4,800.00, EWT 5%); an audit firm's fee ₱22,400.00 and office supplies ₱11,200.00 on one bill (EWT 10%).
    env.clock.set('2026-09-28T02:00:00Z');
    ({ acctFetch, acct, enc } = await signIn());
    const rent = await bill(lessor, 'SI-0100', '2026-09-25', [{ categoryId: cat('Rent'), amountCents: 4_480_000 }]);
    const audit = await bill(auditor, 'SI-0200', '2026-09-25', [{ categoryId: cat('Professional fees'), amountCents: 2_240_000 }, { categoryId: cat('Office supplies'), amountCents: 1_120_000 }]);

    const { from, to } = quarterSoFar('2026-09-28');
    const p = await acct.purchasesRegister(from, to);
    expect(p.rows.map((r) => [r.docTitle, r.documentNumber, r.supplierInvoiceNo, r.supplierName, r.tin, classWords(r.purchaseClass), r.netCents, r.vatCents, r.totalCents])).toEqual([
      ['Supplier Bill', rent.number, 'SI-0100', 'Sample Lessor Corp.', '333-444-555-000', 'Services', 4_000_000, 480_000, 4_480_000],
      ['Supplier Bill', audit.number, 'SI-0200', 'Sample Audit Firm', '555-666-777-000', 'Goods', 1_000_000, 120_000, 1_120_000],
      ['Supplier Bill', audit.number, 'SI-0200', 'Sample Audit Firm', '555-666-777-000', 'Services', 2_000_000, 240_000, 2_240_000],
    ]);
    expect(classTotals(p.byClass).map(([label, t]) => [label, t.vatCents])).toEqual([['Capital goods', 0], ['Goods', 120_000], ['Services', 720_000], ['To classify', 0]]);
    expect([p.totals.vatCents, p.glVatCents]).toEqual([840_000, 840_000]);
    expect(ledgerWarnings([['VAT', 'input VAT', p.totals.vatCents, p.glVatCents]])).toEqual([]);

    const e = await acct.ewtRegister(from, to);
    expect(e.rows.map((r) => [r.supplierName, ewtClassWords(r.ewtClass), atcWords(r), r.baseCents, rateWords(r.rateBp), r.ewtCents])).toEqual([
      ['Sample Lessor Corp.', 'Rent', 'ATC to confirm (WI100 or WC100)', 4_000_000, '5%', 200_000],
      ['Sample Audit Firm', 'Professional fees, firm (lower rate)', 'WC010', 3_000_000, '10%', 300_000],
    ]);
    expect(e).toMatchObject({ totals: { baseCents: 7_000_000, ewtCents: 500_000 }, glEwtCents: 500_000, atcToConfirmCount: 1 });

    const certs = await acct.certificatesToIssue(2026, 3);
    expect(certs.months.map(monthName)).toEqual(['July', 'August', 'September']);
    expect(certs.lines.map((l) => [l.supplierName, atcWords(l), l.months.map((m) => m.ewtCents), l.ewtCents])).toEqual([
      ['Sample Audit Firm', 'WC010', [0, 0, 300_000], 300_000],
      ['Sample Lessor Corp.', 'ATC to confirm (WI100 or WC100)', [0, 0, 200_000], 200_000],
    ]);
    expect(certs.totals).toEqual({ baseCents: 7_000_000, ewtCents: 500_000 });

    // Q2 has ended with no close: the worksheet links to the close form; once it is recorded, it names the close instead.
    const q2 = await acct.vatWorksheet(2026, 2);
    expect(q2.checks.map((c) => c.code)).toEqual(['NOT_CLOSED']);
    expect(worksheetCloseLink(q2)).toBe('/docs/tax.vat_close/new?year=2026&quarter=2');
    const closing = { year: 2026, quarter: 2 };
    const vatc = await acct.post('tax.vat_close', closing, (await acct.preview('tax.vat_close', closing)).totalCents, key());
    const closed = await acct.vatWorksheet(2026, 2);
    expect(closed).toMatchObject({ returnDue: '2026-07-27', close: { documentId: vatc.id, number: vatc.number }, checks: [] });
    expect(worksheetCloseLink(closed)).toBeNull();

    // Q3 is still open: no close to record yet. Its purchases split by class as on the register, with Q2's input VAT carried over.
    const q3 = await acct.vatWorksheet(2026, 3);
    expect(q3).toMatchObject({ returnDue: '2026-10-26', close: null, checks: [{ code: 'QUARTER_OPEN', level: 'info' }] });
    expect(q3.lines.filter((l) => ['input_carried_over', 'goods', 'services', 'input_tax', 'carry_forward'].includes(l.key)).map((l) => [l.key, l.amountCents, l.taxCents])).toEqual([
      ['input_carried_over', null, 60_000], ['goods', 1_000_000, 120_000], ['services', 6_000_000, 720_000], ['input_tax', 7_000_000, 900_000], ['carry_forward', null, 900_000],
    ]);
    expect(worksheetCloseLink(q3)).toBeNull();

    // Each screen's "Download for Excel" link.
    const download = async (url: string) => {
      const res = await acctFetch(excelUrl(url), { method: 'GET', headers: {} });
      expect(res.status).toBe(200);
      return (await res.text()).split('\r\n');
    };
    expect((await download(taxRegisterPath('purchases', from, to)))[0]).toContain('"Supplier invoice","Supplier","TIN","Class","Amount before VAT","Input VAT","Total"');
    expect((await download(taxRegisterPath('ewt', from, to)))[1]).toContain('"ATC to confirm (WI100 or WC100)","40000.00","5%","2000.00"');
    expect((await download(taxQuarterPath('2307-to-issue', 2026, 3)))[0]).toContain('"2026-07 base","2026-07 EWT"');
    expect((await download(taxQuarterPath('2550q', 2026, 3)))[0]).toBe('"Item","Amount","Tax"');

    // The encoder sees none of it.
    for (const call of [() => enc.purchasesRegister(from, to), () => enc.ewtRegister(from, to), () => enc.certificatesToIssue(2026, 3), () => enc.vatWorksheet(2026, 3)]) {
      await expect(call()).rejects.toMatchObject({ status: 403 });
    }
  });
});
