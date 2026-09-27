/**
 * Payroll (PLAN E11, F3, D5 PAY-RUN / PAY-REL / CA-GIVE): goldens to the centavo (G-23, G-24, daily MWE, holidays and
 * the tax path, weekly piece pay), paid once (N-11), corrections into the next run, G-29 cancel order, and the API rules.
 * Every figure below is worked out by hand from F1 and F3. Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { AppError, formatPesos } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { addEmployee, addPay, type TestPay } from '../../EMP/tests/fixture.ts';
import { saveAttendance } from '../../EMP/time.ts';
import { advanceSchedule } from '../../CA/public.ts';
import { advanceDoc } from '../../CA/doctypes/advance.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';
import { unpaidAssignments } from '../../PRD/public.ts';
import { runDoc } from '../doctypes/run.ts';
import { releaseDoc } from '../doctypes/release.ts';

/** A test world at a Manila date: users, an actor with every permission, and helpers to record through the engine. */
async function world(date: string) {
  const env = await createTestEnv(`${date}T02:00:00Z`); // 10:00 in Manila
  const userId = createUser(env.db, `payroll-${date}`, ['owner']);
  const actor = { userId, permissions: new Set(env.deps.registry.permissions().map((p) => p.key)) };
  const e = { db: env.db, clock: env.clock };
  const record = <I>(def: DocTypeDef<I>, input: I) => postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input).totalCents });
  const preview = <I>(def: DocTypeDef<I>, input: I) => previewDocument(e, def, actor, input);
  const cancel = (def: DocTypeDef, id: string) => cancelDocument(e, def, actor, id, 'Recorded by mistake, redo it');
  const who = () => ({ userId, at: stamp(env.clock), today: today(env.clock), can: () => true });
  const attend = (days: object[]) => tx(env.db, () => saveAttendance(env.db, { days }, who()));
  const person = (name: string, pay: TestPay, o: Parameters<typeof addEmployee>[2] = {}) => {
    const id = addEmployee(env.db, name, o);
    addPay(env.db, id, userId, { effectiveFrom: o.hireDate ?? '2025-01-06', ...pay });
    return id;
  };
  const at = (d: string) => env.clock.set(`${d}T02:00:00Z`);
  return { env, db: env.db, userId, actor, record, preview, cancel, attend, person, at, who };
}

/** The document's journal (original), per account: "2110 Cr 7,075.00", sorted by account code. */
function journal(env: TestEnv, documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? GROUP BY a.code ORDER BY a.code`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number }[];
  return rows.flatMap((r) => [...(r.dr ? [`${r.code} Dr ${formatPesos(r.dr)}`] : []), ...(r.cr ? [`${r.code} Cr ${formatPesos(r.cr)}`] : [])]);
}
const partyBalance = (env: TestEnv, code: string, employeeId: string) =>
  env.db
    .prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ? AND l.party_type = 'employee' AND l.party_id = ?`)
    .pluck()
    .get(code, employeeId) as number;
const codes = (issues: { code: string; level: string }[], level = 'error') => issues.filter((i) => i.level === level).map((i) => i.code);
const fails = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect((e as AppError).code).toBe(code);
    return (e as AppError).details;
  }
  throw new Error(`expected ${code}`);
};

describe('G-24: monthly office staff ₱15,000, semi-monthly (F3 example C)', () => {
  it('cutoff 1 takes PhilHealth for the month; cutoff 2 trues SSS and Pag-IBIG up to the month; the 13th month accrues each run', async () => {
    const w = await world('2026-09-15');
    const clerk = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    const c1 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    expect(c1.number).toBe('PAY-000001');
    // SSS on ₱7,500 (EE 375, ER 750, EC 10); PhilHealth 5% of ₱15,000 split (375/375); Pag-IBIG 2% of ₱7,500 (150/150).
    expect(journal(w.env, c1.id)).toEqual(['2110 Cr 6,600.00', '2111 Cr 625.00', '2401 Cr 1,135.00', '2402 Cr 750.00', '2403 Cr 300.00', '6101 Dr 7,500.00', '6102 Dr 1,285.00', '6103 Dr 625.00']);

    w.at('2026-09-30');
    const c2 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    // PLAN I2 G-24 line for line, plus the ACC-18 accrual (Dr 6103 / Cr 2111 625.00) that D5 PAY-RUN and F3 add each run.
    expect(journal(w.env, c2.id)).toEqual(['2110 Cr 7,075.00', '2111 Cr 625.00', '2401 Cr 1,145.00', '2403 Cr 100.00', '6101 Dr 7,500.00', '6102 Dr 820.00', '6103 Dr 625.00']);
    expect(partyBalance(w.env, '2110', clerk)).toBe(-(660_000 + 707_500));

    // The later run of the month was worked out on top of cutoff 1, so it goes first.
    expect((fails(() => w.cancel(runDoc, c1.id), 'HAS_DEPENDENTS') as { number: string }[]).map((d) => d.number)).toEqual(['PAY-000002']);
    w.cancel(runDoc, c2.id);
    w.cancel(runDoc, c1.id);
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('with the 13th-month accrual switched off (ACC-18), cutoff 2 is exactly G-24', async () => {
    const w = await world('2026-09-15');
    w.db.prepare(
      `INSERT INTO pay_rules (effective_from, minimum_wage_cents, reg_holiday_off_bp, reg_holiday_worked_bp, reg_holiday_rest_bp, special_worked_bp, special_rest_bp, rest_day_worked_bp,
         ot_ordinary_bp, ot_premium_bp, accrue_13th, min_net_pay_cents, source, created_at) VALUES ('2026-09-01', 55000, 10000, 20000, 26000, 13000, 15000, 13000, 12500, 13000, 0, 0, 'Test: expense when paid', 'x')`,
    ).run();
    w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    w.at('2026-09-30');
    const c2 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    expect(journal(w.env, c2.id)).toEqual(['2110 Cr 7,075.00', '2401 Cr 1,145.00', '2403 Cr 100.00', '6101 Dr 7,500.00', '6102 Dr 820.00']);
  });
});

describe('monthly staff hired mid-period, with an absence', () => {
  it('₱18,000 a month hired 10 August: 6 of 15 days of the half-month, less one day at the equivalent daily rate', async () => {
    const w = await world('2026-08-15');
    const dee = w.person('Dee Bago', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_800_000 }, { costCentre: 'office', hireDate: '2026-08-10' });
    w.attend([{ employeeId: dee, date: '2026-08-12', status: 'absent' }]);
    const run = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-08-01' });
    const [e] = runDoc.load(w.db, run.id).employees;
    // ₱9,000 × 6/15 = 3,600.00; the day off at ₱18,000 × 12 / 313 = 690.10. SSS minimum MSC; PhilHealth on the monthly rate (450 each);
    // Pag-IBIG 2% of 2,909.90 (58.20 each); no tax; 13th month 2,909.90 / 12 = 242.49.
    expect(e!.lines.map((l) => [l.description, l.amountCents])).toEqual([['Absent, no work no pay', -69_010], ['Half-month salary, 6 of 15 days', 360_000]]);
    expect(journal(w.env, run.id)).toEqual(['2110 Cr 2,151.70', '2111 Cr 242.49', '2401 Cr 760.00', '2402 Cr 900.00', '2403 Cr 116.40', '6101 Dr 2,909.90', '6102 Dr 1,018.20', '6103 Dr 242.49']);
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-08-01' }).issues, 'warning')).toEqual(['PRORATED']);
  });
});

describe('G-23 and G-29: a daily MWE with a cash advance, released, then cancelled in order', () => {
  it('CA ₱2,000 given, ₱1,000 deducted; release; the run waits for its release; cancels restore the CA balance', async () => {
    const w = await world('2026-09-30');
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    const cash = cashPlaceId(w.db, '1101');
    const ca = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 });
    expect(journal(w.env, ca.id)).toEqual(['1101 Cr 2,000.00', '1210 Dr 2,000.00']);
    w.attend([...['16', '17', '18', '19', '22', '23', '24', '25', '26'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' })), { employeeId: ana, date: '2026-09-21', status: 'present', otMinutes: 120 }]);

    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' });
    // 10 days × ₱550 = 5,500.00; 2 h OT at 125% of ₱68.75 = 171.88. SSS on ₱5,671.88 → MSC 5,500 (EE 275, ER 550, EC 10);
    // PhilHealth on ₱550 × 313/12 = 14,345.83 (358.65 each); Pag-IBIG 2% (113.44 each); an MWE pays no tax; CA 1,000.00.
    expect(journal(w.env, run.id)).toEqual(['1210 Cr 1,000.00', '2110 Cr 3,924.79', '2111 Cr 458.33', '2401 Cr 835.00', '2402 Cr 717.30', '2403 Cr 226.88', '5202 Dr 5,671.88', '5203 Dr 1,032.09', '5204 Dr 458.33']);
    expect([partyBalance(w.env, '1210', ana), advanceSchedule(w.db, ana).outstandingCents]).toEqual([100_000, 100_000]); // G-23: CA ledger = GL 1210
    const slip = runDoc.load(w.db, run.id).employees[0]!;
    expect(slip.lines.map((l) => [l.description, l.qty, l.amountCents])).toEqual([['Days worked', 10_000, 550_000], ['Overtime (125% of the hourly rate)', 120, 17_188]]);
    expect(fails(() => w.cancel(advanceDoc, ca.id), 'HAS_DEPENDENTS')).toEqual([{ id: run.id, number: 'PAY-000001' }]);

    const rel = w.record(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: 392_479 }] });
    expect(journal(w.env, rel.id)).toEqual(['1101 Cr 3,924.79', '2110 Dr 3,924.79']);
    expect(codes(w.preview(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: 392_479 }] }).issues)).toEqual(['RELEASED']);

    // G-29: blocked until the release is cancelled; after both mirrors the CA balance is back.
    expect((fails(() => w.cancel(runDoc, run.id), 'HAS_DEPENDENTS') as { number: string }[]).map((d) => d.number)).toEqual(['POUT-000001']);
    w.cancel(releaseDoc, rel.id);
    w.cancel(runDoc, run.id);
    expect([partyBalance(w.env, '1210', ana), partyBalance(w.env, '2110', ana)]).toEqual([200_000, 0]);
    w.cancel(advanceDoc, ca.id);
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('holidays, rest day, overtime, SIL and the tax path (F1)', () => {
  it('₱1,000/day, not an MWE, 16–31 August: special day worked, rest day worked, SIL, regular holiday off, a half day', async () => {
    const w = await world('2026-08-31');
    const ben = w.person('Ben Gawa', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 100_000 }, { hireDate: '2024-06-03' });
    const day = (d: string, status: string, otMinutes?: number) => ({ employeeId: ben, date: `2026-08-${d}`, status, ...(otMinutes ? { otMinutes } : {}) });
    w.attend([
      ...['17', '18', '19', '20', '25', '26', '27', '28', '29'].map((d) => day(d, 'present')),
      day('21', 'holiday_worked', 60), day('22', 'half_day'), day('23', 'rest_day_worked'), day('24', 'leave'), day('31', 'holiday_off'),
    ]);
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-08-16' });
    const [e] = runDoc.load(w.db, run.id).employees;
    expect(e!.lines.map((l) => [l.description, l.qty, l.amountCents])).toEqual([
      ['Days worked', 9_500, 950_000],
      ['Special day worked (130%)', 1_000, 130_000],
      ['Overtime (169% of the hourly rate)', 60, 21_125], // 130% × 130% for OT on a special day
      ['Rest day worked (130%)', 1_000, 130_000],
      ['Paid leave (SIL)', 1_000, 100_000],
      ['Regular holiday, not worked (100%)', 1_000, 100_000],
    ]);
    // Gross 14,311.25. SSS MSC 14,500 (725 / 1,450 / EC 10); PhilHealth on 26,083.33 (652.08 each); Pag-IBIG on 10,000 (200 each);
    // tax on 14,311.25 − 1,577.08 = 12,734.17 → 15% over 10,417 = 347.58; 13th month on basic 9,500 + SIL 1,000 = 875.00.
    expect([e!.grossCents, e!.taxableCents, e!.wtaxCents, e!.netCents]).toEqual([1_431_125, 1_273_417, 34_758, 1_238_659]);
    expect(journal(w.env, run.id)).toEqual(['2110 Cr 12,386.59', '2111 Cr 875.00', '2310 Cr 347.58', '2401 Cr 2,185.00', '2402 Cr 1,304.16', '2403 Cr 400.00', '5202 Dr 14,311.25', '5203 Dr 2,312.08', '5204 Dr 875.00']);
  });
});

describe('weekly piece pay (F3 example B shape), paid once, corrections next run (N-11, D6)', () => {
  it('pays the week, marks the rows paid, carries a correction and a shortfall into the next run, and cancels in order', async () => {
    const w = await world('2026-09-22');
    const eli = w.person('Eli Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    const cash = cashPlaceId(w.db, '1101');
    const cs = seedCustomers(w.db, w.userId);
    const jo = w.record(jobOrderDoc, { customerId: cs.school, dueInDays: 20, priority: 'normal', paymentTerms: 'full', lines: [{ kind: 'made_to_order', description: 'Team shirt', qty: 50, unitPriceCents: 30_000, discountCents: 0, roster: [] }] }).id;
    tx(w.db, () => setupLine(w.db, jo, 1, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: 'standard' }, w.who()));
    const over = 'Cut earlier by the old shop (made up)';
    w.record(entryDoc, { jobOrderId: jo, stepId: 6, rows: [{ lineNo: 1, employeeId: eli, pieces: 30 }], overCapReason: over }); // ₱40.00 a piece

    w.at('2026-09-26');
    const r1 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-21' });
    // 30 × ₱40 = 1,200.00. SSS minimum MSC 5,000 (250 / 500 / 10); PhilHealth floor ₱10,000 (250 each); Pag-IBIG on ₱1,200 (EE 1% = 12, ER 24).
    expect(journal(w.env, r1.id)).toEqual(['2110 Cr 688.00', '2111 Cr 100.00', '2401 Cr 760.00', '2402 Cr 500.00', '2403 Cr 36.00', '5201 Dr 1,200.00', '5203 Dr 784.00', '5204 Dr 100.00']);
    const piece = w.db.prepare(`SELECT l.ref_doc_id FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journals j ON j.id = l.journal_id WHERE j.source_id = ? AND a.code = '5201'`).pluck().get(r1.id);
    expect(piece).toBe(jo); // piece labor tagged with its job order
    const row = w.db.prepare('SELECT id, pay_run_line_id FROM prd_assignments').get() as { id: string; pay_run_line_id: string };
    expect(w.db.prepare('SELECT assignment_id FROM pay_run_lines WHERE id = ?').pluck().get(row.pay_run_line_id)).toBe(row.id);
    expect(unpaidAssignments(w.db, '2026-12-31', eli)).toEqual([]); // N-11
    const rel = w.record(releaseDoc, { runId: r1.id, employeeIds: [eli], tenders: [{ cashPlaceId: cash, amountCents: 68_800 }] });

    w.at('2026-09-28');
    w.record(entryDoc, { jobOrderId: jo, stepId: 6, rows: [{ lineNo: 1, employeeId: eli, pieces: -2, correctionOf: row.id }, { lineNo: 1, employeeId: eli, pieces: 10 }], overCapReason: over });
    w.at('2026-10-03');
    const r2 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-28' });
    // October: −2 + 10 pieces = 320.00. SSS 250 and PhilHealth 70 of 250 fit; 183.20 of employee shares is carried (EE_SHORT).
    expect(journal(w.env, r2.id)).toEqual(['2111 Cr 26.67', '2401 Cr 760.00', '2402 Cr 320.00', '2403 Cr 6.40', '5201 Dr 320.00', '5203 Dr 766.40', '5204 Dr 26.67']);
    const [e2] = runDoc.load(w.db, r2.id).employees;
    expect([e2!.eeShortCents, e2!.netCents, e2!.lines.map((l) => l.amountCents)]).toEqual([18_320, 0, [-8_000, 40_000]]);
    expect(codes(w.preview(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-21' }).issues)).toEqual(['DUPLICATE_RUN']);

    // G-29: the release first, then the run; its rows are unpaid again and a new run pays them the same way.
    fails(() => w.cancel(runDoc, r1.id), 'HAS_DEPENDENTS');
    w.cancel(releaseDoc, rel.id);
    w.cancel(runDoc, r1.id);
    expect(unpaidAssignments(w.db, '2026-12-31', eli).map((a) => a.pieces)).toEqual([30]);
    const again = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-21' });
    expect(journal(w.env, again.id)).toEqual(journal(w.env, r1.id));
    expect(journal(w.env, r1.id, 'reversal')).toEqual(['2110 Dr 688.00', '2111 Dr 100.00', '2401 Dr 760.00', '2402 Dr 500.00', '2403 Dr 36.00', '5201 Cr 1,200.00', '5203 Cr 784.00', '5204 Cr 100.00']);
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('run rules and the API', () => {
  it('periods, nobody to pay, people not in the run, cash-advance and negative-pay checks, strict input, totals, idempotency, permissions', async () => {
    const w = await world('2026-09-30');
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 50_000 });
    const eli = w.person('Eli Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    w.attend(['21', '22', '23'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' })));
    const semi = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-09-16' };
    const errs = (input: Parameters<typeof runDoc.compute>[0]) => codes(w.preview(runDoc, input).issues);
    expect(errs({ payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-22' })).toEqual(['PERIOD']);
    expect(errs({ payGroup: 'SEMI_DAILY', periodStart: '2026-09-05' })).toEqual(['PERIOD']);
    expect(errs({ payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-28' })).toEqual(['PERIOD_OPEN']);
    expect(errs({ payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' })).toEqual(['NOBODY']);
    expect(errs({ ...semi, lines: [{ employeeId: eli, kind: 'allowance', amountCents: 10_000, reason: 'Transport (made up)' }] })).toEqual(['NOT_IN_RUN']);
    expect(errs({ ...semi, advances: [{ employeeId: ana, amountCents: 1 }] })).toEqual(['CA_OVER']);
    expect(errs({ ...semi, lines: [{ employeeId: ana, kind: 'adjustment', amountCents: -200_000, reason: 'Damaged cloth (made up)' }] })).toEqual(['NEGATIVE_PAY']);
    expect(errs({ ...semi, skip: [{ employeeId: ana, reason: 'On leave the whole period' }] })).toEqual(['NOBODY']);
    const warn = w.preview(runDoc, semi).issues.filter((i) => i.level === 'warning').map((i) => i.code);
    expect(warn).toEqual(['MIN_WAGE']); // ₱500 a day is below the ₱550 minimum (ACC-06b: warn only)

    const acct = await w.env.as('accountant');
    const post = (input: object, expected: number, key = idem()) => acct.post('/api/docs/pay.run/post', { input, expectedTotalCents: expected }, key);
    const gross = w.preview(runDoc, semi).totalCents;
    expect(gross).toBe(150_000);
    for (const extra of [{ periodEnd: '2026-09-30' }, { totalCents: 1 }, { status: 'posted' }, { date: '2026-09-30' }, { netCents: 1 }]) {
      expect((await post({ ...semi, ...extra }, gross)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await post(semi, 1)).json().code).toBe('TOTALS_CHANGED');
    const k = idem();
    const first = (await post(semi, gross, k)).json();
    expect((await post(semi, gross, k)).json().id).toBe(first.id); // N-02
    expect((await post(semi, gross)).json().code).toBe('VALIDATION'); // DUPLICATE_RUN

    const slips = (await acct.get(`/api/pay/runs/${first.id}/payslips`)).json();
    expect(slips.employees[0]).toMatchObject({ name: 'Ana Tahi', grossCents: 150_000, caBalanceAfterCents: 0, ytd: { grossCents: 150_000, wtaxCents: 0 } });
    expect((await acct.get('/api/pay/periods?payGroup=SEMI_DAILY')).json()[0]).toMatchObject({ periodStart: '2026-09-16', periodEnd: '2026-09-30', employees: 1, recorded: { id: first.id } });
    expect((await acct.get('/api/pay/statutory')).json().sss).toMatchObject({ eeBp: 500, erBp: 1_000 });
    expect((await acct.get('/api/pay/runs/to-release')).json().map((r: { number: string }) => r.number)).toEqual(['PAY-000001']);

    const enc = await w.env.as('encoder');
    for (const url of ['/api/docs/pay.run', `/api/pay/runs/${first.id}/payslips`, '/api/pay/statutory']) expect((await enc.get(url)).statusCode, url).toBe(403);
    expect((await enc.post('/api/docs/pay.run/preview', { input: semi })).statusCode).toBe(403);
    expect((await enc.get(`/api/ca/employees/${ana}`)).json()).toMatchObject({ outstandingCents: 0, installmentCents: 0 });
    const prod = await w.env.as('production');
    expect((await prod.post('/api/docs/ca.advance/preview', { input: { employeeId: ana, cashPlaceId: 1, amountCents: 100, installmentCents: 100 } })).statusCode).toBe(403);
    expect(codes(w.preview(advanceDoc, { employeeId: ana, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 100_000, installmentCents: 200_000 }).issues)).toEqual(['INSTALLMENT']);
  });
});
