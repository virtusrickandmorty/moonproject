/**
 * Government loans (PLAN D5 PAY-RUN 2404/2405, E11, F3): the register and its rules, the payroll deduction once a month
 * (on the first run whose period ends on or after the 16th), a skipped month, a loan ending, net pay too small, the
 * payslip, and the remittance paying the month's contributions and loans together. Figures worked out by hand from F1
 * and F3. Made-up people and loan numbers only.
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { tx } from '../../../platform/db/driver.ts';
import { remittanceDoc } from '../../STAT/doctypes/remittance.ts';
import { schemeCheck } from '../../STAT/ledger.ts';
import type { MonthLists } from '../../STAT/lists.ts';
import { runDoc } from '../doctypes/run.ts';
import { listLoans, registerLoan, stopLoan, updateLoan } from '../loans.ts';
import { codes, fails, journal, partyBalance, world } from './world.ts';

type World = Awaited<ReturnType<typeof world>>;
const loan = (w: World, employeeId: string, o: { kind?: string; loanNo?: string; amortizationCents: number; firstMonth: string; lastMonth: string }) =>
  tx(w.db, () => registerLoan(w.db, { employeeId, kind: 'SSS_SALARY', loanNo: `LN-${Math.random().toString().slice(2, 10)}`, ...o }, w.who())).id;
const clean = (w: World) => expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);

/** Example C (₱15,000 a month, office, semi-monthly) with an SSS salary loan of ₱1,500 a month from September. */
async function carlaWithLoan(amortizationCents = 150_000, lastMonth = '2027-08') {
  const w = await world('2026-09-15');
  const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
  const sss = loan(w, carla, { kind: 'SSS_SALARY', loanNo: '0301-555-01', amortizationCents, firstMonth: '2026-09', lastMonth });
  return { w, carla, sss };
}

describe('a semi-monthly employee with an SSS loan (F3 example C)', () => {
  it('cutoff 1 takes no loan; cutoff 2 (ends on the 30th) credits 2404 with the month tag and pays that much less; the payslip shows what is left', async () => {
    const { w, carla, sss } = await carlaWithLoan();
    const c1 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    // Exactly G-24's cutoff 1: no loan before the 16th.
    expect(journal(w.env, c1.id)).toEqual(['2110 Cr 6,600.00', '2111 Cr 625.00', '2401 Cr 1,135.00', '2402 Cr 750.00', '2403 Cr 300.00', '6101 Dr 7,500.00', '6102 Dr 1,285.00', '6103 Dr 625.00']);
    w.at('2026-09-30');
    const c2 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    // G-24's cutoff 2 with the loan: net 7,075.00 − 1,500.00 = 5,575.00; Cr 2404 1,500.00. Dr 8,945.00 = Cr 8,945.00.
    expect(journal(w.env, c2.id)).toEqual(['2110 Cr 5,575.00', '2111 Cr 625.00', '2401 Cr 1,145.00', '2403 Cr 100.00', '2404 Cr 1,500.00', '6101 Dr 7,500.00', '6102 Dr 820.00', '6103 Dr 625.00']);
    const memo = w.db.prepare(`SELECT l.memo FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND a.code = '2404'`).pluck().get(c2.id);
    expect(memo).toBe('SSS loan 2026-09');
    expect(partyBalance(w.env, '2404', carla)).toBe(-150_000);

    const [e] = runDoc.load(w.db, c2.id).employees;
    expect([e!.netCents, e!.loanCents, e!.loans.map((l) => [l.loanNo, l.amountCents, l.balanceAfterCents])]).toEqual([557_500, 150_000, [['0301-555-01', 150_000, 1_650_000]]]);
    const owner = await w.env.as('owner');
    const slip = (await owner.get(`/api/pay/runs/${c2.id}/payslips`)).json();
    expect(slip.employees[0].loans[0]).toMatchObject({ kind: 'SSS_SALARY', amountCents: 150_000, balanceAfterCents: 1_650_000 });
    // The release pays the net pay after the loan.
    expect((await owner.get(`/api/pay/runs/${c2.id}/release-status`)).json()[0].netCents).toBe(557_500);
    expect(listLoans(w.db, {}, '2026-09-30').find((l) => l.id === sss)).toMatchObject({ scheduledCents: 1_800_000, deductedCents: 150_000, leftCents: 1_650_000, status: 'running' });

    // Cancelled, the loan's month is open again.
    w.cancel(runDoc, c2.id);
    expect(partyBalance(w.env, '2404', carla)).toBe(0);
    expect(listLoans(w.db, {}, '2026-09-30')[0]!.deductedCents).toBe(0);
    clean(w);
  });

  it('a skipped month (₱0 with a note) credits nothing and leaves the loan as it was; the next month deducts again', async () => {
    const { w, carla, sss } = await carlaWithLoan();
    w.at('2026-09-30');
    const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart: '2026-09-16', loans: [{ loanId: sss, amountCents: 0, reason: 'SSS agreed to skip September (made up)' }] };
    const run = w.record(runDoc, input);
    expect(journal(w.env, run.id)).not.toContain('2404 Cr 1,500.00');
    expect(runDoc.toInput(runDoc.load(w.db, run.id))).toEqual(input);
    expect(partyBalance(w.env, '2404', carla)).toBe(0);
    expect(listLoans(w.db, {}, '2026-09-30')[0]!.leftCents).toBe(1_800_000);
    w.at('2026-10-31');
    const oct = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-16' });
    expect(journal(w.env, oct.id)).toContain('2404 Cr 1,500.00');
    // Changed on a run: ₱1,000 this month, with the reason kept.
    w.at('2026-11-30');
    const nov = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-11-16', loans: [{ loanId: sss, amountCents: 100_000, reason: 'Half this month, rest later' }] });
    expect(journal(w.env, nov.id)).toContain('2404 Cr 1,000.00');
    expect(partyBalance(w.env, '2404', carla)).toBe(-250_000);
    clean(w);
  });

  it('a loan ending: its last month deducts, the month after does not, and a deduction typed then is refused', async () => {
    const { w, sss } = await carlaWithLoan(100_000, '2026-10');
    w.at('2026-09-30');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    w.at('2026-10-31');
    expect(journal(w.env, w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-16' }).id)).toContain('2404 Cr 1,000.00');
    expect(listLoans(w.db, { status: 'all' }, '2026-10-31')[0]).toMatchObject({ leftCents: 0, status: 'ended' });
    expect(listLoans(w.db, {}, '2026-10-31')).toEqual([]);
    w.at('2026-11-30');
    const input = { payGroup: 'SEMI_MONTHLY' as const, periodStart: '2026-11-16' };
    expect(journal(w.env, w.record(runDoc, input).id).some((l) => l.startsWith('2404'))).toBe(false);
    w.at('2026-12-31');
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', loans: [{ loanId: sss, amountCents: 100_000, reason: 'One more month' }] }).issues)).toEqual(['NO_MONTHS_LEFT']);
    clean(w);
  });

  it('refusals on a run: deducted twice in a month, more than is left, not started yet, someone not in the run', async () => {
    const { w, carla, sss } = await carlaWithLoan();
    w.at('2026-09-30');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    const later = loan(w, carla, { kind: 'SSS_CALAMITY', amortizationCents: 50_000, firstMonth: '2026-12', lastMonth: '2027-05' });
    w.at('2026-10-15');
    const one = (loanId: string, amountCents: number) => codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-01', loans: [{ loanId, amountCents, reason: 'Typed on the run' }] }).issues);
    expect(one(sss, 1_700_000)).toEqual(['LOAN_OVER']);
    expect(one(later, 50_000)).toEqual(['LOAN_NOT_STARTED']);
    // Typed on the Oct 1–15 run, the month's amortization is taken there; the Oct 16–31 run then takes no more.
    const r1 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-01', loans: [{ loanId: sss, amountCents: 150_000, reason: 'Deduct early this month' }] });
    expect(journal(w.env, r1.id)).toContain('2404 Cr 1,500.00');
    w.at('2026-10-31');
    expect(journal(w.env, w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-16' }).id).some((l) => l.startsWith('2404'))).toBe(false);
    w.at('2026-11-30');
    const other = w.person('Oscar Iba', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    const his = loan(w, other, { kind: 'HDMF_MPL', amortizationCents: 90_000, firstMonth: '2026-11', lastMonth: '2027-10' });
    expect(codes(w.preview(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-11-16', skip: [{ employeeId: other, reason: 'On leave (made up)' }], loans: [{ loanId: his, amountCents: 90_000, reason: 'Typed on the run' }] }).issues)).toEqual(['NOT_IN_RUN']);
    clean(w);
  });
});

describe('a weekly employee with a Pag-IBIG loan', () => {
  it('the week ending on the 17th (the first ending on or after the 16th) deducts it; the next week does not', async () => {
    const w = await world('2026-10-05');
    const ben = w.person('Ben Lingguhan', { payType: 'daily', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000 });
    loan(w, ben, { kind: 'HDMF_MPL', loanNo: '8000-1234-01', amortizationCents: 90_000, firstMonth: '2026-10', lastMonth: '2028-09' });
    const week = (monday: number) => Array.from({ length: 6 }, (_, i) => ({ employeeId: ben, date: `2026-10-${String(monday + i).padStart(2, '0')}`, status: 'present' }));
    w.at('2026-10-10');
    w.attend(week(5));
    const w1 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-10-05' });
    // 6 × 600 = 3,600.00; SSS on the minimum MSC (250 / 500 / 10); PhilHealth on 600 × 313/12 = 15,650 (391.25 each); Pag-IBIG 72 each; no tax.
    expect(journal(w.env, w1.id)).toEqual(['2110 Cr 2,886.75', '2111 Cr 300.00', '2401 Cr 760.00', '2402 Cr 782.50', '2403 Cr 144.00', '5202 Dr 3,600.00', '5203 Dr 973.25', '5204 Dr 300.00']);
    w.at('2026-10-17');
    w.attend(week(12));
    const w2 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-10-12' });
    // Month to date 7,200: SSS MSC 7,000 (EE 350, ER 700, EC 10) less what week 1 took = 100 / 200 / 0; Pag-IBIG 144 − 72 = 72 each;
    // the loan 900.00; net 3,600 − 100 − 72 − 900 = 2,528.00. Dr 4,172.00 = Cr 4,172.00.
    expect(journal(w.env, w2.id)).toEqual(['2110 Cr 2,528.00', '2111 Cr 300.00', '2401 Cr 300.00', '2403 Cr 144.00', '2405 Cr 900.00', '5202 Dr 3,600.00', '5203 Dr 272.00', '5204 Dr 300.00']);
    w.at('2026-10-24');
    w.attend(week(19));
    const w3 = w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-10-19' });
    expect(journal(w.env, w3.id).some((l) => l.startsWith('2405'))).toBe(false);
    expect(partyBalance(w.env, '2405', ben)).toBe(-90_000);
    clean(w);
  });
});

describe('net pay too small', () => {
  it('deducts what the pay allows after shares and tax, warns, and keeps the rest owed on the loan', async () => {
    const w = await world('2026-09-30');
    const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
    const id = loan(w, ana, { kind: 'SSS_SALARY', amortizationCents: 500_000, firstMonth: '2026-09', lastMonth: '2027-02' });
    w.attend(['16', '17'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' })));
    const input = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-09-16' };
    expect(codes(w.preview(runDoc, input).issues, 'warning')).toContain('LOAN_REDUCED');
    const run = w.record(runDoc, input);
    const [e] = runDoc.load(w.db, run.id).employees;
    const shares = e!.sssEeCents + e!.phicEeCents + e!.hdmfEeCents + e!.wtaxCents;
    expect(e!.netCents).toBe(0);
    expect(e!.loans[0]).toMatchObject({ dueCents: 500_000, amountCents: 110_000 - shares, balanceAfterCents: 3_000_000 - (110_000 - shares) });
    expect(partyBalance(w.env, '2404', ana)).toBe(-(110_000 - shares));
    expect(journal(w.env, run.id).some((l) => l.startsWith('2110'))).toBe(false);
    expect(listLoans(w.db, {}, '2026-09-30').find((l) => l.id === id)!.leftCents).toBe(3_000_000 - (110_000 - shares));
    clean(w);
  });
});

describe('the remittance pays the month’s contributions and loans of the agency (STAT)', () => {
  it('SSS for September: 2,280.00 contributions + 1,500.00 loan in one REM-, in part and then the rest; the lists and the check include the loan', async () => {
    const { w, carla } = await carlaWithLoan();
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
    w.at('2026-09-30');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    w.at('2026-10-05');
    const owner = await w.env.as('owner');
    const lists = (await owner.get('/api/stat/months/2026-09')).json() as MonthLists;
    expect([lists.sss.totalCents, lists.sssLoans.totalCents, lists.sssLoans.rows.map((r) => [r.name, r.loanNo, r.kindLabel, r.totalCents])]).toEqual([
      228_000, 150_000, [['Carla Opisina', '0301-555-01', 'SSS salary loan', 150_000]],
    ]);
    expect(lists.check.find((c) => c.scheme === 'SSS')).toMatchObject({ recordedCents: 378_000, loanRecordedCents: 150_000, remittedCents: 0, balanceCents: 378_000 });
    expect(lists.hdmfLoans.totalCents).toBe(0);

    const bdo = cashPlaceId(w.db, '1111');
    const base = { scheme: 'SSS' as const, month: '2026-09', cashPlaceId: bdo, reference: 'PRN 1234567' };
    expect(codes(w.preview(remittanceDoc, { ...base, amountCents: 378_001 }).issues)).toEqual(['OVER']);
    // Half: spread in proportion, 1,140.00 of contributions and 750.00 of the loan.
    const half = w.record(remittanceDoc, { ...base, amountCents: 189_000 });
    expect(journal(w.env, half.id)).toEqual(['1111 Cr 1,890.00', '2401 Dr 1,140.00', '2404 Dr 750.00']);
    expect(schemeCheck(w.db, 'SSS', '2026-09')).toMatchObject({ remittedCents: 189_000, loanRemittedCents: 75_000, balanceCents: 189_000 });
    const rest = w.record(remittanceDoc, { ...base, amountCents: 189_000, reference: 'PRN 1234568' });
    expect(journal(w.env, rest.id)).toEqual(['1111 Cr 1,890.00', '2401 Dr 1,140.00', '2404 Dr 750.00']);
    expect([partyBalance(w.env, '2401', carla), partyBalance(w.env, '2404', carla)]).toEqual([0, 0]);
    expect(remittanceDoc.load(w.db, rest.id).lines).toEqual([{ employeeId: carla, name: 'Carla Opisina', payableCents: 189_000, amountCents: 189_000, loanPayableCents: 75_000, loanAmountCents: 75_000 }]);
    expect(schemeCheck(w.db, 'SSS', '2026-09').balanceCents).toBe(0);
    // Cancel mirrors it; the loan part is payable again.
    w.cancel(remittanceDoc, rest.id);
    expect(journal(w.env, rest.id, 'reversal')).toEqual(['1111 Dr 1,890.00', '2401 Cr 1,140.00', '2404 Cr 750.00']);
    expect(partyBalance(w.env, '2404', carla)).toBe(-75_000);
    clean(w);
  });
});

describe('the register (If-Match, audit, refusals)', () => {
  it('registers, changes and stops a loan through the API; the encoder may not; a loan with no months left is refused', async () => {
    const w = await world('2026-10-05');
    const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
    const acc = await w.env.as('accountant');
    const body = { employeeId: carla, kind: 'HDMF_CALAMITY', loanNo: '8100-0000-77', amortizationCents: 60_000, firstMonth: '2026-10', lastMonth: '2028-09' };
    const enc = await w.env.as('encoder');
    expect((await enc.post('/api/pay/loans', body)).statusCode).toBe(403);
    expect((await enc.get('/api/pay/loans')).statusCode).toBe(403);
    expect((await acc.post('/api/pay/loans', { ...body, lastMonth: '2026-09', firstMonth: '2026-01' })).json().code).toBe('NO_MONTHS_LEFT');
    expect((await acc.post('/api/pay/loans', { ...body, lastMonth: '2026-09' })).json().code).toBe('BAD_MONTH');
    const made = (await acc.post('/api/pay/loans', body)).json();
    expect(made).toMatchObject({ agency: 'HDMF', version: 1, scheduledCents: 60_000 * 24, leftCents: 60_000 * 24, status: 'running' });
    expect((await acc.post('/api/pay/loans', body)).json().code).toBe('DUPLICATE_LOAN');
    expect((await acc.put(`/api/pay/loans/${made.id}`, { amortizationCents: 65_000 })).statusCode).toBe(428);
    expect((await acc.put(`/api/pay/loans/${made.id}`, { amortizationCents: 65_000 }, { 'if-match': '7' })).json().code).toBe('VERSION_CHANGED');
    const changed = (await acc.put(`/api/pay/loans/${made.id}`, { amortizationCents: 65_000 }, { 'if-match': '1' })).json();
    expect([changed.amortizationCents, changed.version]).toEqual([65_000, 2]);
    expect((await enc.put(`/api/pay/loans/${made.id}`, { amortizationCents: 1 }, { 'if-match': '2' })).statusCode).toBe(403);

    // Deducted in October, it cannot be stopped from October or moved past October.
    w.at('2026-10-31');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-10-16' });
    const who = w.who();
    fails(() => tx(w.db, () => stopLoan(w.db, made.id, '2', { fromMonth: '2026-10', reason: 'Paid off at the Pag-IBIG office' }, who)), 'DEDUCTED');
    fails(() => tx(w.db, () => updateLoan(w.db, made.id, '2', { firstMonth: '2026-11' }, who)), 'DEDUCTED');
    const acc2 = await w.env.as('accountant'); // a new day: sign in again
    const stopped = (await acc2.post(`/api/pay/loans/${made.id}/stop`, { fromMonth: '2026-11', reason: 'Paid off at the Pag-IBIG office' }, { 'if-match': '2' })).json();
    expect([stopped.stoppedFrom, stopped.status, stopped.version]).toEqual(['2026-11', 'running', 3]);
    expect((await acc2.put(`/api/pay/loans/${made.id}`, { note: 'x' }, { 'if-match': '3' })).json().code).toBe('STOPPED');
    w.at('2026-11-30');
    expect(journal(w.env, w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-11-16' }).id).some((l) => l.startsWith('2405'))).toBe(false);
    const actions = w.db.prepare(`SELECT action FROM audit_log WHERE entity_type = 'pay.gov_loan' ORDER BY seq`).pluck().all();
    expect(actions).toEqual(['pay.gov_loan.register', 'pay.gov_loan.update', 'pay.gov_loan.stop']);
    expect(() => w.db.prepare('DELETE FROM pay_gov_loans').run()).toThrow(/NO_DELETE/);
  });
});
