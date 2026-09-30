/**
 * Opening fixed assets (OBFA-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): an asset on the straight line and one with
 * less depreciation than it, each run after the cut-over, a retirement, cancel and edit on the cut-over date, the
 * refusals every opening document shares, and property tests that the charges after the cut-over add up to exactly
 * what the old books left.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { PASSWORD, balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import { cutoverDate } from '../../ACC/public.ts';
import { assetRegister, monthsInService, scheduledCents, straightLine } from '../assets.ts';
import { depreciationDoc } from '../doctypes/depreciation.ts';
import { openingAssetDoc, type OpeningAssetInput } from '../doctypes/opening.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let acc: Client;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  acc = await env.as('accountant');
});

const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
/** Sets the cut-over date as `c` (an accountant of `t`), who is returned. */
const setCutover = async (t: TestEnv = env, c: Client = acc) => {
  await stepUp(c);
  const r = await c.post('/api/acc/opening/cutover-date', { date: CUTOVER });
  expect(r.statusCode, r.body).toBe(200);
  expect((await c.get('/api/acc/opening')).json().cutoverDate).toBe(cutoverDate(t.db));
  return c;
};
const open = (input: OpeningAssetInput, businessDate: string | null = CUTOVER, c = acc) =>
  c.post('/api/docs/fa.opening/post', { input, expectedTotalCents: input.costCents, ...(businessDate ? { businessDate } : {}) }, idem());
const preview = async (input: OpeningAssetInput, businessDate: string | null = CUTOVER) =>
  (await acc.post('/api/docs/fa.opening/preview', { input, ...(businessDate ? { businessDate } : {}) })).json();
const codes = async (input: OpeningAssetInput, businessDate: string | null = CUTOVER, level = 'error') =>
  (await preview(input, businessDate)).issues.filter((i: { level: string }) => i.level === level).map((i: { code: string }) => i.code);
const post = (type: string, input: object, expectedTotalCents: number) => acc.post(`/api/docs/fa.${type}/post`, { input, expectedTotalCents }, idem());
const run = async (month: string) => post('depreciation', { month }, (await acc.post('/api/docs/fa.depreciation/preview', { input: { month } })).json().totalCents);
const cancel = (type: string, id: string) => acc.post(`/api/docs/fa.${type}/${id}/cancel`, { reason: 'Recorded by mistake, redo' }, idem());
/** A document's journal: [code, party type, party id, debit, credit, date] per line. */
const journalOf = (documentId: string, kind = 'original') =>
  env.db.prepare(`SELECT a.code, l.party_type, l.party_id, l.debit_cents, l.credit_cents, j.business_date FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`).raw().all(documentId, kind) as unknown[][];
const errorCodes = (r: { json(): { details?: { code: string; level: string }[] } }) => (r.json().details ?? []).filter((i) => i.level === 'error').map((i) => i.code);
const registerRow = async (id: string) => ((await acc.get('/api/fa/assets')).json() as { id: string }[]).find((a) => a.id === id);
const noBrokenInvariants = (t: TestEnv = env) => expect(runInvariants(t.db).filter((r) => !r.ok)).toEqual([]);
/** Moves the clock to a day in a later month; yesterday's session has timed out. */
const goTo = async (iso: string) => (env.clock.set(iso), (acc = await env.as('accountant')));
/** "2026-09" for months since year 0. */
const month = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
const SEPTEMBER_2026 = 2026 * 12 + 8;
const accountId = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;

/** On the straight line: 12 months in service (Oct 2025 to Sep 2026) of 60, at ₱1,500.00 a month. */
const heatPress = (): OpeningAssetInput => ({
  classCode: 'machinery', description: 'Heat press', location: 'Production floor', acquiredOn: '2025-10-15',
  costCents: 10_000_000, residualCents: 1_000_000, lifeMonths: 60, accumulatedCents: 1_800_000,
});
/** Less than the straight line: 24 months in service (Oct 2024 to Sep 2026) of the usual 36, the old books at ₱20,000.00 not ₱26,666.67. */
const laptops = (): OpeningAssetInput => ({
  classCode: 'computers', description: 'Two office laptops', acquiredOn: '2024-10-10', costCents: 4_500_000, residualCents: 500_000, accumulatedCents: 2_000_000,
});

describe('golden: an asset on the straight line', () => {
  it('Dr 1510 cost / Cr 1511 accumulated / Cr 3900 book value on the cut-over date; the register shows it; runs go on from October', async () => {
    await setCutover();
    const pre = await preview(heatPress());
    expect(pre.summary).toBe(
      'This will record Heat press (machinery and production equipment), acquired 2025-10-15, as owned on 2026-09-27: cost ₱100,000.00 less ₱18,000.00 accumulated depreciation, a book value of ₱82,000.00 credited to opening balance equity. After September 2026 it depreciates on the straight line over the 48 months left, down to ₱10,000.00.',
    );
    expect(pre.issues).toEqual([]);
    const res = await open(heatPress());
    expect(res.statusCode, res.body).toBe(200);
    const { id } = res.json();
    expect(res.json()).toMatchObject({ number: 'OBFA-000001', businessDate: CUTOVER, totalCents: 10_000_000 });
    expect(journalOf(id)).toEqual([
      ['1510', 'asset', id, 10_000_000, 0, CUTOVER],
      ['1511', 'asset', id, 0, 1_800_000, CUTOVER],
      ['3900', null, null, 0, 8_200_000, CUTOVER],
    ]);
    expect(await registerRow(id)).toMatchObject({
      number: 'OBFA-000001', status: 'in service', className: 'Machinery and production equipment', location: 'Production floor', acquiredOn: '2025-10-15',
      openedOn: CUTOVER, openingAccumulatedCents: 1_800_000, monthlyChargeCents: 150_000, accumulatedCents: 1_800_000, bookValueCents: 8_200_000,
    });
    const opening = (await acc.get('/api/acc/opening')).json();
    expect(opening.documents).toMatchObject([{ docType: 'fa.opening', number: 'OBFA-000001', status: 'posted', totalCents: 10_000_000 }]);
    expect(opening.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]); // 1510 and 1511 tie to the asset

    // The cut-over month is not depreciated again; October charges what a purchase of the same asset would.
    expect(errorCodes(await run('2026-09'))).toEqual(['NOTHING_TO_CHARGE']);
    await goTo('2026-10-20T02:00:00Z');
    const oct = await run('2026-10');
    expect(oct.json()).toMatchObject({ number: 'DEPR-000001', totalCents: 150_000 });
    expect(journalOf(oct.json().id)).toEqual([['5302', null, null, 150_000, 0, '2026-10-20'], ['1511', 'asset', id, 0, 150_000, '2026-10-20']]);
    const bought = { costCents: 10_000_000, residualCents: 1_000_000, lifeMonths: 60 };
    expect(straightLine(bought, 13) - straightLine(bought, 12)).toBe(150_000);
    expect((await acc.get(`/api/docs/fa.depreciation/${oct.json().id}`)).json().doc.lines).toEqual([
      { assetId: id, assetNumber: 'OBFA-000001', description: 'Heat press', expenseRole: 'DEPR_PRODUCTION', accumRole: 'FA_MACHINERY_ACCUM', monthsElapsed: 13, chargeCents: 150_000, accumulatedCents: 1_950_000 },
    ]);
    expect(env.db.prepare('SELECT asset_id, month, charge_cents FROM fa_opening_depreciation_lines').raw().all()).toEqual([[id, '2026-10', 150_000]]);
    expect(await registerRow(id)).toMatchObject({ accumulatedCents: 1_950_000, bookValueCents: 8_050_000 });
    expect(balances(env.db)).toEqual({ '1510': 10_000_000, '1511': -1_950_000, '3900': -8_200_000, '5302': 150_000 });
    noBrokenInvariants();
  });
});

describe('golden: less depreciation than the straight line', () => {
  it('spreads the ₱20,000.00 left evenly over the 12 months of life left and stops at exactly the residual value', async () => {
    await setCutover();
    const pre = await preview(laptops());
    expect(pre.summary).toBe(
      'This will record Two office laptops (office and computer equipment), acquired 2024-10-10, as owned on 2026-09-27: cost ₱45,000.00 less ₱20,000.00 accumulated depreciation, a book value of ₱25,000.00 credited to opening balance equity. After September 2026 the ₱20,000.00 left is spread over the 12 months left, down to ₱5,000.00.',
    );
    expect(pre.issues).toEqual([
      {
        field: 'accumulatedCents', code: 'NOT_STRAIGHT_LINE', level: 'warning',
        message: 'The straight line gives ₱26,666.67 for its 24 months in service. The ₱20,000.00 left is spread evenly over the 12 months of life left, about ₱1,666.67 a month.',
      },
    ]);
    const res = await open(laptops());
    const { id } = res.json();
    expect(journalOf(id)).toEqual([
      ['1520', 'asset', id, 4_500_000, 0, CUTOVER],
      ['1521', 'asset', id, 0, 2_000_000, CUTOVER],
      ['3900', null, null, 0, 2_500_000, CUTOVER],
    ]);
    expect(await registerRow(id)).toMatchObject({ lifeMonths: 36, monthlyChargeCents: 166_667, bookValueCents: 2_500_000 });

    const charges: number[] = [];
    for (let k = 0; k < 12; k++) {
      const ym = `${2026 + Math.floor((9 + k) / 12)}-${String(((9 + k) % 12) + 1).padStart(2, '0')}`; // 2026-10 .. 2027-09
      await goTo(`${ym}-25T02:00:00Z`);
      const r = await run(ym);
      expect(r.statusCode, `${ym}: ${r.body}`).toBe(200);
      if (k === 0) expect(journalOf(r.json().id)).toEqual([['6210', null, null, 166_667, 0, '2026-10-25'], ['1521', 'asset', id, 0, 166_667, '2026-10-25']]);
      charges.push(r.json().totalCents);
    }
    expect(charges).toEqual([166_667, 166_666, 166_667, 166_667, 166_666, 166_667, 166_667, 166_666, 166_667, 166_667, 166_666, 166_667]);
    expect(charges.reduce((s, c) => s + c, 0)).toBe(2_000_000);
    expect(await registerRow(id)).toMatchObject({ status: 'fully depreciated', accumulatedCents: 4_000_000, bookValueCents: 500_000 });
    await goTo('2027-10-25T02:00:00Z');
    expect(errorCodes(await run('2027-10'))).toEqual(['NOTHING_TO_CHARGE']);

    // A run comes off only when it is the latest for the asset; the opening asset only when none is left.
    const first = env.db.prepare(`SELECT id FROM documents WHERE number = 'DEPR-000001'`).pluck().get() as string;
    expect((await cancel('depreciation', first)).json().details).toHaveLength(11);
    expect((await cancel('opening', id)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', details: expect.arrayContaining([expect.objectContaining({ number: 'DEPR-000012' })]) });
    noBrokenInvariants();
  });
});

describe('golden: a disposal', () => {
  it('retires an opening asset like a bought one: book value to 7202; its runs and its opening wait for the disposal', async () => {
    await setCutover();
    const { id } = (await open(heatPress())).json();
    await goTo('2026-10-20T02:00:00Z');
    const oct = (await run('2026-10')).json();
    expect(errorCodes(await post('disposal', { assetId: id, kind: 'sale', reason: 'Sold to another shop' }, 0))).toEqual(['INVOICE', 'AMOUNT', 'CASH_PLACE', 'BUYER']);
    const fad = await post('disposal', { assetId: id, kind: 'retirement', reason: 'Heating plate cracked, scrapped' }, 10_000_000);
    expect(fad.statusCode, fad.body).toBe(200);
    expect(fad.json()).toMatchObject({
      number: 'FAD-000001', summary: 'This will retire OBFA-000001 Heat press: cost ₱100,000.00 less ₱19,500.00 accumulated depreciation, a loss of ₱80,500.00 (its book value).',
    });
    expect(journalOf(fad.json().id)).toEqual([
      ['1511', 'asset', id, 1_950_000, 0, '2026-10-20'],
      ['7202', null, null, 8_050_000, 0, '2026-10-20'],
      ['1510', 'asset', id, 0, 10_000_000, '2026-10-20'],
    ]);
    expect(env.db.prepare('SELECT asset_id, cost_cents, accumulated_cents, loss_cents FROM fa_opening_disposals').raw().all()).toEqual([[id, 10_000_000, 1_950_000, 8_050_000]]);
    expect((await acc.get(`/api/docs/fa.disposal/${fad.json().id}`)).json().doc).toMatchObject({ assetNumber: 'OBFA-000001', lossCents: 8_050_000 });
    expect(await registerRow(id)).toMatchObject({ status: 'disposed', disposal: 'FAD-000001', bookValueCents: 0 });
    expect(errorCodes(await post('disposal', { assetId: id, kind: 'retirement', reason: 'Again by mistake' }, 10_000_000))).toEqual(['DISPOSED']);
    await goTo('2026-11-20T02:00:00Z');
    expect(errorCodes(await run('2026-11'))).toEqual(['NOTHING_TO_CHARGE']);
    expect(balances(env.db)).toEqual({ '3900': -8_200_000, '5302': 150_000, '7202': 8_050_000 });

    expect((await cancel('depreciation', oct.id)).json().message).toBe('Cancel these first: FAD-000001.');
    expect((await cancel('opening', id)).json().message).toBe('Cancel these first: DEPR-000001, FAD-000001.');
    expect((await cancel('disposal', fad.json().id)).statusCode).toBe(200);
    expect((await cancel('depreciation', oct.id)).statusCode).toBe(200);
    expect((await cancel('opening', id)).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });
});

describe('cancel and edit', () => {
  it('an edit replaces it on the cut-over date; a cancel in October lands on the cut-over date too', async () => {
    await setCutover();
    const first = (await open({ ...heatPress(), accumulatedCents: 1_500_000 })).json();
    const edit = await acc.post(
      `/api/docs/fa.opening/${first.id}/reissue`,
      { input: heatPress(), expectedTotalCents: 10_000_000, businessDate: CUTOVER, reason: 'Old books said 18,000 accumulated' },
      idem(),
    );
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json()).toMatchObject({ number: 'OBFA-000002', businessDate: CUTOVER });
    expect(journalOf(first.id, 'reversal').map((l) => l[5])).toEqual([CUTOVER, CUTOVER, CUTOVER]);
    expect((await acc.get(`/api/docs/fa.opening/${edit.json().id}`)).json().input).toEqual(heatPress());

    await goTo('2026-10-05T02:00:00Z');
    const id = edit.json().id as string;
    const res = await cancel('opening', id);
    expect(res.statusCode, res.body).toBe(200);
    expect(journalOf(id, 'reversal')).toEqual([
      ['1510', 'asset', id, 0, 10_000_000, CUTOVER],
      ['1511', 'asset', id, 1_800_000, 0, CUTOVER],
      ['3900', null, null, 8_200_000, 0, CUTOVER],
    ]); // the cut-over date, not today: the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect(await registerRow(id)).toMatchObject({ status: 'cancelled', bookValueCents: 0 });
    expect(errorCodes(await run('2026-10'))).toEqual(['NOTHING_TO_CHARGE']);
    noBrokenInvariants();
  });
});

describe('refusals', () => {
  it('without a cut-over date, on another date, and once the opening is closed (then it is not cancelled either)', async () => {
    expect(await codes(heatPress())).toEqual(['NO_CUTOVER']);
    await setCutover();
    expect(await codes(heatPress(), null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    const other = await open(heatPress(), '2026-09-20');
    expect(other.statusCode).toBe(422);
    expect(other.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');

    const { id } = (await open(heatPress())).json();
    // The equity breakdown brings 3900 to zero, then the accountant closes the opening.
    await acc.post('/api/docs/acc.opening/post', { input: { lines: [{ accountId: accountId('3201'), creditCents: 8_200_000 }] }, expectedTotalCents: 8_200_000, businessDate: CUTOVER }, idem());
    await stepUp(acc);
    const closed = await acc.post('/api/acc/opening/close', {});
    expect(closed.statusCode, closed.body).toBe(200);
    const late = await open(laptops());
    expect(late.statusCode).toBe(422);
    expect(errorCodes(late)).toEqual(['OPENING_CLOSED']);
    const cancelled = await cancel('opening', id);
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().code).toBe('OPENING_CLOSED');
    expect(await registerRow(id)).toMatchObject({ status: 'in service', bookValueCents: 8_200_000 });
    noBrokenInvariants();
  });

  it('accumulated depreciation more than cost less residual, and the other slips', async () => {
    await setCutover();
    const res = await open({ ...heatPress(), accumulatedCents: 9_000_001 });
    expect(res.statusCode).toBe(422);
    expect(errorCodes(res)).toEqual(['ACCUMULATED']);
    expect(res.json().message).toBe('The accumulated depreciation cannot be more than the cost less the residual value, ₱90,000.00.');
    expect((await preview({ ...heatPress(), accumulatedCents: 9_000_000 })).summary).toMatch(/a book value of ₱10,000.00 credited to opening balance equity. It is fully depreciated.$/);
    expect(await codes({ ...heatPress(), acquiredOn: '2026-09-28' })).toEqual(['ACQUIRED_AFTER_CUTOVER']);
    expect(await codes({ ...heatPress(), residualCents: 10_000_000 })).toEqual(['RESIDUAL']);
    const leasehold = await preview({ ...heatPress(), classCode: 'leasehold', lifeMonths: undefined });
    expect(leasehold.issues.map((i: { code: string }) => i.code)).toEqual(['LIFE']);
    expect(leasehold.summary).toMatch(/Type its useful life to see how it depreciates.$/);
    expect(await codes({ ...heatPress(), classCode: 'boats' })).toEqual(['CLASS']);
    expect(await codes({ ...heatPress(), lifeMonths: 48 }, CUTOVER, 'warning')).toEqual(['LIFE_DIFFERENT', 'NOT_STRAIGHT_LINE']);
    const ended = await preview({ ...heatPress(), acquiredOn: '2020-01-10', accumulatedCents: 8_000_000 });
    expect(ended.issues.map((i: { code: string }) => i.code)).toEqual(['LIFE_ENDED']);
    expect(ended.issues[0].message).toBe('Its 60 months of life ended by the cut-over, so the next depreciation run charges the ₱10,000.00 left.');
    for (const role of ['owner', 'encoder'] as const) expect((await open(heatPress(), CUTOVER, await env.as(role))).statusCode).toBe(403);
    expect(balances(env.db)).toEqual({});
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('the schedule: nothing more up to the cut-over month, then even steps that add up to exactly what was left', async () => {
    await setCutover();
    fc.assert(
      fc.property(openingAssetDoc.arbitrary(env.db), (input) => {
        const a = { ...input, lifeMonths: input.lifeMonths!, openedOn: CUTOVER, openingAccumulatedCents: input.accumulatedCents };
        const doc = openingAssetDoc.compute(input, { db: env.db, businessDate: CUTOVER, at: '', userId: acc.userId, can: () => true });
        const cut = SEPTEMBER_2026;
        expect(scheduledCents(a, month(cut))).toBe(input.accumulatedCents);
        expect(scheduledCents(a, month(cut - 5))).toBe(input.accumulatedCents);
        const steps = Array.from({ length: doc.monthsLeft + 2 }, (_, k) => scheduledCents(a, month(cut + k + 1)) - scheduledCents(a, month(cut + k)));
        expect(steps.reduce((s, x) => s + x, 0)).toBe(doc.leftCents);
        expect(steps.slice(doc.monthsLeft)).toEqual([0, 0]);
        const onLine = input.accumulatedCents === doc.straightLineCents;
        for (const [k, step] of steps.slice(0, doc.monthsLeft).entries()) {
          if (onLine) expect(scheduledCents(a, month(cut + k + 1))).toBe(straightLine(a, monthsInService(input.acquiredOn, month(cut + k + 1)))); // as if bought
          else expect([Math.floor(doc.leftCents / doc.monthsLeft), Math.ceil(doc.leftCents / doc.monthsLeft)]).toContain(step);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('whenever the runs fall after the cut-over, their charges add up to exactly what was left, down to the residual value', async () => {
    await setCutover(); // the arbitrary acquires before this cut-over date
    const permissions = new Set(['acc.backdate', ...['create', 'post', 'cancel'].flatMap((a) => [`acc.opening.${a}`, `fa.depr.${a}`])]);
    await fc.assert(
      fc.asyncProperty(
        fc.array(openingAssetDoc.arbitrary(env.db), { minLength: 1, maxLength: 3 }),
        fc.array(fc.integer({ min: 1, max: 18 }), { minLength: 1, maxLength: 4 }), // months between runs, in turn
        fc.boolean(), // a run for the cut-over month itself
        async (inputs, gaps, septemberRun) => {
          const t = await createTestEnv();
          const actor = { userId: (await setCutover(t, await t.as('accountant'))).userId, permissions };
          const e = { db: t.db, clock: t.clock };
          const assets = inputs.map((input) => {
            const { id } = postDocument(e, openingAssetDoc, actor, { input, expectedTotalCents: input.costCents, businessDate: CUTOVER });
            const doc = openingAssetDoc.load(t.db, id);
            expect(openingAssetDoc.toInput(doc)).toEqual(input);
            return { id, doc };
          });
          const tryRun = (m: string) => {
            try {
              postDocument(e, depreciationDoc, actor, { input: { month: m }, expectedTotalCents: previewDocument(e, depreciationDoc, actor, { month: m }).totalCents });
            } catch (err) {
              if (!(err instanceof AppError && err.code === 'VALIDATION')) throw err; // nothing to charge that month
            }
          };
          let n = SEPTEMBER_2026;
          if (septemberRun) tryRun(month(n)); // the clock is still 2026-09-28
          const last = n + Math.max(...assets.map((a) => a.doc.monthsLeft));
          for (let i = 0; n <= last; i++) {
            n += gaps[i % gaps.length]!;
            t.clock.set(`${month(n)}-25T02:00:00Z`);
            tryRun(month(n));
          }
          const register = assetRegister(t.db);
          for (const { id, doc } of assets) {
            const charged = t.db
              .prepare(
                `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS cents, MIN(j.business_date) AS first FROM journal_lines l JOIN journals j ON j.id = l.journal_id
                 JOIN documents d ON d.id = j.source_id WHERE d.doc_type = 'fa.depreciation' AND l.party_id = ?`,
              )
              .get(id) as { cents: number; first: string | null };
            expect(charged.cents).toBe(doc.leftCents);
            if (doc.leftCents > 0) expect(charged.first! > '2026-09-30').toBe(true); // nothing in the cut-over month
            expect(t.db.prepare('SELECT COALESCE(SUM(charge_cents), 0) FROM fa_opening_depreciation_lines WHERE asset_id = ?').pluck().get(id)).toBe(doc.leftCents);
            expect(register.find((r) => r.id === id)).toMatchObject({ status: 'fully depreciated', accumulatedCents: doc.costCents - doc.residualCents, bookValueCents: doc.residualCents });
          }
          noBrokenInvariants(t);
        },
      ),
      { numRuns: 12 },
    );
  });
});
