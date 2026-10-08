/** A wearer's category (male or female) on a job order roster: kept, read back, refused when wrong, on the job ticket. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from './cus-fixture.ts';
import { renderPrint } from '../../PRT/print.ts';

let env: TestEnv;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
});

const input = (roster: object[]) => ({ customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'full',
  lines: [{ kind: 'made_to_order', description: 'Team jersey', qty: roster.length, unitPriceCents: 50_000, discountCents: 0, roster }] });

it('keeps each wearer\'s category, reads it back for an edit, and prints it on the job ticket', async () => {
  const roster = [
    { name: 'Ana Reyes', sizeMode: 'preset', size: 'S', category: 'female', qty: 1 },
    { name: 'Ben Cruz', sizeMode: 'preset', size: 'L', category: 'male', qty: 1 },
    { name: 'Cy Lim', sizeMode: 'preset', size: 'M', qty: 1 }, // no category: fine
  ];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: input(roster), expectedTotalCents: 150_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const d = (await encoder.get(`/api/docs/jo.job_order/${r.json().id}`)).json();
  expect(d.input.lines[0].roster).toEqual(roster);
  expect(env.db.prepare('SELECT category FROM jo_roster ORDER BY row_no').pluck().all()).toEqual(['female', 'male', null]);

  const h = { id: r.json().id, number: r.json().number, business_date: '2026-09-28', doc_type: 'jo.job_order', status: 'posted' as const };
  const profile = { registered_name: 'Example Garments Corp.', trade_name: 'Example Garments', tin: '000-111-222', registered_address: '1 Sample Street', is_vat_registered: 1, version: 1 };
  const ticket = renderPrint(env.db, h, d.doc, profile, 'job_ticket', 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
  expect(ticket).toContain('<th>Category</th>');
  expect(ticket).toMatch(/<td>Ana Reyes<\/td><td>Female<\/td><td>S<\/td>/);
  expect(ticket).toMatch(/<td>Ben Cruz<\/td><td>Male<\/td><td>L<\/td>/);
});

it('refuses a category other than male or female', async () => {
  const r = await encoder.post('/api/docs/jo.job_order/preview', { input: input([{ name: 'Dee Tan', sizeMode: 'preset', size: 'M', category: 'kids', qty: 1 }]) });
  expect(r.statusCode).toBe(400);
});
