/**
 * Production (PLAN E7): step catalogue and templates, line routes, the board with Complete / Not needed / Reopen, the JO
 * stage it drives, production entries with caps and piece-rate snapshots, cancel before payroll and corrections after it
 * (D6, F3, N-11), API rules, and a property test over random entries, step changes and cancels.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { currentStage, jobOrdersOf, lineState } from '../../JO/public.ts';
import { entryDoc } from '../doctypes/entry.ts';
import { lineRoute, setupLine, stepAction } from '../production.ts';
import { unpaidAssignments } from '../public.ts';
import { seedEmployees } from './emp-fixture.ts';

let env: TestEnv;
let encoder: Client;
let production: Client;
let c: ReturnType<typeof seedCustomers>;
let w: ReturnType<typeof seedEmployees>;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  production = await env.as('production');
  c = seedCustomers(env.db, encoder.userId);
  w = seedEmployees(env.db);
});

const [LAYOUT, CUTTING, EMBROIDERY, SEWING, QC, PACKING] = [1, 4, 5, 6, 7, 8];
const PE = '/api/docs/prd.entry';

/** A recorded JO with one-piece-price lines of the given quantities. */
async function jobOrder(qtys: number[]): Promise<string> {
  const lines = qtys.map((qty) => ({ kind: 'made_to_order', description: 'Team shirt', qty, unitPriceCents: 30_000, discountCents: 0, roster: [] }));
  const total = qtys.reduce((s, q) => s + q * 30_000, 0);
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'rush', paymentTerms: 'full', lines }, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
}
const setup = (jo: string, line: number, body: object, who = production) => who.post(`/api/prd/jobs/${jo}/lines/${line}/setup`, body);
const act = (jo: string, line: number, step: number, action: string, reason?: string, who = production) =>
  who.post(`/api/prd/jobs/${jo}/lines/${line}/steps/${step}/${action}`, reason ? { reason } : {});
const record = (input: object, who = production) => who.post(`${PE}/preview`, { input }).then(async (p) => (p.statusCode === 200 ? who.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem()) : p));
const issues = async (input: object, who = production) => ((await who.post(`${PE}/preview`, { input })).json().issues as { code: string }[]).map((i) => i.code);
const statuses = (jo: string, line: number) => lineRoute(env.db, jo, line)!.map((s) => [s.code, s.status, s.pieces]);
const tShirts = { templateId: 1, stepIds: [CUTTING, SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' };
const rows = (jo: string, stepId: number, list: object[], extra = {}) => ({ jobOrderId: jo, stepId, rows: list, ...extra });

describe('steps, templates and routes (PLAN E7)', () => {
  it('seeds the step catalogue in canonical order (QC off) and the six route templates', async () => {
    const cat = (await production.get('/api/prd/catalogue')).json();
    expect(cat.steps.map((s: { code: string; isActive: boolean; payBasis: string }) => [s.code, s.isActive, s.payBasis])).toEqual([
      ['LAYOUT', true, 'daily'], ['PRINTING', true, 'daily'], ['HEATPRESS', true, 'daily'], ['CUTTING', true, 'piece_or_daily'],
      ['EMBROIDERY', true, 'daily'], ['SEWING', true, 'piece'], ['QC', false, 'daily'], ['PACKING', true, 'daily'],
    ]);
    const code = (id: number) => cat.steps.find((s: { id: number }) => s.id === id).code;
    expect(cat.templates.map((t: { code: string; stepIds: number[] }) => [t.code, t.stepIds.map(code).join(' ')])).toEqual([
      ['T1', 'CUTTING SEWING PACKING'],
      ['T2', 'LAYOUT PRINTING HEATPRESS CUTTING SEWING PACKING'],
      ['T3', 'LAYOUT CUTTING EMBROIDERY SEWING PACKING'],
      ['T4', 'CUTTING EMBROIDERY SEWING PACKING'],
      ['T5', 'EMBROIDERY'],
      ['T6', 'LAYOUT PRINTING HEATPRESS PACKING'],
    ]);
    expect(cat.complexities).toEqual(['simple', 'standard', 'complex']);
  });

  it('a line takes a template, steps are added or removed and kept in canonical order; a step with pieces stays', async () => {
    const jo = await jobOrder([20]);
    const r = await setup(jo, 1, { templateId: 3, stepIds: [PACKING, SEWING, EMBROIDERY, CUTTING], garmentType: 'Polo shirt', complexity: 'complex' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().map((s: { code: string }) => s.code)).toEqual(['CUTTING', 'EMBROIDERY', 'SEWING', 'PACKING']); // T3 without layout
    expect((await setup(jo, 1, { ...tShirts, stepIds: [QC, SEWING] })).json()).toMatchObject({ code: 'STEP_OFF' });
    expect((await setup(jo, 1, { ...tShirts, stepIds: [] })).statusCode).toBe(400);
    expect((await setup(jo, 2, tShirts)).statusCode).toBe(404);
    expect((await record(rows(jo, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 5 }]))).statusCode).toBe(200);
    expect((await setup(jo, 1, { ...tShirts, stepIds: [SEWING, PACKING] })).json()).toMatchObject({ code: 'STEP_HAS_PIECES', message: 'Cutting has pieces recorded on line 1, so it stays on the route.' });
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'prd.setup'`).pluck().get()).toBe(1);

    // The owner switches QC on (If-Match); then it can go on a route.
    const owner = await env.as('owner');
    expect((await owner.put(`/api/prd/steps/${QC}`, { isActive: true })).statusCode).toBe(428);
    expect((await owner.put(`/api/prd/steps/${QC}`, { isActive: true }, { 'if-match': '2' })).json()).toMatchObject({ code: 'VERSION_CHANGED' });
    expect((await owner.put(`/api/prd/steps/${QC}`, { isActive: true }, { 'if-match': '1' })).json()).toMatchObject({ code: 'QC', isActive: true, version: 2 });
    expect((await production.put(`/api/prd/steps/${QC}`, { isActive: false }, { 'if-match': '2' })).statusCode).toBe(403);
    expect((await setup(jo, 1, { ...tShirts, stepIds: [CUTTING, SEWING, QC, PACKING] })).json().map((s: { code: string }) => s.code)).toEqual(['CUTTING', 'SEWING', 'QC', 'PACKING']);
  });
});

describe('board, Complete / Not needed / Reopen, and the JO stage (PLAN E7 rule 3)', () => {
  it('lines move across the board as steps close; all lines done → JO Ready; a reopened step sends it back', async () => {
    const jo = await jobOrder([60, 20]);
    const board = async () => (await production.get('/api/prd/board')).json() as { lineNo: number; currentStepId: number | null; ready: boolean; steps: unknown }[];
    expect((await board()).map((x) => [x.lineNo, x.currentStepId, x.steps])).toEqual([[1, null, null], [2, null, null]]); // needs a route
    await setup(jo, 1, tShirts);
    await setup(jo, 2, { templateId: 4, stepIds: [CUTTING, EMBROIDERY, SEWING, PACKING], garmentType: 'Polo shirt', complexity: 'complex' });
    expect(currentStage(env.db, jo)).toBe('open'); // a route alone starts nothing

    const cut = await record(rows(jo, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 60 }]));
    expect(cut.json()).toMatchObject({ number: 'PE-000001', totalCents: 48_000 }); // T-shirt cutting ₱8.00 × 60
    expect(currentStage(env.db, jo)).toBe('in_production');
    expect((await act(jo, 1, CUTTING, 'complete')).statusCode).toBe(200);
    expect((await act(jo, 1, CUTTING, 'complete')).json()).toMatchObject({ code: 'ALREADY', message: 'Cutting on line 1 is already completed.' });
    expect((await board())[0]).toMatchObject({ currentStepId: SEWING, ready: false });

    const sew = await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 35 }, { lineNo: 1, employeeId: w.sewer2, pieces: 25 }]));
    expect(sew.json().summary).toBe('This will record 60 pieces of Sewing for JO-000001 (Moonlight Test School): Ely Sewer 35, Fai Stitcher 25. Piece pay: ₱2,400.00.');
    expect((await act(jo, 1, SEWING, 'not-needed')).json()).toMatchObject({ code: 'HAS_PIECES' });
    await act(jo, 1, SEWING, 'complete');
    await act(jo, 1, PACKING, 'not-needed'); // no pieces: fine
    expect(statuses(jo, 1)).toEqual([['CUTTING', 'completed', 60], ['SEWING', 'completed', 60], ['PACKING', 'not_needed', 0]]);
    expect((await board())[0]).toMatchObject({ currentStepId: null, ready: true });
    expect(currentStage(env.db, jo)).toBe('in_production'); // line 2 is not done

    for (const s of [CUTTING, EMBROIDERY, SEWING, PACKING]) expect((await act(jo, 2, s, 'complete')).statusCode).toBe(200);
    expect(currentStage(env.db, jo)).toBe('ready');

    expect((await act(jo, 1, SEWING, 'reopen')).json()).toMatchObject({ code: 'REASON_REQUIRED' });
    expect((await act(jo, 1, SEWING, 'reopen', 'Two shirts came back with loose seams')).statusCode).toBe(200);
    expect(statuses(jo, 1)[1]).toEqual(['SEWING', 'in_progress', 60]);
    expect(currentStage(env.db, jo)).toBe('in_production');
    expect((await act(jo, 1, SEWING, 'reopen', 'Nothing to reopen here')).json()).toMatchObject({ code: 'NOT_CLOSED' });
    const history = (await encoder.get(`/api/jo/orders/${jo}/status`)).json().history.map((h: { fromStage: string; toStage: string; reason: string }) => [h.fromStage, h.toStage, h.reason]);
    expect(history).toEqual([
      ['open', 'in_production', 'PE-000001: Cutting pieces recorded'],
      ['in_production', 'ready', 'Packing of line 2 completed'],
      ['ready', 'in_production', 'Sewing of line 1 reopened'],
    ]);
  });

  it('a released line cannot be reopened; a cancelled JO’s production cannot change; lines without a route or step are refused', async () => {
    const jo = await jobOrder([2]);
    await setup(jo, 1, { ...tShirts, stepIds: [PACKING] });
    await act(jo, 1, PACKING, 'complete');
    expect(currentStage(env.db, jo)).toBe('ready');
    await act(jo, 1, PACKING, 'reopen', 'Boxes were not labelled'); // its only step: nothing has started, yet it is no longer ready
    expect(currentStage(env.db, jo)).toBe('in_production');
    await act(jo, 1, PACKING, 'complete');
    const accountant = await env.as('accountant');
    const release = { jobOrderId: jo, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
    expect((await accountant.post('/api/jo/releases', { release, invoice: null, expectedTotalCents: 30_000 }, idem())).statusCode).toBe(200);
    expect((await act(jo, 1, PACKING, 'reopen', 'Wrong box used for packing')).json()).toMatchObject({ code: 'RELEASED' });
    expect((await act(jo, 1, SEWING, 'complete')).json()).toMatchObject({ code: 'NOT_ON_ROUTE' });

    const other = await jobOrder([5]);
    expect((await act(other, 1, SEWING, 'complete')).json()).toMatchObject({ code: 'NO_ROUTE' });
    await encoder.post(`/api/docs/jo.job_order/${other}/cancel`, { reason: 'Customer called the order off' }, idem());
    expect((await setup(other, 1, tShirts)).json()).toMatchObject({ code: 'JO_CANCELLED' });
  });
});

describe('production entries (PLAN E7 assignments)', () => {
  it('caps: never past the line quantity; past what came out of the step before only with a reason; rework is apart', async () => {
    const jo = await jobOrder([60]);
    await setup(jo, 1, tShirts);
    await record(rows(jo, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 40 }]));
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 30 }, { lineNo: 1, employeeId: w.sewer2, pieces: 11 }]))).toEqual(['OVER_CAP']);
    expect((await production.post(`${PE}/preview`, { input: rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 41 }]) })).json().issues[0].message).toBe(
      'Only 40 pieces of line 1 came out of the step before Sewing. Give a reason to record more.',
    );
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 41 }], { overCapReason: 'Cutter forgot to record 20 pieces' }))).toEqual([]);
    expect((await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 40 }]))).statusCode).toBe(200);
    // Pasubra (rework) is paid at a typed rate and sits outside the caps (OWN-25).
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 5, rework: true }]))).toEqual(['REWORK_RATE']);
    const rework = await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 5, rework: true, rateCents: 2_000, rateReason: 'Pasubra on loose seams' }]));
    expect(rework.json()).toMatchObject({ totalCents: 10_000 });
    expect(statuses(jo, 1)[1]).toEqual(['SEWING', 'in_progress', 40]);

    await act(jo, 1, CUTTING, 'complete'); // everything is cut now
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 20 }]))).toEqual([]);
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 21 }], { overCapReason: 'More pieces than ordered' }))).toEqual(['OVER_QTY']);
    await act(jo, 1, SEWING, 'complete');
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1 }]))).toEqual(['STEP_CLOSED']);
    expect(await issues(rows(jo, EMBROIDERY, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1 }]))).toEqual(['NOT_ON_ROUTE']);
    expect(await issues(rows(jo, PACKING, [{ lineNo: 2, employeeId: w.packer, pieces: 1 }, { lineNo: 1, employeeId: w.left, pieces: 1 }]))).toEqual(['LINE', 'EMPLOYEE']);
    const noRoute = await jobOrder([3]);
    expect(await issues(rows(noRoute, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1 }]))).toEqual(['NO_ROUTE']);

    // A step marked not needed passes all of the line to the next one.
    const jo2 = await jobOrder([10]);
    await setup(jo2, 1, { templateId: 3, stepIds: [LAYOUT, CUTTING, EMBROIDERY, SEWING, PACKING], garmentType: 'Polo shirt', complexity: 'standard' });
    expect(await issues(rows(jo2, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 10 }]))).toEqual(['OVER_CAP']);
    await act(jo2, 1, LAYOUT, 'not-needed');
    expect(await issues(rows(jo2, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 10 }]))).toEqual([]);
  });

  it('takes the rate in force on the work date as a snapshot; typed rates need a reason and rate.override', async () => {
    const jo = await jobOrder([100]);
    await setup(jo, 1, { ...tShirts, stepIds: [SEWING, PACKING] });
    const first = (await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10 }]))).json();
    expect(first.totalCents).toBe(40_000); // ₱40.00 × 10
    const accountant = await env.as('accountant');
    const raised = await accountant.post('/api/rate/rates', { garmentType: 'T-shirt', stepCode: 'SEWING', complexity: 'standard', rateCents: 4_500, effectiveFrom: '2026-09-28', reason: 'Owner raised the sewing rate' });
    expect(raised.statusCode, raised.body).toBe(200);
    const second = (await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 12 }]))).json();
    expect(second.totalCents).toBe(54_000);
    expect((await production.get(`${PE}/${first.id}`)).json().doc.rows[0]).toMatchObject({ rateCents: 4_000, rateSource: 'table', amountCents: 40_000 }); // the snapshot stays

    const typed = rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 10, rateCents: 5_000, rateReason: 'Complex collar on this batch' }]);
    expect(await issues(typed)).toEqual(['RATE_OVERRIDE']); // production may not type rates
    expect(await issues(typed, encoder)).toEqual([]); // encoders may (OWN-26)
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 10, rateCents: 5_000 }]), encoder)).toEqual(['RATE_REASON']);
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 10, rateReason: 'Just because' }]), encoder)).toEqual(['RATE_REASON']);
    const t = (await record(typed, encoder)).json();
    expect((await encoder.get(`${PE}/${t.id}`)).json().input).toEqual({ ...typed, workDate: '2026-09-28' }); // dated today when no date is typed

    // No rate: refused on a piece-rate step, progress only (₱0) elsewhere, with a warning on cutting.
    const gown = await jobOrder([4]);
    await setup(gown, 1, { templateId: 1, stepIds: [CUTTING, SEWING, PACKING], garmentType: 'Gown', complexity: 'complex' });
    expect(await issues(rows(gown, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 1 }], { overCapReason: 'Cut pieces came from stock' }))).toEqual(['NO_RATE']);
    expect(await issues(rows(gown, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 4 }]))).toEqual(['NO_RATE']);
    const p = (await production.post(`${PE}/preview`, { input: rows(gown, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 4 }]) })).json();
    expect([p.issues[0].level, p.totalCents, p.summary]).toEqual(['warning', 0, 'This will record 4 pieces of Cutting for JO-000002 (Moonlight Test School): Dana Cutter 4. Progress only: no piece pay.']);
    expect(p.journal ?? null).toBeNull(); // posts nothing
  });

  it('cancel before payroll; after payroll the row stays, is never paid again, and is corrected with negative pieces (D6, F3, N-11)', async () => {
    const jo = await jobOrder([50]);
    await setup(jo, 1, { ...tShirts, stepIds: [SEWING, PACKING] });
    const e1 = (await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 20 }]))).json();
    expect(unpaidAssignments(env.db, '2026-09-30').map((a) => [a.kind, a.pieces, a.amountCents])).toEqual([['work', 20, 80_000]]);
    expect((await production.post(`${PE}/${e1.id}/cancel`, { reason: 'Recorded on the wrong job order' }, idem())).statusCode).toBe(200);
    expect(unpaidAssignments(env.db, '2026-09-30')).toEqual([]);
    expect(statuses(jo, 1)[0]).toEqual(['SEWING', 'pending', 0]);

    const e2 = (await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 30 }]))).json();
    const [row] = unpaidAssignments(env.db, '2026-09-30');
    // PAY marks the row paid (a stand-in until PAY is built): it is never listed as unpaid again.
    env.db.prepare('UPDATE prd_assignments SET pay_run_line_id = ? WHERE id = ?').run('run-line-1', row!.id);
    expect(unpaidAssignments(env.db, '2026-09-30')).toEqual([]);
    expect(() => env.db.prepare('UPDATE prd_assignments SET pieces = 1 WHERE id = ?').run(row!.id)).toThrow(/IMMUTABLE/);
    expect((await production.post(`${PE}/${e2.id}/cancel`, { reason: 'Recorded on the wrong job order' }, idem())).json()).toMatchObject({ code: 'PAID' });

    await act(jo, 1, SEWING, 'complete'); // a correction still goes in on a completed step
    const fix = (pieces: number, correctionOf = row!.id) => rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces, correctionOf }]);
    expect(await issues(fix(-31))).toEqual(['CORRECTION_PIECES']);
    expect(await issues(fix(5))).toEqual(['CORRECTION_PIECES']);
    expect(await issues({ ...fix(-5), rows: [{ lineNo: 1, employeeId: w.sewer2, pieces: -5, correctionOf: row!.id }] })).toEqual(['CORRECTION']);
    const c1 = (await record(fix(-5))).json();
    expect(c1).toMatchObject({ totalCents: -20_000 }); // the paid row's own rate
    expect(unpaidAssignments(env.db, '2026-09-30').map((a) => [a.kind, a.pieces, a.amountCents])).toEqual([['correction', -5, -20_000]]); // the next run takes it off
    expect(await issues(fix(-26))).toEqual(['CORRECTION_PIECES']); // 25 pieces still counted
    expect(await issues({ ...fix(-20), rows: [...fix(-20).rows, ...fix(-6).rows] })).toEqual(['CORRECTION_PIECES']); // two rows in one entry count together
    expect(statuses(jo, 1)[0]).toEqual(['SEWING', 'completed', 25]);

    const unpaid = (await record(rows(jo, PACKING, [{ lineNo: 1, employeeId: w.packer, pieces: 25 }]))).json();
    const packRow = unpaidAssignments(env.db, '2026-09-30').find((a) => a.documentId === unpaid.id)!;
    expect(await issues(rows(jo, PACKING, [{ lineNo: 1, employeeId: w.packer, pieces: -1, correctionOf: packRow.id }]))).toEqual(['NOT_PAID']);
    expect(() => env.db.prepare('UPDATE prd_assignments SET pay_run_line_id = ? WHERE id = ?').run('run-line-1', packRow.id)).toThrow(/UNIQUE/); // paid once
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('audit codex2-independent-01: work date and repeated sheets (B2-F2, B2-F3)', () => {
  it('a late sheet keeps its work date and that day\'s rate; dates in the future, too old or not real are refused', async () => {
    const jo = await jobOrder([100]);
    await setup(jo, 1, { ...tShirts, stepIds: [SEWING, PACKING] });
    const accountant = await env.as('accountant');
    expect((await accountant.post('/api/rate/rates', { garmentType: 'T-shirt', stepCode: 'SEWING', complexity: 'standard', rateCents: 4_500, effectiveFrom: '2026-09-28', reason: 'Owner raised the sewing rate' })).statusCode).toBe(200);
    const late = rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10 }], { workDate: '2026-09-25' });
    const e = (await record(late)).json();
    expect(e.totalCents).toBe(40_000); // ₱40.00, the rate on 25 September, not today's ₱45.00
    expect(e.summary).toContain('done on 2026-09-25');
    const got = (await production.get(`${PE}/${e.id}`)).json();
    expect([got.doc.workDate, got.input.workDate, got.doc.rows[0].rateCents]).toEqual(['2026-09-25', '2026-09-25', 4_000]);
    expect(unpaidAssignments(env.db, '2026-09-25').map((a) => [a.workDate, a.pieces])).toEqual([['2026-09-25', 10]]); // payroll for that week takes it
    expect((await record(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 10 }]))).json().totalCents).toBe(45_000); // no date: today

    for (const workDate of ['2026-02-30', '2026-09-29', '2026-08-27']) {
      expect(await issues({ ...late, workDate }), workDate).toEqual(['WORK_DATE']); // not a date, after today, 32 days back
    }
    expect(await issues({ ...late, workDate: '2026-08-28' })).toEqual([]); // 31 days back
  });

  it('the same sheet twice is refused without a reason and kept with one; rework of the same pieces never is', async () => {
    const jo = await jobOrder([100]);
    await setup(jo, 1, { ...tShirts, stepIds: [SEWING, PACKING] });
    const sheet = rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10 }]);
    const first = (await record(sheet)).json();
    const p = (await production.post(`${PE}/preview`, { input: sheet })).json();
    expect(p.issues.map((i: { code: string; field: string }) => [i.code, i.field])).toEqual([['LIKELY_REPEAT', 'rows.0.repeatReason']]);
    expect(p.issues[0].message).toContain(first.number);
    expect((await record(sheet)).statusCode).toBe(422); // a second post is refused too
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 11 }]))).toEqual([]); // other pieces
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer2, pieces: 10 }]))).toEqual([]); // another worker
    expect(await issues({ ...sheet, workDate: '2026-09-27' })).toEqual([]); // another day

    expect((await production.post(`${PE}/preview`, { input: rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10, repeatReason: 'Two' }]) })).statusCode).toBe(400); // 5 to 200 characters
    const again = rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10, repeatReason: 'Second bundle, separate sheet' }]);
    const second = (await record(again)).json();
    expect(second.totalCents).toBe(40_000);
    expect((await production.get(`${PE}/${second.id}`)).json().input).toEqual({ ...again, workDate: '2026-09-28' });
    expect(env.db.prepare('SELECT reason FROM prd_assignment_repeats').pluck().all()).toEqual(['Second bundle, separate sheet']);
    expect(() => env.db.prepare(`UPDATE prd_assignment_repeats SET reason = 'Changed later'`).run()).toThrow(/IMMUTABLE/);

    // Rework (pasubra) of the same pieces is never taken for a repeat, however often it is recorded.
    const rework = rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10, rework: true, rateCents: 2_000, rateReason: 'Pasubra, seams redone' }]);
    expect(await issues(rework, encoder)).toEqual([]);
    expect((await record(rework, encoder)).statusCode).toBe(200);
    expect(await issues(rework, encoder)).toEqual([]);
    expect(await issues(rows(jo, SEWING, [{ lineNo: 1, employeeId: w.sewer1, pieces: 10, rework: true, rateCents: 2_000, rateReason: 'Pasubra, seams redone', repeatReason: 'Not needed here' }]), encoder)).toEqual(['REPEAT_REASON']);

    // Cancelled sheets do not count.
    expect((await production.post(`${PE}/${first.id}/cancel`, { reason: 'Typed twice by mistake' }, idem())).statusCode).toBe(200);
    expect((await production.post(`${PE}/${second.id}/cancel`, { reason: 'Typed twice by mistake' }, idem())).statusCode).toBe(200);
    expect(await issues(sheet)).toEqual([]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('API rules', () => {
  it('rejects client-sent totals, dates, rates sources and zero pieces (N-03); one entry per Idempotency-Key (N-02); permissions', async () => {
    const jo = await jobOrder([10]);
    await setup(jo, 1, tShirts);
    const good = rows(jo, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 2 }]);
    const post = (input: object, key = idem()) => production.post(`${PE}/post`, { input, expectedTotalCents: 1_600 }, key);
    for (const extra of [{ date: '2026-01-01' }, { number: 'PE-9' }, { totalCents: 1 }, { pieces: 2 }, { status: 'posted' }]) {
      expect((await post({ ...good, ...extra })).statusCode, JSON.stringify(extra)).toBe(400);
    }
    for (const row of [{ amountCents: 1 }, { rateSource: 'table' }, { workDate: '2026-09-01' }, { pieces: 0 }]) {
      expect((await post(rows(jo, CUTTING, [{ lineNo: 1, employeeId: w.cutter, pieces: 2, ...row }]))).statusCode, JSON.stringify(row)).toBe(400);
    }
    expect((await production.post(`${PE}/post`, { input: good, expectedTotalCents: 1 }, idem())).json().code).toBe('TOTALS_CHANGED');
    const k = idem();
    expect((await post(good, k)).json().id).toBe((await post(good, k)).json().id);

    const tv = await env.as('tv');
    expect((await tv.get('/api/prd/board')).statusCode).toBe(403);
    expect((await tv.get(PE)).statusCode).toBe(403);
    expect((await (await env.as('accountant')).get('/api/prd/workers')).json().map((x: { name: string }) => x.name)).toEqual(['Dana Cutter', 'Ely Sewer', 'Fai Stitcher', 'Gil Packer']);
    expect((await production.get(`/api/prd/jobs/${jo}`)).json().lines[0].route.map((s: { code: string; availablePieces: number }) => [s.code, s.availablePieces])).toEqual([['CUTTING', 10], ['SEWING', 2], ['PACKING', 0]]);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random entries, step changes and cancels: stored = computed, caps hold, pay = pieces × rate', async () => {
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv();
        const db = t.db;
        const userId = createUser(db, 'prop-owner', ['owner']);
        const cs = seedCustomers(db, userId);
        seedEmployees(db);
        const actor = { userId, permissions: new Set(['jo.post', 'prd.assign', 'rate.override']) };
        const e = { db, clock: t.clock };
        const who = () => ({ userId, at: stamp(t.clock) });
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: (p: string) => actor.permissions.has(p) });
        const garments = ['T-shirt', 'Polo shirt', 'Gown'] as const;
        for (let i = 0; i < 2; i++) {
          const qtys = g(() => fc.array(fc.integer({ min: 1, max: 80 }), { minLength: 1, maxLength: 2 }));
          const input = { customerId: cs.school, dueInDays: 10, priority: 'normal' as const, paymentTerms: 'full' as const, lines: qtys.map((qty) => ({ kind: 'made_to_order' as const, description: 'Team shirt', qty, unitPriceCents: 10_000, discountCents: 0, roster: [] })) };
          const jo = postDocument(e, jobOrderDoc, actor, { input, expectedTotalCents: jobOrderDoc.compute(input, ctx()).totalCents }).id;
          for (const [n] of qtys.entries()) {
            const stepIds = g(() => fc.subarray([LAYOUT, CUTTING, EMBROIDERY, SEWING, PACKING], { minLength: 1 }));
            tx(db, () => setupLine(db, jo, n + 1, { stepIds, garmentType: g(() => fc.constantFrom(...garments)), complexity: g(() => fc.constantFrom('simple', 'standard', 'complex')) }, who()));
          }
        }
        const steps = g(() => fc.array(fc.constantFrom('entry', 'entry', 'entry', 'complete', 'not_needed', 'reopen', 'cancel'), { minLength: 1, maxLength: 12 }));
        for (const step of steps) {
          try {
            if (step === 'entry') {
              let arb;
              try {
                arb = entryDoc.arbitrary(db);
              } catch {
                continue; // nothing open for pieces
              }
              const input = g(() => arb);
              const doc = entryDoc.compute(input, ctx());
              const p = postDocument(e, entryDoc, actor, { input, expectedTotalCents: doc.totalCents });
              expect(entryDoc.load(db, p.id)).toEqual(doc);
              expect(entryDoc.toInput(doc)).toEqual({ ...input, workDate: today(t.clock) }); // no date typed: today
              for (const r of doc.rows) expect(r.amountCents).toBe(r.pieces * r.rateCents);
            } else if (step === 'cancel') {
              const ids = db.prepare(`SELECT id FROM documents WHERE doc_type = 'prd.entry' AND status = 'posted'`).pluck().all() as string[];
              if (ids.length > 0) cancelDocument(e, entryDoc, actor, g(() => fc.constantFrom(...ids)), 'Recorded by mistake');
            } else {
              const jo = g(() => fc.constantFrom(...jobOrdersOf(db).map((j) => j.id)));
              const line = g(() => fc.constantFrom(...lineState(db, jo).map((l) => l.lineNo)));
              const route = lineRoute(db, jo, line)!;
              const s = g(() => fc.constantFrom(...route));
              tx(db, () => stepAction(db, jo, line, s.id, step as 'complete' | 'not_needed' | 'reopen', 'Checked again on the floor', who()));
            }
          } catch (err) {
            if (!(err instanceof AppError) || !['ALREADY', 'HAS_PIECES', 'NOT_CLOSED', 'VALIDATION'].includes(err.code)) throw err;
          }
          for (const jo of jobOrdersOf(db)) {
            const lines = lineState(db, jo.id);
            const routes = lines.map((l) => lineRoute(db, jo.id, l.lineNo)!);
            for (const [i, route] of routes.entries()) for (const s of route) expect(s.pieces, step).toBeLessThanOrEqual(lines[i]!.qty);
            const done = routes.every((r) => r.every((s) => s.status === 'completed' || s.status === 'not_needed'));
            const started = routes.some((r) => r.some((s) => s.status !== 'pending'));
            // Ready exactly when every step is closed; once started, never back to Open (a cancelled entry leaves it In production).
            const stage = currentStage(db, jo.id);
            if (done || started) expect(stage, step).toBe(done ? 'ready' : 'in_production');
            else expect(['open', 'in_production'], step).toContain(stage);
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 20, endOnFailure: true },
    );
  });
});
