/**
 * Opening withholding (OBWT-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the customers' 2307s not yet used on a return,
 * Dr 1410 / Dr 1404 per customer / Cr 3900 on the cut-over date. Afterwards they are 2307s like a collection's: listed
 * in the 2307s-received register (marked as opening), a pending one marked received the same way as a collection's,
 * and the VAT close claims the VAT withheld whose 2307 is in hand. Cancelled on the cut-over date while the opening is
 * open and no VAT close stands on it; the refusals; a property test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PASSWORD, balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { openingWithholdingDoc, type OpeningWithholdingInput } from '../doctypes/opening.ts';
import { withholdingReceivedRegister } from '../registers.ts';
import { vatPosition } from '../vat.ts';
import { markReceived } from '../withholding.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client, encoder: Client, owner: Client;
let c: ReturnType<typeof seedCustomers>;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
  owner = await env.as('owner');
  c = seedCustomers(env.db, encoder.userId);
});

const stepUp = (who: Client) => who.post('/api/auth/step-up', { password: PASSWORD });
const setCutover = async (date = CUTOVER) => {
  await stepUp(accountant);
  return accountant.post('/api/acc/opening/cutover-date', { date });
};
/** Signs in again after the clock moves (sessions are for the day). */
const moveTo = async (iso: string) => {
  env.clock.set(iso);
  [accountant, encoder, owner] = [await env.as('accountant'), await env.as('encoder'), await env.as('owner')];
};

type Row = OpeningWithholdingInput['rows'][number];
/**
 * PLAN I2 G-09 style: a government school's 2307 for Q2, in hand (1% CWT ₱1,000.00 and 5% VAT withheld ₱5,000.00 on
 * ₱100,000.00), and another customer's for Q3, still to come (₱250.00 and ₱1,250.00 on ₱25,000.00).
 */
const inHand = (): Row => ({ customerId: c.school, year: 2026, quarter: 2, atc: 'WC158', cwtCents: 100_000, vatWithheldCents: 500_000, certificate: 'received' });
const toCome = (): Row => ({ customerId: c.other, year: 2026, quarter: 3, atc: 'WC158', cwtCents: 25_000, vatWithheldCents: 125_000, certificate: 'pending' });
const obwt = (rows: Row[] = [inHand(), toCome()], note?: string): OpeningWithholdingInput => ({ rows, ...(note ? { note } : {}) });
const totalOf = (input: OpeningWithholdingInput) => input.rows.reduce((s, r) => s + r.cwtCents + r.vatWithheldCents, 0);

const open = (input: OpeningWithholdingInput, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/tax.opening/post', { input, expectedTotalCents: totalOf(input), ...(businessDate ? { businessDate } : {}) }, idem());
const preview = (input: unknown, businessDate: string | null = CUTOVER) =>
  accountant.post('/api/docs/tax.opening/preview', { input, ...(businessDate ? { businessDate } : {}) });
const errors = async (input: OpeningWithholdingInput, businessDate: string | null = CUTOVER) =>
  (await preview(input, businessDate)).json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
const cancel = (type: string, id: string, who = accountant) => who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake at cut-over' }, idem());
const mark = (documentId: string, lineNo: number, who = accountant) => who.post('/api/tax/2307s/received', { documentId, lineNo });
const register = async (from = '2026-07-01', to = '2026-12-31') => (await accountant.get(`/api/tax/registers/withholding-received?from=${from}&to=${to}`)).json();
const vatSummary = async (year: number, quarter: number) => (await accountant.get(`/api/tax/vat-summary?year=${year}&quarter=${quarter}`)).json();
const closeVat = async (year: number, quarter: number) => {
  const pre = (await accountant.post('/api/docs/tax.vat_close/preview', { input: { year, quarter } })).json();
  return { pre, res: await accountant.post('/api/docs/tax.vat_close/post', { input: { year, quarter }, expectedTotalCents: pre.totalCents }, idem()) };
};
/** A journal of a document: [code, party id, ref, debit, credit, date] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? AND j.source_type = 'document' ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind) as unknown[][];
/** Debit-positive balance of an account for one party (+ 0: the ledger's negation gives -0 on zero). */
const partyBalance = (code: string, partyId: string) =>
  (env.db
    .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND l.party_id = ?`)
    .pluck()
    .get(code, partyId) as number) + 0;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const openingState = async () => (await accountant.get('/api/acc/opening')).json();
/** Register rows in brief: [number, customer, ATC, 2307, received on, opening, period, line, CWT, VAT withheld]. */
const rowsOf = (r: { rows: Record<string, unknown>[] }) =>
  r.rows.map((x) => [x.documentNumber, x.customerId, x.atc, x.certificate, x.receivedOn, x.opening, x.period, x.lineNo, x.cwtCents, x.vatWithheldCents]);

describe('opening withholding golden (PLAN D8 step 3)', () => {
  it('two customers, one 2307 in hand and one pending: Dr 1410 and 1404 per customer / Cr 3900, dated the cut-over date', async () => {
    await setCutover();
    const pre = (await preview(obwt())).json();
    expect(pre).toMatchObject({
      totalCents: 750_000,
      issues: [],
      summary: 'This will record 2 2307s of customers not yet used on a return (1 in hand, 1 still to come) as open on the cut-over date 2026-09-27: ₱1,250.00 creditable withholding tax and ₱6,250.00 VAT withheld.',
    });
    const res = await open(obwt());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OBWT-000001', businessDate: CUTOVER, totalCents: 750_000, warnings: [] });
    const id = res.json().id as string;
    expect(journalOf(id)).toEqual([
      ['1410', c.school, null, 100_000, 0, CUTOVER],
      ['1404', c.school, null, 500_000, 0, CUTOVER],
      ['1410', c.other, null, 25_000, 0, CUTOVER],
      ['1404', c.other, null, 125_000, 0, CUTOVER],
      ['3900', null, null, 0, 750_000, CUTOVER],
    ]);
    expect(balances(env.db)).toEqual({ '1410': 125_000, '1404': 625_000, '3900': -750_000 });

    // Listed with OB- on the opening screen; 1410 and 1404 tie to their customers there (L3).
    const s = await openingState();
    expect(s.openingEquityCents).toBe(-750_000);
    expect(s.documents).toMatchObject([{ docType: 'tax.opening', number: 'OBWT-000001', businessDate: CUTOVER, status: 'posted', totalCents: 750_000 }]);
    const check = (code: string) => s.checks.find((x: { code: string }) => x.code === code);
    expect(check('1410')).toMatchObject({ controlCents: 125_000, partiesCents: 125_000, ok: true });
    expect(check('1404')).toMatchObject({ controlCents: 625_000, partiesCents: 625_000, ok: true });
    expect((await setCutover('2026-09-20')).json()).toMatchObject({ code: 'OPENING_POSTED', message: 'OBWT-000001 is dated 2026-09-27. Cancel it before moving the cut-over date.' });

    // The 2307s received register: one row per 2307, marked as opening, with its ATC and status; ties to 1410 and 1404 (L6).
    const r = await register('2026-09-01', '2026-09-30');
    expect(rowsOf(r)).toEqual([
      ['OBWT-000001', c.school, 'WC158', 'received', null, true, '2026-Q2', 1, 100_000, 500_000],
      ['OBWT-000001', c.other, 'WC158', 'pending', null, true, '2026-Q3', 2, 25_000, 125_000],
    ]);
    expect(r.rows[0]).toMatchObject({ docTitle: 'Opening Withholding', date: CUTOVER, posting: 'original', documentStatus: 'posted', customerName: 'Moonlight Test School' });
    expect(r).toMatchObject({ totals: { cwtCents: 125_000, vatWithheldCents: 625_000 }, glCwtCents: 125_000, glVatWithheldCents: 625_000, pendingCount: 1 });
    const csv = (await accountant.get('/api/tax/registers/withholding-received?from=2026-09-01&to=2026-09-30&format=csv')).body
      .replace(/^\ufeff/, '').replaceAll('"', '').split('\r\n');
    expect(csv[0]).toBe('Date,Journal,Cancel,Document,Number,Form no.,Customer,TIN,ATC,2307,Received on,Opening 2307 for,CWT,VAT withheld');
    expect(csv[2]).toMatch(/^2026-09-27,JE-2026-\d+,,Opening Withholding,OBWT-000001,,Paper Lantern Club,,WC158,pending,,2026-Q3,250\.00,1250\.00$/);

    // Stored as typed; the form input comes back the same.
    expect(env.db.prepare('SELECT line_no, customer_id, year, quarter, atc, cwt_cents, vat_withheld_cents, cert_2307 FROM tax_opening_lines WHERE document_id = ? ORDER BY line_no').raw().all(id)).toEqual([
      [1, c.school, 2026, 2, 'WC158', 100_000, 500_000, 'received'],
      [2, c.other, 2026, 3, 'WC158', 25_000, 125_000, 'pending'],
    ]);
    expect((await accountant.get(`/api/docs/tax.opening/${id}`)).json().input).toEqual(obwt());
    noBrokenInvariants();
  });

  it('marks the pending one received, the same way as a collection’s pending 2307', async () => {
    await setCutover();
    const id = (await open(obwt())).json().id as string;
    expect(vatPosition(env.db, 2026, 3)).toMatchObject({ vatWithheldCents: 500_000, vatWithheldPendingCents: 125_000 });

    const res = await mark(id, 2);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ documentId: id, number: 'OBWT-000001', lineNo: 2, receivedOn: '2026-09-28' });
    expect(rowsOf(await register())).toEqual([
      ['OBWT-000001', c.school, 'WC158', 'received', null, true, '2026-Q2', 1, 100_000, 500_000],
      ['OBWT-000001', c.other, 'WC158', 'received', '2026-09-28', true, '2026-Q3', 2, 25_000, 125_000],
    ]);
    expect((await register()).pendingCount).toBe(0);
    expect(vatPosition(env.db, 2026, 3)).toMatchObject({ vatWithheldCents: 625_000, vatWithheldPendingCents: 0 });
    expect(balances(env.db)).toEqual({ '1410': 125_000, '1404': 625_000, '3900': -750_000 }); // no journal: only the certificate came

    // Once only, only a 2307 recorded as pending, only by who may; the document itself never changes.
    expect((await mark(id, 2)).json()).toMatchObject({ code: 'ALREADY_RECEIVED', message: 'The 2307 on row 2 of OBWT-000001 was marked received on 2026-09-28.' });
    expect((await mark(id, 1)).json()).toMatchObject({ code: 'ALREADY_RECEIVED', message: 'The 2307 on row 1 of OBWT-000001 was recorded as in hand.' });
    expect((await mark(id, 3)).statusCode).toBe(404);
    expect((await mark(id, 0)).statusCode).toBe(404);
    expect((await mark('no-such-document', 0)).statusCode).toBe(404);
    expect((await accountant.post('/api/tax/2307s/received', { documentId: id, lineNo: 2, receivedOn: '2026-09-01' })).statusCode).toBe(400);
    expect((await mark(id, 2, encoder)).statusCode).toBe(403);
    expect(env.db.prepare('SELECT cert_2307 FROM tax_opening_lines WHERE document_id = ? AND line_no = 2').pluck().get(id)).toBe('pending');
    // An edit of the opening keeps it in hand.
    expect((await accountant.get(`/api/docs/tax.opening/${id}`)).json().input.rows[1].certificate).toBe('received');

    // A collection after the cut-over with its 2307 still to come: marked received the same way (its only 2307 is line 0).
    const s = await encoder.post('/api/qs/sales', {
      sale: { customerId: c.school, invoiceNumber: '0801', lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: 1_120_000, discountCents: 0 }] },
      payment: {
        crNumber: '0901', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 1_060_000 }],
        withholding: { atc: 'WC158', certificate: 'pending', cwtCents: 10_000, vatWithheldCents: 50_000 },
      },
      expectedTotalCents: 1_120_000,
    }, idem());
    expect(s.statusCode, s.body).toBe(200);
    const colId = s.json().payment.id as string;
    expect((await register()).pendingCount).toBe(1);
    expect((await mark(colId, 1)).statusCode).toBe(404);
    expect((await mark(colId, 0)).json()).toMatchObject({ number: 'COL-000001', lineNo: 0, receivedOn: '2026-09-28' });
    const r = await register();
    expect(r.rows.at(-1)).toMatchObject({ documentNumber: 'COL-000001', formNumber: '0901', certificate: 'received', receivedOn: '2026-09-28', opening: false, period: null, lineNo: 0 });
    expect(r).toMatchObject({ pendingCount: 0, totals: { cwtCents: 135_000, vatWithheldCents: 675_000 }, glCwtCents: 135_000, glVatWithheldCents: 675_000 });
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'tax.2307.received'`).pluck().get()).toBe(2);
    noBrokenInvariants();
  });

  it('the first VAT close after the cut-over claims the VAT withheld in hand; the pending one waits for the close after its 2307 comes', async () => {
    await setCutover();
    const id = (await open(obwt())).json().id as string;
    // A sale after the cut-over: ₱112,000.00 to the school, VAT ₱12,000.00, paid in full.
    const sale = await encoder.post('/api/qs/sales', {
      sale: { customerId: c.school, invoiceNumber: '0802', lines: [{ kind: 'service', description: 'Uniform alterations', qty: 1, unitPriceCents: 11_200_000, discountCents: 0 }] },
      payment: { crNumber: '0902', tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 11_200_000 }] },
      expectedTotalCents: 11_200_000,
    }, idem());
    expect(sale.statusCode, sale.body).toBe(200);

    await moveTo('2026-10-05T02:00:00Z');
    const q3 = await closeVat(2026, 3);
    expect(q3.pre.issues).toEqual([expect.objectContaining({ code: 'PENDING_2307', level: 'warning', message: '₱1,250.00 of VAT withheld still waits for its 2307. It stays for the quarter the certificate comes.' })]);
    expect(q3.pre.doc).toMatchObject({ outputVatCents: 1_200_000, inputVatCents: 0, vatWithheldCents: 500_000, vatWithheldPendingCents: 125_000, payableCents: 700_000, carryForwardCents: 0 });
    expect(q3.res.statusCode, q3.res.body).toBe(200);
    expect(journalOf(q3.res.json().id)).toEqual([
      ['2301', c.school, null, 1_200_000, 0, '2026-10-05'],
      ['1404', c.school, null, 0, 500_000, '2026-10-05'],
      ['2302', null, null, 0, 700_000, '2026-10-05'],
    ]);
    expect([partyBalance('1404', c.school), partyBalance('1404', c.other)]).toEqual([0, 125_000]);
    // The close stands on the opening's VAT withheld: it is cancelled first.
    expect((await cancel('tax.opening', id)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: VATC-000001.' });

    // The pending 2307 comes in October: the next close claims it.
    expect((await mark(id, 2)).json()).toMatchObject({ receivedOn: '2026-10-05' });
    expect(await vatSummary(2026, 4)).toMatchObject({ outputVatCents: 0, vatWithheldCents: 125_000, vatWithheldPendingCents: 0, carryForwardCents: 125_000 });
    await moveTo('2027-01-05T02:00:00Z');
    const q4 = await closeVat(2026, 4);
    expect(q4.pre.issues).toEqual([]);
    expect(q4.res.statusCode, q4.res.body).toBe(200);
    expect(journalOf(q4.res.json().id)).toEqual([
      ['1404', c.other, null, 0, 125_000, '2027-01-05'],
      ['1402', null, null, 125_000, 0, '2027-01-05'],
    ]);
    expect(balances(env.db)).toMatchObject({ '1410': 125_000, '1402': 125_000, '2302': -700_000, '3900': -750_000 });
    expect(balances(env.db)['1404']).toBeUndefined();
    // The registers leave the closes out, so the 2307s still tie to 1410 and 1404.
    const r = await register('2026-07-01', '2027-01-31');
    expect(r).toMatchObject({ totals: { cwtCents: 125_000, vatWithheldCents: 625_000 }, glCwtCents: 125_000, glVatWithheldCents: 625_000, pendingCount: 0 });

    // Cancelled once the closes that stand on it are.
    expect((await cancel('tax.opening', id)).json().message).toBe('Cancel these first: VATC-000001, VATC-000002.');
    expect((await cancel('tax.vat_close', q4.res.json().id)).statusCode).toBe(200);
    expect((await cancel('tax.vat_close', q3.res.json().id)).statusCode).toBe(200);
    expect((await cancel('tax.opening', id)).statusCode).toBe(200);
    expect(journalOf(id, 'reversal').map((l) => l[5])).toEqual([CUTOVER, CUTOVER, CUTOVER, CUTOVER, CUTOVER]);
    noBrokenInvariants();
  });

  it('a cancel lands on the cut-over date; an edit is a new number on it; a closed opening keeps its 2307s', async () => {
    await setCutover();
    const id = (await open(obwt())).json().id as string;
    await mark(id, 2);
    await moveTo('2026-09-29T02:00:00Z'); // cancelled the next day
    expect((await cancel('tax.opening', id, owner)).statusCode).toBe(403);
    const res = await cancel('tax.opening', id);
    expect(res.statusCode, res.body).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      ['1410', c.school, null, 0, 100_000, CUTOVER],
      ['1404', c.school, null, 0, 500_000, CUTOVER],
      ['1410', c.other, null, 0, 25_000, CUTOVER],
      ['1404', c.other, null, 0, 125_000, CUTOVER],
      ['3900', null, null, 750_000, 0, CUTOVER],
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    const r = await register('2026-09-01', '2026-09-30');
    expect(r.rows.map((x: Record<string, unknown>) => [x.date, x.posting, x.documentStatus, x.lineNo, x.cwtCents, x.vatWithheldCents])).toEqual([
      [CUTOVER, 'original', 'cancelled', 1, 100_000, 500_000],
      [CUTOVER, 'original', 'cancelled', 2, 25_000, 125_000],
      [CUTOVER, 'reversal', 'cancelled', 1, -100_000, -500_000],
      [CUTOVER, 'reversal', 'cancelled', 2, -25_000, -125_000],
    ]);
    expect(r).toMatchObject({ totals: { cwtCents: 0, vatWithheldCents: 0 }, glCwtCents: 0, glVatWithheldCents: 0, pendingCount: 0 });
    expect((await mark(id, 2)).json()).toMatchObject({ code: 'CANCELLED', message: 'OBWT-000001 is cancelled, so its 2307 no longer counts.' });
    expect((await openingState()).documents).toMatchObject([{ number: 'OBWT-000001', status: 'cancelled' }]);

    // Edit = cancel + a new number, still on the cut-over date.
    const second = (await open(obwt([inHand()]))).json();
    expect(second).toMatchObject({ number: 'OBWT-000002', businessDate: CUTOVER });
    const input = obwt([{ ...inHand(), cwtCents: 110_000 }, toCome()], 'From the 2307 folder at the cut-over');
    const re = await accountant.post(`/api/docs/tax.opening/${second.id}/reissue`, { input, expectedTotalCents: totalOf(input), businessDate: CUTOVER, reason: 'The 2307 shows ₱1,100.00' }, idem());
    expect(re.statusCode, re.body).toBe(200);
    expect(re.json()).toMatchObject({ number: 'OBWT-000003', businessDate: CUTOVER });
    expect(journalOf(second.id, 'reversal').map((l) => l[5])).toEqual([CUTOVER, CUTOVER, CUTOVER]);
    expect(balances(env.db)).toEqual({ '1410': 135_000, '1404': 625_000, '3900': -760_000 });
    expect((await accountant.get(`/api/docs/tax.opening/${re.json().id}`)).json().input).toEqual(input);

    // Closed: 3900 to zero with retained earnings, then the opening stays; a 2307 that comes later is still marked received.
    const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const ob = await accountant.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: account('3201'), creditCents: 760_000 }] }, expectedTotalCents: 760_000, businessDate: CUTOVER }, idem());
    expect(ob.statusCode, ob.body).toBe(200);
    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200);
    const refused = await cancel('tax.opening', re.json().id);
    expect(refused.json()).toMatchObject({ code: 'OPENING_CLOSED' });
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(re.json().id)).toBe('posted');
    expect(journalOf(re.json().id, 'reversal')).toEqual([]);
    expect((await mark(re.json().id, 2)).json()).toMatchObject({ number: 'OBWT-000003', lineNo: 2, receivedOn: '2026-09-29' });
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, or once the opening is closed', async () => {
    expect(await errors(obwt())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await errors(obwt(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(obwt(), '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await open(obwt(), '2026-09-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect((await open(obwt(), '2026-09-29')).json().code).toBe('BAD_DATE'); // never a future date (NR-7)
    expect(await errors(obwt())).toEqual([]);

    await stepUp(accountant);
    expect((await accountant.post('/api/acc/opening/close', {})).statusCode).toBe(200); // nothing opened: 3900 is zero
    const closed = await open(obwt());
    expect(closed.statusCode).toBe(422);
    expect(closed.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    expect(balances(env.db)).toEqual({});
  });

  it('a quarter after the cut-over, a row with nothing withheld, an inactive customer', async () => {
    await setCutover();
    const q4 = (await preview(obwt([inHand(), { ...toCome(), quarter: 4 }]))).json();
    expect(q4.issues).toEqual([expect.objectContaining({
      field: 'rows.1.quarter', code: 'QUARTER_AFTER_CUTOVER', level: 'error',
      message: 'Row 2: Q4 2026 begins after the cut-over date, 2026-09-27. Tax withheld after it comes in with the collections.',
    })]);
    expect(await errors(obwt([{ ...inHand(), year: 2027, quarter: 1 }]))).toEqual(['QUARTER_AFTER_CUTOVER']);
    expect(await errors(obwt([{ ...inHand(), year: 2026, quarter: 3 }]))).toEqual([]); // the cut-over's own quarter, before it
    const none = (await preview(obwt([{ ...toCome(), cwtCents: 0, vatWithheldCents: 0 }]))).json();
    expect(none.issues).toEqual([expect.objectContaining({ code: 'NOTHING_WITHHELD', message: 'Row 1: type the tax withheld on the 2307 (creditable withholding tax, VAT withheld or both).' })]);
    expect(await errors(obwt([{ ...inHand(), cwtCents: 0 }]))).toEqual([]); // VAT withheld alone: the CWT went on an income tax return already
    expect(await errors(obwt([{ ...inHand(), vatWithheldCents: 0 }]))).toEqual([]);
    expect(await errors(obwt([{ ...inHand(), customerId: c.closed }]))).toEqual(['CUSTOMER']);
    const refused = await open(obwt([toCome(), { ...toCome(), cwtCents: 0, vatWithheldCents: 0 }]));
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toBe('Row 2: type the tax withheld on the 2307 (creditable withholding tax, VAT withheld or both).');
    expect(balances(env.db)).toEqual({});
  });

  it('the same 2307 twice is a warning; the input, and who may record, view and mark', async () => {
    await setCutover();
    const twice = (await preview(obwt([inHand(), inHand()]))).json();
    expect(twice.issues).toEqual([expect.objectContaining({ code: 'SAME_2307', level: 'warning', message: 'Row 2: Moonlight Test School has a WC158 2307 for Q2 2026 on this opening already. Record each certificate once.' })]);
    expect((await open(obwt([inHand()]))).statusCode).toBe(200);
    // The same amounts as well: the duplicate warning shared by every opening document comes with it (ACC/tests/duplicate-opening.test.ts).
    expect((await preview(obwt([inHand()]))).json().issues).toEqual([
      expect.objectContaining({ code: 'SAME_2307', message: 'Row 1: Moonlight Test School has a WC158 2307 for Q2 2026 on OBWT-000001 already. Record each certificate once.' }),
      expect.objectContaining({ code: 'DUPLICATE_OPENING', level: 'warning' }),
    ]);
    expect((await preview(obwt([{ ...inHand(), cwtCents: 110_000 }]))).json().issues.map((i: { code: string }) => i.code)).toEqual(['SAME_2307']); // other amount: no duplicate warning
    // Another ATC is no SAME_2307; the duplicate warning goes by customer, quarter and amounts (ATC is not one of its key figures).
    expect((await preview(obwt([{ ...inHand(), atc: 'WC160' }]))).json().issues.map((i: { code: string }) => i.code)).toEqual(['DUPLICATE_OPENING']);
    expect((await preview(obwt([{ ...inHand(), atc: 'WC160', cwtCents: 110_000 }]))).json().issues).toEqual([]);

    const bad = (input: unknown) => preview(input).then((r) => r.json().code);
    expect(await bad({ rows: [] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...inHand(), totalCents: 1 }] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...inHand(), atc: 'WI010' }] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...inHand(), quarter: 5 }] })).toBe('INVALID_INPUT');
    expect(await bad({ rows: [{ ...inHand(), cwtCents: -1 }] })).toBe('INVALID_INPUT');
    expect(await bad({ ...obwt(), businessDate: CUTOVER })).toBe('INVALID_INPUT');

    expect((await open(obwt(), CUTOVER, encoder)).statusCode).toBe(403);
    expect((await open(obwt(), CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/docs/tax.opening')).statusCode).toBe(200);
    expect((await encoder.get('/api/docs/tax.opening')).statusCode).toBe(403);
    expect((await mark('x', 0, owner)).statusCode).toBe(404); // the owner may mark a 2307 received
    expect((await mark('x', 0, encoder)).statusCode).toBe(403);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random openings post balanced per row, keep 1410 and 1404 per customer = their rows, tie the register, and cancel to zero on the cut-over date', async () => {
    await setCutover();
    const perms = ['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate'];
    const actor = { userId: accountant.userId, permissions: new Set(perms) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    const post = (input: OpeningWithholdingInput) => postDocument(e, openingWithholdingDoc, actor, { input, expectedTotalCents: totalOf(input), businessDate: CUTOVER });
    const who = { userId: actor.userId, at: stamp(env.clock), today: today(env.clock) };
    fc.assert(
      fc.property(fc.array(fc.tuple(openingWithholdingDoc.arbitrary(env.db), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 5 }), (ops) => {
        for (const [input, markPending, cancelIt] of ops) {
          const doc = openingWithholdingDoc.compute(input, ctx());
          expect(openingWithholdingDoc.validate(doc, ctx()).filter((i) => i.level === 'error')).toEqual([]);
          const lines = resolveDraft(env.db, openingWithholdingDoc.journal!(doc, ctx())!);
          expect(lines.map((l) => [l.account.role_key, l.party?.id ?? null, l.debitCents, l.creditCents])).toEqual([
            ...input.rows.flatMap((r) => [
              ...(r.cwtCents ? [['CWT', r.customerId, r.cwtCents, 0]] : []),
              ...(r.vatWithheldCents ? [['VAT_WITHHELD', r.customerId, r.vatWithheldCents, 0]] : []),
            ]),
            ['OPENING_EQUITY', null, 0, doc.totalCents],
          ]);
          const o = post(input);
          expect(openingWithholdingDoc.load(env.db, o.id)).toEqual(doc);
          expect(openingWithholdingDoc.toInput(doc)).toEqual(input);
          if (markPending) {
            input.rows.forEach((r, i) => r.certificate === 'pending' && markReceived(env.db, { documentId: o.id, lineNo: i + 1 }, who));
            expect(openingWithholdingDoc.toInput(openingWithholdingDoc.load(env.db, o.id)).rows.every((r) => r.certificate === 'received')).toBe(true);
          }
          if (cancelIt) cancelDocument(e, openingWithholdingDoc, actor, o.id, 'Recorded twice by mistake');
        }
        const rows = env.db
          .prepare(
            `SELECT l.customer_id AS customerId, l.cwt_cents AS cwt, l.vat_withheld_cents AS vatw FROM tax_opening_lines l JOIN documents d ON d.id = l.document_id
             WHERE d.status = 'posted'`,
          )
          .all() as { customerId: string; cwt: number; vatw: number }[];
        for (const id of [c.school, c.other]) {
          const mine = rows.filter((r) => r.customerId === id);
          expect(partyBalance('1410', id)).toBe(mine.reduce((s, r) => s + r.cwt, 0));
          expect(partyBalance('1404', id)).toBe(mine.reduce((s, r) => s + r.vatw, 0));
        }
        const cwt = rows.reduce((s, r) => s + r.cwt, 0);
        const vatw = rows.reduce((s, r) => s + r.vatw, 0);
        expect(balances(env.db)['3900'] ?? 0).toBe(0 - (cwt + vatw));
        const r = withholdingReceivedRegister(env.db, '2000-01-01', CUTOVER);
        expect(r.totals).toEqual({ cwtCents: cwt, vatWithheldCents: vatw });
        expect([r.glCwtCents, r.glVatWithheldCents]).toEqual([cwt, vatw]);
        const pending = env.db
          .prepare(
            `SELECT COUNT(*) FROM tax_opening_lines l JOIN documents d ON d.id = l.document_id
             WHERE d.status = 'posted' AND l.cert_2307 = 'pending' AND NOT EXISTS (SELECT 1 FROM tax_2307_receipts x WHERE x.document_id = l.document_id AND x.line_no = l.line_no)`,
          )
          .pluck()
          .get();
        expect(r.pendingCount).toBe(pending);
        const reversals = env.db.prepare(`SELECT DISTINCT j.business_date FROM journals j JOIN documents d ON d.id = j.source_id WHERE d.doc_type = 'tax.opening' AND j.posting_kind = 'reversal'`).pluck().all();
        expect(reversals.filter((d) => d !== CUTOVER)).toEqual([]);
        noBrokenInvariants();
      }),
      { numRuns: 30 },
    );
  });
});
