/**
 * Deposit transfer (PLAN D5 DEP-XFER, D6): golden G-28 (PLAN I2) and its cancel, the receivable-first split, the D6 cancel
 * order with collections, refunds and invoice records, rules, API rules, and a property test in which money held for a
 * customer is only ever moved, never made or lost.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { addSettingVersion } from '../../../engine/settings.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { releaseDoc } from '../../JO/doctypes/release.ts';
import { invoiceRecordDoc } from '../../JO/doctypes/invoice-record.ts';
import { invoicedCents, jobOrdersOf, joMoney } from '../../JO/public.ts';
import { changeStage } from '../../JO/stages.ts';
import { collectionDoc } from '../doctypes/collection.ts';
import { refundDoc } from '../doctypes/refund.ts';
import { depositTransferDoc } from '../doctypes/deposit-transfer.ts';
import { depositsHeld } from '../ledger.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

const DXF = '/api/docs/col.deposit_transfer';
const transfer = (input: object, total: number, who = encoder) => who.post(`${DXF}/post`, { input, expectedTotalCents: total }, idem());
const cancel = (type: string, id: string, who = accountant) => who.post(`/api/docs/${type}/${id}/cancel`, { reason: 'Recorded by mistake, undoing it' }, idem());
const codes = async (input: object) => ((await encoder.post(`${DXF}/preview`, { input })).json().issues as { code: string }[]).map((i) => i.code);
const money = async (jo: string) => (await encoder.get(`/api/jo/orders/${jo}/status`)).json().money;
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

const jobInput = (totalCents: number, lines = [totalCents], customerId = c.school) => ({
  customerId,
  dueInDays: 15,
  priority: 'normal',
  paymentTerms: 'dp50',
  lines: lines.map((cents) => ({ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: cents, discountCents: 0, roster: [] })),
});
/** A recorded JO of one or more one-piece lines, moved to Ready for release. */
async function jobOrder(lines: number[], customerId = c.school): Promise<string> {
  const total = lines.reduce((s, x) => s + x, 0);
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: jobInput(total, lines, customerId), expectedTotalCents: total }, idem());
  expect(r.statusCode, r.body).toBe(200);
  for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) await encoder.post(`/api/jo/orders/${r.json().id}/stage`, { from, to });
  return r.json().id;
}
let cr = 100;
/** A cash collection: `applied` on the JO (none for unapplied money only), `extra` kept as the customer's unapplied payment. */
async function collect(jo: string | null, applied: number, extra = 0): Promise<string> {
  const input = { customerId: c.school, crNumber: String(++cr), applications: jo ? [{ jobOrderId: jo, amountCents: applied }] : [], tenders: [{ cashPlaceId: CASH, amountCents: applied + extra }] };
  const r = await encoder.post('/api/docs/col.collection/post', { input, expectedTotalCents: applied + extra }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id;
}
let invoiceNo = 500;
/** Releases one line in full with its invoice record (a credit release, so the accountant records it). */
async function releaseWithInvoice(jo: string, lineNo: number, grossCents: number): Promise<string> {
  const release = { jobOrderId: jo, lines: [{ lineNo, qty: 1 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id', creditNote: 'Balance by bank transfer', creditDueInDays: 7 };
  const r = await accountant.post('/api/jo/releases', { release, invoice: { invoiceNumber: String(++invoiceNo) }, expectedTotalCents: grossCents }, idem());
  expect(r.statusCode, r.body).toBe(200);
  return r.json().invoiceRecord.id;
}

/** Journal lines as [account code, party id, JO ref, debit, credit]: the document's own, its reversal, or its cancel follow-up. */
const linesOf = (documentId: string, kind: 'original' | 'reversal' | 'follow-up' = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.source_type = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind === 'follow-up' ? 'document-cancel' : 'document', kind === 'reversal' ? 'reversal' : 'original') as unknown[][];

describe('deposit transfer golden (PLAN I2)', () => {
  it('G-28: an edited JO’s ₱20,000 deposit moves to the reissued JO, 2201 to 2201 with no cash line; cancel mirrors it', async () => {
    const jo1 = await jobOrder([4_000_000]);
    await collect(jo1, 2_000_000);
    const edit = await encoder.post(`/api/docs/jo.job_order/${jo1}/reissue`, { input: jobInput(4_500_000), expectedTotalCents: 4_500_000, reason: 'Customer added two more sets' }, idem());
    expect(edit.statusCode, edit.body).toBe(200);
    const jo2 = edit.json().id as string;
    // The deposit stays on the cancelled JO until the encoder moves it (D6); the form offers the replacement.
    expect((await encoder.get(`/api/col/customers/${c.school}/transferable`)).json()).toEqual({
      customerId: c.school,
      customerName: 'Moonlight Test School',
      held: [{ id: jo1, number: 'JO-000001', status: 'cancelled', depositsHeldCents: 2_000_000, replacement: { id: jo2, number: 'JO-000002' } }],
      unappliedCents: 0,
      jobOrders: [{ id: jo2, number: 'JO-000002', dueDate: '2026-10-13', totalCents: 4_500_000, balanceDueCents: 4_500_000 }],
    });

    const input = { customerId: c.school, fromJobOrderId: jo1, toJobOrderId: jo2, amountCents: 2_000_000 };
    const pre = (await encoder.post(`${DXF}/preview`, { input })).json();
    expect(pre.summary).toBe('This will move ₱20,000.00 held for Moonlight Test School from JO-000001 to JO-000002. No cash comes in or goes out.');
    expect(pre.issues).toEqual([]);
    expect(pre.journal).toBeUndefined(); // encoders never see debits and credits

    const res = await transfer(input, 2_000_000);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ number: 'DXF-000001', businessDate: '2026-09-28', totalCents: 2_000_000 });
    const { id } = res.json();
    expect(linesOf(id)).toEqual([
      ['2201', c.school, jo1, 2_000_000, 0],
      ['2201', c.school, jo2, 0, 2_000_000],
    ]);
    expect(await money(jo2)).toMatchObject({ depositsHeldCents: 2_000_000, balanceDueCents: 2_500_000 });
    expect(await money(jo1)).toMatchObject({ depositsHeldCents: 0, balanceDueCents: 0 });
    expect((await encoder.get(`${DXF}/${id}`)).json().input).toEqual(input);

    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    expect((await cancel('col.deposit_transfer', id, encoder)).statusCode).toBe(200); // an encoder action, undone the same way
    expect(linesOf(id, 'reversal')).toEqual([
      ['2201', c.school, jo1, 0, 2_000_000],
      ['2201', c.school, jo2, 2_000_000, 0],
    ]);
    expect(linesOf(id, 'follow-up')).toEqual([]);
    expect(env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(id)).toBe('2026-09-29');
    expect([depositsHeld(env.db, c.school, jo1), depositsHeld(env.db, c.school, jo2)]).toEqual([2_000_000, 0]);
    noBrokenInvariants();
  });
});

describe('deposit transfer rules (PLAN D5, D6)', () => {
  it('unapplied money moved to a partly invoiced JO pays its receivable first, the rest is a deposit the next invoice applies', async () => {
    const jo = await jobOrder([1_000_000, 500_000]);
    const ir1 = await releaseWithInvoice(jo, 1, 1_000_000); // AR 10,000.00, 5,000.00 not invoiced yet
    await collect(null, 0, 1_200_000); // ₱12,000 unapplied
    const input = { customerId: c.school, toJobOrderId: jo, amountCents: 1_200_000, note: 'Customer asked to use the extra payment' };
    const pre = (await encoder.post(`${DXF}/preview`, { input })).json();
    expect(pre.summary).toBe(
      'This will move ₱12,000.00 held for Moonlight Test School from their unapplied payments to JO-000001: ₱10,000.00 pays what is invoiced and ₱2,000.00 is its deposit. No cash comes in or goes out.',
    );
    const { id } = (await transfer(input, 1_200_000)).json();
    expect(linesOf(id)).toEqual([
      ['2201', c.school, null, 1_200_000, 0],
      ['1201', c.school, jo, 0, 1_000_000],
      ['2201', c.school, jo, 0, 200_000],
    ]);
    expect(await money(jo)).toMatchObject({ receivableCents: 0, depositsHeldCents: 200_000, balanceDueCents: 300_000 });

    // The second release's invoice applies the moved deposit (DEP-APPLY). Cancelling the transfer then reopens the
    // receivable for that part instead of taking 2201 below zero (D6), and the ₱12,000 is unapplied again.
    const ir2 = await releaseWithInvoice(jo, 2, 500_000);
    expect(linesOf(ir2).slice(-2)).toEqual([['2201', c.school, jo, 200_000, 0], ['1201', c.school, jo, 0, 200_000]]);
    expect((await cancel('col.deposit_transfer', id)).statusCode).toBe(200);
    expect(linesOf(id, 'reversal')).toEqual([
      ['2201', c.school, null, 0, 1_200_000],
      ['1201', c.school, jo, 1_000_000, 0],
      ['2201', c.school, jo, 200_000, 0],
    ]);
    expect(linesOf(id, 'follow-up')).toEqual([['1201', c.school, jo, 200_000, 0], ['2201', c.school, jo, 0, 200_000]]);
    expect(await money(jo)).toMatchObject({ invoicedCents: 1_500_000, receivableCents: 1_500_000, depositsHeldCents: 0, balanceDueCents: 1_500_000 });
    expect(depositsHeld(env.db, c.school, null)).toBe(1_200_000);
    expect(ir1).toBeTruthy();
    noBrokenInvariants();
  });

  it('a collection cannot be cancelled while its deposit is moved, nor a move while the moved deposit is refunded (D6)', async () => {
    const [jo1, jo2] = [await jobOrder([4_000_000]), await jobOrder([3_000_000])];
    const col = await collect(jo1, 2_000_000);
    expect((await cancel('jo.job_order', jo1, encoder)).statusCode).toBe(200); // called off, not edited
    const view = (await encoder.get(`/api/col/customers/${c.school}/transferable`)).json();
    expect(view.held).toEqual([{ id: jo1, number: 'JO-000001', status: 'cancelled', depositsHeldCents: 2_000_000, replacement: null }]);
    const dxf = (await transfer({ customerId: c.school, fromJobOrderId: jo1, toJobOrderId: jo2, amountCents: 2_000_000 }, 2_000_000)).json().id;

    expect((await cancel('col.collection', col)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: DXF-000001.' });
    const back = { customerId: c.school, jobOrderId: jo2, tenders: [{ cashPlaceId: CASH, amountCents: 500_000 }], reason: 'Part of the deposit returned' };
    const rfd = (await accountant.post('/api/docs/col.refund/post', { input: back, expectedTotalCents: 500_000 }, idem())).json().id;
    expect((await cancel('col.deposit_transfer', dxf)).json()).toMatchObject({ code: 'HAS_DEPENDENTS', message: 'Cancel these first: RFD-000001.' });

    expect((await cancel('col.refund', rfd)).statusCode).toBe(200);
    expect((await cancel('col.deposit_transfer', dxf)).statusCode).toBe(200);
    expect((await cancel('col.collection', col)).statusCode).toBe(200);
    for (const jo of [jo1, jo2]) expect(await money(jo)).toMatchObject({ receivableCents: 0, depositsHeldCents: 0 });
    noBrokenInvariants();
  });

  it('moves only money held, to another recorded JO of the same customer, up to its balance due', async () => {
    const [jo1, jo2, done, theirs] = [await jobOrder([4_000_000]), await jobOrder([1_000_000]), await jobOrder([500_000]), await jobOrder([1_000_000], c.other)];
    await collect(jo1, 2_000_000, 300_000);
    await collect(done, 500_000);
    const move = (extra: object) => ({ customerId: c.school, fromJobOrderId: jo1, toJobOrderId: jo2, amountCents: 100_000, ...extra });
    expect(await codes(move({}))).toEqual(['JO_OPEN']); // an open JO's deposit may move, with a warning
    expect(await codes(move({ amountCents: 2_000_001, toJobOrderId: jo2 }))).toEqual(['OVER_BALANCE', 'OVER_HELD', 'JO_OPEN']);
    expect(await codes(move({ toJobOrderId: jo1 }))).toEqual(['SAME_JO', 'JO_OPEN']);
    expect(await codes(move({ toJobOrderId: done }))).toEqual(['OVER_BALANCE', 'JO_OPEN']);
    expect(await codes(move({ toJobOrderId: theirs }))).toEqual(['JOB_ORDER', 'JO_OPEN']);
    expect(await codes(move({ fromJobOrderId: theirs }))).toEqual(['JOB_ORDER', 'OVER_HELD']);
    expect(await codes({ customerId: c.school, toJobOrderId: jo2, amountCents: 300_000 })).toEqual([]); // unapplied money
    expect(await codes({ customerId: c.school, toJobOrderId: jo2, amountCents: 300_001 })).toEqual(['OVER_HELD']);
    expect((await encoder.post(`${DXF}/preview`, { input: move({ amountCents: 2_000_001 }) })).json().issues[0].message).toBe('JO-000002 has ₱10,000.00 left to pay. Move at most that.');
    await cancel('jo.job_order', jo2, encoder);
    expect(await codes(move({}))).toEqual(['JO_CANCELLED', 'JO_OPEN']);

    // Deposits are kept in downpayment VAT mode A only, like collections and invoice records.
    tx(env.db, () => addSettingVersion(env.db, { key: 'sales.deposit_vat_mode', effectiveFrom: today(env.clock), value: 'B', reason: 'Accountant decision for the test', userId: accountant.userId, at: stamp(env.clock), today: today(env.clock) }));
    const jo3 = await jobOrder([1_000_000]);
    expect(await codes(move({ toJobOrderId: jo3 }))).toEqual(['JO_OPEN', 'DEPOSIT_VAT_MODE']);
  });
});

describe('API rules', () => {
  it('rejects client-sent totals, splits, dates and numbers (N-03), and needs col.transfer', async () => {
    const [jo1, jo2] = [await jobOrder([1_000_000]), await jobOrder([1_000_000])];
    await collect(jo1, 100_000);
    const good = { customerId: c.school, fromJobOrderId: jo1, toJobOrderId: jo2, amountCents: 1_000 };
    for (const extra of [{ date: '2026-01-01' }, { number: 'DXF-9' }, { totalCents: 1_000 }, { toDepositCents: 1_000 }, { toReceivableCents: 0 }, { status: 'posted' }]) {
      expect((await transfer({ ...good, ...extra }, 1_000)).statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await transfer({ ...good, amountCents: 0 }, 0)).statusCode).toBe(400);
    expect((await transfer(good, 1_001)).json().code).toBe('TOTALS_CHANGED');
    const production = await env.as('production');
    expect((await transfer(good, 1_000, production)).statusCode).toBe(403);
    expect((await production.get(`/api/col/customers/${c.school}/transferable`)).statusCode).toBe(403);
    expect((await (await env.as('tv')).get(DXF)).statusCode).toBe(403);
    const k = idem();
    const once = await encoder.post(`${DXF}/post`, { input: good, expectedTotalCents: 1_000 }, k);
    expect((await encoder.post(`${DXF}/post`, { input: good, expectedTotalCents: 1_000 }, k)).json().id).toBe(once.json().id); // N-02
    expect((await accountant.post(`${DXF}/preview`, { input: good })).json().journal).toHaveLength(2);
  });
});

describe('property test (PLAN I1.3)', () => {
  it('random collections, transfers, refunds, JO edits, invoices and cancels: stored = computed, nothing negative, money only moves', async () => {
    let number = 10_000;
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        // A fresh database per run, so each run's JOs are the only ones the arbitraries can pick.
        const t = await createTestEnv();
        const db = t.db;
        const userId = createUser(db, `prop-${number}`, ['accountant']);
        const cs = seedCustomers(db, userId);
        const actor = {
          userId,
          permissions: new Set(['jo.post', 'jo.cancel', 'jo.release', 'jo.release_with_balance', 'jo.invoice', 'jo.invoice_cancel', 'col.post', 'col.cancel', 'col.refund', 'col.transfer']),
        };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: (p: string) => actor.permissions.has(p) });
        const posted = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const arbOrNull = <T,>(make: () => fc.Arbitrary<T>) => {
          try {
            return make();
          } catch {
            return null; // nothing to act on yet
          }
        };
        const cash = cashPlaceId(db, '1101');
        for (let i = 0; i < 3; i++) {
          const customerId = i < 2 ? cs.school : cs.other;
          const input = { ...jobInput(0, [], customerId), lines: [{ kind: 'made_to_order' as const, description: 'Team jersey set', qty: 1, unitPriceCents: g(() => fc.integer({ min: 100_000, max: 5_000_000 })), discountCents: 0, roster: [] }] };
          const { id: jo, totalCents } = postDocument(e, jobOrderDoc, actor, { input, expectedTotalCents: input.lines[0]!.unitPriceCents });
          for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']] as const) changeStage(db, jo, { from, to }, { userId, at: stamp(t.clock) });
          const [dp, extra] = [g(() => fc.integer({ min: 1, max: totalCents })), g(() => fc.integer({ min: 0, max: 500_000 }))];
          const col = { customerId, crNumber: String(++number), applications: [{ jobOrderId: jo, amountCents: dp }], tenders: [{ cashPlaceId: cash, amountCents: dp + extra }] };
          postDocument(e, collectionDoc, actor, { input: col, expectedTotalCents: dp + extra });
        }
        const step = fc.constantFrom('collect', 'transfer', 'transfer', 'transfer', 'refund', 'edit-jo', 'cancel-jo', 'release+invoice', 'cancel-transfer', 'cancel-transfer', 'cancel-refund', 'cancel-collection', 'cancel-invoice');
        const steps = g(() => fc.array(step, { minLength: 1, maxLength: 12 }));
        for (const step of steps) {
          try {
            if (step === 'collect' || step === 'transfer' || step === 'refund') {
              const def: DocTypeDef = step === 'collect' ? collectionDoc : step === 'transfer' ? depositTransferDoc : refundDoc;
              const arb = arbOrNull(() => def.arbitrary(db));
              if (!arb) continue;
              const raw = g(() => arb);
              const input = step === 'collect' ? { ...raw, crNumber: String(++number) } : raw;
              const doc = def.compute(input, ctx());
              const p = postDocument(e, def, actor, { input, expectedTotalCents: doc.totalCents });
              if (def === depositTransferDoc) {
                expect(depositTransferDoc.load(db, p.id)).toEqual(doc);
                expect(depositTransferDoc.toInput(doc)).toEqual(input);
              }
            } else if (step === 'edit-jo') {
              const ids = posted('jo.job_order');
              if (ids.length === 0) continue;
              const id = g(() => fc.constantFrom(...ids));
              const old = jobOrderDoc.load(db, id);
              reissueDocument(e, jobOrderDoc, actor, id, { input: jobOrderDoc.toInput(old), expectedTotalCents: old.totalCents, reason: 'Customer changed the order' });
            } else if (step === 'release+invoice') {
              const arb = arbOrNull(() => releaseDoc.arbitrary(db));
              if (!arb) continue;
              const input = g(() => arb);
              const doc = releaseDoc.compute(input, ctx());
              const r = postDocument(e, releaseDoc, actor, { input, expectedTotalCents: doc.totalCents });
              if (doc.totalCents > 0) postDocument(e, invoiceRecordDoc, actor, { input: { releaseId: r.id, invoiceNumber: String(++number) }, expectedTotalCents: doc.totalCents });
            } else {
              const [type, def] = (
                { 'cancel-jo': ['jo.job_order', jobOrderDoc], 'cancel-transfer': ['col.deposit_transfer', depositTransferDoc], 'cancel-refund': ['col.refund', refundDoc],
                  'cancel-collection': ['col.collection', collectionDoc], 'cancel-invoice': ['jo.invoice_record', invoiceRecordDoc] } as const
              )[step];
              const ids = posted(type);
              if (ids.length === 0) continue;
              cancelDocument(e, def, actor, g(() => fc.constantFrom(...ids)), 'Recorded by mistake');
            }
          } catch (err) {
            // Refusals are fine (a transfer out standing, a JO with a release, a JO no longer ready): they record nothing.
            if (!(err instanceof AppError) || !['HAS_DEPENDENTS', 'VALIDATION'].includes(err.code)) throw err;
          }
          for (const customerId of [cs.school, cs.other]) {
            const jos = jobOrdersOf(db, customerId, true);
            for (const jo of jos) {
              const m = joMoney(db, jo.id);
              expect(Math.min(m.receivableCents, m.depositsHeldCents), `${step}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(0);
              expect(m.receivableCents, step).toBeLessThanOrEqual(invoicedCents(db, jo.id));
            }
            expect(depositsHeld(db, customerId, null), step).toBeGreaterThanOrEqual(0);
            // Money in (collections − refunds) = what it paid on invoices + deposits per JO + unapplied: transfers only move it.
            const sum = (sql: string) => db.prepare(sql).pluck().get(customerId) as number;
            const received = sum(`SELECT COALESCE(SUM(d.total_cents), 0) FROM col_collections x JOIN documents d ON d.id = x.document_id WHERE x.customer_id = ? AND d.status = 'posted'`);
            const refunded = sum(`SELECT COALESCE(SUM(d.total_cents), 0) FROM col_refunds x JOIN documents d ON d.id = x.document_id WHERE x.customer_id = ? AND d.status = 'posted'`);
            const held = jos.reduce((s, jo) => {
              const m = joMoney(db, jo.id);
              return s + m.invoicedCents - m.receivableCents + m.depositsHeldCents;
            }, depositsHeld(db, customerId, null));
            expect(held, step).toBe(received - refunded);
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 25 },
    );
  });
});
