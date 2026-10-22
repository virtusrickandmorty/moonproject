/** The job order's printout shows the payments the customer made and the balance due (the owner's request, Oct 2026). */
import { beforeEach, expect, it } from 'vitest';
import { PASSWORD, cashPlaceId, createTestEnv, idem, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv;
let encoder: Client;
let c: ReturnType<typeof seedCustomers>;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  c = seedCustomers(env.db, encoder.userId);
  const owner = await env.as('owner');
  await owner.post('/api/auth/step-up', { password: PASSWORD });
  const profile = { registeredName: 'Example Garments Corp.', tradeName: 'Example Garments', tin: '000-111-222-000', registeredAddress: '1 Sample Street, Manila', isVatRegistered: true };
  expect((await owner.put('/api/prt/company-profile', profile, { 'if-match': '0' })).statusCode).toBe(200);
});

async function jobOrder(cents: number): Promise<string> {
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
}
async function pay(jo: string, cents: number, crNumber: string, place: string, reference?: string) {
  const input = { customerId: c.school, crNumber, applications: [{ jobOrderId: jo, amountCents: cents }], tenders: [{ cashPlaceId: cashPlaceId(env.db, place), amountCents: cents, ...(reference ? { reference } : {}) }] };
  const r = await encoder.post('/api/docs/col.collection/post', { input, expectedTotalCents: cents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
const print = async (jo: string) => { const r = await encoder.post(`/api/prt/print/jo.job_order/${jo}`, { variant: 'document' }); expect(r.statusCode, r.body).toBe(200); return r.json().html as string; };

it('lists each payment with its receipt, CR and how it was paid, then what was paid and the balance due', async () => {
  const jo = await jobOrder(1_000_000); // ₱10,000.00
  expect(await print(jo)).not.toContain('Payments received</h2>');
  expect(await print(jo)).toContain('Balance due');
  const first = await pay(jo, 500_000, '0101', '1101');
  const second = await pay(jo, 200_000, '0102', '1121', 'GC 778899');
  const html = await print(jo);
  expect(html).toContain('Payments received');
  for (const [p, cr, via, amount] of [[first, '0101', 'Cash on hand', '5,000.00'], [second, '0102', 'GCash', '2,000.00']] as const) {
    const row = html.slice(html.indexOf(p.number) - 200, html.indexOf(p.number) + 400);
    expect(row).toContain(cr); expect(row).toContain(via); expect(row).toContain(amount);
  }
  expect(html).toMatch(/Payments received[\s\S]*−₱7,000\.00/);
  expect(html).toMatch(/Balance due[\s\S]*₱3,000\.00/);

  // A cancelled payment is not listed and no longer counts.
  expect((await encoder.post(`/api/docs/col.collection/${second.id}/cancel`, { reason: 'Recorded twice' }, idem())).statusCode).toBe(200);
  const after = await print(jo);
  expect(after).not.toContain(second.number);
  expect(after).toMatch(/Balance due[\s\S]*₱5,000\.00/);
});

it('lists money moved from another job order (a deposit transfer) with the receipts it was paid with there, and money moved away', async () => {
  const [from, to] = [await jobOrder(500_000), await jobOrder(90_000)];
  const paid = await pay(from, 50_000, '0201', '1101');
  const moved = await encoder.post('/api/docs/col.deposit_transfer/post', { input: { customerId: c.school, fromJobOrderId: from, toJobOrderId: to, amountCents: 50_000 }, expectedTotalCents: 50_000 }, idem());
  expect(moved.statusCode, moved.body).toBe(200);
  const dxf = moved.json().number as string;
  const number = (id: string) => env.db.prepare('SELECT number FROM documents WHERE id = ?').pluck().get(id) as string;

  const html = await print(to);
  const row = html.slice(html.indexOf(dxf) - 200, html.indexOf(dxf) + 400);
  expect(row).toContain('0201');
  expect(row).toContain(`Moved from ${number(from)} (paid with ${paid.number})`);
  expect(row).toContain('500.00');
  expect(html).not.toContain('Other credits and earlier payments');
  expect(html).toMatch(/Balance due[\s\S]*₱400\.00/);

  const there = await print(from);
  expect(there).toContain(`Moved to ${number(to)}`);
  expect(there).not.toContain('Other credits and earlier payments');
  expect(there).toMatch(/Balance due[\s\S]*₱5,000\.00/);
});
