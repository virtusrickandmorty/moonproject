/** The production summary of a job order, and changing the worker on a recorded row (the owner's request, Oct 2026). */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let encoder: Client, production: Client, owner: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let w: ReturnType<typeof seedEmployees>;
beforeEach(async () => {
  env = await createTestEnv();
  [encoder, production, owner, accountant] = [await env.as('encoder'), await env.as('production'), await env.as('owner'), await env.as('accountant')];
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

const [SEWING, PACKING] = [6, 8];
const PE = '/api/docs/prd.entry';
async function jobOrder(): Promise<string> {
  const roster = [['Ana Reyes', 1], ['Ben Cruz', 1]].map(([name, qty]) => ({ name, sizeMode: 'preset', size: 'M', qty }));
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 2, unitPriceCents: 30_000, discountCents: 0, roster }];
  const jo = (await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 60_000 }, idem())).json().id as string;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  return jo;
}
async function record(jo: string, stepId: number, rows: object[]) {
  const input = { jobOrderId: jo, stepId, rows };
  const p = await production.post(`${PE}/preview`, { input });
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
type Summary = { allDone: boolean; lines: { done: boolean; steps: { stepId: number; status: string; rows: { entryId: string; rowNo: number; employeeId: string; employeeName: string; pieces: number; wearers: string[]; paid: boolean }[] }[] }[] };
const summary = async (jo: string) => (await production.get(`/api/prd/jobs/${jo}/summary`)).json() as Summary;

it('shows every step with who made what and the wearers; the owner or the accountant can change the worker of a done step', async () => {
  const jo = await jobOrder();
  const sewn = await record(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, wearers: [1, 2] }]);
  await record(jo, PACKING, [{ lineNo: 1, employeeId: w.packer, pieces: 2, wearers: [1, 2] }]);
  const s = await summary(jo);
  expect(s.allDone).toBe(true);
  const sewing = s.lines[0]!.steps.find((x) => x.stepId === SEWING)!;
  expect(sewing).toMatchObject({ status: 'completed', rows: [{ entryId: sewn.id, rowNo: 1, employeeId: w.sewer1, pieces: 2, paid: false }] });
  expect(sewing.rows[0]!.wearers).toEqual(['Ana Reyes · M', 'Ben Cruz · M']);

  // Production may not; a reason is needed; the same worker is refused.
  const move = (who: Client, body: object) => who.post(`/api/prd/entries/${sewn.id}/reassign`, body);
  expect((await move(production, { rowNo: 1, employeeId: w.sewer2, reason: 'Sewn by the other sewer' })).statusCode).toBe(403);
  expect((await move(encoder, { rowNo: 1, employeeId: w.sewer2, reason: 'Sewn by the other sewer' })).statusCode).toBe(403);
  expect((await move(owner, { rowNo: 1, employeeId: w.sewer2, reason: 'short' })).statusCode).toBe(400);
  expect((await move(owner, { rowNo: 1, employeeId: w.sewer1, reason: 'Sewn by the other sewer' })).json()).toMatchObject({ code: 'SAME_WORKER' });

  // Moved, though Sewing is completed: the entry is edited, the step stays done, the wearers stay.
  const moved = await move(accountant, { rowNo: 1, employeeId: w.sewer2, reason: 'Sewn by the other sewer' });
  expect(moved.statusCode, moved.body).toBe(200);
  const after = (await summary(jo)).lines[0]!.steps.find((x) => x.stepId === SEWING)!;
  expect(after).toMatchObject({ status: 'completed', rows: [{ employeeId: w.sewer2, pieces: 2, wearers: ['Ana Reyes · M', 'Ben Cruz · M'] }] });
  expect(env.db.prepare('SELECT status, replaced_by_id IS NOT NULL AS replaced FROM documents WHERE id = ?').get(sewn.id)).toEqual({ status: 'cancelled', replaced: 1 });
  expect((await move(owner, { rowNo: 1, employeeId: w.sewer1, reason: 'Back to the first sewer' })).json()).toMatchObject({ code: 'CANCELLED' });
});

it('refuses to change the worker once the entry is paid in a payroll run', async () => {
  const jo = await jobOrder();
  const sewn = await record(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, wearers: [1, 2] }]);
  env.db.prepare("UPDATE prd_assignments SET pay_run_line_id = 'paid-in-a-run' WHERE document_id = ?").run(sewn.id);
  expect((await owner.post(`/api/prd/entries/${sewn.id}/reassign`, { rowNo: 1, employeeId: w.sewer2, reason: 'Sewn by the other sewer' })).json()).toMatchObject({ code: 'PAID' });
  expect((await summary(jo)).lines[0]!.steps.find((x) => x.stepId === SEWING)!.rows[0]).toMatchObject({ paid: true });
});

it('groups the production entries by job order, an edited one under the job order it is now, newest work first', async () => {
  const jo = await jobOrder();
  await record(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1, wearers: [1] }]);
  await record(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 1, wearers: [2] }]);
  type Row = { id: string; number: string; entries: number; pieces: number; workers: number; stage: string };
  const list = async (q = '') => ((await production.get(`/api/prd/entries/by-job-order${q ? `?q=${q}` : ''}`)).json() as { rows: Row[] }).rows;
  expect(await list()).toEqual([expect.objectContaining({ id: jo, entries: 2, pieces: 2, workers: 2 })]);
  expect(await list('nobody-matches')).toEqual([]);

  // The job order edited: its entries show under the new one.
  const input = { customerId: c.school, dueInDays: 12, priority: 'normal', paymentTerms: 'full', lines: [{ kind: 'made_to_order', description: 'Team shirt', qty: 2, unitPriceCents: 30_000, discountCents: 0,
    roster: [['Ana Reyes', 1], ['Ben Cruz', 1]].map(([name, qty]) => ({ name, sizeMode: 'preset', size: 'M', qty })) }] };
  const edited = (await encoder.post(`/api/docs/jo.job_order/${jo}/reissue`, { input, expectedTotalCents: 60_000, reason: 'Due date moved by the school' }, idem())).json().id as string;
  expect((await list()).map((r) => [r.id, r.entries])).toEqual([[edited, 2]]);
});
