/**
 * Dividends (PLAN D5 DIV): the declaration (golden: split by shares, 10% final tax on individuals, none on a domestic
 * corporation), the retained earnings check, the record date read from the register's history, the payment, the
 * 1601-FQ that pays the final tax, the 1601-FQ and 1604-F list and calendar, cancels and the balance sheet.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { balanceSheet } from '../../RPT/statements.ts';

let env: TestEnv;
let accountant: Client, owner: Client, encoder: Client;
let BDO: number, CASH: number;
let A: string, C: string, D: string, B: string; // A individual 2,500 shares; C a corporation 1,500; D individual 1,000, no TIN; B officer only

const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const jv = (memo: string, lines: { code: string; debitCents?: number; creditCents?: number }[]) =>
  accountant.post('/api/docs/acc.jv/post', {
    input: { memo, lines: lines.map(({ code, ...l }) => ({ accountId: account(code), ...l })) },
    expectedTotalCents: lines.reduce((s, l) => s + (l.debitCents ?? 0), 0),
  }, idem());

beforeEach(async () => {
  env = await createTestEnv(); // Monday 28 September 2026
  accountant = await env.as('accountant');
  owner = await env.as('owner');
  encoder = await env.as('encoder');
  BDO = cashPlaceId(env.db, '1111');
  CASH = cashPlaceId(env.db, '1101');
  const add = async (body: Record<string, unknown>) => (await accountant.post('/api/eq/people', body)).json().id as string;
  A = await add({ name: 'Sample Owner A', isStockholder: true, isOfficer: true, position: 'President', shares: 2500, tin: '123-456-789-000' });
  C = await add({ name: 'Sample Holdings Corp.', isStockholder: true, isOfficer: false, shares: 1500, tin: '222-333-444-000', holderKind: 'corporation' });
  D = await add({ name: 'Sample Owner D', isStockholder: true, isOfficer: false, shares: 1000 });
  B = await add({ name: 'Sample Officer B', isStockholder: false, isOfficer: true, position: 'Treasurer' });
  // ₱500,000.00 retained earnings from earlier years, and ₱20,000.00 earned this year.
  expect((await jv('Retained earnings brought forward', [{ code: '1111', debitCents: 50_000_000 }, { code: '3201', creditCents: 50_000_000 }])).statusCode).toBe(200);
  expect((await jv('Scrap cloth sold', [{ code: '1101', debitCents: 2_000_000 }, { code: '7103', creditCents: 2_000_000 }])).statusCode).toBe(200);
});

const g = (over: Record<string, unknown> = {}) => ({
  resolutionNumber: 'BR-2026-01', resolutionDate: '2026-09-28', recordDate: '2026-09-28', basis: 'per_share', amountCents: 5_000, ...over,
});
const declare = (input: Record<string, unknown>, expectedTotalCents: number, extra: Record<string, unknown> = {}) =>
  accountant.post('/api/docs/eq.dividend/post', { input, expectedTotalCents, ...extra }, idem());
const pay = (c: Client, input: { amountCents: number; [k: string]: unknown }) => c.post('/api/docs/eq.dividend_payment/post', { input, expectedTotalCents: input.amountCents }, idem());
const payBir = (input: { amountCents: number; [k: string]: unknown }) =>
  accountant.post('/api/docs/tax.bir_payment/post', { input: { cashPlaceId: BDO, reference: 'eFPS 555001', ...input }, expectedTotalCents: input.amountCents }, idem());

/** The original journal of a document: [code, party type, party id, debit, credit] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);
/** Moves the clock to a day (Manila, 10:00) and signs everyone in again. */
async function moveTo(date: string) {
  env.clock.set(`${date}T02:00:00Z`);
  [accountant, owner, encoder] = [await env.as('accountant'), await env.as('owner'), await env.as('encoder')];
}
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
/** The error codes a refused post or preview gave (warnings left out). */
const issues = (r: { json(): { details?: { code: string; level?: string }[] } }) => r.json().details?.filter((i) => i.level === 'error').map((i) => i.code);

describe('Dividend declaration golden (PLAN D5 DIV)', () => {
  it('₱50.00 a share on 5,000 shares: Dr 3210 250,000.00 / Cr 2503 per stockholder net of 10% final tax on individuals / Cr 2312 17,500.00', async () => {
    const pre = await accountant.post('/api/docs/eq.dividend/preview', { input: g() });
    expect(pre.statusCode).toBe(200);
    expect(pre.json().summary).toBe(
      'This will declare a cash dividend of ₱250,000.00 (board resolution BR-2026-01), ₱50.00 a share on 5,000 shares, to 3 stockholders of record on 2026-09-28, less ₱17,500.00 final tax withheld (10%, paid with the 1601-FQ).',
    );
    expect(pre.json().issues).toEqual([expect.objectContaining({ level: 'warning', code: 'NO_TIN', message: 'Sample Owner D has no TIN in the register: the 1601-FQ and the 1604-F need it. Add it before filing.' })]);
    expect(pre.json().doc.lines).toEqual([
      { personId: A, name: 'Sample Owner A', tin: '123-456-789-000', holderKind: 'individual', shares: 2500, grossCents: 12_500_000, taxCents: 1_250_000, netCents: 11_250_000 },
      { personId: C, name: 'Sample Holdings Corp.', tin: '222-333-444-000', holderKind: 'corporation', shares: 1500, grossCents: 7_500_000, taxCents: 0, netCents: 7_500_000 },
      { personId: D, name: 'Sample Owner D', tin: null, holderKind: 'individual', shares: 1000, grossCents: 5_000_000, taxCents: 500_000, netCents: 4_500_000 },
    ]);
    expect(pre.json().doc.retained).toEqual({ date: '2026-09-28', retainedCents: 50_000_000, currentYearCents: 2_000_000, earlierYearsCents: 0, declaredCents: 0, availableCents: 52_000_000 });

    const res = await declare(g(), 25_000_000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'DIV-000001', totalCents: 25_000_000, businessDate: '2026-09-28' });
    expect(journalOf(res.json().id)).toEqual([
      ['3210', null, null, 25_000_000, 0],
      ['2503', 'stockholder', A, 0, 11_250_000],
      ['2503', 'stockholder', C, 0, 7_500_000],
      ['2503', 'stockholder', D, 0, 4_500_000],
      ['2312', null, null, 0, 1_750_000],
    ]);
    expect(balances(env.db)).toMatchObject({ '3210': 25_000_000, '2503': -23_250_000, '2312': -1_750_000 });
    const view = (await accountant.get(`/api/docs/eq.dividend/${res.json().id}`)).json();
    expect(view.doc).toEqual(pre.json().doc);
    noBrokenInvariants();
  });

  it('in total, split by shares by largest remainder; the tax is rounded per stockholder', async () => {
    const pre = (await accountant.post('/api/docs/eq.dividend/preview', { input: g({ basis: 'total', amountCents: 10_000_001 }) })).json();
    expect(pre.doc.lines.map((l: { grossCents: number; taxCents: number }) => [l.grossCents, l.taxCents])).toEqual([[5_000_001, 500_000], [3_000_000, 0], [2_000_000, 200_000]]);
    expect(pre.totalCents).toBe(10_000_001);
  });

  it('is refused when retained earnings on the declaration date would go below zero, with the figures', async () => {
    const big = await declare(g({ basis: 'total', amountCents: 60_000_000 }), 60_000_000);
    expect(big.statusCode).toBe(422);
    expect(big.json().message).toBe(
      'Retained earnings on 2026-09-28 are ₱520,000.00: ₱500,000.00 retained earnings, ₱20,000.00 earnings of 2026 to date, less ₱0.00 dividends already declared. This dividend of ₱600,000.00 would leave -₱80,000.00.',
    );
    expect((await declare(g(), 25_000_000)).statusCode).toBe(200);
    const second = await declare(g({ resolutionNumber: 'BR-2026-02', basis: 'total', amountCents: 27_000_001 }), 27_000_001);
    expect(second.json().message).toBe(
      'Retained earnings on 2026-09-28 are ₱270,000.00: ₱500,000.00 retained earnings, ₱20,000.00 earnings of 2026 to date, less ₱250,000.00 dividends already declared. This dividend of ₱270,000.01 would leave -₱0.01.',
    );
    expect((await declare(g({ resolutionNumber: 'BR-2026-02', basis: 'total', amountCents: 27_000_000 }), 27_000_000)).statusCode).toBe(200);
    // A loss this year counts too: ₱30,000.00 of expenses leaves nothing for more.
    await jv('Repairs', [{ code: '6170', debitCents: 3_000_000 }, { code: '1101', creditCents: 3_000_000 }]);
    const after = await declare(g({ resolutionNumber: 'BR-2026-03', basis: 'total', amountCents: 100 }), 100);
    expect(after.json().message).toContain('Retained earnings on 2026-09-28 are -₱30,000.00');
  });

  it('splits by the shares held at the end of the record date, read from the register as it was', async () => {
    await moveTo('2026-09-29');
    const a = (await accountant.get('/api/eq/people')).json().find((p: { id: string }) => p.id === A);
    expect((await accountant.put(`/api/eq/people/${A}`, { shares: 3500 }, { 'if-match': String(a.version) })).statusCode).toBe(200);
    const late = (await accountant.post('/api/eq/people', { name: 'Sample Owner E', isStockholder: true, isOfficer: false, shares: 500, tin: '555-666-777-000' })).json().id;
    const d = (await accountant.get('/api/eq/people')).json().find((p: { id: string }) => p.id === D);
    await accountant.put(`/api/eq/people/${D}`, { isStockholder: false, isOfficer: true }, { 'if-match': String(d.version) });
    await moveTo('2026-09-30');
    const shares = async (recordDate: string) =>
      (await accountant.post('/api/docs/eq.dividend/preview', { input: g({ resolutionDate: '2026-09-28', recordDate }) })).json().doc.lines.map((l: { personId: string; shares: number }) => [l.personId, l.shares]);
    expect(await shares('2026-09-28')).toEqual([[A, 2500], [C, 1500], [D, 1000]]);
    expect(await shares('2026-09-29')).toEqual([[A, 3500], [C, 1500], [late, 500]]);
    // Before anyone was in the register, and a record date that has not ended.
    expect(issues(await declare(g({ resolutionDate: '2026-09-01', recordDate: '2026-09-01' }), 0))).toContain('NO_HOLDERS');
    expect(issues(await declare(g({ recordDate: '2026-10-01' }), 0))).toContain('RECORD_AHEAD');
  });

  it('checks the resolution and record dates, and backdates to the declaration day', async () => {
    await moveTo('2026-09-30');
    expect(issues(await declare(g({ resolutionDate: '2026-09-29' }), 25_000_000, { businessDate: '2026-09-28' }))).toEqual(['AFTER_DECLARATION', 'RECORD_BEFORE_RESOLUTION']);
    const res = await declare(g(), 25_000_000, { businessDate: '2026-09-28' });
    expect(res.json()).toMatchObject({ number: 'DIV-000001', businessDate: '2026-09-28' });
  });

  it('is for the accountant; the owner sees it; encoders do not', async () => {
    expect((await encoder.post('/api/docs/eq.dividend/preview', { input: g() })).statusCode).toBe(403);
    expect((await owner.post('/api/docs/eq.dividend/post', { input: g(), expectedTotalCents: 25_000_000 }, idem())).statusCode).toBe(403);
    const res = await declare(g(), 25_000_000);
    expect((await owner.get(`/api/docs/eq.dividend/${res.json().id}`)).statusCode).toBe(200);
    expect((await encoder.get(`/api/docs/eq.dividend/${res.json().id}`)).statusCode).toBe(403);
  });
});

describe('Dividend payment golden', () => {
  it('pays a stockholder what the declaration made payable, in part or in full, never more; cancel mirrors it', async () => {
    await declare(g(), 25_000_000);
    const res = await pay(owner, { personId: A, cashPlaceId: BDO, amountCents: 11_250_000, note: 'Check 000123' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'DIVP-000001', summary: 'This will record ₱112,500.00 of dividends paid to Sample Owner A from Cash in bank – BDO.' });
    expect(journalOf(res.json().id)).toEqual([
      ['2503', 'stockholder', A, 11_250_000, 0],
      ['1111', null, null, 0, 11_250_000],
    ]);
    const part = await pay(accountant, { personId: D, cashPlaceId: CASH, amountCents: 2_000_000 });
    expect(part.json().summary).toBe('This will record ₱20,000.00 of dividends paid to Sample Owner D from Cash on hand (main cash box). ₱25,000.00 stays payable to them.');
    const over = await pay(accountant, { personId: D, cashPlaceId: CASH, amountCents: 2_500_001 });
    expect(over.json().message).toBe('The company owes Sample Owner D only ₱25,000.00 in dividends.');
    expect(issues(await pay(accountant, { personId: B, cashPlaceId: CASH, amountCents: 100 }))).toEqual(['NOTHING_OWED']);
    expect((await pay(encoder, { personId: D, cashPlaceId: CASH, amountCents: 100 })).statusCode).toBe(403);
    expect(balances(env.db)).toMatchObject({ '2503': -10_000_000 }); // C ₱75,000.00 and D ₱25,000.00

    const cancel = await accountant.post(`/api/docs/eq.dividend_payment/${part.json().id}/cancel`, { reason: 'Paid by check instead' }, idem());
    expect(cancel.statusCode).toBe(200);
    expect(journalOf(part.json().id, 'reversal')).toEqual([
      ['2503', 'stockholder', D, 0, 2_000_000],
      ['1101', null, null, 2_000_000, 0],
    ]);
    noBrokenInvariants();
  });

  it('a declaration is cancelled only after the payments made from it; its mirror lands on its own date', async () => {
    const dec = (await declare(g(), 25_000_000)).json();
    const paid = (await pay(accountant, { personId: A, cashPlaceId: BDO, amountCents: 100 })).json();
    await moveTo('2026-10-02');
    const blocked = await accountant.post(`/api/docs/eq.dividend/${dec.id}/cancel`, { reason: 'Board resolution was wrong' }, idem());
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('HAS_DEPENDENTS');
    await accountant.post(`/api/docs/eq.dividend_payment/${paid.id}/cancel`, { reason: 'Paid in error, returned' }, idem());
    const ok = await accountant.post(`/api/docs/eq.dividend/${dec.id}/cancel`, { reason: 'Board resolution was wrong' }, idem());
    expect(ok.statusCode).toBe(200);
    const mirror = env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(dec.id);
    expect(mirror).toBe('2026-09-28');
    expect(Object.keys(balances(env.db)).filter((code) => ['3210', '2503', '2312'].includes(code))).toEqual([]);
    // The edit is checked as if the old one had never been: the whole ₱520,000.00 is there again.
    expect((await accountant.post('/api/docs/eq.dividend/preview', { input: g(), businessDate: '2026-09-28' })).json().doc.retained.availableCents).toBe(52_000_000);
    noBrokenInvariants();
  });
});

describe('Final tax: 1601-FQ payment, list and calendar', () => {
  it('the 1601-FQ pays the quarter’s final tax: Dr 2312 / Cr cash; the list per stockholder ties to 2312', async () => {
    const dec = (await declare(g(), 25_000_000)).json();
    await moveTo('2026-10-15');
    const list = (await accountant.get('/api/tax/final-tax?year=2026&quarter=3')).json();
    expect(list).toMatchObject({
      period: '2026-Q3', from: '2026-07-01', to: '2026-09-30', dueDate: '2026-11-02', totals: { grossCents: 25_000_000, taxCents: 1_750_000, netCents: 23_250_000 },
      withheldCents: 1_750_000, paidCents: 0, leftCents: 1_750_000, tied: true,
    });
    expect(list.rows.map((r: { name: string; tin: string | null; taxRateBp: number; taxCents: number }) => [r.name, r.tin, r.taxRateBp, r.taxCents])).toEqual([
      ['Sample Holdings Corp.', '222-333-444-000', 0, 0], ['Sample Owner A', '123-456-789-000', 1000, 1_250_000], ['Sample Owner D', null, 1000, 500_000],
    ]);
    const csv = await accountant.get('/api/tax/final-tax?year=2026&quarter=3&format=csv');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="1601-FQ-final-tax-2026-Q3.csv"');
    expect(csv.body).toContain('"Sample Owner D","No TIN","Individual","1000","50000.00","10%","5000.00","45000.00"\r\n"Total"');
    expect((await encoder.get('/api/tax/final-tax?year=2026&quarter=3')).statusCode).toBe(403);

    expect((await accountant.get('/api/tax/payments/due')).json()).toContainEqual({ form: '1601-FQ', period: '2026-Q3', payableCents: 1_750_000 });
    expect((await payBir({ form: '1601-FQ', period: '2026-Q3', amountCents: 1_750_001 })).json().code).toBe('VALIDATION');
    expect(issues(await payBir({ form: '1601-FQ', period: '2026-09', amountCents: 100 }))).toEqual(['PERIOD']);
    expect(issues(await payBir({ form: '1601-FQ', period: '2026-Q2', amountCents: 100 }))).toEqual(['NOTHING_DUE']);
    const res = await payBir({ form: '1601-FQ', period: '2026-Q3', amountCents: 1_750_000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toBe('This will record ₱17,500.00 final tax paid to the BIR with the 1601-FQ for Q3 2026 (eFPS 555001) from Cash in bank – BDO.');
    expect(journalOf(res.json().id)).toEqual([
      ['2312', null, null, 1_750_000, 0],
      ['1111', null, null, 0, 1_750_000],
    ]);
    expect(balances(env.db)['2312']).toBeUndefined(); // zero
    expect((await accountant.get('/api/tax/final-tax?year=2026&quarter=3')).json()).toMatchObject({ withheldCents: 1_750_000, paidCents: 1_750_000, leftCents: 0 });
    expect((await accountant.get(`/api/docs/tax.bir_payment/${res.json().id}`)).json().doc).toMatchObject({ form: '1601-FQ', payableCents: 1_750_000, amountCents: 1_750_000 });
    expect(issues(await payBir({ form: '1601-FQ', period: '2026-Q3', amountCents: 100 }))).toEqual(['NOTHING_DUE']);
    // The Q4 quarter the payment fell in withheld nothing: no 1601-FQ is due for it.
    expect((await accountant.get('/api/tax/final-tax?year=2026&quarter=4')).json()).toMatchObject({ withheldCents: 0, paidCents: 0, dueDate: null });

    // The declaration waits for its 1601-FQ payment before it can be cancelled.
    const blocked = await accountant.post(`/api/docs/eq.dividend/${dec.id}/cancel`, { reason: 'Board resolution was wrong' }, idem());
    expect(blocked.json().code).toBe('HAS_DEPENDENTS');
    const year = (await accountant.get('/api/tax/final-tax?year=2026')).json();
    expect(year).toMatchObject({ period: '2026', quarter: null, dueDate: '2027-02-01', withheldCents: 1_750_000, paidCents: 1_750_000, leftCents: 0 });
    expect((await accountant.get('/api/tax/final-tax?year=2026&format=csv')).headers['content-disposition']).toBe('attachment; filename="1604-F-final-tax-2026.csv"');
    noBrokenInvariants();
  });

  it('the calendar shows the 1601-FQ and the 1604-F only for periods with final tax withheld', async () => {
    const forms = async (from: string, to: string) =>
      ((await accountant.get(`/api/tax/calendar?from=${from}&to=${to}`)).json() as { form: string; period: string; statutoryDate: string; dueDate: string }[])
        .filter((d) => d.form === '1601-FQ' || d.form === '1604-F').map((d) => `${d.form} ${d.period} ${d.statutoryDate}→${d.dueDate}`);
    expect(await forms('2026-10-01', '2027-02-28')).toEqual([]);
    await declare(g(), 25_000_000);
    // 31 Oct is a Saturday and a special holiday, 1 Nov a Sunday and a holiday; 31 Jan 2027 is a Sunday.
    expect(await forms('2026-10-01', '2027-02-28')).toEqual(['1601-FQ 2026-Q3 2026-10-31→2026-11-02', '1604-F 2026 2027-01-31→2027-02-01']);
  });

  it('the late 1601-FQ asks for the penalty; a penalty goes to 6290', async () => {
    await declare(g(), 25_000_000);
    await moveTo('2026-11-10');
    const pre = await accountant.post('/api/docs/tax.bir_payment/preview', { input: { form: '1601-FQ', period: '2026-Q3', cashPlaceId: BDO, amountCents: 1_750_000, reference: 'eFPS 555002' } });
    expect(pre.json().issues).toEqual([expect.objectContaining({ code: 'LATE', level: 'warning' })]);
    const ok = await accountant.post('/api/docs/tax.bir_payment/post', { input: { form: '1601-FQ', period: '2026-Q3', cashPlaceId: BDO, amountCents: 1_750_000, penaltyCents: 100_000, reference: 'eFPS 555002' }, expectedTotalCents: 1_850_000 }, idem());
    expect(journalOf(ok.json().id)).toEqual([
      ['2312', null, null, 1_750_000, 0],
      ['6290', null, null, 100_000, 0],
      ['1111', null, null, 0, 1_850_000],
    ]);
  });
});

describe('Balance sheet: dividends declared inside equity', () => {
  it('3210 shows the year’s dividends; the next year they are a computed line beside retained earnings', async () => {
    await declare(g(), 25_000_000);
    const equity = (asOf: string) => {
      const bs = balanceSheet(env.db, asOf);
      expect(bs.balanced).toBe(true);
      return bs.sections.find((s) => s.key === 'equity')!.groups.flatMap((gr) => gr.lines).map((l) => [l.code, l.name, l.amountCents]);
    };
    expect(equity('2026-09-30')).toEqual(expect.arrayContaining([['3201', 'Retained earnings', 50_000_000], ['3210', 'Dividends declared', -25_000_000]]));
    const next = equity('2027-01-31');
    expect(next.some((l) => l[0] === '3210')).toBe(false);
    expect(next).toEqual(expect.arrayContaining([[null, 'Earlier years’ dividends not yet closed to retained earnings', -25_000_000]]));
    expect(balanceSheet(env.db, '2027-01-31').earlierYearsDividendsCents).toBe(-25_000_000);
    // Closed by the accountant's journal voucher (Dr 3201 / Cr 3210), the computed line goes away.
    await jv('Close 2026 dividends to retained earnings', [{ code: '3201', debitCents: 25_000_000 }, { code: '3210', creditCents: 25_000_000 }]);
    const closed = equity('2027-01-31');
    expect(closed.some((l) => l[1] === 'Earlier years’ dividends not yet closed to retained earnings')).toBe(false);
    expect(closed).toEqual(expect.arrayContaining([['3201', 'Retained earnings', 25_000_000]]));
  });
});
