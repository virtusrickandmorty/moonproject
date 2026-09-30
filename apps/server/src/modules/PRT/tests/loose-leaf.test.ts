import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { createTestEnv, idem, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { layoutBook, PAPERS, type LeafBook } from '../loose-leaf.ts';

let env: TestEnv; let owner: Client; let accountant: Client; let encoder: Client;
const profile = { registeredName: 'Example Garments Corp.', tradeName: 'Example Garments', tin: '000-111-222-000', registeredAddress: '1 Sample Street, Manila', isVatRegistered: true };
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code=?').pluck().get(code) as number;
const journalCount = () => (env.db.prepare('SELECT COUNT(*) FROM journals').pluck().get() as number);
const BOOKS = ['cash-receipts', 'cash-disbursements', 'sales', 'purchases', 'general-journal', 'general-ledger'] as const;

/** Moves the clock; the earlier sessions have timed out. */
async function goTo(iso: string) {
  env.clock.set(iso); owner = await env.as('owner'); accountant = await env.as('accountant'); encoder = await env.as('encoder');
}
const jv = async (memo: string, debit: string, credit: string, cents: number) => {
  const res = await accountant.post('/api/docs/acc.jv/post', { input: { memo, lines: [{ accountId: account(debit), debitCents: cents }, { accountId: account(credit), creditCents: cents }] }, expectedTotalCents: cents }, idem());
  expect(res.statusCode, res.body).toBe(200);
};
const print = (book: string, from: string, to: string, extra: object = {}, who = accountant) => who.post(`/api/prt/books/${book}/print`, { from, to, ...extra });
const screen = async (book: string, from: string, to: string) => (await accountant.get(`/api/rpt/bir-books/${book}?from=${from}&to=${to}`)).json();

beforeEach(async () => {
  env = await createTestEnv('2026-09-05T02:00:00Z');
  await goTo('2026-09-05T02:00:00Z');
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  expect((await owner.put('/api/prt/company-profile', profile, { 'if-match': '0' })).statusCode).toBe(200);
});
afterEach(async () => { await env.app.close(); env.db.close(); });

/** A made-up September: cash in and out, a sale, a supplier bill and a plain journal. */
async function madeUpMonth() {
  for (let i = 0; i < 24; i++) await jv(`Made-up counter income ${i + 1}`, '1101', '7103', 10_000 + 137 * i);
  for (let i = 0; i < 6; i++) await jv(`Made-up sundries ${i + 1}`, '6190', '1101', 2_500 + 111 * i);
  const c = seedCustomers(env.db, encoder.userId);
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 20, unitPriceCents: 280_000, discountCents: 0, roster: [] }] };
  const jo = (await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 5_600_000 }, idem())).json().id as string;
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
  const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
  expect((await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: '0501' }, expectedTotalCents: 5_600_000 }, idem())).statusCode).toBe(200);
  const supplierId = (await accountant.post('/api/pur/suppliers', { name: 'Sample Print', registeredName: 'Sample Print Shop Co.', tin: '222-333-444-000', isVatRegistered: true, ewtClass: 'contractor_2' })).json().id as string;
  const lines = [{ purchase: 'subcontract', amountCents: 112_000 }];
  expect((await encoder.post('/api/docs/ap.bill/post', { input: { supplierId, supplierInvoiceNo: 'SP-1', supplierInvoiceDate: '2026-09-05', lines }, expectedTotalCents: 112_000 }, idem())).statusCode).toBe(200);
}

describe('loose-leaf print of the BIR books', () => {
  it('prints every book with the screen\'s totals to the centavo, numbered leaves and running totals that carry over', async () => {
    await madeUpMonth();
    const before = journalCount();
    let next = 1;
    for (const book of BOOKS) {
      const shown = await screen(book, '2026-09-01', '2026-09-30');
      const res = await print(book, '2026-09-01', '2026-09-30');
      expect(res.statusCode, res.body).toBe(200);
      const out = res.json();
      // Each book is numbered from 1 in a new year.
      expect(out).toMatchObject({ firstPage: 1, year: 2026, paper: 'a4', replacedPages: null });
      expect(out.leaves.map((l: { number: number }) => l.number)).toEqual(Array.from({ length: out.pageCount }, (_, i) => i + 1));
      expect(out.lastPage).toBe(out.pageCount);
      // Totals equal the book screen's.
      const expected: Record<string, number> = book === 'general-journal' ? { debitCents: shown.totalDebitCents, creditCents: shown.totalCreditCents }
        : book === 'general-ledger' ? { debitCents: shown.accounts.reduce((n: number, a: { lines: { debitCents: number }[] }) => n + a.lines.reduce((m, l) => m + l.debitCents, 0), 0),
          creditCents: shown.accounts.reduce((n: number, a: { lines: { creditCents: number }[] }) => n + a.lines.reduce((m, l) => m + l.creditCents, 0), 0) }
          : shown.totals;
      for (const [key, cents] of Object.entries(expected)) {
        if (cents === 0 && out.totals[key] === undefined) continue;
        expect(out.totals[key], `${book} ${key}`).toBe(cents);
        expect(out.html, `${book} ${key}`).toContain(formatPesos(cents));
      }
      expect(Object.keys(out.totals).length).toBeGreaterThan(0);
      // Brought forward is the previous leaf's carried forward, within one account.
      out.leaves.forEach((leaf: { account: string | null; broughtForward: unknown; carriedForward: unknown }, i: number, all: typeof out.leaves) => {
        if (i > 0 && leaf.account === all[i - 1].account) expect(leaf.broughtForward, `${book} leaf ${i + 1}`).toEqual(all[i - 1].carriedForward);
        else expect(leaf.broughtForward).toBeNull();
      });
      // Every leaf names the company, the book, the period, and its page.
      for (const text of [profile.registeredName, `TIN ${profile.tin}`, profile.registeredAddress, out.leaves.length ? `Page ${out.pageCount}` : '', '2026-09-01', '2026-09-30',
        'Total for', 'Prepared by', '@page{size:A4']) expect(out.html, `${book} ${text}`).toContain(text);
      expect((out.html.match(/class="leaf/g) ?? []).length).toBe(out.pageCount);
      expect((out.html.match(/<thead>/g) ?? []).length).toBe(out.pageCount);
      if (out.pageCount > 1) { expect(out.html).toContain('Brought forward'); expect(out.html).toContain('Carried forward'); }
      next += out.pageCount;
    }
    expect(next).toBeGreaterThan(BOOKS.length + 3);
    expect(journalCount()).toBe(before);
  });

  it('shows a long month over several leaves whose carried forward is the running total of the rows so far', async () => {
    await madeUpMonth();
    const shown = await screen('cash-receipts', '2026-09-01', '2026-09-30');
    const out = (await print('cash-receipts', '2026-09-01', '2026-09-30')).json();
    expect(out.pageCount).toBeGreaterThan(1);
    expect(out.leaves.at(-1).carriedForward.cashCents).toBe(shown.totals.cashCents);
    expect(out.leaves[0].carriedForward.cashCents).toBeLessThan(shown.totals.cashCents);
    expect(out.leaves.reduce((n: number, l: { rows: number }) => n + l.rows, 0)).toBe(shown.pages.reduce((n: number, p: { rows: unknown[] }) => n + p.rows.length, 0));
  });

  it('keeps numbering across two monthly prints and starts again at page 1 in a new year', async () => {
    await jv('Made-up September income', '1101', '7103', 12_345);
    const sept = (await print('cash-receipts', '2026-09-01', '2026-09-30')).json();
    expect(sept).toMatchObject({ firstPage: 1, lastPage: 1 });
    await goTo('2026-10-05T02:00:00Z');
    for (let i = 0; i < 20; i++) await jv(`Made-up October income ${i}`, '1101', '7103', 5_000 + i);
    const oct = (await print('cash-receipts', '2026-10-01', '2026-10-31')).json();
    expect(oct.firstPage).toBe(2);
    expect(oct.pageCount).toBeGreaterThan(1);
    expect(oct.html).toContain('Page 2');
    // Another book has its own counter.
    expect((await print('general-journal', '2026-10-01', '2026-10-31')).json().firstPage).toBe(1);
    const status = (await accountant.get('/api/prt/books/status?year=2026')).json();
    expect(status.books.find((b: { book: string }) => b.book === 'cash-receipts')).toMatchObject({ lastPage: oct.lastPage, prints: [{ firstPage: 1 }, { firstPage: 2 }] });
    // A new year restarts.
    await goTo('2027-01-05T02:00:00Z');
    await jv('Made-up January income', '1101', '7103', 6_789);
    const jan = (await print('cash-receipts', '2027-01-01', '2027-01-31')).json();
    expect(jan).toMatchObject({ firstPage: 1, year: 2027 });
    expect((await accountant.get('/api/prt/books/status?year=2026')).json().books[0].lastPage).toBe(oct.lastPage);
    // A range in two years is refused.
    const both = await print('cash-receipts', '2026-12-01', '2027-01-31');
    expect(both.statusCode).toBe(400); expect(both.json().code).toBe('BOOK_YEAR_SPANS');
  });

  it('warns before reprinting a range already printed and says which pages to replace', async () => {
    await madeUpMonth();
    const first = (await print('cash-receipts', '2026-09-01', '2026-09-30')).json();
    const again = await print('cash-receipts', '2026-09-01', '2026-09-30');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_PRINTED');
    expect(again.json().message).toContain(`pages 1 to ${first.lastPage}`);
    expect(again.json().message).toContain('replaces');
    expect(again.json().details).toMatchObject({ replacedPages: [1, first.lastPage] });
    expect((await accountant.get('/api/prt/books/status?year=2026')).json().books[0].prints).toHaveLength(1);
    const confirmed = await print('cash-receipts', '2026-09-01', '2026-09-30', { confirmReprint: true });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ firstPage: 1, lastPage: first.lastPage, replacedPages: [1, first.lastPage] });
    // Still one print in force, and the counter did not move on.
    expect((await accountant.get('/api/prt/books/status?year=2026')).json().books[0]).toMatchObject({ lastPage: first.lastPage, prints: [{ firstPage: 1 }] });
    // A range that cuts across an earlier print cannot be confirmed.
    const cut = await print('cash-receipts', '2026-09-10', '2026-09-20', { confirmReprint: true });
    expect(cut.statusCode).toBe(409); expect(cut.json().code).toBe('PRINT_CUTS_EARLIER');
    expect((env.db.prepare('SELECT COUNT(*) FROM prt_book_prints').pluck().get() as number)).toBe(2);
    expect(() => env.db.prepare('UPDATE prt_book_prints SET last_page = 99').run()).toThrow(/IMMUTABLE/);
  });

  it('uses A4 or long bond paper by the PRT setting, changed by the owner with a fresh password', async () => {
    await jv('Made-up income', '1101', '7103', 12_345);
    expect((await owner.get('/api/prt/settings')).json().looseLeafPaper).toBe('a4');
    expect((await encoder.put('/api/prt/settings/loose-leaf-paper', { paper: 'long' })).statusCode).toBe(403);
    await owner.post('/api/auth/step-up', { password: PASSWORD });
    expect((await owner.put('/api/prt/settings/loose-leaf-paper', { paper: 'long' })).json()).toEqual({ looseLeafPaper: 'long' });
    expect((await owner.put('/api/prt/settings/loose-leaf-paper', { paper: 'long' })).statusCode).toBe(400);
    const out = (await print('cash-receipts', '2026-09-01', '2026-09-30')).json();
    expect(out.paper).toBe('long');
    expect(out.html).toContain('@page{size:8.5in 13in');
    expect(out.html).toContain('font:10pt');
    expect(env.db.prepare("SELECT COUNT(*) FROM audit_log WHERE action = 'prt.loose_leaf_paper'").pluck().get()).toBe(1);
  });

  it('fits more rows on a leaf of long bond paper than on A4', () => {
    const book: LeafBook = { key: 't', title: 'Test', descHeading: 'Entry', amountHeadings: ['Amount'], kinds: ['sum'], keys: ['cents'],
      sections: [{ groups: Array.from({ length: 60 }, (_, i) => [{ lines: [`Entry ${i}`], amounts: [100 * (i + 1)] }]) }] };
    const a4 = layoutBook(book, 'a4'); const long = layoutBook(book, 'long', 5);
    expect(long.pages.length).toBeLessThan(a4.pages.length);
    expect(long.pages[0]!.number).toBe(5);
    expect(a4.totals).toEqual(long.totals);
    expect(PAPERS.long.heightMm).toBeGreaterThan(PAPERS.a4.heightMm);
    for (const layout of [a4, long]) layout.pages.forEach((p, i) => { if (i > 0) expect(p.broughtForward).toEqual(layout.pages[i - 1]!.carriedForward); });
  });

  it('follows the ledger account by account with a running balance', async () => {
    await jv('Made-up income', '1101', '7103', 12_345);
    await jv('Made-up sundries', '6190', '1101', 2_000);
    const out = (await print('general-ledger', '2026-09-01', '2026-09-30')).json();
    const accounts = out.leaves.map((l: { account: string }) => l.account);
    expect(accounts).toContain('Account 1101 ' + (env.db.prepare('SELECT name FROM accounts WHERE code=?').pluck().get('1101') as string));
    const cash = (await screen('general-ledger', '2026-09-01', '2026-09-30')).accounts.find((a: { code: string }) => a.code === '1101');
    const cashLeaf = out.leaves.filter((l: { account: string }) => l.account?.startsWith('Account 1101')).at(-1);
    expect(cashLeaf.carriedForward.balanceCents).toBe(cash.closingBalanceCents);
    expect(out.html).toContain('Total for this account');
    expect(out.html).toContain('Total for the period, all accounts');
    // Accounts with no movement in the period get no page.
    expect(accounts).not.toContain(expect.stringContaining('Account 1301 '));
  });

  it('gives the same permission as the book screens: 403 without it, and a company profile is required', async () => {
    expect((await print('cash-receipts', '2026-09-01', '2026-09-30', {}, encoder)).statusCode).toBe(403);
    expect((await encoder.get('/api/prt/books/status?year=2026')).statusCode).toBe(403);
    expect((await print('cash-receipts', '2026-09-01', '2026-09-30', {}, await env.as('tv'))).statusCode).toBe(403);
    expect((await print('no-such-book', '2026-09-01', '2026-09-30')).statusCode).toBe(404);
    expect((await print('cash-receipts', '2026-09-30', '2026-09-01')).statusCode).toBe(400);
    expect((await accountant.post('/api/prt/books/sales/print', { from: '2026-09-01', to: '2026-09-30', page: 5 })).statusCode).toBe(400);
    const bare = await createTestEnv('2026-09-05T02:00:00Z');
    const acc = await bare.as('accountant');
    const res = await acc.post('/api/prt/books/sales/print', { from: '2026-09-01', to: '2026-09-30' });
    expect(res.statusCode).toBe(409); expect(res.json().code).toBe('COMPANY_PROFILE_REQUIRED');
    await bare.app.close(); bare.db.close();
  });

  it('prints an empty month as one leaf with zero totals', async () => {
    const out = (await print('sales', '2026-08-01', '2026-08-31')).json();
    expect(out.pageCount).toBe(1);
    expect(out.html).toContain('No entries in this period.');
    expect(out.totals.totalCents).toBe(0);
  });
});
