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

it('says a made item has no production steps yet, so the release form greys it', async () => {
  const lines = [{ kind: 'made_to_order', description: 'Team shirt', qty: 2, unitPriceCents: 30_000, discountCents: 0, roster: [] },
    { kind: 'ready_made', description: 'Cap', qty: 1, unitPriceCents: 20_000, discountCents: 0, roster: [] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 10, priority: 'normal', paymentTerms: 'full', lines }, expectedTotalCents: 80_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const status = async () => ((await encoder.get(`/api/jo/orders/${r.json().id}/status`)).json().lines as { lineNo: number; awaitingSteps: boolean; ready: boolean }[]).map((l) => [l.lineNo, l.awaitingSteps, l.ready]);
  expect((await status())[0]).toEqual([1, true, false]);
  expect((await status())[1]![1]).toBe(false); // ready-made: nothing to make
  expect((await production.post(`/api/prd/jobs/${r.json().id}/lines/1/setup`, { templateId: 1, stepIds: [SEWING, PACKING], complexity: 'standard' })).statusCode).toBe(200);
  expect((await status())[0]).toEqual([1, false, false]); // routed, still being made
});

it('lets part of a wearer go out, then the rest (the owner\'s request, Nov 2026)', async () => {
  const jo = await jobOrder();
  // Ben (2 pieces) and Dee are packed too.
  const input = { jobOrderId: jo, stepId: PACKING, rows: [{ lineNo: 1, employeeId: w.packer, pieces: 3, wearers: [2, 4] }] };
  const p0 = await production.post('/api/docs/prd.entry/preview', { input });
  expect((await production.post('/api/docs/prd.entry/post', { input, expectedTotalCents: p0.json().totalCents }, idem())).statusCode).toBe(200);
  const post = async (lines: object[], invoiceNumber: string | null) => {
    const body = release(jo, lines);
    const p = await accountant.post('/api/jo/releases/preview', { release: body });
    const rel = await accountant.post('/api/jo/releases', { release: body, invoice: invoiceNumber ? { invoiceNumber } : null, expectedTotalCents: p.json().release.totalCents }, idem());
    expect(rel.statusCode, rel.body).toBe(200);
    return rel.json().release.id as string;
  };
  type Partly = StatusWearer & { releasedQty: number; partlyOn?: string };
  const ben = async () => ((await encoder.get(`/api/jo/orders/${jo}/status`)).json().lines[0].wearers as Partly[])[1]!;

  // More than Ben has is refused; the pieces must add up.
  expect(await issues(release(jo, [{ lineNo: 1, qty: 3, wearers: [{ rowNo: 2, qty: 3 }] }]))).toContain('WEARER_OVER');
  expect(await issues(release(jo, [{ lineNo: 1, qty: 2, wearers: [1, { rowNo: 2, qty: 2 }] }]))).toContain('WEARERS_QTY');

  // One of Ben's two pieces goes out with Ana.
  const first = await post([{ lineNo: 1, qty: 2, wearers: [1, { rowNo: 2, qty: 1 }] }], '0802');
  const d = (await accountant.get(`/api/docs/jo.release/${first}`)).json();
  expect(d.input.lines).toEqual([{ lineNo: 1, qty: 2, wearers: [1, { rowNo: 2, qty: 1 }] }]);
  expect(d.doc.lines[0].wearers.map((x: { wearerName: string; qty: number; ofQty?: number }) => [x.wearerName, x.qty, x.ofQty])).toEqual([['Ana Reyes', 1, undefined], ['Ben Cruz', 1, 2]]);
  expect(await ben()).toMatchObject({ releasedQty: 1, releasedOn: null, partlyOn: d.header.number });
  expect(await issues(release(jo, [{ lineNo: 1, qty: 2, wearers: [{ rowNo: 2, qty: 2 }] }]))).toContain('WEARER_OVER');

  // Ben alone now takes his last piece; then he is out on both releases.
  const second = await post([{ lineNo: 1, qty: 1, wearers: [2] }], null); // invoice to follow, so it cancels at once
  const n2 = (await accountant.get(`/api/docs/jo.release/${second}`)).json().header.number as string;
  expect(await ben()).toMatchObject({ releasedQty: 2, releasedOn: `${d.header.number}, ${n2}` });
  expect(await issues(release(jo, [{ lineNo: 1, qty: 1, wearers: [2] }]))).toContain('WEARER_RELEASED');

  // Cancelling the second release frees his last piece again.
  expect((await accountant.post(`/api/docs/jo.release/${second}/cancel`, { reason: 'Recorded on the wrong day' }, idem())).statusCode).toBe(200);
  expect(await ben()).toMatchObject({ releasedQty: 1, releasedOn: null });
});
