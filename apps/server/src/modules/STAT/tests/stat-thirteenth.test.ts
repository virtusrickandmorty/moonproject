/**
 * K20: a posted 13th-month pay (TH13-, PAY/doctypes/thirteenth.ts) credits 2310 withholding tax for its own month like a
 * payroll run does (PLAN D6). December: the runs' tax and the 13th-month tax above the ₱90,000 ceiling remit together
 * with no variance, and cancelling the 13th-month pay after that remittance warns the way a run's cancel does.
 * Reuses the "Mia Mataas" golden from PAY/tests/thirteenth.test.ts (23 semi-monthly runs to 15 December, ₱120,000 a
 * month, 5,694.15 withheld on the ₱25,000.00 above the ceiling). Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import type { PayGroup } from '../../EMP/public.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { thirteenthDoc } from '../../PAY/doctypes/thirteenth.ts';
import { periodEndOf } from '../../PAY/run-calc.ts';
import { codes, world } from '../../PAY/tests/world.ts';
import { remittanceDoc } from '../doctypes/remittance.ts';
import { payableByEmployee, remittedForRun, schemeCheck } from '../ledger.ts';
import { monthLists } from '../lists.ts';

type World = Awaited<ReturnType<typeof world>>;
/** Every semi-monthly run of 2026 whose period ends on or before `last`, each on its period's last day. */
function runsUpTo(w: World, payGroup: PayGroup, last: string) {
  const ids: string[] = [];
  for (let m = 1; m <= 12; m++) {
    for (const d of ['01', '16']) {
      const start = `2026-${String(m).padStart(2, '0')}-${d}`;
      const end = periodEndOf(payGroup, start)!;
      if (end > last) return ids;
      w.at(end);
      ids.push(w.record(runDoc, { payGroup, periodStart: start }).id);
    }
  }
  return ids;
}

describe('K20: the 13th-month pay in the withholding-tax remittance', () => {
  it('December: the runs’ tax and the 13th-month tax above the ceiling remit together with no variance; the cancel warning; runInvariants clean', async () => {
    const w = await world('2026-01-15');
    const mia = w.person('Mia Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 12_000_000 }, { costCentre: 'office' });
    runsUpTo(w, 'SEMI_MONTHLY', '2026-12-15'); // 23 runs, 1 January to 15 December

    w.at('2026-12-20');
    const th = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026 });
    const th13WtaxCents = 569_415; // the worked example: 5,694.15 on the 25,000.00 above the 90,000.00 ceiling

    const runsWtaxCents = w.db
      .prepare(`SELECT COALESCE(SUM(e.wtax_cents), 0) FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id WHERE e.employee_id = ? AND r.contribution_month = '2026-12'`)
      .pluck()
      .get(mia) as number;
    expect(runsWtaxCents).toBeGreaterThan(0);

    // Before the fix STAT never saw the 13th-month pay's 2310 credit: December's withholding-tax payable is now both.
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ recordedCents: runsWtaxCents + th13WtaxCents, remittedCents: 0, balanceCents: runsWtaxCents + th13WtaxCents });
    expect([...payableByEmployee(w.db, 'WTAX', '2026-12').values()].reduce((s, x) => s + x, 0)).toBe(runsWtaxCents + th13WtaxCents);

    // The 1601-C list ties out too: the 13th-month excess and its tax are folded into Mia's row and the totals.
    const before = monthLists(w.db, '2026-12', false);
    expect(before.tax.taxWithheldCents).toBe(runsWtaxCents + th13WtaxCents);
    expect(before.tax.totalCompensationCents - before.tax.nonTaxableCents).toBe(before.tax.taxableCents);
    expect(before.tax.thirteenthMonthCents).toBe(9_000_000); // item 17: the ₱90,000.00 within the ceiling
    const miaRow = before.tax.rows.find((r) => r.employeeId === mia)!;
    expect(miaRow.taxCents).toBe(runsWtaxCents + th13WtaxCents);

    // The December remittance pays the runs' tax and the 13th-month tax together, with no variance.
    const cash = cashPlaceId(w.db, '1111');
    const rem = w.record(remittanceDoc, { scheme: 'WTAX', month: '2026-12', cashPlaceId: cash, amountCents: runsWtaxCents + th13WtaxCents, reference: 'eFPS 1226-0001' });
    expect(codes(rem.warnings, 'warning')).toEqual([]);
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ recordedCents: runsWtaxCents + th13WtaxCents, remittedCents: runsWtaxCents + th13WtaxCents, balanceCents: 0 });

    // Cancelling the 13th-month pay now would leave December remitted for more than the payrolls and it now show: warned
    // the way remittedForRun warns for a run (D6).
    expect(remittedForRun(w.db, th.id, '2026-12')).toEqual([{ scheme: 'WTAX', label: 'Withholding tax (1601-C)', numbers: [rem.number] }]);

    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});
