/**
 * K23: year-end tax refunds in the withholding-tax remittance (PLAN F3, BIR RR 11-2018). A year-end run refunds
 * over-withheld tax with Dr 2310 for the employee (PAY/doctypes/run.ts), so an employee's 2310 for December can be below
 * zero. The remittance remits the net (tax withheld less refunds) and credits 2310 for each refund; when December's
 * refunds are more than its tax, December has nothing to remit and the excess comes off January's remittance, which
 * settles both months. Built on the PAY year-end goldens (PAY/tests/year-end.test.ts): ₱30,000 a month office staff,
 * January to November before Virtus, December 1–15 withholding 432.45, the tax due for the year 12,090.00.
 * Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { cashPlaceId, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { tx } from '../../../platform/db/driver.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { addPrior } from '../../PAY/prior.ts';
import { codes, world } from '../../PAY/tests/world.ts';
import { remittanceDoc, type RemittanceInput } from '../doctypes/remittance.ts';
import { payableByEmployee, schemeCheck } from '../ledger.ts';
import { monthLists } from '../lists.ts';

type World = Awaited<ReturnType<typeof world>>;

/** The document's journal per line: "2310 Dr 7,090.00 Uri Opisina 'Withholding tax 2026-12'", sorted. */
function journal(env: TestEnv, documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, e.full_name AS name, l.memo FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN emp_employees e ON e.id = l.party_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ?`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number; name: string | null; memo: string }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}${r.name ? ` ${r.name} '${r.memo}'` : ''}`).sort();
}

/**
 * Olga and Uri, ₱30,000 a month, with January to November before Virtus (₱303,050.00 taxable). Olga's old payroll
 * withheld `olgaBefore`, Uri's ₱5,000.00. December: 1–15 as usual (432.45 each), 16–31 with the year-end adjustment.
 * Uri: 5,432.45 withheld before, 12,090.00 due → 6,657.55 more; December 2310 = 432.45 + 6,657.55 = 7,090.00.
 */
async function december(olgaBefore: number) {
  const w = await world('2026-12-01');
  const office = { costCentre: 'office' as const };
  const olga = w.person('Olga Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
  const uri = w.person('Uri Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_000_000 }, office);
  const before = (employeeId: string, wtaxCents: number) =>
    tx(w.db, () =>
      addPrior(w.db, {
        employeeId, year: 2026, source: 'before', grossCents: 33_000_000, benefitsCents: 0, deMinimisCents: 0, sssCents: 1_650_000, phicCents: 825_000, hdmfCents: 220_000,
        otherNontaxCents: 0, taxableCents: 30_305_000, wtaxCents,
      }, w.who()),
    );
  before(olga, olgaBefore);
  before(uri, 500_000);
  w.at('2026-12-15');
  w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-01' });
  w.at('2026-12-31');
  const yearEnd = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-12-16', yearEnd: true });
  const bdo = cashPlaceId(w.db, '1111');
  const rem = (month: string, amountCents: number): RemittanceInput => ({ scheme: 'WTAX', month, cashPlaceId: bdo, amountCents, reference: `eFPS ${month}` });
  return { ...w, olga, uri, yearEnd, rem };
}
const clean = (w: World) => expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
const payable = (w: World, month: string) => Object.fromEntries(payableByEmployee(w.db, 'WTAX', month));

describe('K23: year-end tax refunds in the withholding-tax remittance', () => {
  it('December with one employee over-withheld (a refund bigger than their December tax) and one owing: remitted at the net, no warning; cancel mirrors it', async () => {
    // Olga: 13,000.00 before + 432.45 = 13,432.45 withheld; 12,090.00 due → 1,342.45 refunded, more than her 432.45 of
    // December tax: her December 2310 is 432.45 − 1,342.45 = −910.00. Uri owes 7,090.00. The net is 6,180.00.
    const w = await december(1_300_000);
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: -91_000, [w.uri]: 709_000 });
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({
      recordedCents: 618_000, remittedCents: 0, balanceCents: 618_000, dueCents: 618_000, refundCents: 134_245, refundOpenCents: 91_000, carriedInCents: 0, carriedOutCents: 0, overRemitted: [],
    });
    // The 1601-C: 25 is the tax withheld before refunds (432.45 + 432.45 + 6,657.55), the refund on its own line, 27 the net.
    expect(monthLists(w.db, '2026-12', false).tax).toMatchObject({ taxWithheldCents: 752_245, yearEndRefundCents: 134_245, refundCarriedInCents: 0, taxToRemitCents: 618_000, refundCarriedOutCents: 0 });

    // More than the net is refused, and the message names the refunds.
    const over = w.preview(remittanceDoc, w.rem('2026-12', 709_000));
    expect(codes(over.issues)).toEqual(['OVER']);
    expect(over.issues[0]!.message).toContain('₱6,180.00 payable to Withholding tax (1601-C) (₱7,090.00 of tax withheld less ₱910.00 of year-end tax refunds)');

    w.at('2027-01-10');
    const pre = w.preview(remittanceDoc, w.rem('2026-12', 618_000));
    expect([codes(pre.issues), codes(pre.issues, 'warning')]).toEqual([[], []]);
    expect(pre.summary).toBe('This will record ₱6,180.00 paid to Withholding tax (1601-C) for 2026-12 (eFPS 2026-12) from Cash in bank – BDO, for 1 employee: ₱7,090.00 of tax withheld less ₱910.00 of year-end tax refunds.');
    const rem = w.record(remittanceDoc, w.rem('2026-12', 618_000));
    expect(codes(rem.warnings, 'warning')).toEqual([]);
    expect(journal(w.env, rem.id)).toEqual([
      '1111 Cr 6,180.00',
      "2310 Cr 910.00 Olga Opisina 'Year-end tax refund 2026-12'",
      "2310 Dr 7,090.00 Uri Opisina 'Withholding tax 2026-12'",
    ]);
    expect(remittanceDoc.load(w.db, rem.id)).toMatchObject({
      payableCents: 618_000, amountCents: 618_000, lines: [{ name: 'Uri Opisina', payableCents: 709_000, amountCents: 709_000 }],
      adjustments: [{ month: '2026-12', name: 'Olga Opisina', debitCents: 0, creditCents: 91_000 }],
    });
    // Every employee's 2310 for December is zero; the cash paid is the net.
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: 0, [w.uri]: 0 });
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ recordedCents: 618_000, remittedCents: 618_000, balanceCents: 0, dueCents: 0, refundOpenCents: 0, overRemitted: [], remittances: [{ number: rem.number, amountCents: 618_000 }] });
    expect(codes(w.preview(remittanceDoc, w.rem('2026-12', 1)).issues)).toEqual(['NOTHING_DUE']);
    clean(w);

    // Cancel mirrors it: the refund is open again and December is payable at the net again.
    w.cancel(remittanceDoc, rem.id);
    expect(journal(w.env, rem.id, 'reversal')).toEqual([
      '1111 Dr 6,180.00',
      "2310 Cr 7,090.00 Uri Opisina 'Withholding tax 2026-12'",
      "2310 Dr 910.00 Olga Opisina 'Year-end tax refund 2026-12'",
    ]);
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: -91_000, [w.uri]: 709_000 });
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ balanceCents: 618_000, dueCents: 618_000, refundOpenCents: 91_000, remittances: [], overRemitted: [] });
    clean(w);
  });

  it('a partial payment takes the refund off in full and spreads the rest over the employees still owing', async () => {
    const w = await december(1_300_000);
    w.at('2027-01-10');
    const part = w.record(remittanceDoc, w.rem('2026-12', 300_000));
    expect(codes(part.warnings, 'warning')).toEqual(['UNDER']);
    expect(journal(w.env, part.id)).toEqual(['1111 Cr 3,000.00', "2310 Cr 910.00 Olga Opisina 'Year-end tax refund 2026-12'", "2310 Dr 3,910.00 Uri Opisina 'Withholding tax 2026-12'"]);
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ balanceCents: 318_000, dueCents: 318_000, refundOpenCents: 0 });
    const rest = w.record(remittanceDoc, w.rem('2026-12', 318_000));
    expect(journal(w.env, rest.id)).toEqual(['1111 Cr 3,180.00', "2310 Dr 3,180.00 Uri Opisina 'Withholding tax 2026-12'"]);
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: 0, [w.uri]: 0 });
    clean(w);
  });

  it('December refunds bigger than all of December’s tax: nothing to remit, the excess carried into January’s remittance; both months zero; cancel mirrors it', async () => {
    // Olga: 20,000.00 before + 432.45; 12,090.00 due → 8,342.45 refunded; her December 2310 is 432.45 − 8,342.45 =
    // −7,910.00. Uri owes 7,090.00. December is 820.00 below zero.
    const w = await december(2_000_000);
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: -791_000, [w.uri]: 709_000 });
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ recordedCents: -82_000, balanceCents: -82_000, dueCents: 0, refundCents: 834_245, refundOpenCents: 791_000, carriedOutCents: 82_000, overRemitted: [] });
    expect(monthLists(w.db, '2026-12', false).tax).toMatchObject({ taxWithheldCents: 752_245, yearEndRefundCents: 834_245, taxToRemitCents: 0, refundCarriedOutCents: 82_000 });
    w.at('2027-01-05');
    const dec = w.preview(remittanceDoc, w.rem('2026-12', 1));
    expect([codes(dec.issues), codes(dec.issues, 'warning')]).toEqual([['NOTHING_DUE'], []]);
    expect(dec.issues[0]!.message).toBe(
      "Nothing is left to remit for 2026-12: its year-end tax refunds still to take off (₱7,910.00) are more than the tax withheld still to remit (₱7,090.00). The ₱820.00 of refunds above the tax is taken off the next month's withholding-tax remittance.",
    );

    // January: 1–15 taxable 13,300.00 → 432.45 each; 16–31 SSS 750 more → taxable 14,250.00 → 15% over 10,417 = 574.95
    // each. January's 2310: 1,007.40 each, 2,014.80 in all; less December's 820.00 → 1,194.80 to remit.
    w.at('2027-01-15');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2027-01-01' });
    w.at('2027-01-31');
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2027-01-16' });
    expect(payable(w, '2027-01')).toEqual({ [w.olga]: 100_740, [w.uri]: 100_740 });
    expect(schemeCheck(w.db, 'WTAX', '2027-01')).toMatchObject({ recordedCents: 201_480, balanceCents: 201_480, dueCents: 119_480, carriedInCents: 82_000, carriedFrom: ['2026-12'], refundCents: 0 });
    expect(monthLists(w.db, '2027-01', false).tax).toMatchObject({ taxWithheldCents: 201_480, yearEndRefundCents: 0, refundCarriedInCents: 82_000, refundCarriedFrom: ['2026-12'], taxToRemitCents: 119_480 });
    expect(codes(w.preview(remittanceDoc, w.rem('2027-01', 201_480)).issues)).toEqual(['OVER']);

    w.at('2027-02-10');
    const pre = w.preview(remittanceDoc, w.rem('2027-01', 119_480));
    expect([codes(pre.issues), codes(pre.issues, 'warning')]).toEqual([[], []]);
    expect(pre.summary).toBe('This will record ₱1,194.80 paid to Withholding tax (1601-C) for 2027-01 (eFPS 2027-01) from Cash in bank – BDO, for 2 employees: ₱9,104.80 of tax withheld less ₱7,910.00 of year-end tax refunds, with 2026-12 (its refunds were more than its tax).');
    const jan = w.record(remittanceDoc, w.rem('2027-01', 119_480));
    expect(codes(jan.warnings, 'warning')).toEqual([]);
    // Dr January's employees, Dr Uri's December tax, Cr Olga's December refund; the cash is the net of both months.
    expect(journal(w.env, jan.id)).toEqual([
      '1111 Cr 1,194.80',
      "2310 Cr 7,910.00 Olga Opisina 'Year-end tax refund 2026-12'",
      "2310 Dr 1,007.40 Olga Opisina 'Withholding tax 2027-01'",
      "2310 Dr 1,007.40 Uri Opisina 'Withholding tax 2027-01'",
      "2310 Dr 7,090.00 Uri Opisina 'Withholding tax 2026-12'",
    ]);
    // Both months show zero, per employee and in the check; December names the January remittance that settled it.
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: 0, [w.uri]: 0 });
    expect(payable(w, '2027-01')).toEqual({ [w.olga]: 0, [w.uri]: 0 });
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ recordedCents: -82_000, remittedCents: -82_000, balanceCents: 0, dueCents: 0, refundOpenCents: 0, carriedOutCents: 0, remittances: [{ number: jan.number, month: '2027-01' }] });
    expect(schemeCheck(w.db, 'WTAX', '2027-01')).toMatchObject({ recordedCents: 201_480, remittedCents: 201_480, balanceCents: 0, dueCents: 0, carriedInCents: 0, remittances: [{ number: jan.number }] });
    // The January 1601-C still shows December's refunds taken off it.
    expect(monthLists(w.db, '2027-01', false).tax).toMatchObject({ refundCarriedInCents: 82_000, refundCarriedFrom: ['2026-12'], taxToRemitCents: 119_480 });
    for (const m of ['2026-12', '2027-01']) expect(codes(w.preview(remittanceDoc, w.rem(m, 1)).issues)).toEqual(['NOTHING_DUE']);
    // The 2310 on the ledger is zero: December's refunds and tax and January's tax are all settled.
    expect(w.db.prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2310'`).pluck().get()).toBe(0);
    clean(w);

    // Cancelling the January remittance mirrors it: December is back to its excess and January owes its tax again.
    w.cancel(remittanceDoc, jan.id);
    expect(journal(w.env, jan.id, 'reversal')).toEqual([
      '1111 Dr 1,194.80',
      "2310 Cr 1,007.40 Olga Opisina 'Withholding tax 2027-01'",
      "2310 Cr 1,007.40 Uri Opisina 'Withholding tax 2027-01'",
      "2310 Cr 7,090.00 Uri Opisina 'Withholding tax 2026-12'",
      "2310 Dr 7,910.00 Olga Opisina 'Year-end tax refund 2026-12'",
    ]);
    expect(payable(w, '2026-12')).toEqual({ [w.olga]: -791_000, [w.uri]: 709_000 });
    expect(schemeCheck(w.db, 'WTAX', '2026-12')).toMatchObject({ balanceCents: -82_000, refundOpenCents: 791_000, carriedOutCents: 82_000, remittances: [] });
    expect(schemeCheck(w.db, 'WTAX', '2027-01')).toMatchObject({ balanceCents: 201_480, dueCents: 119_480, carriedInCents: 82_000 });
    clean(w);
  });
});
