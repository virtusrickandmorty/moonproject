/**
 * Releasing what is ready (the owner's rule, Oct 2026): an item whose production is done goes out while the others are
 * still being made; a line still being made needs the owner's override; cancelling puts the job order back In production.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from './cus-fixture.ts';
import { seedEmployees } from '../../PRD/tests/emp-fixture.ts';
import { currentStage } from '../public.ts';

let env: TestEnv;
let encoder: Client, production: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let w: ReturnType<typeof seedEmployees>;
beforeEach(async () => {
  env = await createTestEnv();
  [encoder, production, accountant] = [await env.as('encoder'), await env.as('production'), await env.as('accountant')];
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

const [SEWING, PACKING] = [6, 8];
const credit = { creditNote: 'Balance by bank transfer', creditDueInDays: 7 };

async function jobOrder(): Promise<string> {
  const lines = ['Team shirt', 'Team shorts'].map((description) => ({ kind: 'made_to_order', description, qty: 4, unitPriceCents: 30_000, discountCents: 0, roster: [] }));
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 240_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json().id as string;
  for (const line of [1, 2]) expect((await production.post(`/api/prd/jobs/${jo}/lines/${line}/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  return jo;
}
/** Every piece of a line through every step, then the step completed. */
async function finish(jo: string, line: number, steps = [SEWING, PACKING]) {
  for (const stepId of steps) {
    const input = { jobOrderId: jo, stepId, rows: [{ lineNo: line, employeeId: stepId === SEWING ? w.sewer1 : w.packer, pieces: 4 }] };
    const p = await production.post('/api/docs/prd.entry/preview', { input });
    expect((await production.post('/api/docs/prd.entry/post', { input, expectedTotalCents: p.json().totalCents }, idem())).statusCode).toBe(200);
    expect((await production.post(`/api/prd/jobs/${jo}/lines/${line}/steps/${stepId}/complete`, {})).statusCode).toBe(200);
  }
}
const release = (jo: string, lines: { lineNo: number; qty: number }[], extra = {}) =>
  ({ jobOrderId: jo, lines, claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...credit, ...extra });
const issues = async (body: object) => ((await accountant.post('/api/jo/releases/preview', { release: body })).json().release.issues as { code: string; message: string }[]);
const listed = async (jo: string) => ((await encoder.get('/api/jo/list')).json() as { id: string; readyToRelease: boolean }[]).find((r) => r.id === jo)!.readyToRelease;
const ready = async (jo: string) => ((await encoder.get(`/api/jo/orders/${jo}/status`)).json().lines as { lineNo: number; ready: boolean }[]).map((l) => [l.lineNo, l.ready]);

it('releases an item whose production is done while the other is still being made, and not the other one', async () => {
  const jo = await jobOrder();
  expect(await listed(jo)).toBe(false); // nothing finished yet
  expect((await issues(release(jo, [{ lineNo: 1, qty: 4 }])))[0]).toMatchObject({ code: 'NOT_READY', message: expect.stringMatching(/Mark it Ready for release first/) });

  await finish(jo, 1);
  expect(currentStage(env.db, jo)).toBe('in_production'); // line 2 is not done
  expect(await ready(jo)).toEqual([[1, true], [2, false]]);
  expect(await listed(jo)).toBe(true);
  expect((await issues(release(jo, [{ lineNo: 2, qty: 4 }])))[0]).toMatchObject({ code: 'NOT_READY',
    message: 'Line 2 is still being made. Release only what is finished, or ask the owner to release the rest anyway with a reason.' });
  expect((await issues(release(jo, [{ lineNo: 1, qty: 4 }], { overrideReason: 'Not needed for a ready item' })))[0]).toMatchObject({ code: 'NO_OVERRIDE' });

  const out = await accountant.post('/api/jo/releases', { release: release(jo, [{ lineNo: 1, qty: 4 }]), invoice: null, expectedTotalCents: 120_000 }, idem());
  expect(out.statusCode, out.body).toBe(200);
  expect(currentStage(env.db, jo)).toBe('partially_released');
  expect(await ready(jo)).toEqual([[1, false], [2, false]]); // line 1 is all out; line 2 still being made
  expect(await listed(jo)).toBe(false);

  // Cancelling it: nothing out any more, and line 2 is still being made, so back to In production (not Ready).
  expect((await accountant.post(`/api/docs/jo.release/${out.json().release.id}/cancel`, { reason: 'Released to the wrong person' }, idem())).statusCode).toBe(200);
  expect(currentStage(env.db, jo)).toBe('in_production');

  // Line 2 done: everything is ready.
  await finish(jo, 2);
  expect(currentStage(env.db, jo)).toBe('ready');
  expect(await ready(jo)).toEqual([[1, true], [2, true]]);
});

it('releases the pieces that went through every step first, while the rest of the item is still being made', async () => {
  const jo = await jobOrder();
  // Line 1: all 4 sewn, 3 packed: 3 went through every step.
  for (const [stepId, pieces] of [[SEWING, 4], [PACKING, 3]] as const) {
    const input = { jobOrderId: jo, stepId, rows: [{ lineNo: 1, employeeId: stepId === SEWING ? w.sewer1 : w.packer, pieces }] };
    const p = await production.post('/api/docs/prd.entry/preview', { input });
    expect((await production.post('/api/docs/prd.entry/post', { input, expectedTotalCents: p.json().totalCents }, idem())).statusCode).toBe(200);
  }
  const lines = (await encoder.get(`/api/jo/orders/${jo}/status`)).json().lines as { lineNo: number; ready: boolean; readyQty: number }[];
  expect(lines.map((l) => [l.lineNo, l.ready, l.readyQty])).toEqual([[1, true, 3], [2, false, 0]]);
  expect(await listed(jo)).toBe(true);
  expect((await issues(release(jo, [{ lineNo: 1, qty: 4 }])))[0]).toMatchObject({ code: 'NOT_READY',
    message: 'Line 1: 3 pieces went through every step, so at most 3 can go out now. Release only what is finished, or ask the owner to release the rest anyway with a reason.' });
  const out = await accountant.post('/api/jo/releases', { release: release(jo, [{ lineNo: 1, qty: 3 }]), invoice: null, expectedTotalCents: 90_000 }, idem());
  expect(out.statusCode, out.body).toBe(200);
  expect(currentStage(env.db, jo)).toBe('partially_released');
  // Those 3 are out: nothing more is ready until the last one is packed.
  expect(((await encoder.get(`/api/jo/orders/${jo}/status`)).json().lines as { readyQty: number }[]).map((l) => l.readyQty)).toEqual([0, 0]);
  expect(await listed(jo)).toBe(false);
});
