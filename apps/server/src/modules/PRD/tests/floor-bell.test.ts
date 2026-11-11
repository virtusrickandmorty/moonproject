/**
 * The floor app's bell (the owner's request, Nov 2026): each worker is told of the new jobs on their own steps and of
 * those falling due (tomorrow, today, late), and marks their own read; another worker's stay unread.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, createUser, idem, login, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let production: Client, owner: Client, sewer: Client, stitcher: Client, packer: Client;
let jo: string, packerId: string;
const SEWING = 6, PACKING = 8, DAY = 86_400_000;
/** Some days later: everyone signs in again (a session does not last days). */
const later = async (days: number) => {
  env.clock.advance(days * DAY);
  [sewer, stitcher, packer] = [await login(env.app, 'sewer.one', PASSWORD), await login(env.app, 'sewer.two', PASSWORD), await login(env.app, 'packer.one', PASSWORD)];
  production = await env.as('production');
};
const bell = async (c: Client) => { const r = await c.get('/api/prd/floor/notifications'); expect(r.statusCode, r.body).toBe(200); return r.json() as { id: string; kind: string; read: boolean; stepName: string; jobOrderNumber: string; left: number }[]; };

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28, 10 AM in Manila
  const encoder = await env.as('encoder');
  [production, owner] = [await env.as('production'), await env.as('owner')];
  const c = seedCustomers(env.db, encoder.userId);
  const w = seedEmployees(env.db);
  const lines = [{ kind: 'made_to_order', description: 'Sample team shirt', qty: 8, unitPriceCents: 30_000, discountCents: 0, roster: [] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 240_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  jo = r.json().id;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  const link = async (employee: string, username: string, steps: number[]) => {
    const user = createUser(env.db, username, ['worker']);
    expect((await owner.put(`/api/emp/employees/${employee}/floor-user`, { userId: user })).statusCode).toBe(200);
    expect((await production.put(`/api/prd/worker-steps/${employee}`, { stepIds: steps })).statusCode).toBe(200);
    return login(env.app, username, PASSWORD);
  };
  sewer = await link(w.sewer1, 'sewer.one', [SEWING]);
  stitcher = await link(w.sewer2, 'sewer.two', [SEWING]);
  packer = await link(w.packer, 'packer.one', []);
  packerId = w.packer;
});

it('tells each worker of a new job on their own steps, once, and keeps their own reads', async () => {
  const mine = await bell(sewer);
  expect(mine).toEqual([expect.objectContaining({ kind: 'new', read: false, stepName: 'Sewing', left: 8 })]);
  expect(await bell(packer)).toEqual([]); // no steps ticked: nothing

  // Read: only their own ids count; the other sewer's stays unread.
  const read = await sewer.post('/api/prd/floor/notifications/read', { ids: [mine[0]!.id, 'new:someone-else'] });
  expect(read.json()).toEqual({ read: 1 });
  expect((await bell(sewer))[0]!.read).toBe(true);
  expect((await bell(stitcher))[0]!.read).toBe(false);
  expect((await sewer.post('/api/prd/floor/notifications/read', { ids: [] })).statusCode).toBe(400);

  // Packing ticked for the packer: the job on it is new to them too.
  expect((await production.put(`/api/prd/worker-steps/${packerId}`, { stepIds: [PACKING] })).statusCode).toBe(200);
  expect(await bell(packer)).toEqual([expect.objectContaining({ kind: 'new', stepName: 'Packing' })]);
  // After a week it is not new any more.
  await later(8);
  expect(await bell(stitcher)).toEqual([]);
});

it('tells of a job due tomorrow, due today and late, each once, until its pieces are done', async () => {
  await later(9); // due tomorrow
  let notes = await bell(sewer);
  expect(notes.map((n) => n.kind)).toEqual(['tomorrow']);
  await sewer.post('/api/prd/floor/notifications/read', { ids: [notes[0]!.id] });
  expect((await bell(sewer)).filter((n) => !n.read)).toEqual([]);

  await later(1); // due today: a new one
  notes = await bell(sewer);
  expect(notes.filter((n) => !n.read).map((n) => n.kind)).toEqual(['today']);
  await later(1); // late
  expect((await bell(sewer)).map((n) => n.kind)).toEqual(['late']);

  // Sewing finished: nothing more to tell the sewers.
  await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${SEWING}/not-needed`, { reason: 'Sewn by the customer' });
  expect(await bell(sewer)).toEqual([]);
});
