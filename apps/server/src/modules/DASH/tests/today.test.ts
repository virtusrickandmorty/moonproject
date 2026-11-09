/** Today (the owner's request, Nov 2026): what is waiting on each person, counted, only what their role may deal with. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
let env: TestEnv, owner: Client, encoder: Client, c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv('2026-11-09T02:00:00Z'); encoderOwnDefaults(env);
  owner = await env.as('owner'); encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});
const jobOrder = async (dueInDays: number) => {
  const input = { customerId: c.school, dueInDays, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 10, unitPriceCents: 50_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 500_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
};
const today = async (who: Client) => (await who.get('/api/dash/today')).json() as { key: string; count: number; href: string }[];

it('counts job orders due soon and late, and designs waiting or sent back, each with where to deal with it', async () => {
  const soon = await jobOrder(1);
  await jobOrder(30);
  const p = (await encoder.post(`/api/prf/job-orders/${soon.id}`, { files: [{ name: 'design.png', data: PNG }] })).json() as { token: string };
  expect(await today(encoder)).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'due-soon', count: 1, href: `/docs/jo.job_order/${soon.id}` }),
    expect.objectContaining({ key: 'proof-waiting', count: 1 }),
  ]));
  await env.app.inject({ method: 'POST', url: `/api/prf/p/${p.token}/answer`, payload: { answer: 'changes', name: 'Coach Ana', comment: 'Bigger logo' }, remoteAddress: '10.7.7.7' });
  const after = await today(encoder);
  expect(after.find((i) => i.key === 'proof-redo')).toMatchObject({ count: 1 });
  expect(after.find((i) => i.key === 'proof-waiting')).toBeUndefined();

  env.clock.set('2026-11-12T02:00:00Z'); // three days on: the first one is late now
  encoder = await env.as('encoder');
  expect((await today(encoder)).find((i) => i.key === 'late')).toMatchObject({ count: 1, href: `/docs/jo.job_order/${soon.id}` });
});

it('shows each person only what they may deal with, and nothing when nothing waits', async () => {
  expect(await today(owner)).toEqual([]);
  await jobOrder(1);
  const production = await env.as('production');
  expect((await today(production)).map((i) => i.key)).not.toContain('proof-waiting');
});
