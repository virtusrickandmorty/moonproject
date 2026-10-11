/**
 * Sets in production (the owner's request, Oct 2026): a job order line takes its garment type, and whether it is a set,
 * from the price list item it matches; a set is made as an upper and a lower part, each paid at its own rate, counted,
 * capped and ticked apart; a step is complete once both parts are done.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';
import { lineSetup } from '../production.ts';

let env: TestEnv;
let owner: Client, encoder: Client, production: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let w: ReturnType<typeof seedEmployees>;
beforeEach(async () => {
  env = await createTestEnv();
  [owner, encoder, production, accountant] = [await env.as('owner'), await env.as('encoder'), await env.as('production'), await env.as('accountant')];
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
  // The price list: a jersey set (upper and lower), and a plain shirt.
  for (const item of [{ name: 'Basketball jersey set', garmentType: 'Jersey set', unit: 'set', setComponents: 2 }, { name: 'Team shirt', garmentType: 'T-shirt', unit: 'pc', setComponents: 1 }]) {
    expect((await owner.post('/api/cat/items', { class: 'made_to_order_garment', ...item })).statusCode).toBe(200);
  }
  for (const [part, rateCents] of [['upper', 4_500], ['lower', 3_000]] as const) {
    expect((await accountant.post('/api/rate/rates', { garmentType: 'Jersey set', stepCode: 'SEWING', complexity: 'standard', part, rateCents, effectiveFrom: '2026-09-28', reason: 'Set rates for the jersey set' })).statusCode).toBe(200);
  }
});

const [SEWING, PACKING] = [6, 8];
const PE = '/api/docs/prd.entry';
async function jobOrder(description: string): Promise<string> {
  const roster = ['Ana Reyes', 'Ben Cruz'].map((name) => ({ name, sizeMode: 'preset', size: 'M', qty: 1 }));
  const lines = [{ kind: 'made_to_order', description, qty: 2, unitPriceCents: 90_000, discountCents: 0, roster }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 180_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json().id as string;
  // No garment type sent: it comes from the price list.
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], complexity: 'standard' })).statusCode).toBe(200);
  return jo;
}
const rows = (jo: string, list: object[], stepId = SEWING) => ({ jobOrderId: jo, stepId, rows: list });
const preview = async (input: object) => (await production.post(`${PE}/preview`, { input })).json() as { totalCents: number; issues: { code: string; level: string }[] };
const errors = async (input: object) => (await preview(input)).issues.filter((i) => i.level === 'error').map((i) => i.code);
async function record(input: object) {
  const p = await preview(input);
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; totalCents: number };
}
const sewing = async (jo: string) => ((await production.get(`/api/prd/jobs/${jo}`)).json().lines[0].route as { id: number; pieces: number; partPieces?: Record<string, number>; partWearersDone?: Record<string, number[]> }[]).find((s) => s.id === SEWING)!;

it('takes the garment type and the parts from the price list item the line matches', async () => {
  const set = await jobOrder('Basketball jersey set: Harbor Rowing');
  expect(lineSetup(env.db, set, 1)).toMatchObject({ garmentType: 'Jersey set', isSet: true });
  const shirt = await jobOrder('Team shirt');
  expect(lineSetup(env.db, shirt, 1)).toMatchObject({ garmentType: 'T-shirt', isSet: false });
  const other = await jobOrder('Embroidered banner');
  expect(lineSetup(env.db, other, 1)).toMatchObject({ garmentType: 'Embroidered banner', isSet: false }); // no match: the description
});

it('makes a set as an upper and a lower part: each paid at its rate, counted, capped and ticked apart; complete with both', async () => {
  const jo = await jobOrder('Basketball jersey set');
  expect(await errors(rows(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1 }]))).toContain('PART_REQUIRED');

  // Ana's upper and lower by two sewers, at each part's rate.
  const upper = await record(rows(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, part: 'upper', wearers: [1] }]));
  expect(upper.totalCents).toBe(4_500);
  const lower = await record(rows(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1, part: 'lower', wearers: [1] }]));
  expect(lower.totalCents).toBe(3_000);
  expect(await sewing(jo)).toMatchObject({ pieces: 1, partPieces: { upper: 1, lower: 1 }, partWearersDone: { upper: [1], lower: [1] } });

  // Ana's upper is done; Ben's is not. Two uppers more than the line has are refused.
  expect(await errors(rows(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, part: 'upper', wearers: [1] }]))).toContain('WEARER_DONE');
  expect(await errors(rows(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, part: 'upper' }]))).toContain('OVER_QTY');

  // Ben's upper only: one complete set of two, so Sewing cannot be completed yet.
  await record(rows(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, part: 'upper', wearers: [2] }]));
  expect(await sewing(jo)).toMatchObject({ pieces: 1, partPieces: { upper: 2, lower: 1 } });
  const short = await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${SEWING}/complete`, {});
  expect(short.json()).toMatchObject({ code: 'PIECES_SHORT', message: expect.stringContaining('2 of 2 upper and 1 of 2 lower') });
  await record(rows(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1, part: 'lower', wearers: [2] }]));
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${SEWING}/complete`, {})).statusCode).toBe(200);
});

it('refuses a part on a line that is not a set', async () => {
  const jo = await jobOrder('Team shirt');
  expect(await errors(rows(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, part: 'upper' }]))).toContain('PART_NOT_SET');
});
