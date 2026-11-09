/** The week's summary (the owner's request, Nov 2026): last week, Monday to Sunday, and the bell that points to it. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { lastWeek, mondayOf } from '../week.ts';

let env: TestEnv, owner: Client, encoder: Client, c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv('2026-11-04T02:00:00Z'); encoderOwnDefaults(env); // a Wednesday, 10 AM in Manila
  owner = await env.as('owner'); encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

describe('which week', () => {
  it('is Monday to Sunday, the last whole one', () => {
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(lastWeek('2026-11-09')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(lastWeek('2026-11-15')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });
});

describe('the summary', () => {
  it('counts the job orders of the week and those late now, for those who see the books', async () => {
    const input = (dueInDays: number) => ({ customerId: c.school, dueInDays, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 10, unitPriceCents: 50_000, discountCents: 0, roster: [] }] });
    for (const due of [1, 30]) expect((await encoder.post('/api/docs/jo.job_order/post', { input: input(due), expectedTotalCents: 500_000 }, idem())).statusCode).toBe(200);
    env.clock.set('2026-11-10T02:00:00Z'); // the Tuesday after: a new day, a new sign-in
    owner = await env.as('owner'); encoder = await env.as('encoder');
    const w = (await owner.get('/api/rpt/week')).json();
    expect(w).toMatchObject({ from: '2026-11-02', to: '2026-11-08', jobOrders: { received: { count: 2, totalCents: 1_000_000 }, late: 1 }, ratings: { rated: 0 }, proofs: { sent: 0 } });
    expect((await owner.get('/api/rpt/week?day=2026-11-10')).json()).toMatchObject({ from: '2026-11-09', to: '2026-11-15', jobOrders: { received: { count: 0 } } });
    expect((await owner.get('/api/rpt/week?day=2999-01-01')).statusCode).toBe(400);
    expect((await encoder.get('/api/rpt/week')).statusCode).toBe(403);
  });

  it('is pointed to by the bell, once a week', async () => {
    env.clock.set('2026-11-09T02:00:00Z');
    owner = await env.as('owner');
    const bell = (await owner.get('/api/dash/notifications')).json();
    const rows = (bell.items ?? bell) as { kind: string; id: string; label: string; href?: string }[];
    expect(rows.find((n) => n.kind === 'week-summary')).toMatchObject({ id: 'week-summary:2026-11-02', label: "Last week's summary is ready (Nov 2 to Nov 8)", href: '/rpt/week' });
  });
});
