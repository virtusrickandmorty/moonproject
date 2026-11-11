/**
 * One invoice for several releases of a job order (the owner's request, Nov 2026): when a release's invoice is written,
 * the earlier releases of the same job order with no invoice yet can go on it too. The sale is all of their lines, each
 * release counts as invoiced, cancelling the invoice frees them all, and a release on it cannot be cancelled first.
 * Made-up customers only.
 */
import { beforeEach, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { invoiceSaleLines, joMoney, releasesAwaitingInvoice } from '../public.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv, encoder: Client, accountant: Client, c: ReturnType<typeof seedCustomers>, CASH: number;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

async function jobOrder(qty: number, customerId = c.school): Promise<string> {
  const input = { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty, unitPriceCents: 112_000, discountCents: 0, roster: [] }] };
  const r = await encoder.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: qty * 112_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to });
  return r.json().id;
}
const credit = { creditNote: 'Made-up: balance by bank transfer', creditDueInDays: 7 };
const releaseOf = (jo: string, qty: number) => ({ jobOrderId: jo, lines: [{ lineNo: 1, qty }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', ...credit });
async function release(jo: string, qty: number, invoice: object | null) {
  const r = await accountant.post('/api/jo/releases', { release: releaseOf(jo, qty), invoice, expectedTotalCents: qty * 112_000 }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { release: { id: string; number: string }; invoiceRecord: { id: string; number: string } | null };
}
const journal = (id: string) => env.db.prepare(`SELECT a.code, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
  WHERE j.source_id = ? AND j.posting_kind = 'original' AND j.source_type = 'document' ORDER BY l.line_no`).raw().all(id);

it('puts the earlier releases with no invoice on the new release\'s invoice, and frees them all when it is cancelled', async () => {
  const jo = await jobOrder(10);
  const cr = { customerId: c.school, crNumber: '5001', applications: [{ jobOrderId: jo, amountCents: 300_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 300_000 }] };
  expect((await encoder.post('/api/docs/col.collection/post', { input: cr, expectedTotalCents: 300_000 }, idem())).statusCode).toBe(200);

  const first = await release(jo, 3, null); // invoice to follow
  const second = await release(jo, 2, null);
  // The next release's preview lists them, and its booklet takes in the ones ticked.
  const pv = await accountant.post('/api/jo/releases/preview', { release: releaseOf(jo, 5), alsoReleaseIds: [first.release.id, second.release.id] });
  expect(pv.statusCode, pv.body).toBe(200);
  expect(pv.json().uninvoiced.map((r: { number: string }) => r.number)).toEqual([first.release.number, second.release.number]);
  expect(pv.json().booklet).toMatchObject({ grossCents: 1_120_000, vatCents: 120_000 });
  expect((await accountant.post('/api/jo/releases/preview', { release: releaseOf(jo, 5) })).json().booklet).toMatchObject({ grossCents: 560_000 });

  const third = await release(jo, 5, { invoiceNumber: '0901', alsoReleaseIds: [first.release.id, second.release.id] });
  const ir = third.invoiceRecord!;
  expect(journal(ir.id).filter((l) => (l as number[])[1] !== 0 || (l as number[])[2] !== 0)).toEqual([['1201', 1_120_000, 0], ['4101', 0, 1_000_000], ['2301', 0, 120_000], ['2201', 300_000, 0], ['1201', 0, 300_000]]);
  const doc = (await encoder.get(`/api/docs/jo.invoice_record/${ir.id}`)).json();
  expect(doc.input).toEqual({ releaseId: third.release.id, alsoReleaseIds: [first.release.id, second.release.id], invoiceNumber: '0901' });
  expect(doc.doc).toMatchObject({ releaseNumbers: [first.release.number, second.release.number, third.release.number], grossCents: 1_120_000 });
  expect(joMoney(env.db, jo)).toMatchObject({ invoicedCents: 1_120_000 });
  expect(releasesAwaitingInvoice(env.db, '2099-12-31')).toEqual([]);
  expect((await encoder.get(`/api/jo/orders/${jo}/status`)).json().awaitingInvoice).toEqual([]);
  expect(invoiceSaleLines(env.db).filter((l) => l.id === ir.id).reduce((n, l) => n + l.qty, 0)).toBe(10);
  // The release picker shows each with the invoice that covers it.
  const picked = (await encoder.get(`/api/jo/pick/releases?q=${first.release.number}`)).json();
  expect(picked[0]).toMatchObject({ number: first.release.number, invoice: { id: ir.id, invoiceNumber: '0901' } });

  // A release on the invoice is not cancelled before the invoice; a second invoice for it is refused.
  const cancelFirst = await accountant.post(`/api/docs/jo.release/${first.release.id}/cancel`, { reason: 'Made-up: wrong slip' }, idem());
  expect(cancelFirst.json()).toMatchObject({ code: 'HAS_DEPENDENTS' });
  const again = await encoder.post('/api/docs/jo.invoice_record/preview', { input: { releaseId: first.release.id, invoiceNumber: '0902' } });
  expect(again.json().issues.map((i: { code: string }) => i.code)).toContain('ALREADY_INVOICED');

  // Cancelled: all three wait for their invoice again; the invoice form offers the other two with the one picked.
  expect((await accountant.post(`/api/docs/jo.invoice_record/${ir.id}/cancel`, { reason: 'Made-up: spoiled invoice' }, idem())).statusCode).toBe(200);
  expect(releasesAwaitingInvoice(env.db, '2099-12-31').map((r) => r.number)).toEqual([first.release.number, second.release.number, third.release.number]);
  const info = (await encoder.get(`/api/jo/releases/${third.release.id}/invoice-info?also=${first.release.id}`)).json();
  expect(info.others.map((r: { number: string }) => r.number)).toEqual([first.release.number, second.release.number]);
  expect(info.booklet).toMatchObject({ grossCents: 896_000 });
  const input = { releaseId: third.release.id, alsoReleaseIds: [first.release.id], invoiceNumber: '0903' };
  const later = await encoder.post('/api/docs/jo.invoice_record/post', { input, expectedTotalCents: 896_000 }, idem());
  expect(later.statusCode, later.body).toBe(200);
  expect(releasesAwaitingInvoice(env.db, '2099-12-31').map((r) => r.number)).toEqual([second.release.number]);
  expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
});

it("refuses another job order's release, a cancelled one, and the same release twice", async () => {
  const jo = await jobOrder(4);
  const other = await jobOrder(2, c.other);
  const a = await release(jo, 2, null);
  const b = await release(jo, 2, null);
  const elsewhere = await release(other, 2, null);
  const issues = async (also: string[]) => ((await encoder.post('/api/docs/jo.invoice_record/preview', { input: { releaseId: b.release.id, alsoReleaseIds: also, invoiceNumber: '0911' } })).json().issues as { code: string }[]).map((i) => i.code);
  expect(await issues([elsewhere.release.id])).toContain('OTHER_JOB_ORDER');
  expect(await issues([b.release.id])).toContain('RELEASE_TWICE');
  expect(await issues([a.release.id])).toEqual([]);
  expect((await accountant.post(`/api/docs/jo.release/${a.release.id}/cancel`, { reason: 'Made-up: wrong slip' }, idem())).statusCode).toBe(200);
  expect(await issues([a.release.id])).toContain('RELEASE_CANCELLED');
});
