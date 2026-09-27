/** The deposit transfer form's choices, and its web client calls against the real server (in memory): edit a JO, move its deposit. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key, type Transferable } from '../../api.ts';
import { UNAPPLIED, sources, targets } from './transfer.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('deposit transfer choices', () => {
  const t: Transferable = {
    customerId: 'c',
    customerName: 'Moonlight Test School',
    unappliedCents: 5_000,
    held: [
      { id: 'jo1', number: 'JO-000001', status: 'cancelled', depositsHeldCents: 2_000_000, replacement: { id: 'jo2', number: 'JO-000002' } },
      { id: 'jo3', number: 'JO-000003', status: 'posted', depositsHeldCents: 100_000, replacement: null },
    ],
    jobOrders: [
      { id: 'jo2', number: 'JO-000002', dueDate: '2026-10-13', totalCents: 4_500_000, balanceDueCents: 4_500_000 },
      { id: 'jo3', number: 'JO-000003', dueDate: '2026-10-20', totalCents: 1_000_000, balanceDueCents: 900_000 },
    ],
  };

  it('offers each JO’s deposit, saying where an edited JO went, and the unapplied payments; targets leave out the source', () => {
    expect(sources(t).map((s) => [s.key, s.label, s.cents, s.replacementId])).toEqual([
      ['jo1', 'Deposit for JO-000001 (edited into JO-000002)', 2_000_000, 'jo2'],
      ['jo3', 'Deposit for JO-000003', 100_000, null],
      [UNAPPLIED, 'Unapplied payments', 5_000, null],
    ]);
    expect(targets(t, 'jo3').map((j) => j.id)).toEqual(['jo2']);
    expect(targets(t, UNAPPLIED).map((j) => [j.label, j.dueCents])).toEqual([['JO-000002, due 2026-10-13', 4_500_000], ['JO-000003, due 2026-10-20', 900_000]]);
  });

  it('on edit, what the transfer moved counts as held on its source and owed on its target again', () => {
    const moved = { fromKey: 'jo9', fromLabel: 'Deposit for JO-000009', toId: 'jo8', toLabel: 'JO-000008', cents: 300_000 };
    expect(sources({ ...t, held: [], unappliedCents: 0 }, moved)).toEqual([{ key: 'jo9', label: 'Deposit for JO-000009', cents: 300_000, replacementId: null }]);
    expect(targets(t, 'jo9', { ...moved, toId: 'jo3' }).find((j) => j.id === 'jo3')?.dueCents).toBe(1_200_000);
    expect(targets({ ...t, jobOrders: [] }, 'jo9', moved)).toEqual([{ id: 'jo8', label: 'JO-000008', dueCents: 300_000 }]);
  });
});

describe('web client for deposit transfers', () => {
  it('edit a JO with a deposit, see it held with its replacement, move it, and read both JOs’ money', async () => {
    const env = await createTestEnv();
    const c = seedCustomers(env.db, createUser(env.db, 'encoder1', ['encoder']));
    const api = createApi(injectFetch(env.app));
    await api.login('encoder1', PASSWORD);
    const jo = (cents: number) => ({ customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] }] });
    const jo1 = await api.post('jo.job_order', jo(4_000_000), 4_000_000, key());
    await api.post('col.collection', { customerId: c.school, crNumber: '0901', applications: [{ jobOrderId: jo1.id, amountCents: 2_000_000 }], tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 2_000_000 }] }, 2_000_000, key());
    const jo2 = await api.reissue('jo.job_order', jo1.id, jo(4_500_000), 4_500_000, 'Customer added two more sets', key());

    const held = await api.transferable(c.school);
    const [from] = sources(held);
    expect(from).toMatchObject({ key: jo1.id, cents: 2_000_000, replacementId: jo2.id });
    expect(targets(held, from!.key).map((j) => j.id)).toEqual([jo2.id]);
    const input = { customerId: c.school, fromJobOrderId: jo1.id, toJobOrderId: jo2.id, amountCents: 2_000_000 };
    const pre = await api.preview('col.deposit_transfer', input);
    expect(pre.summary).toBe('This will move ₱20,000.00 held for Moonlight Test School from JO-000001 to JO-000002. No cash comes in or goes out.');
    expect((await api.post('col.deposit_transfer', input, pre.totalCents, key())).number).toBe('DXF-000001');
    expect((await api.joStatus(jo2.id)).money).toMatchObject({ depositsHeldCents: 2_000_000, balanceDueCents: 2_500_000 });
    expect((await api.joStatus(jo1.id)).money.depositsHeldCents).toBe(0);
    expect((await api.transferable(c.school)).held).toEqual([{ id: jo2.id, number: 'JO-000002', status: 'posted', depositsHeldCents: 2_000_000, replacement: null }]);
  });
});
