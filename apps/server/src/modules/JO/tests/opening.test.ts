/**
 * Opening job orders (PLAN D8 "Cut-over" step 2, MIG-02 part 2): goldens for deposits only, receivable only and both;
 * after the cut-over it works like a job order taken today (lists, production board, collections, releases, invoice
 * records, balance due); cancel on the cut-over date and only with no later document on it; edit; the refusals of an
 * opening document (ACC/public.ts); and a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { seedEmployees } from '../../PRD/tests/emp-fixture.ts';
import { openingJobOrderDoc } from '../doctypes/opening.ts';
import { currentStage, jobOrdersOf, joMoney } from '../public.ts';
import { seedCustomers } from './cus-fixture.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client;
let owner: Client;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

const OB = '/api/docs/jo.opening';
const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  const r = await accountant.post('/api/acc/opening/cutover-date', { date });
  expect(r.statusCode, r.body).toBe(200);
};
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

type Line = { qty: number; unitPriceCents: number; discountCents?: number };
const line = (l: Line) => ({ kind: 'made_to_order', description: 'Team jersey set', discountCents: 0, roster: [], ...l });
const input = (over: object = {}) => ({
  customerId: c.school,
  oldNumber: 'JO 1187',
  dueDate: '2026-10-05',
  priority: 'normal',
  paymentTerms: 'dp50',
  lines: [line({ qty: 20, unitPriceCents: 280_000 })],
  depositsCents: 0,
  receivableCents: 0,
  ...over,
});
/** Deposits only: 20 jerseys still to make (₱56,000.00), ₱28,000.00 paid down in the old records. */
const depositsOnly = () => input({ depositsCents: 2_800_000, depositsMemo: 'Old receipt 3310' });
/** Receivable only: everything went out; ₱15,000.00 invoiced and not yet paid. */
const receivableOnly = () => input({ oldNumber: 'JO 1150', lines: [], receivableCents: 1_500_000, oldInvoices: '0412, 0413' });
/** Both: 10 pieces still to release (₱15,000.00), ₱5,000.00 of deposits, ₱8,000.00 invoiced and not yet paid. */
const both = () => input({ oldNumber: 'JO 1203', lines: [line({ qty: 10, unitPriceCents: 150_000 })], depositsCents: 500_000, receivableCents: 800_000, oldInvoices: '0520' });

const total = (i: ReturnType<typeof input>) => i.lines.reduce((s, l) => s + l.qty * l.unitPriceCents - l.discountCents, 0) + i.receivableCents;
const open = async (i: ReturnType<typeof input>, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post(`${OB}/post`, { input: i, expectedTotalCents: total(i), ...(businessDate ? { businessDate } : {}) }, idem());
const opened = async (i: ReturnType<typeof input>) => {
  const r = await open(i);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string; businessDate: string; summary: string; journalNumber: string | null };
};
const errors = async (i: object, businessDate: string | null = CUTOVER) => {
  const r = await accountant.post(`${OB}/preview`, { input: i, ...(businessDate ? { businessDate } : {}) });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().issues.filter((x: { level: string }) => x.level === 'error').map((x: { code: string }) => x.code);
};

/** Journal lines as [account code, party id, JO ref, debit, credit]. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = 'document' AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
const journalDate = (documentId: string, kind: 'original' | 'reversal') =>
  env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND source_type = 'document' AND posting_kind = ?`).pluck().get(documentId, kind);
const status = async (jo: string) => (await encoder.get(`/api/jo/orders/${jo}/status`)).json();

let cr = 500;
const collect = async (jo: string, cents: number) => {
  const i = { customerId: c.school, crNumber: String(++cr), applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: CASH, amountCents: cents }] };
  const r = await encoder.post('/api/docs/col.collection/post', { input: i, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};
const ready = async (jo: string) => {
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to })).statusCode).toBe(200);
};
const credit = { creditNote: 'Balance by bank transfer after the event', creditDueInDays: 7 };

describe('opening job order goldens (D8 step 2)', () => {
  it('deposits only: Dr 3900 / Cr 2201 (customer, the JO); the rest is a memo; it shows in the lists, the board and the opening screen', async () => {
    await setCutover();
    const pre = (await accountant.post(`${OB}/preview`, { input: depositsOnly(), businessDate: CUTOVER })).json();
    expect(pre.issues).toEqual([]);
    expect(pre.totalCents).toBe(5_600_000);
    expect(pre.summary).toBe(
      'This will open old job order JO 1187 of Moonlight Test School as at 2026-09-27: 20 pieces still to release (₱56,000.00), ₱28,000.00 of deposits held. Balance due ₱28,000.00, due 2026-10-05.',
    );
    const res = await opened(depositsOnly());
    expect(res).toMatchObject({ number: 'OBJO-000001', businessDate: CUTOVER, journalNumber: 'JE-2026-000001' });
    expect(linesOf(res.id)).toEqual([
      ['3900', null, null, 2_800_000, 0],
      ['2201', c.school, res.id, 0, 2_800_000],
    ]);
    expect(journalDate(res.id, 'original')).toBe(CUTOVER);
    expect(balances(env.db)).toEqual({ '2201': -2_800_000, '3900': 2_800_000 });

    const s = await status(res.id);
    expect(s).toMatchObject({ stage: 'open', lines: [{ lineNo: 1, qty: 20, releasedQty: 0, leftQty: 20 }], awaitingInvoice: [] });
    expect(s.money).toEqual({
      totalCents: 5_600_000, invoicedCents: 0, requiredDownpaymentCents: 0, receivableCents: 0, depositsHeldCents: 2_800_000,
      balanceDueCents: 2_800_000, collectedCents: 2_800_000, notInvoicedCents: 5_600_000,
    });
    expect(jobOrdersOf(env.db, c.school)).toMatchObject([{ id: res.id, number: 'OBJO-000001', status: 'posted', dueDate: '2026-10-05', totalCents: 5_600_000 }]);
    expect((await encoder.get(`/api/col/customers/${c.school}/open-items`)).json().jobOrders).toEqual([
      { id: res.id, number: 'OBJO-000001', dueDate: '2026-10-05', totalCents: 5_600_000, balanceDueCents: 2_800_000, depositsHeldCents: 2_800_000 },
    ]);
    expect((await encoder.get('/api/prd/board')).json()).toMatchObject([{ jobOrderId: res.id, number: 'OBJO-000001', stage: 'open', lineNo: 1, qty: 20 }]);
    const screen = (await owner.get('/api/acc/opening')).json();
    expect(screen.documents).toMatchObject([{ docType: 'jo.opening', number: 'OBJO-000001', businessDate: CUTOVER, status: 'posted', totalCents: 5_600_000 }]);
    expect(screen.openingEquityCents).toBe(2_800_000);
    expect(screen.checks.filter((x: { ok: boolean }) => !x.ok)).toEqual([]);
    expect((await owner.get(`${OB}/${res.id}`)).json().input).toEqual(depositsOnly());
    noBrokenInvariants();
  });

  it('receivable only: Dr 1201 (customer, the JO) / Cr 3900; nothing left to release, so it starts Released; a collection pays it', async () => {
    await setCutover();
    const res = await opened(receivableOnly());
    expect(res.summary).toBe(
      'This will open old job order JO 1150 of Moonlight Test School as at 2026-09-27: nothing left to release, ₱15,000.00 invoiced and not yet paid (old invoices 0412, 0413). Balance due ₱15,000.00, due 2026-10-05.',
    );
    expect(linesOf(res.id)).toEqual([
      ['1201', c.school, res.id, 1_500_000, 0],
      ['3900', null, null, 0, 1_500_000],
    ]);
    const s = await status(res.id);
    expect(s).toMatchObject({ stage: 'released', lines: [] });
    expect(s.money).toMatchObject({ totalCents: 1_500_000, invoicedCents: 1_500_000, receivableCents: 1_500_000, depositsHeldCents: 0, balanceDueCents: 1_500_000, collectedCents: 0 });
    expect((await encoder.get('/api/prd/board')).json()).toEqual([]);

    const col = await collect(res.id, 1_500_000);
    expect(linesOf(col)).toEqual([
      ['1101', null, null, 1_500_000, 0],
      ['1201', c.school, res.id, 0, 1_500_000],
    ]);
    expect(joMoney(env.db, res.id)).toMatchObject({ receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 0, collectedCents: 1_500_000 });
    expect(balances(env.db)).toEqual({ '1101': 1_500_000, '3900': -1_500_000 });
    expect((await encoder.post(`/api/jo/orders/${res.id}/stage`, { from: 'released', to: 'closed' })).statusCode).toBe(200);
    noBrokenInvariants();
  });

  it('both: Dr 3900 / Cr 2201 for the deposits and Dr 1201 / Cr 3900 for the unpaid invoices, one journal', async () => {
    await setCutover();
    const res = await opened(both());
    expect(res.summary).toBe(
      'This will open old job order JO 1203 of Moonlight Test School as at 2026-09-27: 10 pieces still to release (₱15,000.00), ₱5,000.00 of deposits held, ₱8,000.00 invoiced and not yet paid (old invoices 0520). Balance due ₱18,000.00, due 2026-10-05.',
    );
    expect(linesOf(res.id)).toEqual([
      ['3900', null, null, 500_000, 0],
      ['2201', c.school, res.id, 0, 500_000],
      ['1201', c.school, res.id, 800_000, 0],
      ['3900', null, null, 0, 800_000],
    ]);
    expect(joMoney(env.db, res.id)).toMatchObject({ totalCents: 2_300_000, invoicedCents: 800_000, receivableCents: 800_000, depositsHeldCents: 500_000, balanceDueCents: 1_800_000, collectedCents: 500_000 });
    expect(balances(env.db)).toEqual({ '1201': 800_000, '2201': -500_000, '3900': -300_000 });
    noBrokenInvariants();
  });

  it('after the cut-over: a collection pays the receivable first and the rest is a deposit; the release invoice applies the deposits; a last collection clears it', async () => {
    await setCutover();
    const jo = (await opened(both())).id;

    const first = await collect(jo, 1_000_000);
    expect(linesOf(first)).toEqual([
      ['1101', null, null, 1_000_000, 0],
      ['1201', c.school, jo, 0, 800_000],
      ['2201', c.school, jo, 0, 200_000],
    ]);
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 0, depositsHeldCents: 700_000, balanceDueCents: 800_000 });

    await ready(jo);
    const rel = await accountant.post('/api/jo/releases', {
      release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 10 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...credit },
      invoice: { invoiceNumber: '0701' },
      expectedTotalCents: 1_500_000,
    }, idem());
    expect(rel.statusCode, rel.body).toBe(200);
    const ir = rel.json().invoiceRecord;
    expect(ir.summary).toBe(
      'This will record invoice no. 0701 to Moonlight Test School for REL-000001 of OBJO-000001: ₱15,000.00 (VATable sales ₱13,392.86, VAT ₱1,607.14). ₱7,000.00 of deposits is applied; ₱8,000.00 is left to collect.',
    );
    expect(linesOf(ir.id)).toEqual([
      ['1201', c.school, jo, 1_500_000, 0],
      ['4101', c.school, null, 0, 1_339_286],
      ['2301', c.school, null, 0, 160_714],
      ['2201', c.school, jo, 700_000, 0],
      ['1201', c.school, jo, 0, 700_000],
    ]);
    const s = await status(jo);
    expect(s.stage).toBe('released');
    expect(s.money).toMatchObject({ totalCents: 2_300_000, invoicedCents: 2_300_000, receivableCents: 800_000, depositsHeldCents: 0, balanceDueCents: 800_000 });

    await collect(jo, 800_000);
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 0, collectedCents: 2_300_000 });
    expect(balances(env.db)).toEqual({ '1101': 1_800_000, '2301': -160_714, '3900': -300_000, '4101': -1_339_286 });
    noBrokenInvariants();
  });

  it('a collection before the release adds to the opening deposits, and a deposits-only JO released in full is paid off', async () => {
    await setCutover();
    const jo = (await opened(depositsOnly())).id;
    const col = await collect(jo, 1_000_000);
    expect(linesOf(col)).toEqual([
      ['1101', null, null, 1_000_000, 0],
      ['2201', c.school, jo, 0, 1_000_000],
    ]);
    await ready(jo);
    const rel = await accountant.post('/api/jo/releases', {
      release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 20 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...credit },
      invoice: { invoiceNumber: '0702' },
      expectedTotalCents: 5_600_000,
    }, idem());
    expect(rel.statusCode, rel.body).toBe(200);
    expect(linesOf(rel.json().invoiceRecord.id).slice(-2)).toEqual([
      ['2201', c.school, jo, 3_800_000, 0],
      ['1201', c.school, jo, 0, 3_800_000],
    ]);
    expect(joMoney(env.db, jo)).toMatchObject({ receivableCents: 1_800_000, depositsHeldCents: 0, balanceDueCents: 1_800_000 });
    await collect(jo, 1_800_000);
    expect(joMoney(env.db, jo)).toMatchObject({ balanceDueCents: 0, collectedCents: 5_600_000 });
    noBrokenInvariants();
  });
});

describe('cancel and edit', () => {
  it('cancels with a mirror on the cut-over date, only once no later document stands on it', async () => {
    await setCutover();
    const jo = (await opened(both())).id;
    const col = await collect(jo, 100_000);
    const blocked = await accountant.post(`${OB}/${jo}/cancel`, { reason: 'Old job order was already paid in full' }, idem());
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: COL-000001.' });

    expect((await accountant.post(`/api/docs/col.collection/${col}/cancel`, { reason: 'Recorded on the wrong job order' }, idem())).statusCode).toBe(200);
    const res = await accountant.post(`${OB}/${jo}/cancel`, { reason: 'Old job order was already paid in full' }, idem());
    expect(res.statusCode, res.body).toBe(200);
    expect(linesOf(jo, 'reversal')).toEqual([
      ['3900', null, null, 0, 500_000],
      ['2201', c.school, jo, 500_000, 0],
      ['1201', c.school, jo, 0, 800_000],
      ['3900', null, null, 800_000, 0],
    ]);
    expect(journalDate(jo, 'reversal')).toBe(CUTOVER); // the cut-over date: as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect(joMoney(env.db, jo)).toMatchObject({ totalCents: 0, invoicedCents: 0, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 0 });
    expect(currentStage(env.db, jo)).toBe('cancelled');
    expect(jobOrdersOf(env.db, c.school)).toEqual([]);
    expect((await owner.get('/api/acc/opening')).json().documents).toMatchObject([{ number: 'OBJO-000001', status: 'cancelled' }]);
    noBrokenInvariants();
  });

  it('is blocked by its releases and production entries too; the production board works on it', async () => {
    await setCutover();
    const w = seedEmployees(env.db);
    const production = await env.as('production');
    const jo = (await opened(depositsOnly())).id;
    const setup = await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: 'standard' });
    expect(setup.statusCode, setup.body).toBe(200);
    const pe = { jobOrderId: jo, stepId: 4, rows: [{ lineNo: 1, employeeId: w.cutter, pieces: 20 }] };
    const pre = (await production.post('/api/docs/prd.entry/preview', { input: pe })).json();
    expect(pre.issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);
    const entry = await production.post('/api/docs/prd.entry/post', { input: pe, expectedTotalCents: pre.totalCents }, idem());
    expect(entry.statusCode, entry.body).toBe(200);
    expect(currentStage(env.db, jo)).toBe('in_production'); // production moved it, as it moves any job order

    for (const [from, to] of [['in_production', 'ready']]) expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from, to })).statusCode).toBe(200);
    const rel = await accountant.post('/api/jo/releases', {
      release: { jobOrderId: jo, lines: [{ lineNo: 1, qty: 5 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...credit },
      invoice: null,
      expectedTotalCents: 1_400_000,
    }, idem());
    expect(rel.statusCode, rel.body).toBe(200);
    expect(currentStage(env.db, jo)).toBe('partially_released');

    const blocked = await accountant.post(`${OB}/${jo}/cancel`, { reason: 'Old job order was a duplicate' }, idem());
    expect(blocked.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: REL-000001, PE-000001.' });
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(jo)).toBe('posted');
  });

  it('edit = cancel on the cut-over date + a new OBJO- on it; the stage carries over; refused while a collection stands on it', async () => {
    await setCutover();
    const jo = (await opened(depositsOnly())).id;
    expect((await encoder.post(`/api/jo/orders/${jo}/stage`, { from: 'open', to: 'in_production' })).statusCode).toBe(200);
    const fixed = input({ depositsCents: 3_000_000, depositsMemo: 'Old receipts 3310, 3311' });
    const body = { input: fixed, expectedTotalCents: 5_600_000, reason: 'Second old receipt found in the box', businessDate: CUTOVER };
    const res = await accountant.post(`${OB}/${jo}/reissue`, body, idem());
    expect(res.statusCode, res.body).toBe(200);
    const next = res.json().id;
    expect(res.json()).toMatchObject({ number: 'OBJO-000002', businessDate: CUTOVER });
    expect(journalDate(jo, 'reversal')).toBe(CUTOVER);
    expect(currentStage(env.db, next)).toBe('in_production');
    expect(joMoney(env.db, next)).toMatchObject({ depositsHeldCents: 3_000_000, balanceDueCents: 2_600_000 });
    expect(balances(env.db)).toEqual({ '2201': -3_000_000, '3900': 3_000_000 });

    await collect(next, 100_000);
    const again = await accountant.post(`${OB}/${next}/reissue`, { ...body, input: depositsOnly() }, idem());
    expect(again.json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: COL-000001.' });
    noBrokenInvariants();
  });
});

describe('refusals (ACC/public.ts)', () => {
  it('is refused without a cut-over date, on another date, and once the opening is closed', async () => {
    expect(await errors(depositsOnly())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(depositsOnly(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(depositsOnly(), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const wrong = await open(depositsOnly(), '2026-09-20');
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect(await errors(depositsOnly())).toEqual([]);

    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);
    expect(await errors(depositsOnly())).toEqual(['OPENING_CLOSED']);
    const late = await open(depositsOnly());
    expect(late.statusCode).toBe(422);
    expect(late.json().message).toBe('The opening was closed on 2026-09-28. Correct balances with a journal voucher.');
    expect(balances(env.db)).toEqual({});
  });

  it('a closed opening keeps its opening job orders: the cancel is refused', async () => {
    await setCutover();
    const jo = (await opened(depositsOnly())).id;
    // The cash that took the deposits brings 3900 back to zero, so the opening can close.
    const cash = await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: CASH, debitCents: 2_800_000 }] }, expectedTotalCents: 2_800_000, businessDate: CUTOVER }, idem());
    expect(cash.statusCode, cash.body).toBe(200);
    await stepUp(accountant);
    const closed = await accountant.post('/api/acc/opening/close', {});
    expect(closed.statusCode, closed.body).toBe(200);

    const cancel = await accountant.post(`${OB}/${jo}/cancel`, { reason: 'Old job order was a duplicate' }, idem());
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe('OPENING_CLOSED');
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(jo)).toBe('posted');
    expect(linesOf(jo, 'reversal')).toEqual([]);
    noBrokenInvariants();
  });

  it('checks the money, the old numbers, the customer and the lines', async () => {
    await setCutover();
    expect(await errors(input({ depositsCents: 5_600_001 }))).toEqual(['DEPOSITS_OVER']);
    const over = (await accountant.post(`${OB}/preview`, { input: input({ depositsCents: 5_600_001 }), businessDate: CUTOVER })).json().issues[0].message;
    expect(over).toBe('The deposits (₱56,000.01) are more than the part not yet released (₱56,000.00). Record at most that: take the rest off the unpaid invoices, or ask the accountant.');
    expect(await errors(input({ lines: [], depositsCents: 100, receivableCents: 1_000, oldInvoices: '0412' }))).toEqual(['DEPOSITS_OVER']);
    expect(await errors(input({ lines: [] }))).toEqual(['NOTHING_OPEN']);
    expect(await errors(input({ receivableCents: 1_000 }))).toEqual(['OLD_INVOICES']);
    expect(await errors(input({ customerId: c.closed }))).toEqual(['CUSTOMER']);
    expect(await errors(input({ lines: [line({ qty: 2, unitPriceCents: 100, discountCents: 300 })] }))).toEqual(['DISCOUNT']);
    expect(await errors(input({ lines: [{ ...line({ qty: 2, unitPriceCents: 100 }), roster: [{ name: 'One-off Wearer', sizeMode: 'preset', size: 'M', qty: 1 }] }] }))).toEqual(['ROSTER_QTY']);
    const bad = await accountant.post(`${OB}/preview`, { input: input({ dueDate: '2026-02-30' }), businessDate: CUTOVER });
    expect(bad.json().code).toBe('INVALID_INPUT');

    await opened(depositsOnly());
    const twice = (await accountant.post(`${OB}/preview`, { input: input({ oldNumber: 'jo 1187' }), businessDate: CUTOVER })).json().issues;
    expect(twice).toMatchObject([{ code: 'OLD_NUMBER_USED', message: 'Old job order jo 1187 is already open as OBJO-000001.' }]);
  });

  it('is for the accountant; the owner sees it; staff work on it through the job order screens', async () => {
    await setCutover();
    expect((await open(depositsOnly(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(depositsOnly(), CUTOVER, owner)).statusCode).toBe(403);
    const jo = (await opened(depositsOnly())).id;
    expect((await owner.get(`${OB}/${jo}`)).statusCode).toBe(200);
    expect((await encoder.get(`${OB}/${jo}`)).statusCode).toBe(403);
    expect((await encoder.get(`/api/jo/orders/${jo}/status`)).statusCode).toBe(200);
    expect((await encoder.post(`${OB}/${jo}/cancel`, { reason: 'Old job order was a duplicate' }, idem())).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('the journal balances against 3900, stores what was computed, balance due = total − deposits, and cancels to zero', async () => {
    await setCutover();
    const actor = { userId: accountant.userId, permissions: new Set(['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    const role = (lines: ReturnType<typeof resolveDraft>, key: string) => lines.filter((l) => l.account.role_key === key).reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    let n = 0;
    fc.assert(
      fc.property(openingJobOrderDoc.arbitrary(env.db), fc.boolean(), (generated, cancel) => {
        const i = { ...generated, oldNumber: `P-${++n}` }; // each old job order is opened once
        const doc = openingJobOrderDoc.compute(i, ctx());
        expect(openingJobOrderDoc.validate(doc, ctx()).filter((x) => x.level === 'error')).toEqual([]);
        const draft = openingJobOrderDoc.journal!(doc, ctx());
        if (doc.depositsCents + doc.receivableCents === 0) expect(draft).toBeNull();
        else {
          const lines = resolveDraft(env.db, draft!);
          const dr = lines.reduce((s, l) => s + l.debitCents, 0);
          expect(lines.reduce((s, l) => s + l.creditCents, 0)).toBe(dr);
          expect(dr).toBe(doc.depositsCents + doc.receivableCents);
          expect(role(lines, 'CUSTOMER_DEPOSITS')).toBe(0 - doc.depositsCents);
          expect(role(lines, 'AR_TRADE')).toBe(doc.receivableCents);
          expect(role(lines, 'OPENING_EQUITY')).toBe(doc.depositsCents - doc.receivableCents);
        }
        expect(openingJobOrderDoc.compute(openingJobOrderDoc.toInput(doc), ctx())).toEqual(doc);

        const p = postDocument(e, openingJobOrderDoc, actor, { input: i, expectedTotalCents: doc.totalCents, businessDate: CUTOVER });
        expect(openingJobOrderDoc.load(env.db, p.id)).toEqual(doc);
        expect(joMoney(env.db, p.id)).toMatchObject({ totalCents: doc.totalCents, receivableCents: doc.receivableCents, depositsHeldCents: doc.depositsCents, balanceDueCents: doc.totalCents - doc.depositsCents });
        expect(currentStage(env.db, p.id)).toBe(doc.lines.length > 0 ? 'open' : 'released');
        if (cancel) {
          cancelDocument(e, openingJobOrderDoc, actor, p.id, 'Property test cancel');
          expect(joMoney(env.db, p.id)).toMatchObject({ receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 0 });
        }
      }),
      { numRuns: 40 },
    );
    noBrokenInvariants();
  });
});
