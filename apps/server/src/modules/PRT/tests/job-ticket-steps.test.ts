/** A job ticket prints once every made item has its production steps (the owner's rule, Oct 2026); it says which do not. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client, production: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv();
  [encoder, production] = [await env.as('encoder'), await env.as('production')];
  c = seedCustomers(env.db, encoder.userId);
});

it('refuses the job ticket while a made item has no production steps, naming the items; prints once they all do', async () => {
  const lines = [
    { kind: 'made_to_order', description: 'Team shirt', qty: 2, unitPriceCents: 30_000, discountCents: 0, roster: [] },
    { kind: 'ready_made', description: 'Cap', qty: 1, unitPriceCents: 20_000, discountCents: 0, roster: [] },
    { kind: 'made_to_order', description: 'Team shorts', qty: 2, unitPriceCents: 20_000, discountCents: 0, roster: [] },
  ];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 120_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json() as { id: string; number: string };
  const ticket = () => encoder.post(`/api/prt/print/jo.job_order/${jo.id}`, { variant: 'job_ticket' });
  const setup = (line: number) => production.post(`/api/prd/jobs/${jo.id}/lines/${line}/setup`, { templateId: 1, stepIds: [6, 8], complexity: 'standard' });

  const refused = await ticket();
  expect(refused.statusCode).toBe(409);
  expect(refused.json()).toMatchObject({ code: 'NEEDS_STEPS', details: { jobOrderId: jo.id, number: jo.number, lines: [{ lineNo: 1, description: 'Team shirt' }, { lineNo: 3, description: 'Team shorts' }] } });
  // The job order itself still prints (the test shop has no company profile, so printing stops there instead).
  expect((await encoder.post(`/api/prt/print/jo.job_order/${jo.id}`, { variant: 'document' })).json().code).toBe('COMPANY_PROFILE_REQUIRED');

  expect((await setup(1)).statusCode).toBe(200);
  expect((await ticket()).json().details.lines).toEqual([{ lineNo: 3, description: 'Team shorts' }]);
  expect((await setup(3)).statusCode).toBe(200);
  expect((await ticket()).json().code).toBe('COMPANY_PROFILE_REQUIRED'); // past the steps check: the cap needs none
});
