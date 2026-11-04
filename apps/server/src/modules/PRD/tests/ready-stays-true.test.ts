/**
 * A job order is Ready only when its pieces are made (the ERP review, Nov 2026): cancelling an entry, raising a quantity
 * or swapping an item takes it back, and a wearer not finished does not go out. Made-up people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { currentStage, releasableQty } from '../../JO/public.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { lineRoute } from '../production.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv, encoder: Client, production: Client;
let c: ReturnType<typeof seedCustomers>, w: ReturnType<typeof seedEmployees>;
beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  production = await env.as('production');
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

const [SEWING, PACKING] = [6, 8];
const PE = '/api/docs/prd.entry';
const line = (qty: number, description = 'Team shirt', roster: object[] = []) => ({ kind: 'made_to_order', description, qty, unitPriceCents: 30_000, discountCents: 0, roster });
const inputOf = (lines: object[]) => ({ customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'cod', lines });
async function jo(lines: object[]) {
  const input = inputOf(lines);
  const p = await encoder.post('/api/docs/jo.job_order/preview', { input });
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
async function edit(id: string, lines: object[]) {
  const input = inputOf(lines);
  const p = await encoder.post('/api/docs/jo.job_order/preview', { input });
  const r = await encoder.post(`/api/docs/jo.job_order/${id}/reissue`, { input, expectedTotalCents: p.json().totalCents, reason: 'The school changed the order' }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
const setup = (j: string, stepIds: number[], extra: object = {}) => production.post(`/api/prd/jobs/${j}/lines/1/setup`, { stepIds, garmentType: 'T-shirt', complexity: 'standard', ...extra });
async function record(j: string, stepId: number, rows: object[]) {
  const input = { jobOrderId: j, stepId, rows };
  const p = await production.post(`${PE}/preview`, { input });
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
const statusOf = (j: string) => lineRoute(env.db, j, 1)!.map((s) => s.status);

describe('Ready means made', () => {
  it('cancelling the entry that completed a step opens it again and takes the job order off Ready', async () => {
    const j = await jo([line(10)]);
    await setup(j, [SEWING]);
    const e = await record(j, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10 }]);
    expect(currentStage(env.db, j)).toBe('ready');
    expect((await production.post(`${PE}/${e}/cancel`, { reason: 'Recorded on the wrong job order' }, idem())).statusCode).toBe(200);
    expect(statusOf(j)).toEqual(['pending']);
    expect(currentStage(env.db, j)).toBe('in_production');
    expect([...releasableQty(env.db, j)]).toEqual([[1, 0]]);
    await record(j, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10 }]); // and the work can be recorded again
    expect(currentStage(env.db, j)).toBe('ready');
  });

  it('a quantity raised on an edit leaves the step open for the new pieces', async () => {
    const j = await jo([line(10)]);
    await setup(j, [SEWING]);
    await record(j, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10 }]);
    const next = await edit(j, [line(15)]);
    expect(statusOf(next)).toEqual(['in_progress']);
    expect(currentStage(env.db, next)).toBe('in_production');
    expect([...releasableQty(env.db, next)]).toEqual([[1, 10]]);
    await record(next, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 5 }]);
    expect(currentStage(env.db, next)).toBe('ready');
  });

  it('an edit that swaps the only item for a new one is not Ready', async () => {
    const j = await jo([line(5)]);
    await setup(j, [PACKING]);
    await record(j, PACKING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 5 }]);
    const next = await edit(j, [line(3, 'Baseball cap')]);
    expect(currentStage(env.db, next)).toBe('in_production');
    expect([...releasableQty(env.db, next)]).toEqual([[1, 0]]);
  });

  it('a step with only the uppers of a set recorded is not Not needed', async () => {
    const j = await jo([line(10, 'Team set')]);
    expect((await setup(j, [PACKING, SEWING], { isSet: true })).statusCode).toBe(200);
    await record(j, PACKING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 5, part: 'upper' }]);
    const r = await production.post(`/api/prd/jobs/${j}/lines/1/steps/${PACKING}/not-needed`, {});
    expect([r.statusCode, r.json().code]).toEqual([409, 'HAS_PIECES']);
  });

  it('a wearer not finished does not go out, whatever the count says', async () => {
    const roster = ['Ana', 'Ben', 'Cy'].map((name) => ({ name, sizeMode: 'preset', size: 'M', qty: 1 }));
    const j = await jo([line(3, 'Team shirt', roster)]);
    await setup(j, [PACKING]);
    await record(j, PACKING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, wearers: [1] }]);
    const input = (wearers: number[]) => ({ jobOrderId: j, lines: [{ lineNo: 1, qty: 1, wearers }], claimedBy: 'Sample Coach', idSeen: 'school_id', creditNote: 'Balance on delivery of the rest', creditDueInDays: 30 });
    const codes = async (wearers: number[]) => ((await encoder.post('/api/docs/jo.release/preview', { input: input(wearers) })).json().issues as { level: string; code: string }[]).filter((i) => i.level === 'error').map((i) => i.code);
    expect(await codes([3])).toContain('WEARER_NOT_READY');
    expect(await codes([1])).not.toContain('WEARER_NOT_READY');
  });
});
