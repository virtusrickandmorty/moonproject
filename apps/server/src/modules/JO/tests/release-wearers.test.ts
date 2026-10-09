/**
 * Releasing by wearer (the owner's request, Oct 2026): on a line with a wearer list, the release form ticks who goes out
 * (those through every step are marked ready); the pieces are theirs, each wearer goes out once, and the slip prints them.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { seedCustomers } from './cus-fixture.ts';
import { seedEmployees } from '../../PRD/tests/emp-fixture.ts';
import { renderPrint } from '../../PRT/print.ts';

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

/** Line 1 lists four wearers (1, 2, 1 and 1 pieces); all sewn, Ana and Cy packed. */
async function jobOrder(): Promise<string> {
  const roster = [['Ana Reyes', 1, '10'], ['Ben Cruz', 2, '7'], ['Cy Lim', 1, '3'], ['Dee Tan', 1, '9']].map(([name, qty, no]) => ({ name, sizeMode: 'preset', size: 'M', jerseyNumber: no, qty }));
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 5, unitPriceCents: 30_000, discountCents: 0, roster }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 150_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const jo = r.json().id as string;
  expect((await production.post(`/api/prd/jobs/${jo}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], garmentType: 'T-shirt', complexity: 'standard' })).statusCode).toBe(200);
  for (const [stepId, employeeId, pieces, wearers] of [[SEWING, w.sewer1, 5, [1, 2, 3, 4]], [PACKING, w.packer, 2, [1, 3]]] as const) {
    const input = { jobOrderId: jo, stepId, rows: [{ lineNo: 1, employeeId, pieces, wearers }] };
    const p = await production.post('/api/docs/prd.entry/preview', { input });
    expect((await production.post('/api/docs/prd.entry/post', { input, expectedTotalCents: p.json().totalCents }, idem())).statusCode).toBe(200);
  }
  return jo;
}
const release = (jo: string, lines: object[]) => ({ jobOrderId: jo, lines, claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...credit });
const issues = async (body: object) => ((await accountant.post('/api/jo/releases/preview', { release: body })).json().release.issues as { code: string; level: string }[])
  .filter((i) => i.level === 'error').map((i) => i.code);
type StatusWearer = { rowNo: number; wearerName: string; releasedOn: string | null; ready: boolean | null };
const wearersOf = async (jo: string) => ((await encoder.get(`/api/jo/orders/${jo}/status`)).json().lines[0].wearers as StatusWearer[]).map((x) => [x.wearerName, x.ready, x.releasedOn]);

it('ticks who goes out, prints them on the slip, and lets each wearer go out once', async () => {
  const jo = await jobOrder();
  expect(await wearersOf(jo)).toEqual([['Ana Reyes', true, null], ['Ben Cruz', false, null], ['Cy Lim', true, null], ['Dee Tan', false, null]]);

  // The pieces are the wearers' own; a wearer the line does not have is refused.
  expect(await issues(release(jo, [{ lineNo: 1, qty: 3, wearers: [1, 3] }]))).toContain('WEARERS_QTY');
  expect(await issues(release(jo, [{ lineNo: 1, qty: 1, wearers: [9] }]))).toContain('WEARER');

  const body = release(jo, [{ lineNo: 1, qty: 2, wearers: [1, 3] }]);
  const p = await accountant.post('/api/jo/releases/preview', { release: body });
  const rel = await accountant.post('/api/jo/releases', { release: body, invoice: { invoiceNumber: '0801' }, expectedTotalCents: p.json().release.totalCents }, idem());
  expect(rel.statusCode, rel.body).toBe(200);
  const id = rel.json().release.id as string;

  // Kept on the release, printed on the slip, and taken off the list.
  const d = (await accountant.get(`/api/docs/jo.release/${id}`)).json();
  expect(d.input.lines).toEqual([{ lineNo: 1, qty: 2, wearers: [1, 3] }]);
  const h = { id, number: d.header.number, business_date: d.header.businessDate, doc_type: 'jo.release', status: 'posted' as const };
  const profile = { registered_name: 'Example Garments Corp.', trade_name: 'Example Garments', tin: '000-111-222', registered_address: '1 Sample Street', is_vat_registered: 1, version: 1 };
  const slip = renderPrint(env.db, h, d.doc, profile, 'document', 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
  expect(slip).toContain('Wearers released');
  expect(slip).toContain('<td>Team shirt</td><td>Ana Reyes</td><td>M</td><td class="fig">10</td><td class="fig">1</td>');
  expect(slip).toMatch(/<td>Cy Lim<\/td>/);
  expect(slip).not.toMatch(/<td>Ben Cruz<\/td>/);
  expect(await wearersOf(jo)).toEqual([['Ana Reyes', true, d.header.number], ['Ben Cruz', false, null], ['Cy Lim', true, d.header.number], ['Dee Tan', false, null]]);
  expect(await issues(release(jo, [{ lineNo: 1, qty: 1, wearers: [1] }]))).toContain('WEARER_RELEASED');
});
