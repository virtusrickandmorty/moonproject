/**
 * Long item names (the owner's decision, Oct 2026: up to 150 letters, GARMENT_TYPE_MAX): a price list item's rates are
 * kept under its whole name, and the production board remembers the whole name, so the rate is found when pieces are
 * recorded. Before, the board and the rate table stopped at 60 letters: a longer name's rate could not be saved, and the
 * board looked for the cut name and found no rate.
 */
import { expect, it } from 'vitest';
import { GARMENT_TYPE_MAX } from '@moonproject/shared';
import { createTestEnv, idem } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';
import { lineSetup } from '../production.ts';

const LONG = 'Cut & Sew Scrub Pants Cargo ---(Pockets: Hips (L/R), Knee Level (L/R) + 1 Back Pocket)'; // 86 letters, a real one
const SEWING = 6;

it('an item named up to 150 letters gets its rate saved, remembered whole on the board, and paid', async () => {
  expect(LONG.length).toBe(86);
  expect(GARMENT_TYPE_MAX).toBe(150);
  const env = await createTestEnv();
  const [owner, encoder, production, accountant] = [await env.as('owner'), await env.as('encoder'), await env.as('production'), await env.as('accountant')];
  const c = seedCustomers(env.db, encoder.userId);
  const w = seedEmployees(env.db);
  expect((await owner.post('/api/cat/items', { class: 'made_to_order_garment', name: LONG, garmentType: LONG, unit: 'pc', setComponents: 1 })).statusCode).toBe(200);
  // The rate is saved under the whole name (refused before: over 60 letters).
  const rate = await accountant.post('/api/rate/rates', { garmentType: LONG, stepCode: 'SEWING', complexity: 'standard', rateCents: 5_500, effectiveFrom: '2026-09-28', reason: 'Sewing rate for the cargo scrub pants' });
  expect(rate.statusCode, rate.body).toBe(200);
  // Too long for any of them: refused alike.
  const tooLong = 'x'.repeat(GARMENT_TYPE_MAX + 1);
  expect((await accountant.post('/api/rate/rates', { garmentType: tooLong, stepCode: 'SEWING', complexity: 'standard', rateCents: 100, effectiveFrom: '2026-09-28', reason: 'Too long a garment type' })).statusCode).toBe(400);
  expect((await owner.post('/api/cat/items', { class: 'made_to_order_garment', name: tooLong, garmentType: tooLong, unit: 'pc', setComponents: 1 })).statusCode).toBe(400);

  const lines = [{ kind: 'made_to_order', description: LONG, qty: 3, unitPriceCents: 60_000, discountCents: 0, roster: [] }];
  const jo = (await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 180_000 }, idem())).json().id as string;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { stepIds: [SEWING], complexity: 'standard' })).statusCode).toBe(200);
  expect(lineSetup(env.db, jo, 1)?.garmentType).toBe(LONG); // whole, not cut at 60

  const input = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId: w.sewer1, pieces: 3 }] };
  const preview = (await production.post('/api/docs/prd.entry/preview', { input })).json() as { totalCents: number; issues: { code: string; level: string }[] };
  expect(preview.issues.filter((i) => i.level === 'error')).toEqual([]); // no NO_RATE
  expect(preview.totalCents).toBe(16_500); // 3 pieces × ₱55.00, the item's rate
  // Switching a long garment type's rates off is accepted too (it was capped at 60).
  expect((await owner.post('/api/rate/garment-types/switch', { garmentType: LONG, on: false, reason: 'Checking the long name is accepted' })).json().code).not.toBe('INVALID_INPUT');
});
