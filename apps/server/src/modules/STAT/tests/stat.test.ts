/**
 * Statutory (PLAN E11, F4, D5 STAT-REM, D6): the monthly SSS, PhilHealth and Pag-IBIG lists and the 1601-C worksheet
 * built from payroll research examples A (August, a daily MWE), C and C2 (September, office staff at ₱15,000 and
 * ₱35,000; docs/research/payroll-examples.md), the remittance golden with its variance check, partial payment and cancel,
 * and the D6 warning when a run of a remitted month is cancelled. Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import { formatPesos } from '@moonproject/shared';
import { cashPlaceId, idem, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { codes, fails, world } from '../../PAY/tests/world.ts';
import { remittanceDoc, type RemittanceInput } from '../doctypes/remittance.ts';
import { payableByEmployee, schemeCheck } from '../ledger.ts';
import type { MonthLists } from '../lists.ts';

/** The document's journal per account and employee: "2401 Dr 2,280.00 Carla Opisina", sorted. */
function journal(env: TestEnv, documentId: string, kind: 'original' | 'reversal' = 'original'): string[] {
  const rows = env.db
    .prepare(
      `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr, e.full_name AS name FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       LEFT JOIN emp_employees e ON e.id = l.party_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY a.code, name`,
    )
    .all(documentId, kind) as { code: string; dr: number; cr: number; name: string | null }[];
  return rows.map((r) => `${r.code} ${r.dr ? 'Dr' : 'Cr'} ${formatPesos(r.dr || r.cr)}${r.name ? ` ${r.name}` : ''}`);
}

/** Example A in August (Ana, a daily MWE) and examples C and C2 in September (Carla and Dee, office), all recorded. */
async function examples() {
  const w = await world('2026-08-15');
  const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true });
  const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
  const dee = w.person('Dee Mataas', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 3_500_000 }, { costCentre: 'office' });
  w.db.prepare(`UPDATE emp_employees SET sss_no = '34-0000001-1', phic_no = '01-000000001-1', hdmf_no = '1210-0000-0001', tin = '100-000-001-000' WHERE id = ?`).run(ana);
  const day = (d: string, status = 'present', otMinutes?: number) => ({ employeeId: ana, date: `2026-08-${d}`, status, ...(otMinutes ? { otMinutes } : {}) });
  w.attend([...['01', '03', '04', '05', '06', '07', '08', '10', '11', '13', '14', '15'].map((d) => day(d)), day('12', 'absent')]);
  w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-08-01' });
  w.at('2026-08-31');
  w.attend([...['17', '18', '19', '20', '22', '24', '25', '27', '28', '29'].map((d) => day(d)), day('21', 'holiday_worked'), day('26', 'present', 120), day('31', 'holiday_off')]);
  w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-08-16' });
  w.at('2026-09-15');
  const sep1 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-01' });
  w.at('2026-09-30');
  const sep2 = w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
  w.at('2026-10-05');
  return { ...w, ana, carla, dee, sep1, sep2, bdo: cashPlaceId(w.db, '1111') };
}

describe('the monthly lists and the 1601-C worksheet (E11, F4)', () => {
  it('August (Example A) and September (examples C and C2), each list adding up to the payable the payrolls recorded', async () => {
    const w = await examples();
    const acct = await w.env.as('accountant');
    const aug = (await acct.get('/api/stat/months/2026-08')).json() as MonthLists;
    // Example A: August SSS on 14,086.88 → MSC 14,000: EE 700, ER 1,400, EC 10; PhilHealth on 14,345.83; Pag-IBIG 200 each.
    expect(aug.sss.rows).toEqual([{ employeeId: w.ana, code: expect.any(String), name: 'Ana Tahi', idNo: '34-0000001-1', mscCents: 1_400_000, mpfMscCents: 0, eeCents: 70_000, erCents: 140_000, ecCents: 1_000, totalCents: 211_000 }]);
    expect(aug.phic.rows).toMatchObject([{ name: 'Ana Tahi', idNo: '01-000000001-1', basisCents: 1_434_583, eeCents: 35_865, erCents: 35_865, totalCents: 71_730 }]);
    expect(aug.hdmf.rows).toMatchObject([{ name: 'Ana Tahi', idNo: '1210-0000-0001', compensationCents: 1_408_688, eeCents: 20_000, erCents: 20_000, totalCents: 40_000 }]);
    // An MWE's minimum wage (13,200.00 of basic days) and holiday, premium and overtime pay (550 + 165 + 171.88) are exempt.
    expect(aug.tax).toMatchObject({
      employees: 1, totalCompensationCents: 1_408_688, mweBasicCents: 1_320_000, mwePremiumCents: 88_688, eeSharesCents: 0, otherNonTaxableCents: 0,
      nonTaxableCents: 1_408_688, taxableCents: 0, noTaxWithheldCents: 0, taxWithheldCents: 0,
    });
    expect(aug.check.map((c) => [c.scheme, c.recordedCents, c.remittedCents, c.balanceCents])).toEqual([['SSS', 211_000, 0, 211_000], ['PHIC', 71_730, 0, 71_730], ['HDMF', 40_000, 0, 40_000], ['WTAX', 0, 0, 0]]);

    const sep = (await acct.get('/api/stat/months/2026-09')).json() as MonthLists;
    // C: MSC 15,000 (EE 750, ER 1,500, EC 30). C2: MSC 35,000 of which 15,000 is MPF (EE 1,750, ER 3,500, EC 30).
    expect(sep.sss.rows.map((r) => [r.name, r.mscCents, r.mpfMscCents, r.eeCents, r.erCents, r.ecCents, r.totalCents])).toEqual([
      ['Carla Opisina', 1_500_000, 0, 75_000, 150_000, 3_000, 228_000],
      ['Dee Mataas', 3_500_000, 1_500_000, 175_000, 350_000, 3_000, 528_000],
    ]);
    expect(sep.phic.rows.map((r) => [r.name, r.basisCents, r.totalCents])).toEqual([['Carla Opisina', 1_500_000, 75_000], ['Dee Mataas', 3_500_000, 175_000]]);
    expect(sep.hdmf.rows.map((r) => [r.name, r.compensationCents, r.totalCents])).toEqual([['Carla Opisina', 1_500_000, 40_000], ['Dee Mataas', 3_500_000, 40_000]]);
    // 1601-C: compensation 50,000; employee shares off taxable pay 1,325 (C) + 2,825 (C2); taxable 13,675 + 32,175 (the
    // examples' monthly checks); tax 769.95 + 931.20. Carla's 13,675 had no tax withheld (the accountant decides item 23).
    expect(sep.tax).toMatchObject({
      employees: 2, totalCompensationCents: 5_000_000, mweBasicCents: 0, mwePremiumCents: 0, eeSharesCents: 415_000, otherNonTaxableCents: 0,
      nonTaxableCents: 415_000, taxableCents: 4_585_000, noTaxWithheldCents: 1_367_500, taxWithheldCents: 170_115,
    });
    expect(sep.tax.rows.map((r) => [r.name, r.grossCents, r.taxableCents, r.taxCents])).toEqual([['Carla Opisina', 1_500_000, 1_367_500, 0], ['Dee Mataas', 3_500_000, 3_217_500, 170_115]]);
    // Each list adds up to what the payrolls credited to the payable on the ledger.
    expect(sep.check.map((c) => c.recordedCents)).toEqual([sep.sss.totalCents, sep.phic.totalCents, sep.hdmf.totalCents, sep.tax.taxWithheldCents]);
    expect((await acct.get('/api/stat/months')).json().map((m: { month: string }) => m.month)).toEqual(['2026-09', '2026-08']);

    // Government IDs only with emp.view_ids; encoders see no payroll (OWN-12).
    w.db.prepare(`UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'emp.view_ids'`).run();
    expect((await (await w.env.as('owner')).get('/api/stat/months/2026-08')).json().sss.rows[0].idNo).toBeNull();
    const enc = await w.env.as('encoder');
    for (const url of ['/api/stat/months', '/api/stat/months/2026-09', '/api/docs/stat.remittance']) expect((await enc.get(url)).statusCode, url).toBe(403);
    expect((await acct.get('/api/stat/months/2026-9')).statusCode).toBe(400);
  });
});

describe('STAT-REM: the remittance, its variance check and its cancel (D5)', () => {
  it('SSS and 1601-C for September paid in full, PhilHealth in two parts; more than payable, nothing due and a future month are refused', async () => {
    const w = await examples();
    const rem = (o: Partial<RemittanceInput> & Pick<RemittanceInput, 'scheme' | 'amountCents'>): RemittanceInput => ({ month: '2026-09', cashPlaceId: w.bdo, reference: 'PRN 0926-0001', ...o });

    const sss = w.record(remittanceDoc, rem({ scheme: 'SSS', amountCents: 756_000 }));
    expect(sss.number).toBe('REM-000001');
    expect(codes(sss.warnings, 'warning')).toEqual([]);
    expect(journal(w.env, sss.id)).toEqual(['1111 Cr 7,560.00', '2401 Dr 2,280.00 Carla Opisina', '2401 Dr 5,280.00 Dee Mataas']);
    expect(schemeCheck(w.db, 'SSS', '2026-09')).toMatchObject({ recordedCents: 756_000, remittedCents: 756_000, balanceCents: 0, remittances: [{ number: 'REM-000001' }] });
    const tax = w.record(remittanceDoc, rem({ scheme: 'WTAX', amountCents: 170_115, reference: 'eFPS 0926-0002' }));
    expect(journal(w.env, tax.id)).toEqual(['1111 Cr 1,701.15', '2310 Dr 1,701.15 Dee Mataas']); // Carla had no tax withheld

    // PhilHealth: 1,000.00 of 2,500.00 now, spread in proportion (750 : 1,750); the rest later.
    const part = w.preview(remittanceDoc, rem({ scheme: 'PHIC', amountCents: 100_000 }));
    expect([codes(part.issues), codes(part.issues, 'warning')]).toEqual([[], ['UNDER']]);
    expect(part.summary).toContain('₱1,500.00 stays payable');
    const p1 = w.record(remittanceDoc, rem({ scheme: 'PHIC', amountCents: 100_000 }));
    expect(journal(w.env, p1.id)).toEqual(['1111 Cr 1,000.00', '2402 Dr 300.00 Carla Opisina', '2402 Dr 700.00 Dee Mataas']);
    expect(remittanceDoc.load(w.db, p1.id).lines.map((l) => [l.name, l.payableCents, l.amountCents])).toEqual([['Carla Opisina', 75_000, 30_000], ['Dee Mataas', 175_000, 70_000]]);
    const p2 = w.record(remittanceDoc, rem({ scheme: 'PHIC', amountCents: 150_000 }));
    expect(journal(w.env, p2.id)).toEqual(['1111 Cr 1,500.00', '2402 Dr 450.00 Carla Opisina', '2402 Dr 1,050.00 Dee Mataas']);
    expect([...payableByEmployee(w.db, 'PHIC', '2026-09').values()]).toEqual([0, 0]);

    const errs = (input: RemittanceInput) => codes(w.preview(remittanceDoc, input).issues);
    expect(errs(rem({ scheme: 'HDMF', amountCents: 80_001 }))).toEqual(['OVER']);
    expect(errs(rem({ scheme: 'SSS', amountCents: 1 }))).toEqual(['NOTHING_DUE']); // all remitted
    expect(errs(rem({ scheme: 'SSS', month: '2026-07', amountCents: 1 }))).toEqual(['NOTHING_DUE']); // no payroll that month
    expect(errs(rem({ scheme: 'SSS', month: '2026-11', amountCents: 1 }))).toEqual(['MONTH', 'NOTHING_DUE']);

    // Over HTTP: strict input (no date, total or status), totals confirmed, idempotent.
    const acct = await w.env.as('accountant');
    const hdmf = rem({ scheme: 'HDMF', amountCents: 80_000 });
    for (const extra of [{ date: '2026-10-05' }, { totalCents: 1 }, { status: 'posted' }, { payableCents: 1 }]) {
      expect((await acct.post('/api/docs/stat.remittance/post', { input: { ...hdmf, ...extra }, expectedTotalCents: 80_000 }, idem())).statusCode, JSON.stringify(extra)).toBe(400);
    }
    const k = idem();
    const posted = (await acct.post('/api/docs/stat.remittance/post', { input: hdmf, expectedTotalCents: 80_000 }, k)).json();
    expect((await acct.post('/api/docs/stat.remittance/post', { input: hdmf, expectedTotalCents: 80_000 }, k)).json().id).toBe(posted.id);
    expect(posted.number).toBe('REM-000005');

    // Cancel mirrors it and the month is payable again.
    w.cancel(remittanceDoc, sss.id);
    expect(journal(w.env, sss.id, 'reversal')).toEqual(['1111 Dr 7,560.00', '2401 Cr 2,280.00 Carla Opisina', '2401 Cr 5,280.00 Dee Mataas']);
    expect(schemeCheck(w.db, 'SSS', '2026-09')).toMatchObject({ recordedCents: 756_000, remittedCents: 0, balanceCents: 756_000, remittances: [] });
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('D6: cancelling a payroll run whose month was already remitted', () => {
  it('warns on the run, then shows the negative payable and the run on the check until the payroll is redone', async () => {
    const w = await examples();
    const acct = await w.env.as('accountant');
    w.record(remittanceDoc, { scheme: 'SSS', month: '2026-09', cashPlaceId: w.bdo, amountCents: 756_000, reference: 'PRN 0926-0001' });
    expect((await acct.get(`/api/stat/runs/${w.sep2.id}/remitted`)).json()).toEqual({ month: '2026-09', remitted: [{ scheme: 'SSS', label: 'SSS', numbers: ['REM-000001'] }] });

    // Cutoff 2 credited SSS 1,145.00 (Carla) and 2,625.00 (Dee); cancelling it leaves September remitted by that much more.
    w.cancel(runDoc, w.sep2.id);
    expect((await acct.get(`/api/stat/runs/${w.sep2.id}/remitted`)).json().remitted).toEqual([]);
    const check = (await acct.get('/api/stat/months/2026-09')).json() as MonthLists;
    expect(check.check[0]).toMatchObject({
      scheme: 'SSS', recordedCents: 379_000, remittedCents: 756_000, balanceCents: -377_000, cancelledAfter: [{ number: 'PAY-000004' }],
      overRemitted: [{ name: 'Carla Opisina', cents: 114_500 }, { name: 'Dee Mataas', cents: 262_500 }],
    });
    // Nothing is left to remit, and the remittance screen says why.
    const again = w.preview(remittanceDoc, { scheme: 'SSS', month: '2026-09', cashPlaceId: w.bdo, amountCents: 1, reference: 'PRN 0926-0003' });
    expect([codes(again.issues), codes(again.issues, 'warning')]).toEqual([['NOTHING_DUE'], ['OVER_REMITTED']]);

    // Redoing the payroll credits the month again: nothing over-remitted, the cancelled run stays on the record.
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: '2026-09-16' });
    expect(schemeCheck(w.db, 'SSS', '2026-09')).toMatchObject({ balanceCents: 0, overRemitted: [], cancelledAfter: [{ number: 'PAY-000004' }] });
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
    fails(() => w.cancel(runDoc, w.sep1.id), 'HAS_DEPENDENTS'); // the redone cutoff 2 still rests on cutoff 1
  });
});
