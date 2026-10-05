/**
 * Cash places, cash count (golden G-18), other receipt, and the cash book (PLAN E10, D5 CASH-COUNT and OTH-RCV).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import { cancelDocument, postDocument, reissueDocument } from '../../../engine/documents/lifecycle.ts';
import { countDoc } from '../doctypes/count.ts';
import { otherReceiptDoc } from '../doctypes/other-receipt.ts';

let env: TestEnv;
let encoder: Client, accountant: Client;
let CASH: number, PETTY: number, BDO: number, GCASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  CASH = cashPlaceId(env.db, '1101');
  PETTY = cashPlaceId(env.db, '1102');
  BDO = cashPlaceId(env.db, '1111');
  GCASH = cashPlaceId(env.db, '1121');
});

const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const receive = (c: Client, input: object, cents: number) => c.post('/api/docs/cash.other_receipt/post', { input, expectedTotalCents: cents }, idem());
const account = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const count = (c: Client, input: object, cents: number) => c.post('/api/docs/cash.count/post', { input, expectedTotalCents: cents }, idem());
const oneReceipt = (cashPlaceId: number, amountCents: number) => ({ cashPlaceId, category: 'other_income', receivedFrom: 'Made-up Scrap Buyer', description: 'Scrap cloth', amountCents });
/** ₱12,450.00 = 12 × ₱1,000 + 4 × ₱100 + 1 × ₱50. */
const lines12450 = [{ denominationCents: 100_000, qty: 12 }, { denominationCents: 10_000, qty: 4 }, { denominationCents: 5_000, qty: 1 }];

describe('Other receipt (D5 OTH-RCV)', () => {
  it('posts cash against the category account, and cancels to zero', async () => {
    const r = await receive(encoder, { cashPlaceId: GCASH, category: 'interest', receivedFrom: 'Made-up Borrower', description: 'Interest on a staff loan', amountCents: 150_000, reference: 'GC 7788' }, 150_000);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ number: 'ORC-000001', summary: 'This will record ₱1,500.00 received from Made-up Borrower into E-wallet – GCash as interest received: Interest on a staff loan.' });
    expect(balances(env.db)).toEqual({ '1121': 150_000, '7101': -150_000 });
    const back = await receive(encoder, { ...oneReceipt(CASH, 20_000), category: 'other_receivable' }, 20_000);
    expect(balances(env.db)).toMatchObject({ '1101': 20_000, '1290': -20_000 });
    expect((await encoder.post(`/api/docs/cash.other_receipt/${back.json().id}/cancel`, { reason: 'Recorded in the wrong box' }, idem())).statusCode).toBe(403);
    expect((await accountant.post(`/api/docs/cash.other_receipt/${back.json().id}/cancel`, { reason: 'Recorded in the wrong box' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({ '1121': 150_000, '7101': -150_000 });
    noBrokenInvariants();
  });

  it('refuses an unknown category, a header account and client totals', async () => {
    expect((await receive(encoder, { ...oneReceipt(CASH, 100), category: 'sales' }, 100)).statusCode).toBe(400);
    expect((await receive(encoder, { ...oneReceipt(CASH, 100), totalCents: 100 }, 100)).statusCode).toBe(400);
    const header = env.db.prepare(`SELECT id FROM accounts WHERE code = '1100'`).pluck().get() as number; // the heading
    expect((await receive(encoder, oneReceipt(header, 100), 100)).statusCode).toBe(422);
  });
});

describe('Cash count against a ledger that moved (A1-003)', () => {
  it('refuses the count when money moved in or out of the box since its preview, without telling anyone the balance', async () => {
    const lines = [{ denominationCents: 100_000, qty: 12 }];
    const pre = (await accountant.post('/api/docs/cash.count/preview', { input: { cashPlaceId: CASH, lines } })).json();
    const ledgerVersion = pre.doc.ledgerVersionNow as string;
    expect(ledgerVersion).toMatch(/^[0-9a-f]{16}$/);
    // The same count, nothing moved: it checks out.
    expect((await accountant.post('/api/docs/cash.count/preview', { input: { cashPlaceId: CASH, lines, ledgerVersion } })).json().issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);
    // Money comes into the box after the preview.
    expect((await accountant.post('/api/docs/acc.jv/post', {
      input: { memo: 'Cash from the owner', lines: [{ accountId: CASH, debitCents: 50_000 }, { accountId: account('3900'), creditCents: 50_000 }] }, expectedTotalCents: 50_000,
    }, idem())).statusCode).toBe(200);
    const r = await count(accountant, { cashPlaceId: CASH, lines, ledgerVersion }, 1_200_000);
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toBe('Money moved since you started the count. Check and save again.');
    expect(r.json().details.map((i: { code: string }) => i.code)).toEqual(['LEDGER_MOVED']);
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type = 'cash.count'`).pluck().get()).toBe(0);
    // Checked again: the new version records.
    const again = (await accountant.post('/api/docs/cash.count/preview', { input: { cashPlaceId: CASH, lines } })).json().doc.ledgerVersionNow as string;
    expect(again).not.toBe(ledgerVersion);
    expect((await count(accountant, { cashPlaceId: CASH, lines, ledgerVersion: again }, 1_200_000)).statusCode).toBe(200);
  });
});

describe('Cash count golden (PLAN I2 G-18)', () => {
  it('ledger ₱12,500.00, counted ₱12,450.00: Dr 6280 50.00 / Cr 1101 50.00', async () => {
    await receive(encoder, oneReceipt(CASH, 1_250_000), 1_250_000);
    const pre = await encoder.post('/api/docs/cash.count/preview', { input: { cashPlaceId: CASH, lines: lines12450 } });
    expect(pre.json().summary).toBe('This will record a count of ₱12,450.00 in Cash on hand (main cash box) against ₱12,500.00 in the ledger: ₱50.00 short, posted to cash short and over.');
    const r = await count(encoder, { cashPlaceId: CASH, lines: lines12450 }, 1_245_000);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().number).toBe('CNT-000001');
    expect(balances(env.db)).toEqual({ '1101': 1_245_000, '6280': 5_000, '7103': -1_250_000 });
    const lines = env.db.prepare(`SELECT a.code, l.debit_cents AS d, l.credit_cents AS c FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE j.source_id = ? ORDER BY l.line_no`).all(r.json().id);
    expect(lines).toEqual([{ code: '6280', d: 5_000, c: 0 }, { code: '1101', d: 0, c: 5_000 }]);

    // Cancelling it (the accountant only) puts the ₱50.00 back.
    expect((await encoder.post(`/api/docs/cash.count/${r.json().id}/cancel`, { reason: 'Counted the wrong box' }, idem())).statusCode).toBe(403);
    expect((await accountant.post(`/api/docs/cash.count/${r.json().id}/cancel`, { reason: 'Counted the wrong box' }, idem())).statusCode).toBe(200);
    expect(balances(env.db)).toEqual({ '1101': 1_250_000, '7103': -1_250_000 });
    noBrokenInvariants();
  });

  it('an over count credits 6280; a matching count posts nothing', async () => {
    await receive(encoder, oneReceipt(PETTY, 1_000_000), 1_000_000);
    const over = await count(encoder, { cashPlaceId: PETTY, lines: [{ denominationCents: 100_000, qty: 10 }, { denominationCents: 25, qty: 4 }] }, 1_000_100);
    expect(over.json().journalNumber).not.toBeNull();
    expect(balances(env.db)).toMatchObject({ '1102': 1_000_100, '6280': -100 });
    const same = await count(encoder, { cashPlaceId: PETTY, lines: [{ denominationCents: 100_000, qty: 10 }, { denominationCents: 100, qty: 1 }] }, 1_000_100);
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json()).toMatchObject({ journalNumber: null, summary: 'This will record a count of ₱10,001.00 in Petty cash fund. It matches the ledger.' });
    noBrokenInvariants();
  });

  it('warns on a big difference and checks the place and the lines', async () => {
    await receive(encoder, oneReceipt(CASH, 500_000), 500_000);
    const big = await count(encoder, { cashPlaceId: CASH, lines: [{ denominationCents: 100_000, qty: 3 }] }, 300_000);
    expect(big.json().warnings).toEqual([expect.objectContaining({ code: 'BIG_DIFFERENCE', message: 'The count is ₱2,000.00 short. Please count again before recording.' })]);
    expect((await count(encoder, { cashPlaceId: BDO, lines: [] }, 0)).json().code).toBe('VALIDATION'); // a bank is reconciled, not counted
    expect((await count(encoder, { cashPlaceId: CASH, lines: [{ denominationCents: 100_000, qty: 1 }, { denominationCents: 100_000, qty: 2 }] }, 300_000)).statusCode).toBe(422);
    expect((await count(encoder, { cashPlaceId: CASH, lines: [{ denominationCents: 30_000, qty: 1 }] }, 30_000)).statusCode).toBe(400); // no ₱300 bill
  });

  it('only people who see a box balance may count it (OWN-27)', async () => {
    const safe = (await accountant.post('/api/cash/places', { name: 'Office safe', kind: 'cash', encoderSeesBalance: false })).json();
    await accountant.post('/api/docs/cash.other_receipt/post', { input: oneReceipt(safe.id, 50_000), expectedTotalCents: 50_000 }, idem());
    const peek = await encoder.post('/api/docs/cash.count/preview', { input: { cashPlaceId: safe.id, lines: [] } });
    expect(peek.json().doc.ledgerCents).toBe(0); // the ₱500.00 in the safe stays hidden
    const r = await count(encoder, { cashPlaceId: safe.id, lines: [{ denominationCents: 100_000, qty: 1 }] }, 100_000);
    expect(r.statusCode).toBe(422);
    expect(r.json().details[0].code).toBe('NOT_ALLOWED');
    const ok = await count(accountant, { cashPlaceId: safe.id, lines: [{ denominationCents: 100_000, qty: 1 }] }, 100_000);
    expect(ok.json().summary).toBe('This will record a count of ₱1,000.00 in Office safe. Any difference from the ledger posts to cash short and over.');
    expect(balances(env.db)).toMatchObject({ '1104': 100_000, '6280': -50_000 });
  });
});

describe('Cash places (Cash Accounts screen)', () => {
  it('adds a place with the next code of its kind, a settings row and an audit entry', async () => {
    const r = await accountant.post('/api/cash/places', { name: 'Cash in bank – Metrobank', kind: 'bank', accountNo: '123-456-7890', encoderSeesBalance: false });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ code: '1113', kind: 'bank', accountNo: '123-456-7890', encoderSeesBalance: false, isActive: true, version: 1 });
    const wallet = (await accountant.post('/api/cash/places', { name: 'E-wallet – Maya', kind: 'ewallet', encoderSeesBalance: true })).json();
    expect(wallet.code).toBe('1122');
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'cash.place.create'`).pluck().get()).toBe(2);

    const mine = (await encoder.get('/api/cash/places')).json() as { name: string; accountNo: string | null; balanceCents: number | null; encoderSeesBalance?: boolean }[];
    const metro = mine.find((p) => p.name.includes('Metrobank'))!;
    expect(metro).toMatchObject({ accountNo: '••••7890', balanceCents: null });
    expect(metro.encoderSeesBalance).toBeUndefined();
    expect(mine.find((p) => p.name.includes('Maya'))!.balanceCents).toBe(0);
    expect((await accountant.get('/api/cash/places')).json().find((p: { name: string }) => p.name.includes('Metrobank')).accountNo).toBe('123-456-7890');
  });

  it('refuses duplicates, account numbers on cash boxes, encoders, and cash-place codes in the chart of accounts', async () => {
    expect((await accountant.post('/api/cash/places', { name: 'cash in bank – bdo', kind: 'bank', encoderSeesBalance: false })).statusCode).toBe(409);
    expect((await accountant.post('/api/cash/places', { name: 'Drawer 2', kind: 'cash', accountNo: '1234', encoderSeesBalance: true })).statusCode).toBe(400);
    expect((await encoder.post('/api/cash/places', { name: 'Drawer 2', kind: 'cash', encoderSeesBalance: true })).statusCode).toBe(403);
    expect((await accountant.post('/api/acc/accounts', { code: '1105', name: 'Drawer 2', type: 'asset' })).json().code).toBe('CASH_PLACE_CODE');
  });

  it('changes who sees the balance with If-Match', async () => {
    const places = (await accountant.get('/api/cash/places')).json() as { id: number; code: string; version: number }[];
    const bdo = places.find((p) => p.code === '1111')!;
    expect((await accountant.put(`/api/cash/places/${bdo.id}/settings`, { encoderSeesBalance: true })).statusCode).toBe(428);
    const ok = await accountant.put(`/api/cash/places/${bdo.id}/settings`, { encoderSeesBalance: true }, { 'if-match': String(bdo.version) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await accountant.put(`/api/cash/places/${bdo.id}/settings`, { encoderSeesBalance: false }, { 'if-match': String(bdo.version) })).statusCode).toBe(409);
    expect((await encoder.get('/api/cash/places')).json().find((p: { code: string }) => p.code === '1111').balanceCents).toBe(0);
  });
});

describe('Cash book', () => {
  it('shows the opening balance, each line with a running balance, and the closing balance', async () => {
    await receive(encoder, oneReceipt(CASH, 100_000), 100_000); // 2026-09-28
    env.clock.advance(24 * 3600_000);
    encoder = await env.as('encoder');
    await receive(encoder, oneReceipt(CASH, 50_000), 50_000); // 2026-09-29
    await encoder.post('/api/docs/cash.transfer/post', { input: { fromCashPlaceId: CASH, toCashPlaceId: BDO, amountSentCents: 30_000, amountReceivedCents: 30_000 }, expectedTotalCents: 30_000 }, idem());
    const book = await encoder.get(`/api/cash/places/${CASH}/book?from=2026-09-29&to=2026-09-30`);
    expect(book.statusCode, book.body).toBe(200);
    expect(book.json()).toMatchObject({ openingCents: 100_000, closingCents: 120_000 });
    expect(book.json().lines.map((l: { documentNumber: string; inCents: number; outCents: number; balanceCents: number }) => [l.documentNumber, l.inCents, l.outCents, l.balanceCents])).toEqual([
      ['ORC-000002', 50_000, 0, 150_000],
      ['TRF-000001', 0, 30_000, 120_000],
    ]);
    expect(book.json().closingCents).toBe(accountBalance(env.db, CASH));
  });

  it('is hidden where the balance is hidden, and checks the dates', async () => {
    expect((await encoder.get(`/api/cash/places/${BDO}/book?from=2026-09-01&to=2026-09-30`)).statusCode).toBe(403);
    expect((await accountant.get(`/api/cash/places/${BDO}/book?from=2026-09-01&to=2026-09-30`)).statusCode).toBe(200);
    expect((await encoder.get(`/api/cash/places/${CASH}/book?from=2026-09-30&to=2026-09-01`)).json().code).toBe('BAD_RANGE');
    expect((await encoder.get(`/api/cash/places/${CASH}/book?from=2025-01-01&to=2026-09-30`)).json().code).toBe('BAD_RANGE');
    expect((await encoder.get(`/api/cash/places/${CASH}/book?from=yesterday&to=2026-09-30`)).json().code).toBe('BAD_DATE');
    expect((await (await env.as('tv')).get(`/api/cash/places/${CASH}/book?from=2026-09-01&to=2026-09-30`)).statusCode).toBe(403);
  });
});

describe('property tests (PLAN I1.3)', () => {
  it('random receipts and counts post balanced, store what was computed, and cancel or reissue cleanly', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['cash.orc.create', 'cash.orc.post', 'cash.orc.cancel', 'cash.count.create', 'cash.count.post', 'cash.count.cancel', 'cash.balances.view_all']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: '2026-09-28', at: '2026-09-28T10:00:00.000+08:00', userId: actor.userId, can: (p: string) => actor.permissions.has(p) });
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), otherReceiptDoc.arbitrary(env.db), countDoc.arbitrary(env.db), fc.constantFrom('keep', 'cancel', 'reissue')), { minLength: 1, maxLength: 6 }), (ops) => {
        for (const [isCount, receipt, counted, then] of ops) {
          const def = isCount ? countDoc : otherReceiptDoc;
          const input = isCount ? counted : receipt;
          const computed = def.compute(input as never, ctx());
          const p = postDocument(e, def, actor, { input, expectedTotalCents: computed.totalCents });
          expect(def.load(env.db, p.id)).toEqual(isCount ? { ...computed, ledgerVersionNow: null } : computed); // a ledger version is not stored
          if (then === 'cancel') cancelDocument(e, def, actor, p.id, 'Recorded twice by mistake');
          if (then === 'reissue') {
            const again = def.compute(def.toInput(computed as never) as never, ctx()); // a count is checked against the ledger again
            reissueDocument(e, def, actor, p.id, { input: def.toInput(computed as never), expectedTotalCents: again.totalCents, reason: 'Corrected the details' });
          }
        }
        expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });
});
