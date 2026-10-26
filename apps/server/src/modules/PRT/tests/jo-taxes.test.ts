/**
 * The job order's printout shows the taxes for a VAT-registered customer who withholds tax (the owner's request,
 * 26 Oct 2026, from the shop's sales invoice): Total Sales (VAT inclusive) ₱71,030.00, Less: VAT ₱7,610.36, Amount net of
 * VAT ₱63,419.64, Less: withholding tax (2%) ₱1,268.39, Total amount due ₱69,761.61. Any other customer sees the total.
 */
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

const taxed = (vat: boolean, profile: string) => env.db.prepare('UPDATE cus_customers SET is_vat_registered = ?, withholding_profile = ? WHERE id = ?').run(vat ? 1 : 0, profile, c.school);
async function jobOrder(): Promise<string> {
  // The sample invoice: 75 shirts at 365, 101 jogging pants at 415, 4 at 435.
  const line = (description: string, qty: number, unitPriceCents: number) => ({ kind: 'made_to_order', description, qty, unitPriceCents, discountCents: 0, roster: [] });
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50',
    lines: [line('Shirt, full sublimation, 2XS to 2XL', 75, 36_500), line('Jogging pants, 2XS to 2XL', 101, 41_500), line('Jogging pants, 3XL and up', 4, 43_500)] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: 7_103_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
}
const print = async (jo: string) => { const r = await encoder.post(`/api/prt/print/jo.job_order/${jo}`, { variant: 'document' }); expect(r.statusCode, r.body).toBe(200); return r.json().html as string; };
const totals = (html: string) => html.slice(html.indexOf('class="totals"'), html.indexOf('</div>', html.indexOf('class="totals"')));

it('works out VAT and the 2% withheld for a VAT-registered customer who withholds, and what is left to pay', async () => {
  taxed(true, 'twa_services');
  const jo = await jobOrder();
  const t = totals(await print(jo));
  for (const [label, value] of [['Total Sales (VAT inclusive)', '₱71,030.00'], ['Less: VAT', '₱7,610.36'], ['Amount net of VAT', '₱63,419.64'],
    ['Less: withholding tax (2%)', '₱1,268.39'], ['Total amount due', '₱69,761.61'], ['Balance due, less tax withheld', '₱69,761.61']]) {
    expect(t).toContain(`<b>${label}:</b> ${value}`);
  }
  expect(t).not.toContain('<b>Total:</b>');

  // Paid with the money and the 2307: nothing is left.
  const input = { customerId: c.school, crNumber: '0301', applications: [{ jobOrderId: jo, amountCents: 7_103_000 }],
    tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: 6_976_161 }], withholding: { cwtCents: 126_839, atc: 'WC160', certificate: 'pending' } };
  const paid = await encoder.post('/api/docs/col.collection/post', { input, expectedTotalCents: 7_103_000 }, idem());
  expect(paid.statusCode, paid.body).toBe(200);
  expect(totals(await print(jo))).toContain('<b>Balance due:</b> ₱0.00');
});

it('adds the 5% VAT a government buyer withholds', async () => {
  taxed(true, 'government');
  const t = totals(await print(await jobOrder()));
  expect(t).toContain('<b>Less: withholding tax (1%):</b> ₱634.20');
  expect(t).toContain('<b>Less: VAT withheld (5%):</b> ₱3,170.98');
  expect(t).toContain('<b>Total amount due:</b> ₱67,224.82');
});

it('shows only the total for any other customer', async () => {
  for (const [vat, profile] of [[false, 'twa_services'], [true, 'none'], [false, 'none']] as const) {
    taxed(vat, profile);
    const t = totals(await print(await jobOrder()));
    expect(t).toContain('<b>Total:</b> ₱71,030.00');
    expect(t).not.toContain('Less: VAT');
    expect(t).toContain('<b>Balance due:</b> ₱71,030.00');
  }
});
