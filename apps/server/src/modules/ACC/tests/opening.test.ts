/**
 * ACC: opening balances, part 1 (PLAN D8 "Cut-over", D5 "OB-*", D9 L3 and L8, MIG-02): the cut-over date, OB-
 * documents against 3900, the opening screen's figures and the close.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PASSWORD, balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { resolveDraft } from '../../../engine/ledger/post.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { stamp } from '../../../platform/clock.ts';
import { openingDoc } from '../doctypes/opening.ts';
import { DOCUMENT_OWNED_ROLES } from '../opening.ts';

const CUTOVER = '2026-09-27'; // the day before the test clock's 2026-09-28

let env: TestEnv;
let accountant: Client;
let owner: Client;
let encoder: Client;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  owner = await env.as('owner');
  encoder = await env.as('encoder');
});

const id = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const setCutover = async (date: string, who = accountant) => {
  await stepUp(who);
  return who.post('/api/acc/opening/cutover-date', { date });
};
const ob = (lines: object[], total: number, businessDate: string | null = CUTOVER, who = accountant) =>
  who.post('/api/docs/acc.opening/post', { input: { lines }, expectedTotalCents: total, ...(businessDate ? { businessDate } : {}) }, idem());
const errors = async (lines: object[], businessDate: string | null = CUTOVER) => {
  const r = await accountant.post('/api/docs/acc.opening/preview', { input: { lines }, ...(businessDate ? { businessDate } : {}) });
  return r.json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
};
const journalOf = (documentId: string, kind = 'original') =>
  env.db
    .prepare(
      `SELECT a.code, l.party_id AS party, l.debit_cents AS dr, l.credit_cents AS cr, j.business_date AS date
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
    )
    .all(documentId, kind);
const state = async () => (await owner.get('/api/acc/opening')).json();
const stockholder = async (name: string) =>
  (await accountant.post('/api/eq/people', { name, isStockholder: true, isOfficer: false })).json().id as string;

describe('cut-over date', () => {
  it('is set by the accountant with a fresh password; the newest row counts; audited', async () => {
    expect((await encoder.post('/api/acc/opening/cutover-date', { date: CUTOVER })).statusCode).toBe(403);
    expect((await setCutover(CUTOVER, owner)).statusCode).toBe(403);
    expect((await accountant.post('/api/acc/opening/cutover-date', { date: CUTOVER })).json().code).toBe('STEP_UP_REQUIRED');
    expect((await setCutover('2026-02-30')).json().code).toBe('BAD_DATE');

    expect((await setCutover('2026-09-26')).json().cutoverDate).toBe('2026-09-26');
    const moved = await setCutover(CUTOVER);
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ cutoverDate: CUTOVER, openingEquityCents: 0, closed: null, documents: [] });
    expect((await setCutover(CUTOVER)).json().code).toBe('NO_CHANGE');
    expect(env.db.prepare('SELECT cutover_date FROM acc_cutover_dates ORDER BY id').pluck().all()).toEqual(['2026-09-26', CUTOVER]);
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'acc.opening.cutover'`).pluck().get()).toBe(2);

    expect((await state()).cutoverDate).toBe(CUTOVER);
    expect((await encoder.get('/api/acc/opening')).statusCode).toBe(403);
  });
});

describe('opening balances (D5 "OB-*", D8)', () => {
  it('golden: a cash line alone is Dr cash / Cr 3900, dated the cut-over date', async () => {
    await setCutover(CUTOVER);
    const lines = [{ accountId: id('1101'), debitCents: 15_000_000, memo: 'Cash count at closing time' }];
    const pre = await accountant.post('/api/docs/acc.opening/preview', { input: { lines }, businessDate: CUTOVER });
    expect(pre.json().summary).toBe(
      'This will record opening balances of ₱150,000.00 dated 2026-09-27 over 1 line, with ₱150,000.00 credited to opening balance equity.',
    );
    const res = await ob(lines, 15_000_000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'OB-000001', businessDate: CUTOVER });
    expect(journalOf(res.json().id)).toEqual([
      { code: '1101', party: null, dr: 15_000_000, cr: 0, date: CUTOVER },
      { code: '3900', party: null, dr: 0, cr: 15_000_000, date: CUTOVER },
    ]);
    expect(balances(env.db)).toEqual({ '1101': 15_000_000, '3900': -15_000_000 });
    const s = await state();
    expect(s.openingEquityCents).toBe(-15_000_000);
    expect(s.trialBalance).toEqual({ asOf: CUTOVER, totalDebitCents: 15_000_000, totalCreditCents: 15_000_000, balanced: true });
    expect(s.documents).toMatchObject([{ number: 'OB-000001', businessDate: CUTOVER, status: 'posted', totalCents: 15_000_000 }]);
    noBrokenInvariants();
  });

  it('golden: the equity breakdown brings 3900 to zero; then the accountant closes the opening', async () => {
    await setCutover(CUTOVER);
    const A = await stockholder('Sample Owner A');
    const B = await stockholder('Sample Owner B');
    const assets = await ob(
      [
        { accountId: id('1101'), debitCents: 5_000_000 },
        { accountId: id('1111'), debitCents: 120_000_000 },
        { accountId: id('1301'), debitCents: 30_000_000 },
        { accountId: id('1302'), debitCents: 8_000_000 },
        { accountId: id('1402'), debitCents: 4_500_000 },
        { accountId: id('1420'), debitCents: 6_000_000 },
      ],
      173_500_000,
    );
    expect(assets.statusCode).toBe(200);
    expect(journalOf(assets.json().id).at(-1)).toEqual({ code: '3900', party: null, dr: 0, cr: 173_500_000, date: CUTOVER });

    await stepUp(accountant);
    const early = await accountant.post('/api/acc/opening/close', {});
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({
      code: 'OPENING_EQUITY_NOT_ZERO',
      message: 'Opening balance equity still has a credit balance of ₱1,735,000.00. Record the equity breakdown until it is zero.',
    });

    const equity = await ob(
      [
        { accountId: id('3101'), stockholderId: A, creditCents: 50_000_000 },
        { accountId: id('3101'), stockholderId: B, creditCents: 50_000_000 },
        { accountId: id('3104'), creditCents: 20_000_000 },
        { accountId: id('3201'), creditCents: 53_500_000, memo: 'Retained earnings to the cut-over date' },
      ],
      173_500_000,
    );
    expect(equity.statusCode).toBe(200);
    expect(journalOf(equity.json().id)).toEqual([
      { code: '3101', party: A, dr: 0, cr: 50_000_000, date: CUTOVER },
      { code: '3101', party: B, dr: 0, cr: 50_000_000, date: CUTOVER },
      { code: '3104', party: null, dr: 0, cr: 20_000_000, date: CUTOVER },
      { code: '3201', party: null, dr: 0, cr: 53_500_000, date: CUTOVER },
      { code: '3900', party: null, dr: 173_500_000, cr: 0, date: CUTOVER },
    ]);
    expect(balances(env.db)['3900']).toBeUndefined();

    const s = await state();
    expect(s.openingEquityCents).toBe(0);
    expect(s.trialBalance).toMatchObject({ totalDebitCents: 173_500_000, balanced: true });
    expect(s.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
    expect(s.checks.find((c: { code: string }) => c.code === '3101')).toEqual({
      code: '3101', name: 'Capital stock', partyType: 'stockholder', controlCents: -100_000_000, partiesCents: -100_000_000, ok: true,
    });

    expect((await owner.post('/api/acc/opening/close', {})).statusCode).toBe(403);
    const closed = await accountant.post('/api/acc/opening/close', {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json().closed).toMatchObject({ cutoverDate: CUTOVER, closedBy: accountant.userId, totalDebitCents: 173_500_000, totalCreditCents: 173_500_000 });
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'acc.opening.close'`).pluck().get()).toBe(1);

    // After the close: no OB- is posted or cancelled, and the cut-over date stays.
    const late = await ob([{ accountId: id('1102'), debitCents: 100_000 }], 100_000);
    expect(late.statusCode).toBe(422);
    expect(late.json().details.map((i: { code: string }) => i.code)).toEqual(['OPENING_CLOSED']);
    const cancel = await accountant.post(`/api/docs/acc.opening/${assets.json().id}/cancel`, { reason: 'Recounted the cash box' }, idem());
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe('OPENING_CLOSED');
    expect(env.db.prepare('SELECT status FROM documents WHERE id = ?').pluck().get(assets.json().id)).toBe('posted');
    expect(journalOf(assets.json().id, 'reversal')).toEqual([]);
    expect((await setCutover('2026-09-20')).json().code).toBe('OPENING_CLOSED');
    expect((await accountant.post('/api/acc/opening/close', {})).json().code).toBe('OPENING_CLOSED');
    expect((await state()).cutoverDate).toBe(CUTOVER);
    noBrokenInvariants();
  });

  it('refuses accounts the documents own, headings, 3290, 3900, and wrong stockholders', async () => {
    await setCutover(CUTOVER);
    const cash = { accountId: id('1101'), debitCents: 100 };
    const cr = (code: string, extra: object = {}) => [cash, { accountId: id(code), creditCents: 100, ...extra }];
    for (const code of ['1201', '2201', '2101', '1410', '2301', '1401', '2311', '2302', '2601', '1210', '2501', '1510', '1511', '2401', '4101']) {
      expect(await errors(cr(code)), code).toEqual(['SUBLEDGER']);
    }
    expect(await errors(cr('1000'))).toEqual(['HEADER']);
    expect(await errors(cr('3290'))).toEqual(['NOT_POSTABLE']);
    expect(await errors(cr('3900'))).toEqual(['OPENING_EQUITY']);
    expect(await errors(cr('3101'))).toEqual(['STOCKHOLDER_REQUIRED']);
    expect(await errors(cr('3101', { stockholderId: crypto.randomUUID() }))).toEqual(['STOCKHOLDER']);
    expect(await errors(cr('3104', { stockholderId: await stockholder('Sample Owner A') }))).toEqual(['STOCKHOLDER_NOT_ALLOWED']);
    expect(await errors([{ accountId: id('1101'), debitCents: 100, creditCents: 100 }])).toEqual(['ONE_SIDE']);

    const res = await ob(cr('1201'), 100);
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Line 2: 1201 Accounts receivable – trade opens with opening invoice records per customer, not here.');
    expect(balances(env.db)).toEqual({});
  });

  it('allows cash places and balances no document keeps; the list of owned roles matches the chart', async () => {
    const codes = (await state()).accounts.map((a: { code: string }) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['1101', '1102', '1111', '1121', '1301', '1302', '1402', '1420', '3101', '3104', '3201']));
    for (const code of ['1000', '1190', '1201', '1210', '1220', '1401', '1404', '1410', '1510', '2101', '2201', '2301', '2302', '2310', '2311', '2320', '2401', '2405', '2501', '2601', '2602', '3290', '3900']) {
      expect(codes, code).not.toContain(code);
    }
    const roles = env.db.prepare('SELECT role_key FROM accounts WHERE role_key IS NOT NULL').pluck().all() as string[];
    expect(Object.keys(DOCUMENT_OWNED_ROLES).filter((r) => !roles.includes(r))).toEqual([]);
  });

  it('is refused without a cut-over date or on another date', async () => {
    const lines = [{ accountId: id('1101'), debitCents: 100 }];
    expect(await errors(lines)).toEqual(['NO_CUTOVER']);
    await setCutover(CUTOVER);
    expect(await errors(lines, null)).toEqual(['NOT_CUTOVER_DATE']); // today, 2026-09-28
    expect(await errors(lines, '2026-09-20')).toEqual(['NOT_CUTOVER_DATE']);
    const res = await ob(lines, 100, '2026-09-20');
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Opening balances are dated the cut-over date, 2026-09-27, not 2026-09-20.');
    expect(await errors(lines)).toEqual([]);
  });

  it('is for the accountant only; the owner sees the opening screen', async () => {
    await setCutover(CUTOVER);
    const lines = [{ accountId: id('1101'), debitCents: 100 }];
    expect((await ob(lines, 100, CUTOVER, encoder)).statusCode).toBe(403);
    expect((await ob(lines, 100, CUTOVER, owner)).statusCode).toBe(403);
    expect((await owner.get('/api/acc/opening')).statusCode).toBe(200);
  });

  it('cancels with a mirror on the cut-over date while the opening is open', async () => {
    await setCutover(CUTOVER);
    const res = await ob([{ accountId: id('1111'), debitCents: 2_500_000 }], 2_500_000);
    const cancel = await accountant.post(`/api/docs/acc.opening/${res.json().id}/cancel`, { reason: 'Bank balance was from the wrong statement' }, idem());
    expect(cancel.statusCode).toBe(200);
    expect(journalOf(res.json().id, 'reversal')).toEqual([
      { code: '1111', party: null, dr: 0, cr: 2_500_000, date: '2026-09-27' },
      { code: '3900', party: null, dr: 2_500_000, cr: 0, date: '2026-09-27' },
    ]); // the cut-over date, so the opening there is as if it had never been recorded
    expect(balances(env.db)).toEqual({});
    expect((await state()).documents).toMatchObject([{ number: 'OB-000001', status: 'cancelled' }]);
    noBrokenInvariants();
  });

  it('moves the cut-over date only when no recorded OB- is left on the old date', async () => {
    await setCutover(CUTOVER);
    const res = await ob([{ accountId: id('1101'), debitCents: 100_000 }], 100_000);
    const moved = await setCutover('2026-09-20');
    expect(moved.statusCode).toBe(409);
    expect(moved.json()).toMatchObject({ code: 'OPENING_POSTED', message: 'OB-000001 is dated 2026-09-27. Cancel it before moving the cut-over date.' });
    await accountant.post(`/api/docs/acc.opening/${res.json().id}/cancel`, { reason: 'Cut-over moved to the earlier Sunday' }, idem());
    expect((await setCutover('2026-09-20')).json().cutoverDate).toBe('2026-09-20');
  });

  it('property: the journal always balances with its 3900 line, stores what was computed and cancels to zero', async () => {
    await setCutover(CUTOVER);
    const actor = { userId: accountant.userId, permissions: new Set(['acc.opening.create', 'acc.opening.post', 'acc.opening.cancel', 'acc.backdate']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: CUTOVER, at: stamp(env.clock), userId: actor.userId, can: () => true });
    fc.assert(
      fc.property(openingDoc.arbitrary(env.db), fc.boolean(), (input, cancel) => {
        const doc = openingDoc.compute(input, ctx());
        expect(openingDoc.validate(doc, ctx()).filter((i) => i.level === 'error')).toEqual([]);
        const lines = resolveDraft(env.db, openingDoc.journal!(doc, ctx())!);
        const dr = lines.reduce((s, l) => s + l.debitCents, 0);
        expect(lines.reduce((s, l) => s + l.creditCents, 0)).toBe(dr);
        expect(dr).toBe(doc.totalCents);
        const equity = lines.filter((l) => l.account.role_key === 'OPENING_EQUITY');
        if (doc.debitsCents === doc.creditsCents) expect(equity).toEqual([]);
        else expect(equity.map((l) => l.creditCents - l.debitCents)).toEqual([doc.debitsCents - doc.creditsCents]);

        const p = postDocument(e, openingDoc, actor, { input, expectedTotalCents: doc.totalCents, businessDate: CUTOVER });
        expect(openingDoc.load(env.db, p.id)).toEqual(doc);
        expect(openingDoc.toInput(doc)).toEqual(input);
        if (cancel) cancelDocument(e, openingDoc, actor, p.id, 'Property test cancel');
      }),
      { numRuns: 40 },
    );
    noBrokenInvariants();
  });
});
