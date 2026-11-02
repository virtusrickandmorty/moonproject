/**
 * Open jobs and checked scans on the floor app (the owner's request, Nov 2026): a worker sees the open job orders with
 * pieces left on the steps they do; what they scan counts only once the production head approves it, dated the day of
 * the scan, and a rejected scan records nothing.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, createUser, grantRole, idem, login, PASSWORD, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let production: Client, owner: Client, sewer: Client;
let w: ReturnType<typeof seedEmployees>;
let jo: string;
const CUTTING = 4, SEWING = 6, PACKING = 8;
const entries = () => env.db.prepare("SELECT COUNT(*) FROM documents WHERE doc_type = 'prd.entry'").pluck().get() as number;

beforeEach(async () => {
  env = await createTestEnv();
  grantRole(env, 'production', 'prd.verify'); // the owner ticks it for the production head's role
  const encoder = await env.as('encoder');
  [production, owner] = [await env.as('production'), await env.as('owner')];
  const c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
  const roster = [['Ana Reyes', 3], ['Ben Cruz', 2], ['Cy Lim', 3]].map(([name, qty]) => ({ name, sizeMode: 'preset', size: 'M', qty }));
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 8, unitPriceCents: 30_000, discountCents: 0, roster }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 240_000 }, idem());
  jo = r.json().id;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  const user = createUser(env.db, 'sewer.one', ['worker']);
  expect((await owner.put(`/api/emp/employees/${w.sewer1}/floor-user`, { userId: user })).statusCode).toBe(200);
  sewer = await login(env.app, 'sewer.one', PASSWORD);
  expect((await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [SEWING] })).statusCode).toBe(200); // she sews
});

it('lists the open job orders with pieces left on the steps the worker does', async () => {
  await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [] });
  expect((await sewer.get('/api/prd/floor/open')).json()).toEqual({ steps: [], jobs: [] }); // no steps ticked
  const set = await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [SEWING, CUTTING] });
  expect(set.json()).toEqual({ stepIds: [CUTTING, SEWING] });
  expect((await production.get(`/api/prd/worker-steps/${w.sewer1}`)).json()).toEqual({ stepIds: [CUTTING, SEWING] });

  const open = (await sewer.get('/api/prd/floor/open')).json();
  expect(open.steps.map((s: { name: string }) => s.name)).toEqual(['Cutting', 'Sewing']);
  expect(open.jobs).toEqual([expect.objectContaining({ jobOrderId: jo, lineNo: 1, stepName: 'Sewing', qty: 8, done: 0, left: 8, ready: 8, waiting: 0 })]); // the line has no cutting

  // Switched off, the step's jobs go; and a step done to the last piece leaves the list.
  await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [PACKING] });
  expect((await sewer.get('/api/prd/floor/open')).json().jobs).toEqual([expect.objectContaining({ stepName: 'Packing', ready: 0 })]); // sewing not done yet
  await production.post(`/api/prd/jobs/${jo}/lines/1/steps/${PACKING}/not-needed`, { reason: 'Packed by the customer' });
  expect((await sewer.get('/api/prd/floor/open')).json().jobs).toEqual([]);
  // Workers neither see nor change anyone's steps.
  expect((await sewer.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [SEWING] })).statusCode).toBe(403);
});

it('shows a worker only their own steps on a job, and records nothing on any other', async () => {
  const job = (await sewer.get(`/api/prd/floor/jobs/${jo}`)).json();
  expect(job).toMatchObject({ mySteps: ['Sewing'], setUp: 1 });
  expect(job.lines[0].steps.map((s: { name: string }) => s.name)).toEqual(['Sewing']); // not Packing

  const packing = await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: PACKING, pieces: 2 });
  expect(packing.statusCode).toBe(403);
  expect(packing.json()).toMatchObject({ code: 'NOT_YOUR_STEP' });
  expect(env.db.prepare('SELECT COUNT(*) FROM prd_floor_claims').pluck().get()).toBe(0);

  // A cutter sees no line of this job (it has no cutting); with no steps ticked, nothing at all.
  await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [CUTTING] });
  expect((await sewer.get(`/api/prd/floor/jobs/${jo}`)).json()).toMatchObject({ lines: [], mySteps: ['Cutting'], setUp: 1 });
  await production.put(`/api/prd/worker-steps/${w.sewer1}`, { stepIds: [] });
  expect((await sewer.get(`/api/prd/floor/jobs/${jo}`)).json()).toMatchObject({ lines: [], mySteps: [], setUp: 1 });
  expect((await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 2 })).json()).toMatchObject({ code: 'NOT_YOUR_STEP' });
  expect((await sewer.get('/api/prd/floor/today')).json().work).toEqual([]);
});

it('keeps a scan waiting until the production head approves it, dated the day of the scan, with the pieces counted', async () => {
  const scan = await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 3, wearers: [1] });
  expect(scan.statusCode, scan.body).toBe(200);
  expect(scan.json()).toMatchObject({ pieces: 3, amountCents: 12_000, waiting: true });
  expect(entries()).toBe(0);

  // Nothing counts yet: not on the job, not in her week. She sees it waiting; the job shows it apart.
  let today = (await sewer.get('/api/prd/floor/today')).json();
  expect(today.week.pieces).toBe(0);
  expect(today.scans).toEqual([expect.objectContaining({ status: 'waiting', pieces: 3, stepName: 'Sewing', wearers: [{ rowNo: 1, name: 'Ana Reyes', qty: 3 }] })]);
  const sewing = (await sewer.get(`/api/prd/floor/jobs/${jo}`)).json().lines[0].steps.find((s: { id: number }) => s.id === SEWING);
  expect(sewing).toMatchObject({ pieces: 0, waiting: 3 });
  // The same wearer cannot go on a second scan while the first waits; and she cannot check her own.
  expect((await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 3, wearers: [1], again: true })).json()).toMatchObject({ code: 'WEARER_WAITING' });
  expect((await sewer.get('/api/prd/checks')).statusCode).toBe(403);

  const list = (await production.get('/api/prd/checks')).json();
  expect(list.waiting).toEqual([expect.objectContaining({ id: scan.json().id, employeeName: 'Ely Sewer', stepName: 'Sewing', description: 'Team shirt', pieces: 3, amountCents: 12_000, problems: [] })]);

  // Checked the next day: the head counted 2. The entry is dated the day of the scan.
  env.clock.advance(86_400_000);
  [production, owner, sewer] = [await env.as('production'), await env.as('owner'), await login(env.app, 'sewer.one', PASSWORD)]; // a new day's sign-ins
  const ok = await production.post(`/api/prd/checks/${scan.json().id}/approve`, { pieces: 2 });
  expect(ok.statusCode, ok.body).toBe(200);
  expect(ok.json()).toMatchObject({ pieces: 2, amountCents: 8_000 });
  const entry = (await owner.get(`/api/docs/prd.entry/${env.db.prepare("SELECT id FROM documents WHERE doc_type = 'prd.entry'").pluck().get()}`)).json();
  expect(entry.doc).toMatchObject({ workDate: '2026-09-28', rows: [expect.objectContaining({ employeeId: w.sewer1, pieces: 2, wearers: [1] })] });

  today = (await sewer.get('/api/prd/floor/today')).json();
  expect(today.scans).toEqual([expect.objectContaining({ status: 'approved', pieces: 3, checkedPieces: 2, entryNumber: ok.json().number })]);
  expect((await production.post(`/api/prd/checks/${scan.json().id}/approve`, {})).json()).toMatchObject({ code: 'ALREADY_CHECKED' });
  expect((await production.get('/api/prd/checks')).json()).toMatchObject({ waiting: [], checked: [expect.objectContaining({ status: 'approved', checkedPieces: 2 })] });
});

it('records nothing for a rejected scan, and tells the worker why', async () => {
  const scan = (await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 5 })).json();
  expect((await production.post(`/api/prd/checks/${scan.id}/reject`, { reason: '' })).statusCode).toBe(400);
  expect((await production.post(`/api/prd/checks/${scan.id}/reject`, { reason: 'Only 3 were sewn; scan again' })).statusCode).toBe(200);
  expect(entries()).toBe(0);
  expect((await sewer.get('/api/prd/floor/today')).json().scans).toEqual([expect.objectContaining({ status: 'rejected', reason: 'Only 3 were sewn; scan again' })]);
  expect((await production.post(`/api/prd/checks/${scan.id}/approve`, {})).statusCode).toBe(409);
  // Free to scan the right count now.
  expect((await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 3 })).statusCode).toBe(200);
});

it('says what stops an approval, and leaves the scan waiting', async () => {
  const a = (await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 6 })).json();
  const b = (await sewer.post('/api/prd/floor/record', { jobOrderId: jo, lineNo: 1, stepId: SEWING, pieces: 5 })).json();
  expect((await production.post(`/api/prd/checks/${a.id}/approve`, {})).statusCode).toBe(200);
  // 6 + 5 would pass the 8 of the line.
  const list = (await production.get('/api/prd/checks')).json();
  expect(list.waiting).toEqual([expect.objectContaining({ id: b.id, problems: [expect.stringMatching(/\w/)] })]);
  expect((await production.post(`/api/prd/checks/${b.id}/approve`, {})).statusCode).toBe(422);
  expect((await production.post(`/api/prd/checks/${b.id}/approve`, { pieces: 2 })).statusCode).toBe(200);
  expect(entries()).toBe(2);
});
