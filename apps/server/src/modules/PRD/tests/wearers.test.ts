/**
 * Ticking wearers on Record pieces (the owner's request, Oct 2026): a row names the wearers it finished, its pieces are
 * their quantities, a wearer is done once per step, and a cancelled entry frees them again.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let encoder: Client, production: Client;
let c: ReturnType<typeof seedCustomers>;
let w: ReturnType<typeof seedEmployees>;
beforeEach(async () => {
  env = await createTestEnv();
  [encoder, production] = [await env.as('encoder'), await env.as('production')];
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

const [SEWING, PACKING] = [6, 8];
const PE = '/api/docs/prd.entry';

/** A job order whose line 1 lists four wearers (quantities 1, 2, 1, 1). */
async function jobOrder(): Promise<string> {
  const roster = [['Ana Reyes', 1], ['Ben Cruz', 2], ['Cy Lim', 1], ['Dee Tan', 1]].map(([name, qty]) => ({ name, sizeMode: 'preset', size: 'M', qty }));
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 5, unitPriceCents: 30_000, discountCents: 0, roster }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 150_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json().id as string;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  return jo;
}
const entry = (jo: string, rows: object[], stepId = SEWING) => ({ jobOrderId: jo, stepId, rows });
const codes = async (input: object) => ((await production.post(`${PE}/preview`, { input })).json().issues as { code: string; level: string }[]).filter((i) => i.level === 'error').map((i) => i.code);
async function record(input: object) {
  const p = await production.post(`${PE}/preview`, { input });
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
const doneOn = async (jo: string, stepId: number) =>
  ((await production.get(`/api/prd/jobs/${jo}`)).json().lines[0].route as { id: number; doneWearers: number[] }[]).find((s) => s.id === stepId)!.doneWearers.sort();

it('lists the wearers of a line, keeps who each row finished, and counts the pieces from them', async () => {
  const jo = await jobOrder();
  const job = (await production.get(`/api/prd/jobs/${jo}`)).json();
  expect(job.lines[0].roster.map((r: { rowNo: number; wearerName: string; qty: number }) => [r.rowNo, r.wearerName, r.qty])).toEqual([[1, 'Ana Reyes', 1], [2, 'Ben Cruz', 2], [3, 'Cy Lim', 1], [4, 'Dee Tan', 1]]);
  expect(await doneOn(jo, SEWING)).toEqual([]);

  // Two sewers share the wearers; each row's pieces are its wearers' quantities.
  const first = await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 3, wearers: [1, 2] }, { lineNo: 1, employeeId: w.sewer2, pieces: 1, wearers: [3] }]));
  expect(await doneOn(jo, SEWING)).toEqual([1, 2, 3]);
  expect(await doneOn(jo, PACKING)).toEqual([]); // done per step
  expect((await production.get(`${PE}/${first.id}`)).json().input.rows.map((r: { wearers?: number[] }) => r.wearers)).toEqual([[1, 2], [3]]);

  // Who is done cannot be ticked again; the pieces must match; a wearer the line does not have is refused.
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, wearers: [1] }]))).toEqual(['WEARER_DONE']);
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, wearers: [4] }]))).toContain('WEARERS_PIECES');
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, wearers: [9] }]))).toContain('WEARER');
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, wearers: [4] }, { lineNo: 1, employeeId: w.sewer2, pieces: 1, wearers: [4] }]))).toContain('WEARER_TWICE');

  // The last wearer: all 5 pieces are sewn, so Sewing can be completed.
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, wearers: [4] }]));
  expect(await doneOn(jo, SEWING)).toEqual([1, 2, 3, 4]);
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${SEWING}/complete`, {})).statusCode).toBe(200);
});

it('frees the wearers of a cancelled entry; rework names no wearers; a row without wearers still works', async () => {
  const jo = await jobOrder();
  const e = await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, wearers: [2] }]));
  expect((await production.post(`${PE}/${e.id}/cancel`, { reason: 'Recorded on the wrong job order' }, idem())).statusCode).toBe(200);
  expect(await doneOn(jo, SEWING)).toEqual([]);
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1, rework: true, rateCents: 2_000, rateReason: 'Pasubra on a seam', wearers: [1] }]))).toEqual(['WEARERS_KIND']);
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2 }])); // counted, no wearers named
  expect(await doneOn(jo, SEWING)).toEqual([]);
});
