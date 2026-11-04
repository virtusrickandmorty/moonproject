/** Phone notifications (the owner's request, Nov 2026): what comes up new in a person's bell is pushed to their phones once. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { pushNew, type Phone, type Sender } from '../push.ts';

let env: TestEnv;
let owner: Client, encoder: Client;
let customer: string;
const sent: { phone: string; title: string; href: string }[] = [];
const fake: Sender = async (phone: Phone, payload: string) => { const p = JSON.parse(payload); sent.push({ phone: phone.endpoint, title: p.title, href: p.href }); };
const phone = (n: number) => ({ endpoint: `https://push.example.test/send/${n}-abcdef`, keys: { p256dh: 'BPk3zW4xQy7n2a9f0', auth: 'Zm9vYmFyYmF6' }, device: 'Made-up phone' });
const run = () => pushNew(env.db, env.clock, env.deps.registry, fake);

beforeEach(async () => {
  process.env.MOONPROJECT_PUSH_DIR = `${process.env.TEMP ?? '/tmp'}/moonproject-push-test`;
  env = await createTestEnv();
  [owner, encoder] = [await env.as('owner'), await env.as('encoder')];
  customer = seedCustomers(env.db, encoder.userId).school;
  sent.length = 0;
});

const jobOrder = async (dueInDays: number) => {
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 2, unitPriceCents: 30_000, discountCents: 0, roster: [{ name: 'Made-up Player', sizeMode: 'preset', size: 'M', qty: 2 }] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: customer, dueInDays, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 60_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
};

it('tries again when the internet was down: a notice nobody received is not marked sent', async () => {
  await owner.post('/api/push/subscribe', phone(1));
  const jo = await jobOrder(2);
  const down: Sender = async () => { throw Object.assign(new Error('Service unavailable'), { statusCode: 503 }); };
  expect(await pushNew(env.db, env.clock, env.deps.registry, down)).toBe(0);
  await run();
  expect(sent.filter((s) => s.title === `${jo.number} is due soon`)).toHaveLength(1);
});

it('pushes what comes up in the bell after a phone is turned on, once, to every phone of that person', async () => {
  await jobOrder(20); // already in the bell when notifications are turned on: not pushed
  const key = (await owner.get('/api/push/key')).json();
  expect(key).toMatchObject({ publicKey: expect.any(String), phones: 0 });
  expect((await owner.post('/api/push/subscribe', phone(1))).json()).toEqual({ on: true, phones: 1 });
  await owner.post('/api/push/subscribe', phone(2));
  expect(await run()).toBe(0);

  const jo = await jobOrder(2); // due soon, and a new job order to route: new in the owner's bell
  await run();
  expect(sent.filter((s) => s.title === `${jo.number} is due soon`).map((s) => s.phone)).toEqual([phone(1).endpoint, phone(2).endpoint]);
  expect(sent.find((s) => s.title === `${jo.number} is due soon`)?.href).toBe(`/docs/jo.job_order/${jo.id}`);
  const before = sent.length;
  expect(await run()).toBe(0); // once
  expect(sent.length).toBe(before);

  env.clock.advance(5 * 86_400_000); // now overdue: a new notification
  await run();
  expect(sent.some((s) => s.title === `${jo.number} is overdue`)).toBe(true);
});

it('sends a burst as one summary, switches off a phone that is gone, and turns off on request', async () => {
  await owner.post('/api/push/subscribe', phone(1));
  for (let i = 0; i < 3; i++) await jobOrder(1); // two notifications each: more than four at once
  await run();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.title).toMatch(/^\d+ new notifications$/);

  await jobOrder(1);
  const gone: Sender = async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); };
  await pushNew(env.db, env.clock, env.deps.registry, gone);
  expect((await owner.get('/api/push/key')).json().phones).toBe(0);

  await owner.post('/api/push/subscribe', phone(3));
  expect((await owner.post('/api/push/unsubscribe', { endpoint: phone(3).endpoint })).json()).toEqual({ on: false, phones: 0 });
  expect((await owner.post('/api/push/subscribe', { ...phone(4), endpoint: 'http://not-secure.example.test/x' })).statusCode).toBe(400);
});
