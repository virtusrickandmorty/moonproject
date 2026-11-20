/**
 * Internal receipts and invoices (the owner's request, Nov 2026): a CR or an invoice (SI) number is typed from the BIR
 * booklet (digits only, checked against the ATP register) or from the shop's internal booklet (IN- or PR- and the number). Each is used
 * once among its own paper; internal ones are not BIR booklet paper. Made-up customers and numbers only.
 */
import { beforeEach, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, encoderOwnDefaults, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { invoiceNumbersBetween } from '../public.ts';
import { crNumbersBetween } from '../../COL/public.ts';
import { seedCustomers } from './cus-fixture.ts';

let env: TestEnv, encoder: Client, accountant: Client, c: ReturnType<typeof seedCustomers>, CASH: number;
beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

const COL = '/api/docs/col.collection';
const IR = '/api/docs/jo.invoice_record';
const errors = (issues: { code: string; level: string }[]) => issues.filter((i) => i.level === 'error').map((i) => i.code);
const deposit = (crNumber: string, more: object = {}) => ({ customerId: c.school, crNumber, applications: [], tenders: [{ cashPlaceId: CASH, amountCents: 10_000 }], ...more });
async function post(path: string, input: object, total: number) {
  const r = await encoder.post(`${path}/post`, { input, expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; number: string };
}
const previewErrors = async (path: string, input: object) => errors((await encoder.post(`${path}/preview`, { input })).json().issues);
/** A BIR booklet of each kind, numbers 1 to 500: a BIR number outside it is refused, an internal one is never checked. */
function booklets() {
  for (const kind of ['CR', 'SALES_INVOICE']) {
    env.db.prepare(`INSERT INTO tax_booklets (id, kind, atp_no, serial_from, serial_to, received_on, is_active, version, created_at, created_by) VALUES (?, ?, ?, 1, 500, '2026-01-05', 1, 1, '2026-01-05T09:00:00.000+08:00', ?)`)
      .run(`bk-${kind}`, kind, `ATP-SAMPLE-${kind}`, encoder.userId);
  }
}

it('takes an internal receipt number (PR- and the number) on a collection, used once among internal ones, apart from BIR CRs', async () => {
  booklets();
  // Letters on a BIR CR are refused, and the words say to pick Internal.
  const bad = (await encoder.post(`${COL}/preview`, { input: deposit('A-0125') })).json().issues as { code: string; message: string }[];
  expect(bad.find((i) => i.code === 'CR_NUMBER')?.message).toContain('pick Internal');

  // An internal receipt is PR- and the number (the owner's request, Nov 2026): other letters, an invoice's IN- or a
  // leading zero are refused, with words that show the form.
  for (const n of ['A-0125', 'IN-125', 'PR-0125', 'PR-', '125']) {
    const issue = ((await encoder.post(`${COL}/preview`, { input: deposit(n, { paper: 'internal' }) })).json().issues as { code: string; message: string }[]).find((i) => i.code === 'CR_NUMBER');
    expect(issue?.message, n).toContain('like PR-125');
  }
  const first = await post(COL, deposit('PR-125', { paper: 'internal' }), 10_000);
  expect((await encoder.get(`${COL}/${first.id}`)).json().input).toMatchObject({ crNumber: 'PR-125', paper: 'internal' });
  // The same internal number is used; BIR CR 125 is other paper; an internal one is not booklet paper.
  expect(await previewErrors(COL, deposit('PR-125', { paper: 'internal' }))).toEqual(['CR_USED']);
  expect(await previewErrors(COL, deposit('125'))).toEqual([]);
  expect(await previewErrors(COL, deposit('9999'))).toEqual(['BOOKLET_UNKNOWN']);
  expect(await previewErrors(COL, deposit('PR-9999', { paper: 'internal' }))).toEqual([]);
  await post(COL, deposit('125'), 10_000);
  // The BIR booklet's usage report counts BIR CRs only.
  expect(crNumbersBetween(env.db, 1, 500).map((r) => r.n)).toEqual([125]);
  // The journal says which paper it was.
  const memo = env.db.prepare(`SELECT j.memo FROM journals j WHERE j.source_id = ?`).pluck().get(first.id) as string;
  expect(memo).toContain('internal receipt PR-125');
  expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
});

it('takes an internal invoice number on an invoice record and a quick sale, used once among internal invoices', async () => {
  booklets();
  const input = { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'full', lines: [{ kind: 'made_to_order', description: 'Sample jersey', qty: 2, unitPriceCents: 50_000, discountCents: 0, roster: [] }] };
  const jo = await post('/api/docs/jo.job_order', input, 100_000);
  await post(COL, { customerId: c.school, crNumber: 'PR-7', paper: 'internal', applications: [{ jobOrderId: jo.id, amountCents: 100_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 100_000 }] }, 100_000);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${jo.id}/stage`, { from, to });
  const release = async (qty: number) => {
    const r = await accountant.post('/api/jo/releases', { release: { jobOrderId: jo.id, lines: [{ lineNo: 1, qty }], claimedBy: 'Coach Placeholder', idSeen: 'school_id' }, invoice: null, expectedTotalCents: qty * 50_000 }, idem());
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { release: { id: string } }).release.id;
  };
  const [one, two] = [await release(1), await release(1)];

  // An internal invoice is IN- and the number: a receipt's PR- is refused.
  expect(await previewErrors(IR, { releaseId: one, invoiceNumber: 'PR-901', paper: 'internal' })).toEqual(['INVOICE_NUMBER']);
  const ir = await post(IR, { releaseId: one, invoiceNumber: 'IN-901', paper: 'internal' }, 50_000);
  expect((await encoder.get(`${IR}/${ir.id}`)).json().input).toEqual({ releaseId: one, invoiceNumber: 'IN-901', paper: 'internal' });
  // The same internal number is used (on a record or a quick sale); BIR invoice 401 is other paper.
  expect(await previewErrors(IR, { releaseId: two, invoiceNumber: 'IN-901', paper: 'internal' })).toEqual(['INVOICE_USED']);
  const sale = { customerId: c.school, invoiceNumber: 'IN-901', paper: 'internal', lines: [{ kind: 'service', description: 'Sample alteration', qty: 1, unitPriceCents: 20_000, discountCents: 0 }] };
  expect(errors((await encoder.post('/api/qs/sales/preview', { sale, payment: { crNumber: 'PR-8', paper: 'internal', tenders: [{ cashPlaceId: CASH, amountCents: 20_000 }] } })).json().sale.issues)).toEqual(['INVOICE_USED']);
  expect(await previewErrors(IR, { releaseId: two, invoiceNumber: '0401' })).toEqual([]);
  // A quick sale on another internal invoice, paid on an internal receipt.
  const qs = await encoder.post('/api/qs/sales', { sale: { ...sale, invoiceNumber: 'IN-902' }, payment: { crNumber: 'PR-8', paper: 'internal', tenders: [{ cashPlaceId: CASH, amountCents: 20_000 }] }, expectedTotalCents: 20_000 }, idem());
  expect(qs.statusCode, qs.body).toBe(200);
  // The BIR booklet's usage report counts BIR invoices only.
  await post(IR, { releaseId: two, invoiceNumber: '0401' }, 50_000);
  expect(invoiceNumbersBetween(env.db, 1, 500).map((r) => r.n)).toEqual([401]);
  expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
});
