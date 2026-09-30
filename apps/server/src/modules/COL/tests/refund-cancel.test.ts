/**
 * The cancels of G-07 line by line (PLAN D5 COL-OVER and DEP-REFUND, D6 "Collection: Always / Mirror journal"):
 * ₱12,000 paid on ₱10,000 AR keeps ₱2,000 unapplied (Cr 2201, no JO); the refund pays it back (Dr 2201 / Cr 1101).
 * Cancelling the refund mirrors it and the ₱2,000 is held again; cancelling the collection then mirrors it, the AR is
 * open again and nothing is held. Worked by hand from the plan's words. (Posting coverage check,
 * docs/review/posting-coverage.md.) As in collection.test.ts, the invoiced receivable is posted as the invoice
 * record's journal, tagged with the JO, to keep this free of releases.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, vatFromGross } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { postJournal, type DraftLine } from '../../../engine/ledger/post.ts';
import { tx } from '../../../platform/db/driver.ts';
import { stamp } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { joLedger } from '../../JO/public.ts';
import { depositsHeld } from '../ledger.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  CASH = cashPlaceId(env.db, '1101');
});

const linesOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
       JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .raw()
    .all(documentId, kind);

describe('G-07 cancels (D5 COL-OVER, DEP-REFUND; D6)', () => {
  it('the refund’s mirror holds the ₱2,000 again; the collection’s mirror reopens the ₱10,000 AR and takes the ₱2,000 unapplied back out of 2201', async () => {
    const lines = [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: 1_000_000, discountCents: 0, roster: [] }];
    const jo = (await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: c.school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: 1_000_000 }, idem())).json().id as string;
    const party = { type: 'customer', id: c.school };
    const { netCents, vatCents } = vatFromGross(1_000_000, 1200);
    const inv: DraftLine[] = [
      { account: { role: 'AR_TRADE' }, party, ref: { documentId: jo }, debitCents: 1_000_000 },
      { account: { role: 'SALES_MTO' }, party, creditCents: netCents },
      { account: { role: 'OUTPUT_VAT' }, party, creditCents: vatCents },
    ];
    tx(env.db, () => postJournal(env.db, { memo: 'Invoice record stand-in', lines: inv }, { sourceType: 'test', sourceId: newId(), businessDate: '2026-09-28', userId: encoder.userId, at: stamp(env.clock) }));

    const col = await encoder.post('/api/docs/col.collection/post', {
      input: { customerId: c.school, crNumber: '0104', applications: [{ jobOrderId: jo, amountCents: 1_000_000 }], tenders: [{ cashPlaceId: CASH, amountCents: 1_200_000 }] },
      expectedTotalCents: 1_200_000,
    }, idem());
    expect(col.statusCode, col.body).toBe(200);
    const colId = col.json().id as string;
    expect(linesOf(colId)).toEqual([['1101', null, null, 1_200_000, 0], ['1201', c.school, jo, 0, 1_000_000], ['2201', c.school, null, 0, 200_000]]);
    const rfd = await accountant.post('/api/docs/col.refund/post', {
      input: { customerId: c.school, tenders: [{ cashPlaceId: CASH, amountCents: 200_000 }], reason: 'Overpayment returned to the customer' },
      expectedTotalCents: 200_000,
    }, idem());
    expect(rfd.statusCode, rfd.body).toBe(200);
    const rfdId = rfd.json().id as string;
    expect(linesOf(rfdId)).toEqual([['2201', c.school, null, 200_000, 0], ['1101', null, null, 0, 200_000]]);

    env.clock.advance(24 * 3600_000);
    [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
    expect((await accountant.post(`/api/docs/col.refund/${rfdId}/cancel`, { reason: 'Customer did not take the money' }, idem())).statusCode).toBe(200);
    expect(linesOf(rfdId, 'reversal')).toEqual([['2201', c.school, null, 0, 200_000], ['1101', null, null, 200_000, 0]]);
    expect(depositsHeld(env.db, c.school, null)).toBe(200_000);

    expect((await encoder.post(`/api/docs/col.collection/${colId}/cancel`, { reason: 'Recorded against the wrong customer' }, idem())).statusCode).toBe(200);
    expect(linesOf(colId, 'reversal')).toEqual([['1101', null, null, 0, 1_200_000], ['1201', c.school, jo, 1_000_000, 0], ['2201', c.school, null, 200_000, 0]]);
    expect(env.db.prepare(`SELECT DISTINCT business_date FROM journals WHERE posting_kind = 'reversal'`).pluck().all()).toEqual(['2026-09-29']);
    expect(depositsHeld(env.db, c.school, null)).toBe(0);
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 1_000_000, depositsHeldCents: 0 });
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});
