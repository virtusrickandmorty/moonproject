/**
 * Recording a cancelled invoice record again (the owner's request, Nov 2026: an invoice record was cancelled by mistake
 * while its paper invoice still stands, and its number could not be used again). The new record keeps the booklet number
 * and the releases, names the cancelled one, needs a reason and the right to cancel invoices, and is done once.
 * Made-up customers only.
 */
import { beforeEach, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { invoiceNumbersBetween, joMoney, releasesAwaitingInvoice } from '../public.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv, encoder: Client, accountant: Client, c: ReturnType<typeof seedCustomers>, CASH: number;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

async function jobOrder(qty: number): Promise<string> {
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty, unitPriceCents: 112_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: qty * 112_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to });
  return r.json().id;
}
const releaseOf = (jo: string, qty: number) => ({ jobOrderId: jo, lines: [{ lineNo: 1, qty }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Made-up: balance by bank transfer', creditDueInDays: 7 });
async function release(jo: string, qty: number) {
  const r = await accountant.post('/api/jo/releases', { release: releaseOf(jo, qty), invoice: null, expectedTotalCents: qty * 112_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return (r.json() as { release: { id: string; number: string } }).release;
}
const IR = '/api/docs/jo.invoice_record';
const codes = (issues: { code: string; level: string }[]) => issues.filter((i) => i.level === 'error').map((i) => i.code);

async function invoicedThenCancelled() {
  const jo = await jobOrder(10);
  const cr = { customerId: c.school, crNumber: '5001', applications: [{ jobOrderId: jo, amountCents: 300_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 300_000 }] };
  expect((await encoder.post('/api/docs/col.collection/post', { input: cr, expectedTotalCents: 300_000 }, idem())).statusCode).toBe(200);
  const first = await release(jo, 3);
  const second = await release(jo, 2);
  const input = { releaseId: second.id, alsoReleaseIds: [first.id], invoiceNumber: '0901' };
  const ir = await encoder.post(`${IR}/post`, { input, expectedTotalCents: 560_000 }, idem());
  expect(ir.statusCode, ir.body).toBe(200);
  const id = ir.json().id as string;
  expect((await accountant.post(`${IR}/${id}/cancel`, { reason: 'Made-up: cancelled by mistake' }, idem())).statusCode).toBe(200);
  return { jo, first, second, id, number: ir.json().number as string, input };
}

it('records a cancelled invoice again with its number and releases, and counts the number once', async () => {
  const { jo, id, number, input } = await invoicedThenCancelled();
  // A plain new record cannot take the number.
  expect(codes((await accountant.post(`${IR}/preview`, { input })).json().issues)).toContain('INVOICE_USED');

  const again = { ...input, againOf: id, note: 'Cancelled by mistake' };
  const p = await accountant.post(`${IR}/preview`, { input: again });
  expect(p.statusCode, p.body).toBe(200);
  expect(codes(p.json().issues)).toEqual([]);
  expect(p.json().summary).toContain(`It records ${number} again`);
  const r = await accountant.post(`${IR}/post`, { input: again, expectedTotalCents: p.json().totalCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  const doc = (await accountant.get(`${IR}/${r.json().id}`)).json();
  expect(doc.doc).toMatchObject({ againOf: id, againOfNumber: number, invoiceNumber: '0901', grossCents: 560_000, depositAppliedCents: 300_000 });
  expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 560_000 });
  expect(releasesAwaitingInvoice(env.db, '2099-12-31')).toEqual([]);
  // The booklet shows no. 901 once, as used by the new record.
  expect(invoiceNumbersBetween(env.db, 900, 902)).toEqual([{ n: 901, number: r.json().number, status: 'posted' }]);
  expect(runInvariants(env.db).filter((x) => !x.ok)).toEqual([]);

  // Once only: neither the cancelled record again, nor the number on a new record.
  expect(codes((await accountant.post(`${IR}/preview`, { input: again })).json().issues)).toEqual(expect.arrayContaining(['AGAIN_DONE', 'INVOICE_USED']));
});

it('keeps the number and releases, and needs a reason and the right to cancel invoices', async () => {
  const { first, second, id, input } = await invoicedThenCancelled();
  const again = { ...input, againOf: id, note: 'Cancelled by mistake' };
  expect(codes((await accountant.post(`${IR}/preview`, { input: { ...again, invoiceNumber: '0902' } })).json().issues)).toContain('AGAIN_NUMBER');
  expect(codes((await accountant.post(`${IR}/preview`, { input: { releaseId: second.id, invoiceNumber: '0901', againOf: id, note: 'x' } })).json().issues)).toContain('AGAIN_RELEASES');
  expect(codes((await accountant.post(`${IR}/preview`, { input: { ...again, releaseId: first.id, alsoReleaseIds: [second.id] } })).json().issues)).toEqual([]); // same releases, any order
  const { note: _, ...noNote } = again;
  expect(codes((await accountant.post(`${IR}/preview`, { input: noNote })).json().issues)).toContain('AGAIN_NOTE');
  expect(codes((await encoder.post(`${IR}/preview`, { input: again })).json().issues)).toContain('AGAIN_PERMISSION');
});

it('records again only a cancelled invoice record', async () => {
  const jo = await jobOrder(4);
  const rel = await release(jo, 4);
  const input = { releaseId: rel.id, invoiceNumber: '0911' };
  const ir = await encoder.post(`${IR}/post`, { input, expectedTotalCents: 448_000 }, idem());
  expect(ir.statusCode, ir.body).toBe(200);
  const p = await accountant.post(`${IR}/preview`, { input: { ...input, againOf: ir.json().id, note: 'x' } });
  expect(codes(p.json().issues)).toEqual(expect.arrayContaining(['AGAIN_NOT_CANCELLED', 'ALREADY_INVOICED']));
  expect(codes((await accountant.post(`${IR}/preview`, { input: { ...input, againOf: jo, note: 'x' } })).json().issues)).toContain('AGAIN_NOT_FOUND');
});
