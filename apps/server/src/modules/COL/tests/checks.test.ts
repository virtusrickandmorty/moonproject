/**
 * Customer checks: check details on tenders into Checks on hand (1103) only, post-dated checks refused on a collection and
 * kept on the memo list until their date (ACC-23), a due memo recorded as a collection, deposits from the checks-on-hand
 * list (TRF 1103 -> bank), 1103 on the ledger equal to the list, and a check the bank returned (TRF bank -> 1103, bank
 * adjustment for the charge, the collection cancelled): receivable, 1103 and the bank right to the centavo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balances, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { joMoney } from '../../JO/public.ts';
import { checksOnHand } from '../checks.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let c: ReturnType<typeof seedCustomers>;
let CASH: number, CHECKS: number, BDO: number, CHINA: number, GCASH: number;
let cr = 900;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 in Manila
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  c = seedCustomers(env.db, encoder.userId);
  [CASH, CHECKS, BDO, CHINA, GCASH] = ['1101', '1103', '1111', '1112', '1121'].map((code) => cashPlaceId(env.db, code)) as [number, number, number, number, number];
});

const COL = '/api/docs/col.collection';
const check = (number: string, amountCents: number, date = '2026-09-25', bank = 'Sample Savings Bank') => ({ cashPlaceId: CHECKS, amountCents, check: { number, bank, date } });
const collect = (input: object, total: number, who = encoder) => who.post(`${COL}/post`, { input: { crNumber: String(++cr), ...input }, expectedTotalCents: total }, idem());
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const codes = (r: { json(): { details?: { code: string; level: string }[] } }) => (r.json().details ?? []).filter((i) => i.level === 'error').map((i) => i.code);
const onHand = async (who = accountant) => (await who.get('/api/col/checks')).json() as { checks: { collectionId: string; lineNo: number; checkNumber: string; amountCents: number; days: number; returned: unknown }[]; totalCents: number; ledgerCents: number | null };
const ledger1103 = () => balances(env.db)['1103'] ?? 0;
const deposit = async (checks: { collectionId: string; lineNo: number }[], toCashPlaceId = BDO, who = encoder) => {
  const pre = await who.post('/api/col/checks/deposit/preview', { checks, toCashPlaceId });
  expect(pre.statusCode, pre.body).toBe(200);
  return who.post('/api/col/checks/deposit', { checks, toCashPlaceId, expectedTotalCents: pre.json().totalCents }, idem());
};

async function jobOrder(totalCents: number, customerId = c.school): Promise<string> {
  const lines = [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: totalCents, discountCents: 0, roster: [] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: totalCents }, idem());
  expect(r.statusCode).toBe(200);
  return r.json().id;
}

describe('check details on a collection', () => {
  it('are required on a tender into Checks on hand, refused anywhere else, and kept with the collection', async () => {
    const bare = await collect({ customerId: c.school, applications: [], tenders: [{ cashPlaceId: CHECKS, amountCents: 500_000, reference: 'Check 123' }] }, 500_000);
    expect(bare.statusCode).toBe(422);
    expect(codes(bare)).toEqual(['CHECK_DETAILS']);
    expect(bare.json().message).toMatch(/^Payment 1 goes to Checks on hand.*: type the check number, the bank and the date on the check\.$/);

    const gcash = await collect({ customerId: c.school, applications: [], tenders: [{ cashPlaceId: GCASH, amountCents: 500_000, check: { number: '123', bank: 'Sample Bank', date: '2026-09-28' } }] }, 500_000);
    expect(codes(gcash)).toEqual(['NOT_A_CHECK_PLACE']);

    // Cash and GCash are unchanged: no check details asked.
    expect((await collect({ customerId: c.school, applications: [], tenders: [{ cashPlaceId: CASH, amountCents: 100_000 }, { cashPlaceId: GCASH, amountCents: 50_000, reference: 'GC-1' }] }, 150_000)).statusCode).toBe(200);

    const input = { customerId: c.school, applications: [], tenders: [check('000123', 500_000), { cashPlaceId: CASH, amountCents: 20_000 }] };
    const ok = await collect(input, 520_000);
    expect(ok.statusCode, ok.body).toBe(200);
    const view = (await encoder.get(`${COL}/${ok.json().id}`)).json();
    expect(view.input.tenders).toEqual(input.tenders);
    expect(view.doc.tenders[0]).toMatchObject({ cashPlaceName: expect.stringMatching(/^Checks on hand/), check: { number: '000123', bank: 'Sample Savings Bank', date: '2026-09-25' } });

    // The same check again is only a warning; a stale check (over six months old) too.
    const again = await encoder.post(`${COL}/preview`, { input: { crNumber: '999', ...input, tenders: [check('000123', 500_000)] } });
    expect(again.json().issues.map((i: { code: string }) => i.code)).toContain('CHECK_TWICE');
    const stale = await encoder.post(`${COL}/preview`, { input: { crNumber: '999', ...input, tenders: [check('777', 500_000, '2026-03-01')] } });
    expect(stale.json().issues.map((i: { code: string; level: string }) => `${i.level}:${i.code}`)).toContain('warning:STALE_CHECK');
    noBrokenInvariants();
  });

  it('refuses a post-dated check, pointing to the post-dated checks list (ACC-23)', async () => {
    const r = await collect({ customerId: c.school, applications: [], tenders: [check('555', 800_000, '2026-10-15')] }, 800_000);
    expect(r.statusCode).toBe(422);
    expect(codes(r)).toEqual(['POST_DATED']);
    expect(r.json().message).toMatch(/dated 2026-10-15, after today.*post-dated checks list/);
    expect(balances(env.db)['1103']).toBeUndefined();
  });

  it('a refund is not paid out of Checks on hand', async () => {
    await collect({ customerId: c.school, applications: [], tenders: [check('42', 300_000)] }, 300_000);
    const r = await accountant.post('/api/docs/col.refund/post', { input: { customerId: c.school, tenders: [{ cashPlaceId: CHECKS, amountCents: 300_000 }], reason: 'Customer asked for the money back' }, expectedTotalCents: 300_000 }, idem());
    expect(codes(r)).toEqual(['CHECKS_PLACE']);
  });
});

describe('post-dated checks list', () => {
  it('lists a check until its date, then records it as a collection filled from it; voids with a reason; all audited', async () => {
    const jo = await jobOrder(1_500_000);
    const memo = { customerId: c.school, bank: 'Sample Savings Bank', checkNumber: '880001', checkDate: '2026-10-05', amountCents: 1_000_000, jobOrderIds: [jo], note: 'Second tranche' };
    expect((await encoder.post('/api/col/pdcs', { ...memo, checkDate: '2026-09-28' })).json().code).toBe('NOT_POST_DATED');
    const added = await encoder.post('/api/col/pdcs', memo);
    expect(added.statusCode, added.body).toBe(200);
    const pdc = added.json();
    expect(pdc).toMatchObject({ status: 'waiting', customerName: 'Moonlight Test School', jobOrders: [{ id: jo, number: 'JO-000001' }], usedBy: null });
    expect((await encoder.post('/api/col/pdcs', memo)).json().code).toBe('PDC_LISTED');
    expect(balances(env.db)).toEqual({}); // a memo posts nothing

    // Before its date the collection is refused.
    const input = { customerId: c.school, applications: [{ jobOrderId: jo, amountCents: 1_000_000 }], tenders: [check('880001', 1_000_000, '2026-10-05')], postDatedCheckId: pdc.id };
    expect(codes(await collect(input, 1_000_000))).toEqual(['POST_DATED', 'PDC_NOT_DUE']);

    env.clock.set('2026-10-05T01:00:00Z');
    encoder = await env.as('encoder'); // a week later: a new sign-in
    expect((await encoder.get(`/api/col/pdcs/${pdc.id}`)).json().status).toBe('due');
    // It must be paid in as listed.
    expect(codes(await collect({ ...input, tenders: [check('880002', 1_000_000, '2026-10-05')] }, 1_000_000))).toEqual(['PDC_TENDER']);
    expect(codes(await collect({ ...input, customerId: c.other, applications: [] }, 1_000_000))).toEqual(['PDC_CUSTOMER']);
    const col = await collect(input, 1_000_000);
    expect(col.statusCode, col.body).toBe(200);
    expect((await encoder.get(`/api/col/pdcs/${pdc.id}`)).json()).toMatchObject({ status: 'used', usedBy: { id: col.json().id, number: col.json().number } });
    expect((await encoder.get(`${COL}/${col.json().id}`)).json().input.postDatedCheckId).toBe(pdc.id);
    expect(codes(await collect(input, 1_000_000))).toContain('PDC_USED');
    expect((await encoder.post(`/api/col/pdcs/${pdc.id}/void`, { reason: 'Customer replaced the check' })).json().code).toBe('PDC_USED');
    expect(joMoney(env.db, jo).balanceDueCents).toBe(500_000);
    expect(ledger1103()).toBe(1_000_000);

    // Cancelled, the collection frees the memo; voided, it is off the list for good.
    expect((await encoder.post(`${COL}/${col.json().id}/cancel`, { reason: 'Recorded on the wrong CR' }, idem())).statusCode).toBe(200);
    expect((await encoder.get(`/api/col/pdcs/${pdc.id}`)).json().status).toBe('due');
    expect((await encoder.post(`/api/col/pdcs/${pdc.id}/void`, { reason: 'short' })).statusCode).toBe(400);
    const voided = await encoder.post(`/api/col/pdcs/${pdc.id}/void`, { reason: 'Customer replaced the check with cash' });
    expect(voided.json()).toMatchObject({ status: 'voided', voided: { reason: 'Customer replaced the check with cash' } });
    expect(codes(await collect(input, 1_000_000))).toContain('PDC_VOIDED');
    const audit = env.db.prepare(`SELECT action FROM audit_log WHERE entity_type = 'col.pdc' ORDER BY seq`).pluck().all();
    expect(audit).toEqual(['col.pdc.add', 'col.pdc.void']);
    expect((await (await env.as('production')).get('/api/col/pdcs')).statusCode).toBe(403);
    noBrokenInvariants();
  });
});

describe('checks on hand and deposits', () => {
  it('lists every check not yet deposited with its days; a deposit is one transfer 1103 -> bank; 1103 equals the list', async () => {
    const a = (await collect({ customerId: c.school, applications: [], tenders: [check('1001', 250_000, '2026-09-20')] }, 250_000)).json().id;
    env.clock.set('2026-10-01T01:00:00Z');
    [encoder, accountant] = [await env.as('encoder'), await env.as('accountant')];
    const b = (await collect({ customerId: c.other, applications: [], tenders: [check('2002', 400_050, '2026-09-30', 'Other Bank'), { cashPlaceId: CASH, amountCents: 1_000 }] }, 401_050)).json().id;
    let list = await onHand();
    expect(list.checks.map((r) => [r.checkNumber, r.amountCents, r.days])).toEqual([['1001', 250_000, 3], ['2002', 400_050, 0]]);
    expect(list.totalCents).toBe(650_050);
    expect(list.ledgerCents).toBe(650_050);
    expect(ledger1103()).toBe(650_050);
    // An encoder does not see the 1103 balance by default (OWN-27), only the list.
    expect((await onHand(encoder)).ledgerCents).toBeNull();

    // Only a bank; the transfer's total and note come from the checks.
    expect((await encoder.post('/api/col/checks/deposit/preview', { checks: [{ collectionId: a, lineNo: 1 }], toCashPlaceId: GCASH })).json().code).toBe('NOT_A_BANK');
    const pre = await encoder.post('/api/col/checks/deposit/preview', { checks: [{ collectionId: a, lineNo: 1 }, { collectionId: b, lineNo: 1 }], toCashPlaceId: BDO });
    expect(pre.json()).toMatchObject({ totalCents: 650_050, summary: expect.stringMatching(/^This will move ₱6,500\.50 from Checks on hand.* to Cash in bank – BDO\.$/) });
    const dep = await deposit([{ collectionId: a, lineNo: 1 }, { collectionId: b, lineNo: 1 }]);
    expect(dep.statusCode, dep.body).toBe(200);
    const trf = (await encoder.get(`/api/docs/cash.transfer/${dep.json().transfer.id}`)).json();
    expect(trf.input).toEqual({ fromCashPlaceId: CHECKS, toCashPlaceId: BDO, amountSentCents: 650_050, amountReceivedCents: 650_050, note: 'Checks deposited: 1001 Sample Savings Bank, 2002 Other Bank' });
    list = await onHand();
    expect(list.checks).toEqual([]);
    expect([list.totalCents, list.ledgerCents, ledger1103()]).toEqual([0, 0, 0]);
    expect(balances(env.db)['1111']).toBe(650_050);

    // Deposited once only; the collection waits for its check to come back before it is cancelled.
    expect((await encoder.post('/api/col/checks/deposit/preview', { checks: [{ collectionId: a, lineNo: 1 }], toCashPlaceId: BDO })).statusCode).toBe(409);
    expect((await encoder.post('/api/col/checks/deposit', { checks: [{ collectionId: a, lineNo: 1 }], toCashPlaceId: BDO, expectedTotalCents: 250_000 }, idem())).json().code).toBe('CHECK_NOT_ON_HAND');
    const cancel = await encoder.post(`${COL}/${a}/cancel`, { reason: 'Recorded by mistake' }, idem());
    expect(cancel.json()).toMatchObject({ code: 'CHECK_DEPOSITED' });

    // Cancelling the deposit's transfer puts its checks back on hand.
    expect((await encoder.post(`/api/docs/cash.transfer/${dep.json().transfer.id}/cancel`, { reason: 'Deposit slip was not stamped' }, idem())).statusCode).toBe(200);
    list = await onHand();
    expect(list.checks.map((r) => r.checkNumber)).toEqual(['1001', '2002']);
    expect([list.totalCents, list.ledgerCents]).toEqual([650_050, 650_050]);
    expect(env.db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'col.checks.%'`).pluck().all()).toEqual(['col.checks.deposit']);
    noBrokenInvariants();
  });
});

describe('a check the bank returned', () => {
  it('comes back to 1103, the bank charge goes to 6230, and cancelling the collection puts the receivable back, to the centavo', async () => {
    const jo = await jobOrder(1_234_567);
    const col = await collect({ customerId: c.school, applications: [{ jobOrderId: jo, amountCents: 1_234_567 }], tenders: [check('3003', 1_234_567)] }, 1_234_567);
    expect(col.statusCode, col.body).toBe(200);
    const id = col.json().id;
    expect(joMoney(env.db, jo).balanceDueCents).toBe(0);
    const before = balances(env.db);
    expect((await deposit([{ collectionId: id, lineNo: 1 }], CHINA)).statusCode).toBe(200);

    const body = { collectionId: id, lineNo: 1, chargeCents: 50_000, reason: 'Drawn against insufficient funds', cancelCollection: true };
    expect((await encoder.post('/api/col/checks/return', body, idem())).statusCode).toBe(403); // the accountant's
    expect((await accountant.get('/api/col/checks/at-bank')).json()).toMatchObject([{ collectionId: id, checkNumber: '3003', amountCents: 1_234_567 }]);
    const r = await accountant.post('/api/col/checks/return', body, idem());
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ cancelled: true, charge: { totalCents: 50_000 }, transfer: { totalCents: 1_234_567 } });

    // The receivable is back, 1103 holds nothing, the bank lost only its charge, which is a bank charge (6230).
    expect(joMoney(env.db, jo).balanceDueCents).toBe(1_234_567);
    const after = balances(env.db);
    expect(after['1103'] ?? 0).toBe(0);
    expect(after['1112']).toBe(-50_000);
    expect(after['6230']).toBe(50_000);
    expect((after['2201'] ?? 0) - (before['2201'] ?? 0)).toBe(1_234_567); // the deposit the check paid is gone (credit side)
    expect(Object.keys(after).sort()).toEqual(['1112', '6230']);
    expect((await onHand()).checks).toEqual([]);
    expect(env.db.prepare(`SELECT status FROM documents WHERE id = ?`).pluck().get(id)).toBe('cancelled');
    expect(env.db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'col.checks.%' ORDER BY seq`).pluck().all()).toEqual(['col.checks.deposit', 'col.checks.return']);
    noBrokenInvariants();
  });

  it('with other money on the collection it only comes back on hand; the collection is then edited without it', async () => {
    const jo = await jobOrder(1_000_000);
    const input = { customerId: c.school, applications: [{ jobOrderId: jo, amountCents: 1_000_000 }], tenders: [check('4004', 700_000), { cashPlaceId: CASH, amountCents: 300_000 }] };
    const id = (await collect(input, 1_000_000)).json().id;
    await deposit([{ collectionId: id, lineNo: 1 }]);
    const body = { collectionId: id, lineNo: 1, reason: 'Account closed per the bank', cancelCollection: true };
    expect((await accountant.post('/api/col/checks/return', body, idem())).json().code).toBe('OTHER_MONEY');
    expect((await accountant.post('/api/col/checks/return', { ...body, cancelCollection: false }, idem())).statusCode).toBe(200);
    let list = await onHand();
    expect(list.checks).toMatchObject([{ checkNumber: '4004', returned: { number: 'TRF-000002' } }]);
    expect([list.totalCents, list.ledgerCents]).toEqual([700_000, 700_000]);
    // Edit: cancel and reissue with the cash only. The check leaves the list and 1103.
    const edit = await encoder.post(`${COL}/${id}/reissue`, { input: { ...input, crNumber: '7001', applications: [{ jobOrderId: jo, amountCents: 300_000 }], tenders: [input.tenders[1]] }, expectedTotalCents: 300_000, reason: 'Check returned by the bank' }, idem());
    expect(edit.statusCode, edit.body).toBe(200);
    list = await onHand();
    expect([list.checks.length, list.totalCents, list.ledgerCents]).toEqual([0, 0, 0]);
    expect(joMoney(env.db, jo).balanceDueCents).toBe(700_000);
    expect(balances(env.db)['1111'] ?? 0).toBe(0);
    noBrokenInvariants();
  });

  it('property: whatever is collected, deposited, returned and cancelled, 1103 on the ledger equals the checks-on-hand list', async () => {
    const jos = [await jobOrder(50_000_000), await jobOrder(50_000_000, c.other)];
    const owner = await env.as('owner');
    let n = 0;
    const op = fc.oneof(
      fc.record({ kind: fc.constant('collect' as const), amount: fc.integer({ min: 1, max: 900_000 }), cash: fc.integer({ min: 0, max: 50_000 }), who: fc.integer({ min: 0, max: 1 }) }),
      fc.record({ kind: fc.constant('deposit' as const), pick: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }), bank: fc.constantFrom('BDO', 'CHINA') }),
      fc.record({ kind: fc.constant('return' as const), pick: fc.nat(), charge: fc.integer({ min: 0, max: 30_000 }), cancel: fc.boolean() }),
      fc.record({ kind: fc.constant('cancel' as const), pick: fc.nat() }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 8 }), async (ops) => {
        for (const o of ops) {
          if (o.kind === 'collect') {
            const tenders = [check(`P${++n}`, o.amount), ...(o.cash ? [{ cashPlaceId: CASH, amountCents: o.cash }] : [])];
            const r = await collect({ customerId: o.who ? c.other : c.school, applications: [], tenders }, o.amount + o.cash);
            expect(r.statusCode, r.body).toBe(200);
          } else if (o.kind === 'deposit') {
            const list = (await onHand()).checks;
            if (list.length === 0) continue;
            const picked = [...new Set(o.pick.map((i) => i % list.length))].map((i) => ({ collectionId: list[i]!.collectionId, lineNo: list[i]!.lineNo }));
            expect((await deposit(picked, o.bank === 'BDO' ? BDO : CHINA)).statusCode).toBe(200);
          } else if (o.kind === 'return') {
            const banked = (await owner.get('/api/col/checks/at-bank')).json() as { collectionId: string; lineNo: number }[];
            if (banked.length === 0) continue;
            const { collectionId, lineNo } = banked[o.pick % banked.length]!;
            const k = { collectionId, lineNo };
            const tenders = env.db.prepare('SELECT COUNT(*) FROM col_tenders WHERE document_id = ?').pluck().get(k.collectionId) as number;
            const r = await owner.post('/api/col/checks/return', { ...k, ...(o.charge ? { chargeCents: o.charge } : {}), reason: 'Drawn against insufficient funds', cancelCollection: o.cancel && tenders === 1 }, idem());
            expect(r.statusCode, r.body).toBe(200);
          } else {
            const list = (await onHand()).checks;
            if (list.length === 0) continue;
            const r = await owner.post(`${COL}/${list[o.pick % list.length]!.collectionId}/cancel`, { reason: 'Recorded by mistake' }, idem());
            expect(r.statusCode, r.body).toBe(200);
          }
          const list = await onHand();
          expect(list.ledgerCents).toBe(list.totalCents);
          expect(ledger1103()).toBe(checksOnHand(env.db).reduce((s, r) => s + r.amountCents, 0));
        }
        noBrokenInvariants();
      }),
      { numRuns: 15 },
    );
  });
});
