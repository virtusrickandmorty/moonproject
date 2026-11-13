/**
 * Editing an entry: the preview checks the new version as Record will, with the entry it replaces cancelled (the owner's
 * report, Nov 2026: "Line 1 is 4 pieces and 4 ... are recorded, so at most 0 more" when changing an entry's date or
 * worker). Nothing is written by the preview. Made-up people only.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let owner: Client;
let w: ReturnType<typeof seedEmployees>;
let jo: string;
const SEWING = 6, PACKING = 8;
const PE = '/api/docs/prd.entry';
const yesterday = () => new Date(Date.parse(env.clock.now().toISOString()) + 8 * 3600_000 - 86_400_000).toISOString().slice(0, 10); // Manila
const codes = (issues: { code: string; level: string }[]) => issues.filter((i) => i.level === 'error').map((i) => i.code);

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const encoder = await env.as('encoder');
  const c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
  const input = { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full',
    lines: [{ kind: 'made_to_order', description: 'Made-up shorts', qty: 4, unitPriceCents: 20_000, discountCents: 0, roster: [] }] };
  const p = await encoder.post('/api/docs/jo.job_order/preview', { input });
  jo = (await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: p.json().totalCents }, idem())).json().id;
  const setup = await owner.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' });
  expect(setup.statusCode, setup.body).toBe(200);
});

async function recordAll(): Promise<string> {
  const input = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId: w.sewer1, pieces: 4 }] };
  const p = await owner.post(`${PE}/preview`, { input });
  const r = await owner.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
const state = () => ({
  entries: env.db.prepare(`SELECT id, status FROM documents WHERE doc_type = 'prd.entry' ORDER BY id`).all(),
  audit: env.db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get(),
  journals: env.db.prepare('SELECT COUNT(*) FROM journals').pluck().get(),
});

it('lets an entry that recorded the whole line change its worker, date or pieces', async () => {
  const id = await recordAll();
  const edited = { jobOrderId: jo, stepId: SEWING, workDate: yesterday(), rows: [{ lineNo: 1, employeeId: w.sewer2, pieces: 4 }] };
  // A plain preview counts the entry being edited too.
  expect(codes((await owner.post(`${PE}/preview`, { input: edited })).json().issues)).toContain('OVER_QTY');
  const before = state();
  const p = await owner.post(`${PE}/preview`, { input: edited, replacesId: id });
  expect(p.statusCode, p.body).toBe(200);
  expect(codes(p.json().issues)).toEqual([]);
  expect(state()).toEqual(before); // nothing written
  const fewer = await owner.post(`${PE}/preview`, { input: { ...edited, rows: [{ lineNo: 1, employeeId: w.sewer2, pieces: 3 }] }, replacesId: id });
  expect(codes(fewer.json().issues)).toEqual([]);
  const r = await owner.post(`${PE}/${id}/reissue`, { input: edited, expectedTotalCents: p.json().totalCents, reason: 'Wrong worker and date' }, idem());
  expect(r.statusCode, r.body).toBe(200);
});

it('still turns down more pieces than the line has, on an edit too', async () => {
  const id = await recordAll();
  const more = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId: w.sewer1, pieces: 5 }] };
  const p = await owner.post(`${PE}/preview`, { input: more, replacesId: id });
  expect(codes(p.json().issues)).toContain('OVER_QTY');
  expect(p.json().issues.find((i: { code: string }) => i.code === 'OVER_QTY').message).toContain('so at most 4 more');
});

it('needs the right to cancel, and a recorded entry of that kind', async () => {
  const id = await recordAll();
  const input = { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId: w.sewer2, pieces: 4 }] };
  expect((await owner.post(`${PE}/preview`, { input, replacesId: 'no-such-entry' })).statusCode).toBe(404);
  expect((await owner.post(`${PE}/preview`, { input, replacesId: jo })).statusCode).toBe(404); // a job order, not an entry
  const tv = await env.as('tv').catch(() => null);
  if (tv) expect((await tv.post(`${PE}/preview`, { input, replacesId: id })).statusCode).toBe(403);
});
