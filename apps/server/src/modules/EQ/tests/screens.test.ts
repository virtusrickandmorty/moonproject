/** The owners and officers screens' read-only routes: a person's documents and what everyone owes and is owed. */
import { describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem } from '../../../../test/helpers.ts';

async function shop() {
  const env = await createTestEnv();
  const acc = await env.as('accountant');
  const BDO = cashPlaceId(env.db, '1111');
  const person = async (body: object) => (await acc.post('/api/eq/people', body)).json().id as string;
  const A = await person({ name: 'Sample Owner A', isStockholder: true, isOfficer: true, position: 'President', shares: 2500 });
  const B = await person({ name: 'Sample Officer B', isStockholder: false, isOfficer: true, position: 'Treasurer' });
  const post = async (type: string, input: { amountCents: number }) => (await acc.post(`/api/docs/${type}/post`, { input, expectedTotalCents: input.amountCents }, idem())).json() as { id: string; number: string };
  return { env, acc, A, B, BDO, post };
}

describe('owners and officers screens: read-only routes', () => {
  it("lists a person's owner money and officer money, cancelled ones included, and the balances agree with the ledger", async () => {
    const { acc, A, B, BDO, post } = await shop();
    const adv = await post('eq.owner_money', { personId: A, cashPlaceId: BDO, amountCents: 500_000, classification: 'advance', note: 'Working capital' } as never);
    const took = await post('eq.officer', { personId: A, kind: 'taken', cashPlaceId: BDO, amountCents: 120_000, purpose: 'Personal expense' } as never);
    const back = await post('eq.officer', { personId: A, kind: 'returned', cashPlaceId: BDO, amountCents: 20_000, purpose: 'Paid back part' } as never);
    await post('eq.officer', { personId: B, kind: 'taken', cashPlaceId: BDO, amountCents: 30_000, purpose: 'Travel' } as never);
    await acc.post(`/api/docs/eq.officer/${back.id}/cancel`, { reason: 'Recorded by mistake today' }, idem());

    const own = (await acc.get(`/api/eq/people/${A}/owner-money`)).json();
    expect(own).toEqual([{ id: adv.id, number: adv.number, date: '2026-09-28', status: 'posted', amountCents: 500_000, accountName: expect.any(String), kind: 'advance', note: 'Working capital' }]);
    const ofc = (await acc.get(`/api/eq/people/${A}/officer-transactions`)).json();
    expect(ofc.map((r: { number: string; kind: string; status: string; amountCents: number }) => [r.number, r.kind, r.status, r.amountCents]).sort()).toEqual([
      [back.number, 'returned', 'cancelled', 20_000], [took.number, 'taken', 'posted', 120_000],
    ].sort());
    expect((await acc.get(`/api/eq/people/${B}/owner-money`)).json()).toEqual([]);

    const balances = (await acc.get('/api/eq/balances')).json() as { personId: string; dueFromCents: number; dueToCents: number; unpaidSubscriptionCents: number }[];
    expect(balances.find((b) => b.personId === A)).toEqual({ personId: A, dueFromCents: 120_000, dueToCents: 500_000, unpaidSubscriptionCents: 0 });
    expect(balances.find((b) => b.personId === B)).toEqual({ personId: B, dueFromCents: 30_000, dueToCents: 0, unpaidSubscriptionCents: 0 });
    const ledger = (await acc.get(`/api/eq/people/${A}/ledger`)).json();
    expect([ledger.dueFromCents, ledger.dueToCents]).toEqual([120_000, 500_000]);
  });

  it('owner money needs eq.own.view, officer money eq.ofc.view and the balances eq.ledger.view; an unknown person is 404', async () => {
    const { env, acc, A } = await shop();
    const encoder = await env.as('encoder');
    expect((await encoder.get(`/api/eq/people/${A}/owner-money`)).statusCode).toBe(200);
    expect((await encoder.get(`/api/eq/people/${A}/officer-transactions`)).statusCode).toBe(200);
    expect((await encoder.get('/api/eq/balances')).statusCode).toBe(403);
    for (const role of ['production', 'tv'] as const) {
      const c = await env.as(role);
      for (const url of [`/api/eq/people/${A}/owner-money`, `/api/eq/people/${A}/officer-transactions`, '/api/eq/balances']) expect((await c.get(url)).statusCode, `${role} ${url}`).toBe(403);
    }
    expect((await acc.get('/api/eq/people/nope/owner-money')).statusCode).toBe(404);
    expect((await acc.get('/api/eq/people/nope/officer-transactions')).statusCode).toBe(404);
  });
});
