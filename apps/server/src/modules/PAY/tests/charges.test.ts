/**
 * Damage or loss charges (the owner's request, Oct 2026; CA ca.charge): booked as owed by the employee (1290) and
 * recovered (7103), then taken back by payroll after tax, contributions and the cash advance, an instalment at a time,
 * never more than 20% of the gross pay of a run; the rest waits for the next payroll. A charge a run took from stays.
 */
import { expect, it } from 'vitest';
import { idem } from '../../../../test/helpers.ts';
import { chargeDoc } from '../../CA/doctypes/charge.ts';
import { openCharges } from '../../CA/public.ts';
import { runDoc } from '../doctypes/run.ts';
import { codes, journal, partyBalance, world } from './world.ts';

/** Ana, ₱600 a day, present Sep 16-25 (8 workdays, ₱4,800), on the semi-monthly daily-paid run of Sep 16-30. */
async function ana() {
  const w = await world('2026-09-30');
  const id = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  w.attend(['16', '17', '18', '19', '21', '22', '23', '24'].map((d) => ({ employeeId: id, date: `2026-09-${d}`, status: 'present' })));
  return { w, id };
}
const run = { payGroup: 'SEMI_DAILY' as const, periodStart: '2026-09-16' };

it('books the charge as owed by the employee and recovered, with no cash', async () => {
  const { w, id } = await ana();
  const c = w.record(chargeDoc, { employeeId: id, what: 'Damaged jersey cloth', amountCents: 150_000, installmentCents: 50_000, explanation: 'Admitted cutting the wrong side of the cloth' });
  expect(c).toMatchObject({ number: 'DMG-000001', totalCents: 150_000 });
  expect(journal(w.env, c.id)).toEqual(['1290 Dr 1,500.00', '7103 Cr 1,500.00']);
  expect(partyBalance(w.env, '1290', id)).toBe(150_000);
  expect(openCharges(w.db, id)).toEqual([expect.objectContaining({ number: 'DMG-000001', installmentCents: 50_000, owedCents: 150_000 })]);
  // The instalment cannot be more than the charge.
  expect(codes(w.preview(chargeDoc, { employeeId: id, what: 'Lost scissors', amountCents: 10_000, installmentCents: 20_000, explanation: 'Left them at the canteen' }).issues)).toEqual(['INSTALLMENT']);
});

it('takes back an instalment after tax and contributions, and the run posts it against the charge', async () => {
  const { w, id } = await ana();
  const c = w.record(chargeDoc, { employeeId: id, what: 'Damaged jersey cloth', amountCents: 150_000, installmentCents: 50_000, explanation: 'Admitted cutting the wrong side of the cloth' });
  const pre = w.preview(runDoc, run);
  const e = (pre.doc as { employees: { grossCents: number; chargeCents: number; netCents: number; sssEeCents: number; phicEeCents: number; hdmfEeCents: number; wtaxCents: number; charges: { number: string; amountCents: number; leftAfterCents: number }[] }[] }).employees[0]!;
  expect(e.grossCents).toBe(480_000);
  expect(e.chargeCents).toBe(50_000); // the instalment: under 20% of ₱4,800 (₱960)
  expect(e.charges).toEqual([{ chargeId: c.id, number: 'DMG-000001', what: 'Damaged jersey cloth', amountCents: 50_000, leftAfterCents: 100_000 }]);
  expect(e.netCents).toBe(e.grossCents - e.sssEeCents - e.phicEeCents - e.hdmfEeCents - e.wtaxCents - 50_000);
  const r = w.record(runDoc, run);
  expect(journal(w.env, r.id)).toContain('1290 Cr 500.00');
  expect(partyBalance(w.env, '1290', id)).toBe(100_000);
  expect(openCharges(w.db, id)[0]!.owedCents).toBe(100_000);
  // The charge stays while the run that took from it stands (the app's cancel route asks the modules).
  const owner = await w.env.as('owner');
  const refused = await owner.post(`/api/docs/ca.charge/${c.id}/cancel`, { reason: 'Charged the wrong employee' }, idem());
  expect(refused.json()).toMatchObject({ code: 'HAS_DEPENDENTS' });
  expect(refused.body).toContain('PAY-000001');
  w.cancel(runDoc, r.id);
  expect(partyBalance(w.env, '1290', id)).toBe(150_000);
  w.cancel(chargeDoc, c.id);
  expect(partyBalance(w.env, '1290', id)).toBe(0);
});

it('never takes more than 20% of the gross pay of a run; the rest waits', async () => {
  const { w, id } = await ana();
  w.record(chargeDoc, { employeeId: id, what: 'Lost sewing machine motor', amountCents: 500_000, installmentCents: 200_000, explanation: 'Took it home and it was stolen, she says' });
  const pre = w.preview(runDoc, run);
  const e = (pre.doc as { employees: { chargeCents: number }[] }).employees[0]!;
  expect(e.chargeCents).toBe(96_000); // 20% of ₱4,800, not the ₱2,000 instalment
  expect(pre.issues.find((i) => i.code === 'CHARGE_REDUCED')?.message).toContain('at most 20% of the pay (₱960.00)');
});
