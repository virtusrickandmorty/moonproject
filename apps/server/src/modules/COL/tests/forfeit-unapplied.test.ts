/**
 * Deposits not on a job order (the owner's request, 26 Oct 2026): a layout fee deposit (and other deposits) paid before
 * any job order is the customer's credit, for a job order if they order (a deposit transfer); once it is 30 days old and
 * they did not, it may be forfeited as other income, oldest money first and only what is matured.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env?.db.close(); env = undefined; });
const DAY = 24 * 3600_000;

describe('a deposit not on a job order', () => {
  it('is credited to a job order, or forfeited once 30 days old: oldest money first, only what is matured', async () => {
    env = await createTestEnv(); // 28 September 2026
    let encoder = await env.as('encoder');
    const customer = seedCustomers(env.db, encoder.userId).school;
    const pay = async (cents: number, cr: string) => {
      const r = await encoder.post('/api/docs/col.collection/post', { input: { customerId: customer, crNumber: cr, applications: [], tenders: [{ cashPlaceId: cashPlaceId(env!.db, '1101'), amountCents: cents }] }, expectedTotalCents: cents }, idem());
      expect(r.statusCode, r.body).toBe(200);
      return r.json().id as string;
    };
    const later = async (days: number) => { env!.clock.advance(days * DAY); encoder = await env!.as('encoder'); return env!.as('owner'); };
    const forfeit = (c: Client, amountCents: number) =>
      c.post('/api/docs/col.forfeit/post', { input: { customerId: customer, amountCents, reason: 'Did not order the layout within 30 days' }, expectedTotalCents: amountCents }, idem());
    const codes = (r: { json(): { details?: { code: string }[] } }) => (r.json().details ?? []).map((d) => d.code);

    // 28 Sep: a ₱1,000 layout fee deposit; 18 Oct: ₱500 more.
    await pay(100_000, '5001');
    let owner = await later(20);
    await pay(50_000, '5002');

    // 23 Oct: ₱300 of it goes to a job order the customer ordered: taken from the oldest payment.
    const jo = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: customer, dueInDays: 10, priority: 'normal', paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Made-up layout shirts', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }] }, expectedTotalCents: 100_000 }, idem());
    owner = await later(5);
    const moved = await encoder.post('/api/docs/col.deposit_transfer/post', { input: { customerId: customer, toJobOrderId: jo.json().id, amountCents: 30_000 }, expectedTotalCents: 30_000 }, idem());
    expect(moved.statusCode, moved.body).toBe(200);

    // Too early on 23 Oct: nothing is 30 days old yet.
    const early = await forfeit(owner, 10_000);
    expect(codes(early)).toContain('NOT_MATURE');
    expect(early.json().message).toContain('can be kept from 2026-10-28');

    // 29 Oct: the first ₱1,000 less the ₱300 moved is matured; the ₱500 of 18 Oct is not (until 17 Nov).
    owner = await later(6);
    const list = (await owner.get('/api/col/unapplied-deposits')).json() as { days: number; rows: { customerId: string; heldCents: number; maturedCents: number; firstPaid: string; nextMatures: string | null }[] };
    expect(list.days).toBe(30);
    expect(list.rows).toEqual([expect.objectContaining({ customerId: customer, heldCents: 120_000, maturedCents: 70_000, firstPaid: '2026-09-28', nextMatures: '2026-11-17' })]);
    expect(((await owner.get('/api/dash/notifications')).json() as { kind: string; amountCents?: number }[])).toContainEqual(expect.objectContaining({ kind: 'deposit-matured', amountCents: 70_000 }));
    const tooMuch = await forfeit(owner, 70_001);
    expect(codes(tooMuch)).toContain('NOT_MATURE');
    expect(tooMuch.json().message).toContain('Only ₱700.00');

    const kept = await forfeit(owner, 70_000);
    expect(kept.statusCode, kept.body).toBe(200);
    const journal = env.db.prepare(`SELECT a.code, l.party_id, l.ref_doc_id, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? AND j.posting_kind = 'original' ORDER BY l.line_no`).raw().all(kept.json().id);
    expect(journal).toEqual([['2201', customer, null, 70_000, 0], ['7103', null, null, 0, 70_000]]);
    expect((await owner.get('/api/col/unapplied-deposits')).json().rows).toEqual([expect.objectContaining({ heldCents: 50_000, maturedCents: 0 })]);

    // Production may not forfeit; cancelling gives the customer their credit back.
    expect((await forfeit(await env.as('production'), 100)).statusCode).toBe(403);
    expect((await owner.post(`/api/docs/col.forfeit/${kept.json().id}/cancel`, { reason: 'Customer came back to order' }, idem())).statusCode).toBe(200);
    expect((await owner.get('/api/col/unapplied-deposits')).json().rows).toEqual([expect.objectContaining({ heldCents: 120_000, maturedCents: 70_000 })]);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('still needs a job order or a customer, not both', async () => {
    env = await createTestEnv();
    const owner = await env.as('owner');
    const customer = seedCustomers(env.db, owner.userId).school;
    const both = await owner.post('/api/docs/col.forfeit/preview', { input: { customerId: customer, jobOrderId: customer, amountCents: 100, reason: 'Testing both at once here' } });
    expect(both.statusCode).toBe(400);
    const neither = await owner.post('/api/docs/col.forfeit/preview', { input: { amountCents: 100, reason: 'Testing with neither one' } });
    expect(neither.statusCode).toBe(400);
  });
});
