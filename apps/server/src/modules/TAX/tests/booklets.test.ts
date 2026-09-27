/**
 * The ATP booklet register (PLAN D7, L7): registering and retiring booklets, the number check that quick sales, job
 * order releases and collections run in `validate`, and the usage report (used, cancelled, skipped, left).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });
const invoices = { kind: 'SALES_INVOICE', atpNo: 'OCN 0AU0001234567', printer: 'Made-up Printing Press', serialFrom: 501, serialTo: 550, receivedOn: '2026-09-01' };
const receipts = { kind: 'CR', atpNo: 'OCN 0AU0007654321', serialFrom: 701, serialTo: 750, receivedOn: '2026-09-01' };
const register = (b: object, who = accountant) => who.post('/api/tax/booklets', b);
const alteration = { kind: 'service', description: 'Alteration: shorten sleeves', qty: 1, unitPriceCents: 35_000, discountCents: 0 };
const quickSale = (invoiceNumber: string, crNumber: string) =>
  encoder.post('/api/qs/sales', { sale: { customerId: c.school, invoiceNumber, lines: [alteration] }, payment: { crNumber, tenders: [{ cashPlaceId: CASH, amountCents: 35_000 }] }, expectedTotalCents: 35_000 }, idem());
const codes = (res: { json(): { details?: { code: string }[] } }) => (res.json().details ?? []).map((d) => d.code);

describe('booklet register', () => {
  it('the accountant registers booklets with a fresh password; encoders only see them', async () => {
    expect((await register(invoices)).json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await stepUp(accountant);
    const b = await register(invoices);
    expect(b.statusCode, b.body).toBe(200);
    expect(b.json()).toMatchObject({ kind: 'SALES_INVOICE', serialFrom: 501, serialTo: 550, isActive: true, version: 1 });
    expect((await register(invoices, encoder)).statusCode).toBe(403);
    const list = (await encoder.get('/api/tax/booklets')).json();
    expect(list).toEqual([expect.objectContaining({ usedCount: 0, lastUsed: null, leftCount: 50, skipped: [] })]);
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'tax.booklet.register'`).pluck().get()).toBe(1);
  });

  it('refuses overlapping ranges, a backwards range, a future date and extra fields', async () => {
    await stepUp(accountant);
    await register(invoices);
    expect((await register({ ...invoices, serialFrom: 550, serialTo: 600 })).json()).toMatchObject({ code: 'BOOKLET_OVERLAP' });
    expect((await register({ ...receipts, serialFrom: 501, serialTo: 550 })).statusCode).toBe(200); // another kind may share numbers
    expect((await register({ ...invoices, serialFrom: 610, serialTo: 600 })).json()).toMatchObject({ code: 'BAD_RANGE' });
    expect((await register({ ...invoices, serialFrom: 601, serialTo: 650, receivedOn: '2026-10-01' })).json()).toMatchObject({ code: 'BAD_DATE' });
    expect((await register({ ...invoices, serialFrom: 601, serialTo: 650, isActive: false })).statusCode).toBe(400);
  });

  it('a registered range never changes, even in the database', async () => {
    await stepUp(accountant);
    const b = (await register(invoices)).json();
    expect(() => env.db.prepare('UPDATE tax_booklets SET serial_to = 900 WHERE id = ?').run(b.id)).toThrow(/IMMUTABLE/);
  });
});

describe('booklet number check (L7)', () => {
  it('checks nothing until the first booklet of a kind is registered', async () => {
    expect((await quickSale('0900', '0999')).statusCode).toBe(200);
  });

  it('refuses invoice and CR numbers outside the registered booklets; the same check runs on job order releases', async () => {
    await stepUp(accountant);
    await register(invoices);
    await register(receipts);
    expect((await quickSale('0502', '0701')).statusCode).toBe(200);
    const bad = await quickSale('0900', '0702');
    expect(bad.json().message).toBe('Invoice no. 0900 is not in any registered invoice booklet. Check the number, or ask the accountant to register the booklet (ATP number and range).');
    expect(codes(await quickSale('0503', '0999'))).toContain('BOOKLET_UNKNOWN');

    const jo = (await encoder.post('/api/docs/jo.job_order/post', {
      input: { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'full', lines: [{ kind: 'ready_made', description: 'Shirt', qty: 1, unitPriceCents: 35_000, discountCents: 0, roster: [] }] },
      expectedTotalCents: 35_000,
    }, idem())).json().id;
    for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to });
    const release = (invoiceNumber: string) =>
      accountant.post('/api/jo/releases', { release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Walk-in Placeholder', idSeen: 'none', creditNote: 'Pays on Friday', creditDueInDays: 3 }, invoice: { invoiceNumber }, expectedTotalCents: 35_000 }, idem());
    expect((await release('0601')).json().message).toMatch(/^Invoice no. 0601 is not in any registered invoice booklet\./);
    expect((await release('0504')).statusCode).toBe(200);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('a retired booklet refuses its numbers until it is switched back on (If-Match, with a reason)', async () => {
    await stepUp(accountant);
    const b = (await register(invoices)).json();
    await register({ ...invoices, atpNo: 'OCN 0AU0001239999', serialFrom: 551, serialTo: 600 });
    expect((await accountant.post(`/api/tax/booklets/${b.id}/retire`, { note: 'Booklet lost in the flood' })).statusCode).toBe(428);
    const retired = await accountant.post(`/api/tax/booklets/${b.id}/retire`, { note: 'Booklet lost in the flood' }, { 'if-match': '1' });
    expect(retired.json()).toMatchObject({ isActive: false, version: 2 });
    expect((await quickSale('0510', '0701')).json().message).toBe('Invoice no. 0510 is in booklet ATP OCN 0AU0001234567 (501 to 550), which is retired. Use the booklet in use now, or ask the accountant.');
    expect((await quickSale('0551', '0701')).statusCode).toBe(200);
    expect((await accountant.post(`/api/tax/booklets/${b.id}/activate`, { note: 'Found it again' }, { 'if-match': '1' })).json()).toMatchObject({ code: 'VERSION_CHANGED' });
    expect((await accountant.post(`/api/tax/booklets/${b.id}/activate`, { note: 'Found the booklet in the stock room' }, { 'if-match': '2' })).statusCode).toBe(200);
    expect((await quickSale('0510', '0702')).statusCode).toBe(200);
  });
});

describe('booklet usage report', () => {
  it('lists used, cancelled and skipped numbers, and what is left', async () => {
    await stepUp(accountant);
    const b = (await register(invoices)).json();
    await quickSale('0502', '0701');
    const spoiled = (await quickSale('0503', '0702')).json();
    await quickSale('0506', '0703');
    expect((await accountant.post(`/api/qs/sales/${spoiled.sale.id}/cancel`, { reason: 'Wrong customer on the invoice' }, idem())).statusCode).toBe(200);
    const usage = (await encoder.get(`/api/tax/booklets/${b.id}`)).json();
    expect(usage).toMatchObject({ usedCount: 3, cancelledCount: 1, lastUsed: 506, leftCount: 44, skipped: [501, 504, 505], skippedCount: 3 });
    expect(usage.used.map((u: { n: number; status: string }) => [u.n, u.status])).toEqual([[502, 'posted'], [503, 'cancelled'], [506, 'posted']]);
  });
});

describe('chart', () => {
  it('6290 penalties and surcharges has the role key PENALTIES, and role keys stay locked', () => {
    expect(resolveAccount(env.db, { role: 'PENALTIES' }).code).toBe('6290');
    expect(() => env.db.prepare(`UPDATE accounts SET role_key = 'OTHER' WHERE code = '6290'`).run()).toThrow(/IMMUTABLE/);
  });
});
