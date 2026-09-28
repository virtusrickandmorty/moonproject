/**
 * 13th-month pay (PLAN D5 TH13-PAY, E11, F1): goldens to the centavo (a full-year employee, one hired mid-year, one above
 * the ₱90,000 ceiling, accrued more than paid, the accrual switched off), its release (POUT-), the cancel order, a
 * late-December run counted the next year, and the refusals. Every figure is worked out by hand. Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId, idem } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import type { PayGroup } from '../../EMP/public.ts';
import { runDoc } from '../doctypes/run.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { thirteenthDoc, type Thirteenth } from '../doctypes/thirteenth.ts';
import { periodEndOf } from '../run-calc.ts';
import { codes, fails, journal, partyBalance, world } from './world.ts';

type World = Awaited<ReturnType<typeof world>>;
/** Records every semi-monthly run of 2026 whose period ends on or before `last`, each on its period's last day. */
function runsUpTo(w: World, payGroup: PayGroup, last: string, from = '2026-01-01') {
  const ids: string[] = [];
  for (let m = 1; m <= 12; m++) {
    for (const d of ['01', '16']) {
      const start = `2026-${String(m).padStart(2, '0')}-${d}`;
      const end = periodEndOf(payGroup, start)!;
      if (start < from) continue;
      if (end > last) return ids;
      w.at(end);
      ids.push(w.record(runDoc, { payGroup, periodStart: start }).id);
    }
  }
  return ids;
}
const office = { costCentre: 'office' as const };

describe('TH13-PAY goldens', () => {
  it('a full-year employee, one hired mid-year, one above ₱90,000: Dr 2111 what was accrued / Cr 2110 net, Cr 2310 on the part above the ceiling', async () => {
    const w = await world('2026-01-15');
    const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, office);
    const dee = w.person('Dee Bago', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_800_000 }, { hireDate: '2026-07-10' });
    const mia = w.person('Mia Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 12_000_000 }, office);
    const runs = runsUpTo(w, 'SEMI_MONTHLY', '2026-12-15'); // 23 runs, 1 January to 15 December
    expect(runs).toHaveLength(23);

    w.at('2026-12-20');
    const th = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026 });
    expect(th.number).toBe('TH13-000001');
    const byName = Object.fromEntries(thirteenthDoc.load(w.db, th.id).employees.map((e) => [e.name, e]));
    // Carla: 23 half-months × 7,500 = 172,500.00 basic → 14,375.00; each run accrued 625.00 (23 × 625 = 14,375.00).
    expect(byName['Carla Opisina']).toMatchObject({ basicCents: 17_250_000, dueCents: 1_437_500, accruedCents: 1_437_500, amountCents: 1_437_500, wtaxCents: 0, netCents: 1_437_500 });
    expect(byName['Carla Opisina']!.basis).toHaveLength(23);
    // Dee, hired 10 July: 6 of 15 days of the first half-month (3,600.00) + 10 half-months × 9,000 = 93,600.00 → 7,800.00 (= 300.00 + 10 × 750.00 accrued).
    expect(byName['Dee Bago']).toMatchObject({ basicCents: 9_360_000, dueCents: 780_000, accruedCents: 780_000, amountCents: 780_000, netCents: 780_000 });
    // Mia: 23 × 60,000 = 1,380,000.00 → 115,000.00, of which 25,000.00 is above ₱90,000. December's regular taxable pay is
    // 60,000 − SSS 1,750 − PhilHealth 2,500 − Pag-IBIG 200 = 55,550.00; the monthly table on 80,550.00 (12,012.55) less on
    // 55,550.00 (6,318.40) = 5,694.15 withheld.
    expect(byName['Mia Mataas']).toMatchObject({ dueCents: 11_500_000, accruedCents: 11_500_000, taxableCents: 2_500_000, wtaxCents: 569_415, netCents: 10_930_585 });
    expect(journal(w.env, th.id)).toEqual(['2110 Cr 131,480.85', '2111 Dr 137,175.00', '2310 Cr 5,694.15']);
    expect([partyBalance(w.env, '2111', carla), partyBalance(w.env, '2111', dee), partyBalance(w.env, '2111', mia)]).toEqual([0, 0, 0]);
    const runSum = (col: string, id: string) => w.db.prepare(`SELECT SUM(${col}) FROM pay_run_employees WHERE employee_id = ?`).pluck().get(id) as number;
    expect(partyBalance(w.env, '2310', mia)).toBe(-(569_415 + runSum('wtax_cents', mia)));

    // Paid out with the existing payroll release.
    const cash = cashPlaceId(w.db, '1101');
    const rel = w.record(releaseDoc, { runId: th.id, employeeIds: [carla, dee], tenders: [{ cashPlaceId: cash, amountCents: 1_437_500 + 780_000 }] });
    expect(journal(w.env, rel.id)).toEqual(['1101 Cr 22,175.00', '2110 Dr 22,175.00']);
    expect(releaseDoc.load(w.db, rel.id)).toMatchObject({ runNumber: 'TH13-000001', period: '13th month 2026', lines: [{ name: 'Carla Opisina' }, { name: 'Dee Bago' }] });
    expect(codes(w.preview(releaseDoc, { runId: th.id, employeeIds: [carla], tenders: [{ cashPlaceId: cash, amountCents: 1_437_500 }] }).issues)).toEqual(['RELEASED']);
    expect(partyBalance(w.env, '2110', carla)).toBe(-runSum('net_cents', carla)); // the 13th month released; the runs' net pay is not

    // The runs it counted wait for it; it waits for its release (G-29).
    expect((fails(() => w.cancel(runDoc, runs[22]!), 'HAS_DEPENDENTS') as { number: string }[]).map((d) => d.number)).toEqual(['TH13-000001']);
    expect((fails(() => w.cancel(thirteenthDoc, th.id), 'HAS_DEPENDENTS') as { number: string }[]).map((d) => d.number)).toEqual(['POUT-000001']);

    // A late-December run recorded after the payout: its basic pay and accrual go to next year's 13th-month pay.
    w.at('2026-12-31');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16' });
    w.at('2027-01-05');
    const next = w.preview(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2027 });
    expect((next.doc as Thirteenth).employees.find((e) => e.name === 'Carla Opisina')).toMatchObject({ basicCents: 750_000, earlierBasicCents: 750_000, dueCents: 62_500, accruedCents: 62_500 });
    expect(codes(next.issues, 'warning')).toContain('EARLIER_BASIC');
    expect(codes(w.preview(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026 }).issues)).toEqual(['DUPLICATE']);

    w.cancel(releaseDoc, rel.id);
    w.cancel(thirteenthDoc, th.id);
    expect(journal(w.env, th.id, 'reversal')).toEqual(['2110 Dr 131,480.85', '2111 Cr 137,175.00', '2310 Dr 5,694.15']);
    expect(partyBalance(w.env, '2111', carla)).toBe(-(1_437_500 + 62_500));
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('accrued more than paid: the amount changed with a reason, the difference credited back to 6103 / 5204 by cost centre', async () => {
    const w = await world('2026-01-15');
    const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, office);
    const ben = w.person('Ben Gawa', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_200_000 });
    runsUpTo(w, 'SEMI_MONTHLY', '2026-12-15');
    w.at('2026-12-18');
    const input = {
      payGroup: 'SEMI_MONTHLY' as const, year: 2026,
      amounts: [{ employeeId: carla, amountCents: 1_000_000, reason: 'Part paid in cash on 1 December (made up)' }, { employeeId: ben, amountCents: 1_200_000, reason: 'Rounded up by the owner (made up)' }],
    };
    expect(codes(w.preview(thirteenthDoc, input).issues, 'warning')).toEqual(['BELOW_DUE']);
    const th = w.record(thirteenthDoc, input);
    // Carla accrued 14,375.00 and is paid 10,000.00: Cr 6103 4,375.00. Ben (production) accrued 23 × 500 = 11,500.00 and is paid 12,000.00: Dr 5204 500.00.
    expect(journal(w.env, th.id)).toEqual(['2110 Cr 22,000.00', '2111 Dr 25,875.00', '5204 Dr 500.00', '6103 Cr 4,375.00']);
    expect(thirteenthDoc.load(w.db, th.id).employees.map((e) => [e.name, e.dueCents, e.accruedCents, e.amountCents, e.reason])).toEqual([
      ['Ben Gawa', 1_150_000, 1_150_000, 1_200_000, 'Rounded up by the owner (made up)'],
      ['Carla Opisina', 1_437_500, 1_437_500, 1_000_000, 'Part paid in cash on 1 December (made up)'],
    ]);
    expect(thirteenthDoc.toInput(thirteenthDoc.load(w.db, th.id))).toEqual({ ...input, amounts: [input.amounts[1], input.amounts[0]] });
    expect([partyBalance(w.env, '2111', carla), partyBalance(w.env, '2111', ben)]).toEqual([0, 0]);
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('with the accrual switched off (ACC-18 "expense when paid"), the whole 13th month is expensed when paid; someone left out keeps their runs', async () => {
    const w = await world('2026-09-15');
    w.db.prepare(
      `INSERT INTO pay_rules (effective_from, minimum_wage_cents, reg_holiday_off_bp, reg_holiday_worked_bp, reg_holiday_rest_bp, special_worked_bp, special_rest_bp, rest_day_worked_bp,
         ot_ordinary_bp, ot_premium_bp, accrue_13th, min_net_pay_cents, source, created_at) VALUES ('2026-01-01', 55000, 10000, 20000, 26000, 13000, 15000, 13000, 12500, 13000, 0, 0, 'Test: expense when paid', 'x')`,
    ).run();
    w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, office);
    const ben = w.person('Ben Gawa', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_200_000 });
    runsUpTo(w, 'SEMI_MONTHLY', '2026-11-30', '2026-09-01'); // six runs, September to November
    w.at('2026-12-10');
    const skip = [{ employeeId: ben, reason: 'Paid with his final pay (made up)' }];
    const th = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026, skip });
    // 6 × 7,500 = 45,000.00 → 3,750.00, nothing accrued.
    expect(journal(w.env, th.id)).toEqual(['2110 Cr 3,750.00', '6103 Dr 3,750.00']);
    expect(thirteenthDoc.load(w.db, th.id)).toMatchObject({ skip, employees: [{ name: 'Carla Opisina', accruedCents: 0 }] });
    expect(w.db.prepare('SELECT COUNT(*) FROM pay_thirteenth_basis b JOIN pay_run_employees e ON e.id = b.run_employee_id WHERE e.employee_id = ?').pluck().get(ben)).toBe(0);
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('TH13-PAY rules and the API', () => {
  it('one per group and year, the year, people not in the group, nobody to pay; the encoder and the owner may not record it', async () => {
    const w = await world('2026-01-15');
    const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, office);
    const eli = w.person('Eli Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
    runsUpTo(w, 'SEMI_MONTHLY', '2026-02-28');
    w.at('2026-03-02');
    const input = { payGroup: 'SEMI_MONTHLY' as const, year: 2026 };
    const errs = (i: Parameters<typeof thirteenthDoc.compute>[0]) => codes(w.preview(thirteenthDoc, i).issues);
    expect(errs({ ...input, year: 2024 })).toEqual(['YEAR']);
    expect(errs({ ...input, year: 2027 })).toEqual(['YEAR']);
    expect(errs({ payGroup: 'SEMI_DAILY', year: 2026 })).toEqual(['NOBODY']);
    expect(errs({ payGroup: 'WEEKLY_PIECE', year: 2026 })).toEqual(['NOBODY']); // in the group, but no runs and no accrual
    expect(errs({ ...input, skip: [{ employeeId: eli, reason: 'Not in this group' }] })).toEqual(['NOT_IN_RUN']);
    expect(errs({ ...input, amounts: [{ employeeId: eli, amountCents: 100, reason: 'Not in this group' }] })).toEqual(['NOT_IN_RUN']);
    expect(errs({ ...input, skip: [{ employeeId: carla, reason: 'Paid by hand already' }] })).toEqual(['NOBODY']);

    const acct = await w.env.as('accountant');
    const pre = (await acct.post('/api/docs/pay.thirteenth/preview', { input })).json();
    expect(pre.totalCents).toBe(250_000); // 4 × 7,500 / 12
    for (const extra of [{ totalCents: 1 }, { date: '2026-12-20' }, { netCents: 1 }, { employees: [] }]) {
      expect((await acct.post('/api/docs/pay.thirteenth/post', { input: { ...input, ...extra }, expectedTotalCents: 250_000 }, idem())).statusCode, JSON.stringify(extra)).toBe(400);
    }
    const first = (await acct.post('/api/docs/pay.thirteenth/post', { input, expectedTotalCents: 250_000 }, idem())).json();
    expect(first.number).toBe('TH13-000001');
    const second = await acct.post('/api/docs/pay.thirteenth/post', { input, expectedTotalCents: 0 }, idem());
    expect(second.json().code).toBe('VALIDATION');
    expect(codes(w.preview(thirteenthDoc, input).issues)).toEqual(['DUPLICATE']);
    expect((await acct.get('/api/pay/thirteenth/years')).json()).toEqual({ years: [2026, 2025], recorded: [{ payGroup: 'SEMI_MONTHLY', year: 2026, id: first.id, number: 'TH13-000001' }] });
    expect((await acct.get('/api/pay/runs/to-release')).json()[0]).toMatchObject({ id: first.id, kind: 'thirteenth', periodStart: '2026-01-01', periodEnd: '2026-12-31', dueCents: 250_000 });

    const enc = await w.env.as('encoder');
    expect((await enc.post('/api/docs/pay.thirteenth/preview', { input })).statusCode).toBe(403);
    expect((await enc.post('/api/docs/pay.thirteenth/post', { input, expectedTotalCents: 250_000 }, idem())).statusCode).toBe(403);
    expect((await enc.get('/api/docs/pay.thirteenth')).statusCode).toBe(403);
    const owner = await w.env.as('owner');
    expect((await owner.get(`/api/docs/pay.thirteenth/${first.id}`)).statusCode).toBe(200);
    expect((await owner.post('/api/docs/pay.thirteenth/post', { input: { payGroup: 'WEEKLY_PIECE', year: 2026 }, expectedTotalCents: 0 }, idem())).statusCode).toBe(403);

    // The payslip shows the year's 13th-month accrual and, once recorded, the payout.
    const run = w.db.prepare(`SELECT id FROM documents WHERE doc_type = 'pay.run' ORDER BY number DESC`).pluck().get() as string;
    const slip = (await acct.get(`/api/pay/runs/${run}/payslips`)).json().employees[0];
    expect(slip).toMatchObject({ thirteenthCents: 62_500, ytd: { thirteenthCents: 250_000 }, thirteenthPaid: [{ number: 'TH13-000001', amountCents: 250_000 }] });
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});
