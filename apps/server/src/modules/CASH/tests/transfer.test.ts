/**
 * Fund Transfer: golden G-17, cancel/reissue, API rules (N-02, N-03, N-04, N-09) and property tests.
 * This is the reference test file for every document type.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { postDocument, cancelDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { transferDoc } from '../doctypes/transfer.ts';

let env: TestEnv;
let encoder: Client;
let BDO: number, CBC: number, CASH: number, GCASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  BDO = cashPlaceId(env.db, '1111');
  CBC = cashPlaceId(env.db, '1112');
  CASH = cashPlaceId(env.db, '1101');
  GCASH = cashPlaceId(env.db, '1121');
});

const post = (c: Client, input: object, expectedTotalCents: number, headers = idem()) =>
  c.post('/api/docs/cash.transfer/post', { input, expectedTotalCents }, headers);

const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);

describe('Fund Transfer golden (PLAN I2 G-17)', () => {
  it('BDO -> China Bank, sent 10,000.00, received 9,975.00', async () => {
    const input = { fromCashPlaceId: BDO, toCashPlaceId: CBC, amountSentCents: 1_000_000, amountReceivedCents: 997_500 };
    const pre = await encoder.post('/api/docs/cash.transfer/preview', { input });
    expect(pre.statusCode).toBe(200);
    expect(pre.json().summary).toBe('This will move ₱10,000.00 from Cash in bank – BDO to Cash in bank – China Bank (₱9,975.00 arrived, fee ₱25.00).');
    expect(pre.json().journal).toBeUndefined(); // encoders never see debits and credits

    const res = await post(encoder, input, 1_000_000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'TRF-000001', businessDate: '2026-09-28', totalCents: 1_000_000, journalNumber: 'JE-2026-000001' });
    expect(balances(env.db)).toEqual({ '1112': 997_500, '6230': 2_500, '1111': -1_000_000 });
    noBrokenInvariants();
  });

  it('with no fee posts two lines only', async () => {
    await post(encoder, { fromCashPlaceId: CASH, toCashPlaceId: BDO, amountSentCents: 500_000, amountReceivedCents: 500_000 }, 500_000);
    const lines = env.db.prepare('SELECT COUNT(*) AS n FROM journal_lines').get() as { n: number };
    expect(lines.n).toBe(2);
    expect(balances(env.db)).toEqual({ '1111': 500_000, '1101': -500_000 });
  });
});

describe('cancel and edit (NR-4, PLAN G-12 pattern)', () => {
  it('cancel posts a mirror dated today and nets to zero', async () => {
    const { id } = (await post(encoder, { fromCashPlaceId: BDO, toCashPlaceId: CBC, amountSentCents: 1_000_000, amountReceivedCents: 997_500 }, 1_000_000)).json();
    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder'); // yesterday's session has timed out
    expect((await encoder.post(`/api/docs/cash.transfer/${id}/cancel`, { reason: 'short' }, idem())).statusCode).toBe(400);
    const c = await encoder.post(`/api/docs/cash.transfer/${id}/cancel`, { reason: 'Wrong bank was picked' }, idem());
    expect(c.statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    const rev = env.db.prepare(`SELECT business_date FROM journals WHERE posting_kind = 'reversal'`).get() as { business_date: string };
    expect(rev.business_date).toBe('2026-09-29');
    expect((await encoder.post(`/api/docs/cash.transfer/${id}/cancel`, { reason: 'Wrong bank was picked' }, idem())).statusCode).toBe(409);
    noBrokenInvariants();
  });

  it('edit = cancel + new number, linked, with the reason', async () => {
    const first = (await post(encoder, { fromCashPlaceId: CASH, toCashPlaceId: GCASH, amountSentCents: 1_000_000, amountReceivedCents: 1_000_000 }, 1_000_000)).json();
    const r = await encoder.post(
      `/api/docs/cash.transfer/${first.id}/reissue`,
      { input: { fromCashPlaceId: CASH, toCashPlaceId: BDO, amountSentCents: 1_000_000, amountReceivedCents: 1_000_000 }, expectedTotalCents: 1_000_000, reason: 'Money went to BDO, not GCash' },
      idem(),
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().number).toBe('TRF-000002');
    expect(balances(env.db)).toEqual({ '1111': 1_000_000, '1101': -1_000_000 });
    const old = (await encoder.get(`/api/docs/cash.transfer/${first.id}`)).json().header;
    expect(old).toMatchObject({ status: 'cancelled', replacedById: r.json().id, cancelReason: 'Money went to BDO, not GCash' });
    noBrokenInvariants();
  });

  it('an invalid replacement changes nothing', async () => {
    const first = (await post(encoder, { fromCashPlaceId: CASH, toCashPlaceId: GCASH, amountSentCents: 1_000, amountReceivedCents: 1_000 }, 1_000)).json();
    const r = await encoder.post(
      `/api/docs/cash.transfer/${first.id}/reissue`,
      { input: { fromCashPlaceId: CASH, toCashPlaceId: CASH, amountSentCents: 1_000, amountReceivedCents: 1_000 }, expectedTotalCents: 1_000, reason: 'Trying a bad edit here' },
      idem(),
    );
    expect(r.statusCode).toBe(422);
    const doc = (await encoder.get(`/api/docs/cash.transfer/${first.id}`)).json();
    expect(doc.header.status).toBe('posted');
    expect(balances(env.db)).toEqual({ '1121': 1_000, '1101': -1_000 });
    noBrokenInvariants();
  });
});

describe('API rules', () => {
  const good = () => ({ fromCashPlaceId: BDO, toCashPlaceId: CBC, amountSentCents: 1_000, amountReceivedCents: 1_000 });

  it('same Idempotency-Key records once (N-02)', async () => {
    const h = idem();
    const a = await post(encoder, good(), 1_000, h);
    const b = await post(encoder, good(), 1_000, h);
    expect(b.json()).toEqual(a.json());
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n).toBe(1);
    expect((await post(encoder, { ...good(), amountSentCents: 2_000, amountReceivedCents: 2_000 }, 2_000, h)).statusCode).toBe(409);
    expect((await encoder.post('/api/docs/cash.transfer/post', { input: good(), expectedTotalCents: 1_000 })).statusCode).toBe(400);
  });

  it('rejects client-sent dates, numbers, totals and statuses (N-03)', async () => {
    for (const extra of [{ date: '2026-01-01' }, { number: 'TRF-9' }, { totalCents: 5 }, { status: 'posted' }, { feeCents: 0 }, { vatCents: 0 }]) {
      const r = await post(encoder, { ...good(), ...extra }, 1_000);
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await encoder.post('/api/docs/cash.transfer/post', { input: good(), expectedTotalCents: 1_000, businessDate: '2026-09-01' }, idem())).statusCode).toBe(400);
    expect((await encoder.post('/api/docs/cash.transfer/post', { input: good(), expectedTotalCents: 1_000, createdBy: 'x' }, idem())).statusCode).toBe(400);
  });

  it('refuses when the totals changed since the confirm dialog', async () => {
    const r = await post(encoder, good(), 999);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('TOTALS_CHANGED');
  });

  it('checks business rules', async () => {
    expect((await post(encoder, { ...good(), toCashPlaceId: BDO }, 1_000)).statusCode).toBe(422);
    expect((await post(encoder, { ...good(), amountReceivedCents: 1_001 }, 1_000)).statusCode).toBe(422);
    const header = (env.db.prepare(`SELECT id FROM accounts WHERE code = '1201'`).get() as { id: number }).id;
    expect((await post(encoder, { ...good(), toCashPlaceId: header }, 1_000)).statusCode).toBe(422);
  });

  it('needs the right permission (N-04)', async () => {
    const tv = await env.as('tv');
    expect((await post(tv, good(), 1_000)).statusCode).toBe(403);
    expect((await tv.get('/api/docs/cash.transfer')).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'GET', url: '/api/docs/cash.transfer' })).statusCode).toBe(401);
  });

  it('blocks posting when the server clock goes backwards (N-09)', async () => {
    await post(encoder, good(), 1_000);
    env.clock.advance(-24 * 3600_000);
    const r = await post(encoder, good(), 1_000);
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('CLOCK_BEHIND');
  });

  it('lists cash places with balances hidden per role (OWN-27)', async () => {
    await post(encoder, good(), 1_000);
    const mine = (await encoder.get('/api/cash/places')).json() as { name: string; balanceCents: number | null }[];
    expect(mine.find((c) => c.name.includes('BDO'))!.balanceCents).toBeNull();
    expect(mine.find((c) => c.name.startsWith('Cash on hand'))!.balanceCents).toBe(0);
    const owner = await env.as('owner');
    const all = (await owner.get('/api/cash/places')).json() as { name: string; balanceCents: number | null }[];
    expect(all.find((c) => c.name.includes('BDO'))!.balanceCents).toBe(-1_000);
  });

  it('owners and accountants see the journal', async () => {
    const acc = await env.as('accountant');
    const { id } = (await post(acc, good(), 1_000)).json();
    const v = (await acc.get(`/api/docs/cash.transfer/${id}`)).json();
    expect(v.journals[0].lines).toHaveLength(2);
    expect((await encoder.get(`/api/docs/cash.transfer/${id}`)).json().journals).toBeUndefined();
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random transfers post balanced, cancel to zero, and keep numbers gapless', () => {
    const actor = { userId: encoder.userId, permissions: new Set(['cash.trf.create', 'cash.trf.post', 'cash.trf.cancel']) };
    const e = { db: env.db, clock: env.clock };
    fc.assert(
      fc.property(fc.array(fc.tuple(transferDoc.arbitrary(env.db), fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 8 }), (ops) => {
        for (const [input, cancel, reissue] of ops) {
          const total = input.amountSentCents;
          const p = postDocument(e, transferDoc, actor, { input, expectedTotalCents: total });
          if (reissue) {
            reissueDocument(e, transferDoc, actor, p.id, { input: { ...input, fromCashPlaceId: input.toCashPlaceId, toCashPlaceId: input.fromCashPlaceId }, expectedTotalCents: total, reason: 'Swapped the places by mistake' });
          } else if (cancel) {
            cancelDocument(e, transferDoc, actor, p.id, 'Recorded twice by mistake');
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 40 },
    );
    const tb = env.db.prepare('SELECT SUM(debit_cents) AS d, SUM(credit_cents) AS c FROM journal_lines').get() as { d: number; c: number };
    expect(tb.d).toBe(tb.c);
  });
});
