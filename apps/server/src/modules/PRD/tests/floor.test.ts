/**
 * The floor app (the owner's request, Nov 2026): a production worker's own sign-in records their own pieces, today, and
 * sees their own week. Every rule of Record pieces still applies, and the pieces count once the production head approves
 * them (checks.test.ts).
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, createUser, grantRole, idem, login, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let encoder: Client, production: Client, owner: Client, sewer: Client;
let w: ReturnType<typeof seedEmployees>;
let jo: string;
let plainJob: () => Promise<string>;
const SEWING = 6;

beforeEach(async () => {
  env = await createTestEnv();
  grantRole(env, 'production', 'prd.verify'); // the owner ticks it for the production head's role
  [encoder, production, owner] = [await env.as('encoder'), await env.as('production'), await env.as('owner')];
  const c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
  // A job order of 8 team shirts, three wearers, sewn then packed.
  const roster = [['Ana Reyes', 3], ['Ben Cruz', 2], ['Cy Lim', 3]].map(([name, qty]) => ({ name, sizeMode: 'preset', size: 'M', qty }));
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 8, unitPriceCents: 30_000, discountCents: 0, roster }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 240_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  jo = r.json().id;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, 8], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  // A job order of 8 plain shirts, no wearer list: the pieces are counted as one number.
  plainJob = async () => {
    const plain = [{ kind: 'made_to_order', description: 'Plain shirt', qty: 8, unitPriceCents: 30_000, discountCents: 0, roster: [] }];
    const p = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines: plain }, expectedTotalCents: 240_000 }, idem());
    expect(p.statusCode, p.body).toBe(200);
    expect((await production.post(`/api/prd/jobs/${p.json().id}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, 8], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
    return p.json().id as string;
  };
  // The sewer's own sign-in, linked to her employee record.
  const user = createUser(env.db, 'sewer.one', ['worker']);
  expect((await owner.put(`/api/emp/employees/${w.sewer1}/floor-user`, { userId: user })).statusCode).toBe(200);
  sewer = await login(env.app, 'sewer.one', PASSWORD);
  expect((await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [SEWING] })).statusCode).toBe(200); // she sews
});

it('records her own pieces today at the table rate, and shows them on her week and her work', async () => {
  const number = (await owner.get(`/api/docs/jo.job_order/${jo}`)).json().header.number as string;
  const job = (await sewer.get(`/api/prd/floor/jobs/${number.replace(/^JO-0*/, '')}`)).json(); // typed as "1"
  expect(job.jobOrder.id).toBe(jo);
  const sewing = job.lines[0].steps.find((s: { id: number }) => s.id === SEWING);
  expect(sewing).toMatchObject({ name: 'Sewing', pieces: 0, available: 8, rates: [{ part: 'whole', rateCents: 4_000 }] });
  expect(job.lines[0].roster.map((r: { wearerName: string }) => r.wearerName)).toEqual(['Ana Reyes', 'Ben Cruz', 'Cy Lim']);

  const r = await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 3, wearers: [{ rowNo: 1, pieces: 3 }] });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toMatchObject({ pieces: 3, amountCents: 12_000, waiting: true });
  expect((await production.post(`/api/prd/checks/${r.json().id}/approve`, {})).statusCode).toBe(200);
  const entry = (await owner.get(`/api/docs/prd.entry/${env.db.prepare("SELECT id FROM documents WHERE doc_type = 'prd.entry'").pluck().get()}`)).json();
  expect(entry.doc.rows).toEqual([expect.objectContaining({ employeeId: w.sewer1, pieces: 3, wearers: [1], rateCents: 4_000 })]);
  expect(entry.doc.workDate).toBe('2026-09-28'); // today

  const today = (await sewer.get('/api/prd/floor/today')).json();
  expect(today.week).toMatchObject({ pieces: 3, amountCents: 12_000, paid: false });
  expect(today.week.days.find((d: { date: string }) => d.date === '2026-09-28')).toMatchObject({ pieces: 3, amountCents: 12_000 });
  expect(today.work).toEqual([expect.objectContaining({ jobOrderId: jo, stepName: 'Sewing', done: 3, left: 5 })]);
});

it('asks before a second batch of the same pieces today, and keeps every Record pieces rule', async () => {
  jo = await plainJob(); // no wearer list: one count
  await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 2 });
  const again = await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 2 });
  expect(again.json()).toMatchObject({ code: 'ALREADY_TODAY', message: 'You already recorded 2 pieces here today. Is this another batch?' });
  expect((await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 2, again: true })).statusCode).toBe(200);
  // More than the line has left is refused, in words.
  const over = await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 9 });
  expect(over.statusCode).toBe(422);
  expect(over.json().message).toMatch(/\w/);
  // Her own pieces only: no employee in the input, and the generic routes stay closed to her.
  expect((await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 1, employeeId: w.sewer2 })).statusCode).toBe(400);
  expect((await sewer.post('/api/docs/prd.entry/preview', { input: { jobOrderId: jo, stepId: SEWING, rows: [{ lineNo: 1, employeeId: w.sewer2, pieces: 1 }] } })).statusCode).toBe(403);
  expect((await sewer.get('/api/prd/board')).statusCode).toBe(403);
});

it('refuses a sign-in not linked to an employee, and anyone without the floor app', async () => {
  createUser(env.db, 'new.worker', ['worker']);
  const fresh = await login(env.app, 'new.worker', PASSWORD);
  expect((await fresh.get('/api/prd/floor/today')).json()).toMatchObject({ code: 'FLOOR_NOT_LINKED' });
  expect((await production.get('/api/prd/floor/today')).statusCode).toBe(403);
});
