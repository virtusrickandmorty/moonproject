/** The loan screens' read-only routes: a loan's payments and the instalments that are late. */
import { describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem } from '../../../../test/helpers.ts';

async function shop() {
  const env = await createTestEnv(); // today is 2026-09-28
  let acc = await env.as('accountant');
  const BDO = cashPlaceId(env.db, '1111');
  // ₱60,000 at 12% a year flat over 3 months, first due one month after the loan: 2026-10-28, 11-28, 12-28.
  const loan = (await acc.post('/api/docs/loan.loan/post', {
    input: { lender: 'Sample Bank', kind: 'loan', cashPlaceId: BDO, principalCents: 6_000_000, interestRateBp: 1200, termMonths: 3, schedule: 'flat' }, expectedTotalCents: 6_000_000,
  }, idem())).json() as { id: string; number: string };
  const pay = async (instalmentNo: number) => (await acc.post('/api/docs/loan.payment/post', { input: { loanId: loan.id, instalmentNo, cashPlaceId: BDO }, expectedTotalCents: 2_060_000 }, idem())).json() as { id: string; number: string };
  const goTo = async (iso: string) => (env.clock.set(iso), (acc = await env.as('accountant')));
  return { env, loan, pay, goTo, acc: () => acc };
}

describe('loan screens: read-only routes', () => {
  it('nothing is late before the first due date; then each unpaid instalment is, with its days late, until it is paid', async () => {
    const { loan, pay, goTo, acc } = await shop();
    expect((await acc().get('/api/loan/late')).json()).toEqual([]);
    await goTo('2026-10-28T09:00:00+08:00');
    expect((await acc().get('/api/loan/late')).json()).toEqual([]); // due today is not late
    await goTo('2026-11-30T09:00:00+08:00');
    const late = (await acc().get('/api/loan/late')).json();
    expect(late.map((l: { instalmentNo: number; dueDate: string; daysLate: number }) => [l.instalmentNo, l.dueDate, l.daysLate])).toEqual([[1, '2026-10-28', 33], [2, '2026-11-28', 2]]);
    expect(late[0]).toMatchObject({ loanId: loan.id, loanNumber: loan.number, lender: 'Sample Bank', principalCents: 2_000_000, interestCents: 60_000 });
    await pay(1);
    expect((await acc().get('/api/loan/late')).json().map((l: { instalmentNo: number }) => l.instalmentNo)).toEqual([2]);
  });

  it('a loan lists its payments, cancelled ones too, and a cancelled payment leaves the instalment late', async () => {
    const { loan, pay, goTo, acc } = await shop();
    await goTo('2026-10-29T09:00:00+08:00');
    const p = await pay(1);
    expect((await acc().get(`/api/loan/loans/${loan.id}/payments`)).json()).toEqual([
      { id: p.id, number: p.number, date: '2026-10-29', status: 'posted', instalmentNo: 1, principalCents: 2_000_000, interestCents: 60_000, totalCents: 2_060_000, note: null },
    ]);
    await acc().post(`/api/docs/loan.payment/${p.id}/cancel`, { reason: 'Recorded by mistake today' }, idem());
    const list = (await acc().get(`/api/loan/loans/${loan.id}/payments`)).json();
    expect(list.map((x: { status: string }) => x.status)).toEqual(['cancelled']);
    expect((await acc().get('/api/loan/late')).json().map((l: { instalmentNo: number }) => l.instalmentNo)).toEqual([1]);
  });

  it('a paid-off or cancelled loan is never late; permissions and 404', async () => {
    const { env, loan, goTo, acc } = await shop();
    await acc().post(`/api/docs/loan.loan/${loan.id}/cancel`, { reason: 'Recorded by mistake today' }, idem());
    await goTo('2026-12-30T09:00:00+08:00');
    expect((await acc().get('/api/loan/late')).json()).toEqual([]);
    const encoder = await env.as('encoder');
    expect((await encoder.get('/api/loan/late')).statusCode).toBe(200); // loan.loans.view
    expect((await encoder.get(`/api/loan/loans/${loan.id}/payments`)).statusCode).toBe(403); // loan.ledger.view
    for (const role of ['production', 'tv'] as const) {
      const c = await env.as(role);
      expect((await c.get('/api/loan/late')).statusCode, role).toBe(403);
      expect((await c.get(`/api/loan/loans/${loan.id}/payments`)).statusCode, role).toBe(403);
    }
    expect((await acc().get('/api/loan/loans/nope/payments')).statusCode).toBe(404);
  });
});
