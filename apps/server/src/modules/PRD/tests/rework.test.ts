/**
 * Forwarded wearers and rework sent back (the owner's request, Oct 2026): a step's wearer list is the wearers that came
 * out of the step before; pieces needing rework go back to a step they went through, labelled rework there, without
 * replacing what was done, and are held back from release until the rework is recorded.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { currentStage } from '../../JO/public.ts';
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

/** A job order whose line 1 lists four wearers (quantities 1, 2, 1, 1), made through Sewing then Packing. */
async function jobOrder(): Promise<string> {
  const roster = [['Ana Reyes', 1], ['Ben Cruz', 2], ['Cy Lim', 1], ['Dee Tan', 1]].map(([name, qty]) => ({ name, sizeMode: 'preset', size: 'M', qty }));
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 5, unitPriceCents: 30_000, discountCents: 0, roster }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 150_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json().id as string;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  return jo;
}
const entry = (jo: string, rows: object[], stepId = SEWING, more: object = {}) => ({ jobOrderId: jo, stepId, rows, ...more });
const codes = async (input: object) => ((await production.post(`${PE}/preview`, { input })).json().issues as { code: string; level: string }[]).filter((i) => i.level === 'error').map((i) => i.code);
async function record(input: object) {
  const p = await production.post(`${PE}/preview`, { input });
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
}
type JobStep = { id: number; status: string; pieces: number; reworkPieces: number; forwardedWearers: number[] | null; rework: { pieces: number; wearers: number[] } };
const stepOf = async (jo: string, stepId: number) => ((await production.get(`/api/prd/jobs/${jo}`)).json().lines[0].route as JobStep[]).find((s) => s.id === stepId)!;
const cardOf = async (jo: string) => ((await production.get('/api/prd/board')).json() as { jobOrderId: string; ready: boolean; finishedPieces: number; steps: { stepId: number; reworkOpen: number }[] }[]).find((x) => x.jobOrderId === jo)!;
const sendBack = (jo: string, body: object) => production.post(`/api/prd/jobs/${jo}/lines/1/rework`, body);
const readyQty = async (jo: string) => (await encoder.get(`/api/jo/orders/${jo}/status`)).json().lines[0].readyQty as number;
const pasubra = { rework: true, rateCents: 2_000, rateReason: 'Pasubra rate' };

it('lists on a step only the wearers forwarded from the step before', async () => {
  const jo = await jobOrder();
  expect((await stepOf(jo, SEWING)).forwardedWearers).toBeNull(); // the first step takes everyone
  expect((await stepOf(jo, PACKING)).forwardedWearers).toEqual([]);

  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 3, wearers: [1, 2] }]));
  expect((await stepOf(jo, PACKING)).forwardedWearers).toEqual([1, 2]);

  // A wearer not sewn yet cannot be packed, unless a reason says why.
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 1, wearers: [3] }], PACKING))).toEqual(['WEARER_NOT_FORWARDED']);
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 1, wearers: [3] }], PACKING, { overCapReason: 'Sewn at home, sheet comes later' }))).toEqual([]);
  await record(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 1, wearers: [1] }], PACKING));

  // Sewn pieces without naming wearers: who came out is unknown, so every wearer shows.
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1 }]));
  expect((await stepOf(jo, PACKING)).forwardedWearers).toBeNull();
});

it('sends pieces back to the first step, through every step again as rework, without replacing what was done', async () => {
  const jo = await jobOrder();
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 5, wearers: [1, 2, 3, 4] }]));
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${SEWING}/complete`, {})).statusCode).toBe(200);
  await record(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 5, wearers: [1, 2, 3, 4] }], PACKING));
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${PACKING}/complete`, {})).statusCode).toBe(200);
  expect(currentStage(env.db, jo)).toBe('ready');

  // Ben's 2 shirts go back to the beginning (Sewing): Sewing keeps its 5 pieces done, and shows 2 rework.
  const sent = await sendBack(jo, { wearers: [2], reason: 'Seam opened on both shirts' });
  expect(sent.statusCode, sent.body).toBe(200);
  const sewing = await stepOf(jo, SEWING);
  expect(sewing.pieces).toBe(5);
  expect(sewing.rework).toMatchObject({ pieces: 2, wearers: [2] });
  expect((await stepOf(jo, PACKING)).rework).toMatchObject({ pieces: 0, wearers: [] });
  expect(await cardOf(jo)).toMatchObject({ ready: false, finishedPieces: 3 });
  expect((await cardOf(jo)).steps.map((s) => s.reworkOpen)).toEqual([2, 0]);
  expect(currentStage(env.db, jo)).toBe('in_production');
  expect(await readyQty(jo)).toBe(3); // the other 3 can still go out

  // Not twice; not more than was done; a reason is needed.
  expect((await sendBack(jo, { wearers: [2], reason: 'Seam opened again' })).json().code).toBe('WEARER_IN_REWORK');
  expect((await sendBack(jo, { pieces: 4, reason: 'Too many pieces sent back' })).json().code).toBe('REWORK_OVER');
  expect((await sendBack(jo, { wearers: [1], reason: 'short' })).json().code).toBe('REASON_REQUIRED');

  // Rework goes on the completed step; normal work there still needs a reopen.
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1, wearers: [9], ...pasubra }]))).toContain('WEARER');
  expect(await codes(entry(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1 }]))).toContain('STEP_CLOSED');
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 2, wearers: [2], ...pasubra }]));

  // Redone at Sewing, they move on to Packing as rework; still not ready.
  const redone = await stepOf(jo, SEWING);
  expect([redone.pieces, redone.reworkPieces]).toEqual([5, 2]);
  expect(redone.rework).toMatchObject({ pieces: 0, wearers: [] });
  expect((await stepOf(jo, PACKING)).rework).toMatchObject({ pieces: 2, wearers: [2] });
  expect(await cardOf(jo)).toMatchObject({ ready: false, finishedPieces: 3 });

  // Packed again (paid the table rate): done, ready, all 5 can go.
  await record(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 2, wearers: [2], rework: true }], PACKING));
  expect((await stepOf(jo, PACKING)).rework).toMatchObject({ pieces: 0, wearers: [] });
  expect(await cardOf(jo)).toMatchObject({ ready: true, finishedPieces: 5 });
  expect(currentStage(env.db, jo)).toBe('ready');
  expect(await readyQty(jo)).toBe(5);
});

it('sends back a count of pieces on a line recorded without wearers', async () => {
  const jo = await jobOrder();
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 4 }]));
  expect((await sendBack(jo, { pieces: 1, reason: 'Wrong thread colour used' })).statusCode).toBe(200);
  expect((await stepOf(jo, SEWING)).rework).toMatchObject({ pieces: 1, wearers: [] });
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, ...pasubra }]));
  expect((await stepOf(jo, SEWING)).rework.pieces).toBe(0);
  expect((await stepOf(jo, PACKING)).rework.pieces).toBe(1); // on to the next step
  expect((await sendBack(jo, { pieces: 4, reason: 'More than was sewn' })).json().code).toBe('REWORK_OVER');
});

it('completes a step on its own once its pieces and the rework that reached it are all recorded', async () => {
  const jo = await jobOrder();
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 5, wearers: [1, 2, 3, 4] }]));
  expect((await stepOf(jo, SEWING)).status).toBe('completed'); // all 5 sewn: no Complete click

  // Ben (2) is found bad before packing: back to Sewing; the other 3 are packed.
  expect((await sendBack(jo, { wearers: [2], reason: 'Wrong collar, redo it' })).statusCode).toBe(200);
  expect((await stepOf(jo, PACKING)).forwardedWearers).toBeNull(); // Sewing is completed: all listed, Ben comes as rework
  await record(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 3, wearers: [1, 3, 4] }], PACKING));
  expect((await stepOf(jo, PACKING)).status).toBe('in_progress');
  expect(await cardOf(jo)).toMatchObject({ finishedPieces: 3 });

  // Redone at Sewing, then packed as rework: Packing has every piece now and completes on its own.
  await record(entry(jo, [{ lineNo: 1, employeeId: w.sewer2, pieces: 2, wearers: [2], rework: true }]));
  expect(await cardOf(jo)).toMatchObject({ finishedPieces: 3, ready: false });
  await record(entry(jo, [{ lineNo: 1, employeeId: w.packer, pieces: 2, wearers: [2], rework: true }], PACKING));
  expect((await stepOf(jo, PACKING)).status).toBe('completed');
  expect(await cardOf(jo)).toMatchObject({ finishedPieces: 5, ready: true });
  expect(currentStage(env.db, jo)).toBe('ready');
});
