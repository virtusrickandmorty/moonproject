/**
 * Production carried over when a job order is edited (the owner's request, Oct 2026): the replacement's items keep their
 * route, steps, pieces and wearers; an item or wearer left out keeps its work on record as extras; a size changed after
 * work is warned about and keeps the progress. The entries already recorded stay as they are (paid once).
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { currentStage } from '../../JO/public.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { seedEmployees } from './emp-fixture.ts';
import { matchLines, matchWearers } from '../carry.ts';

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
const JO = '/api/docs/jo.job_order';
const PE = '/api/docs/prd.entry';
const wearer = (name: string, qty = 1, size = 'M') => ({ name, sizeMode: 'preset', size, qty });
const shirts = (roster: object[]) => ({ kind: 'made_to_order', description: 'Team shirt', qty: roster.length, unitPriceCents: 30_000, discountCents: 0, roster });
const shorts = { kind: 'made_to_order', description: 'Shorts', qty: 3, unitPriceCents: 20_000, discountCents: 0, roster: [] };
const cap = { kind: 'made_to_order', description: 'Cap', qty: 2, unitPriceCents: 10_000, discountCents: 0, roster: [] };
const inputOf = (lines: object[]) => ({ customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines });

async function post(lines: object[]): Promise<string> {
  const input = inputOf(lines);
  const p = await encoder.post(`${JO}/preview`, { input });
  expect(p.statusCode, p.body).toBe(200);
  const r = await encoder.post(`${JO}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
async function edit(jo: string, lines: object[]): Promise<string> {
  const input = inputOf(lines);
  const p = await encoder.post(`${JO}/preview`, { input });
  const r = await encoder.post(`${JO}/${jo}/reissue`, { input, expectedTotalCents: p.json().totalCents, reason: 'The school changed the order' }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
}
const route = (jo: string, line: number) => production.post(`/api/prd/jobs/${jo}/lines/${line}/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' });
async function record(jo: string, rows: object[], stepId = SEWING) {
  const input = { jobOrderId: jo, stepId, rows };
  const p = await production.post(`${PE}/preview`, { input });
  const r = await production.post(`${PE}/post`, { input, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
}
type JobStep = { id: number; status: string; pieces: number; forwardedWearers: number[] | null };
const lineOf = async (jo: string, n: number) => ((await production.get(`/api/prd/jobs/${jo}`)).json().lines as { lineNo: number; route: JobStep[] | null }[]).find((l) => l.lineNo === n)!;
const stepOf = async (jo: string, n: number, stepId: number) => (await lineOf(jo, n)).route!.find((s) => s.id === stepId)!;

it('keeps the production of the items an edit keeps, warns about work left out or changed, and pays nothing twice', async () => {
  const first = [wearer('Ana Reyes'), wearer('Ben Cruz'), wearer('Cy Lim'), wearer('Dee Tan')];
  const jo = await post([shirts(first), shorts]);
  for (const n of [1, 2]) expect((await route(jo, n)).statusCode).toBe(200);
  await record(jo, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, wearers: [1, 2] }, { lineNo: 2, employeeId: w.sewer2, pieces: 2 }]);
  expect(currentStage(env.db, jo)).toBe('in_production');

  // The edit: Ben goes up a size, Dee is dropped (nothing done yet), Eve joins; the shorts are left out; a cap is added.
  const next = [shirts([wearer('Ana Reyes'), wearer('Ben Cruz', 1, 'L'), wearer('Cy Lim'), wearer('Eve Go')]), cap];
  const check = await encoder.post(`/api/prd/jobs/${jo}/carry-check`, { lines: next });
  expect(check.statusCode, check.body).toBe(200);
  expect(check.json().warnings).toEqual([
    { kind: 'changed', message: "Item 1: Ben Cruz's size from M to L after Sewing. The progress is kept: send it back for rework if it needs redoing." },
    { kind: 'extra', message: 'Shorts is left out, but 2 pieces have gone through Sewing. They stay on record as extras.' },
  ]);

  const jo2 = await edit(jo, next);
  expect(currentStage(env.db, jo2)).toBe('in_production');
  // The extras confirmed on the form are kept with the edit (audit).
  const audit = JSON.parse(env.db.prepare(`SELECT data FROM audit_log WHERE action = 'prd.carry_over' AND entity_id = ?`).pluck().get(jo2) as string);
  expect(audit.warnings.map((x: { kind: string }) => x.kind)).toEqual(['changed', 'extra']);
  // Line 1 goes on where it was: 2 sewn (Ana and Ben), forwarded to Packing; the cap waits for its route.
  expect(await stepOf(jo2, 1, SEWING)).toMatchObject({ status: 'in_progress', pieces: 2 });
  expect((await stepOf(jo2, 1, PACKING)).forwardedWearers).toEqual([1, 2]);
  expect((await lineOf(jo2, 2)).route).toBeNull();
  const board = (await production.get('/api/prd/board')).json() as { jobOrderId: string }[];
  expect(board.map((b) => b.jobOrderId)).toContain(jo2);
  expect(board.map((b) => b.jobOrderId)).not.toContain(jo);

  // Sewing the other two finishes the step on the new job order; the old sheet is still recorded (paid once).
  await record(jo2, [{ lineNo: 1, employeeId: w.sewer1, pieces: 2, wearers: [3, 4] }]);
  expect(await stepOf(jo2, 1, SEWING)).toMatchObject({ status: 'completed', pieces: 4 });
  const sheets = env.db.prepare(`SELECT a.job_order_id AS jo, SUM(a.pieces) AS pieces FROM prd_assignments a JOIN documents d ON d.id = a.document_id
    WHERE d.status = 'posted' GROUP BY a.job_order_id ORDER BY pieces DESC`).all();
  expect(sheets).toEqual([{ jo, pieces: 4 }, { jo: jo2, pieces: 2 }]);

  // Edited again: the work of both earlier job orders carries on.
  const jo3 = await edit(jo2, next);
  expect(await stepOf(jo3, 1, SEWING)).toMatchObject({ status: 'completed', pieces: 4 });
  expect((await stepOf(jo3, 1, PACKING)).forwardedWearers).toBeNull(); // Sewing is completed: everyone may be packed
  await record(jo3, [{ lineNo: 1, employeeId: w.packer, pieces: 4, wearers: [1, 2, 3, 4] }], PACKING);
  expect(await stepOf(jo3, 1, PACKING)).toMatchObject({ status: 'completed', pieces: 4 });
});

it('pairs a renamed item with the old one, but never an item swapped for another', () => {
  const wearers = (...names: string[]) => names.map((name, i) => ({ rowNo: i + 1, personId: null, name, size: 'M', jerseyName: null, jerseyNumber: null, qty: 1 }));
  const line = (lineNo: number, description: string, roster = wearers(), qty = roster.length || 3) => ({ lineNo, kind: 'made_to_order', description, qty, roster });
  const old = [line(1, 'Team shirt', wearers('Ana', 'Ben')), line(2, 'Shorts'), line(3, 'Socks')];
  // The shirt renamed (Ana still on it), the shorts swapped for caps of another quantity, the socks kept.
  const next = [line(1, 'Team shirt (V-neck)', wearers('Ana', 'Cy')), line(2, 'Cap', [], 2), line(3, 'Socks')];
  expect([...matchLines(old, next)]).toEqual([[3, 3], [1, 1]]);
  expect([...matchWearers(old[0]!.roster, next[0]!.roster)]).toEqual([[1, 1]]);
});
