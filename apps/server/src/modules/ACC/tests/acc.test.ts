/**
 * ACC: effective-dated settings, the chart-of-accounts API and journal vouchers (PLAN E12, D5 "JV", N-04, N-06).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PASSWORD, balances, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument } from '../../../engine/documents/lifecycle.ts';
import { settingAt } from '../../../engine/settings.ts';
import { stamp } from '../../../platform/clock.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jvDoc } from '../doctypes/jv.ts';

let env: TestEnv;
let accountant: Client;
let encoder: Client;

beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28 10:00 Manila
  accountant = await env.as('accountant');
  encoder = await env.as('encoder');
});

const id = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const version = (code: string) => env.db.prepare('SELECT version FROM accounts WHERE code = ?').pluck().get(code) as number;
const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const jv = (input: object, total: number, who = accountant, businessDate?: string) =>
  who.post('/api/docs/acc.jv/post', { input, expectedTotalCents: total, ...(businessDate ? { businessDate } : {}) }, idem());

describe('effective-dated settings (E12, D4.2)', () => {
  it('starts with the plan defaults', async () => {
    const res = await encoder.get('/api/settings');
    expect(res.statusCode).toBe(200);
    expect(Object.fromEntries(res.json().map((s: { key: string; current: unknown }) => [s.key, s.current]))).toEqual({
      'tax.vat_rate_bp': 1200,
      'sales.deposit_vat_mode': 'A',
      'col.cr_mode': { mode: 'booklet' },
      'tax.top_withholding_agent': false,
      'tax.interest_final_tax_bp': 2000,
    });
  });

  it('a new version applies from its date only; older dates keep the old value', async () => {
    await stepUp(accountant);
    const res = await accountant.post('/api/settings/tax.vat_rate_bp', { effectiveFrom: '2027-01-01', value: 1000, reason: 'Test of a future rate change' });
    expect(res.statusCode).toBe(200);
    expect(settingAt(env.db, 'tax.vat_rate_bp', '2026-12-31')).toBe(1200);
    expect(settingAt(env.db, 'tax.vat_rate_bp', '2027-01-01')).toBe(1000);

    // A future version entered by mistake is corrected by a later row on the same date.
    expect((await accountant.post('/api/settings/tax.vat_rate_bp', { effectiveFrom: '2027-01-01', value: 1200, reason: 'The 10% bill did not pass' })).statusCode).toBe(200);
    expect(settingAt(env.db, 'tax.vat_rate_bp', '2027-06-30')).toBe(1200);
    const vat = (await accountant.get('/api/settings')).json().find((s: { key: string }) => s.key === 'tax.vat_rate_bp');
    expect(vat.versions.map((v: { value: number }) => v.value)).toEqual([1200, 1000, 1200]);

    const audit = env.db.prepare(`SELECT data FROM audit_log WHERE action = 'acc.setting.add' ORDER BY seq`).pluck().all() as string[];
    expect(JSON.parse(audit[0]!)).toMatchObject({ effectiveFrom: '2027-01-01', before: 1200, after: 1000 });
  });

  it('refuses earlier dates, bad values, no-change and edits', async () => {
    await stepUp(accountant);
    const add = (key: string, body: object) => accountant.post(`/api/settings/${key}`, { reason: 'Accountant decision ACC-02', ...body });
    expect((await add('sales.deposit_vat_mode', { effectiveFrom: '2026-09-27', value: 'B' })).json().code).toBe('SETTING_BACKDATED');
    expect((await add('sales.deposit_vat_mode', { effectiveFrom: '2026-09-28', value: 'D' })).json().code).toBe('BAD_VALUE');
    expect((await add('sales.deposit_vat_mode', { effectiveFrom: '2026-09-28', value: 'A' })).json().code).toBe('NO_CHANGE');
    expect((await add('col.cr_mode', { effectiveFrom: '2026-10-01', value: { mode: 'system' } })).json().code).toBe('BAD_VALUE');
    expect((await add('no.such.key', { effectiveFrom: '2026-10-01', value: 1 })).statusCode).toBe(404);
    const ok = await add('col.cr_mode', { effectiveFrom: '2026-10-01', value: { mode: 'system', signOff: { name: 'Juana Cruz, CPA', date: '2026-09-28', basis: 'RDO confirmed system CRs are allowed' } } });
    expect(ok.statusCode).toBe(200);
    expect(settingAt(env.db, 'col.cr_mode', '2026-10-01')).toMatchObject({ mode: 'system' });
    expect(() => env.db.prepare(`UPDATE settings SET value_json = '1100' WHERE key = 'tax.vat_rate_bp'`).run()).toThrow(/IMMUTABLE/);
  });

  it('needs the permission and a fresh password (N-06)', async () => {
    const body = { effectiveFrom: '2026-10-01', value: { mode: 'booklet' }, reason: 'Encoder tries to switch' };
    expect((await encoder.post('/api/settings/sales.deposit_vat_mode', { ...body, value: 'B' })).statusCode).toBe(403);
    const noStepUp = await accountant.post('/api/settings/sales.deposit_vat_mode', { ...body, value: 'B' });
    expect(noStepUp.json().code).toBe('STEP_UP_REQUIRED');
  });
});

describe('chart of accounts (E12)', () => {
  it('lists accounts with balances; other income is revenue', async () => {
    const res = await accountant.get('/api/acc/accounts');
    expect(res.statusCode).toBe(200);
    expect(res.json().find((a: { code: string }) => a.code === '7101')).toMatchObject({ type: 'revenue', normalSide: 'credit', roleKey: 'INTEREST_INCOME' });
    expect((await encoder.get('/api/acc/accounts')).statusCode).toBe(403);
  });

  it('adds an account after its neighbour, never in the cash-place range, never twice', async () => {
    const add = (body: object, who = accountant) => who.post('/api/acc/accounts', body);
    const res = await add({ code: '6265', name: 'Laundry and cleaning', type: 'expense' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: '6265', normalSide: 'debit', partyType: null, isActive: true, version: 1, balanceCents: 0 });
    const order = (env.db.prepare('SELECT code FROM accounts ORDER BY sort_order, code').pluck().all() as string[]).filter((c) => c.startsWith('626') || c === '6270');
    expect(order).toEqual(['6260', '6265', '6270']);
    expect((await add({ code: '4195', name: 'Sales allowances – promo', type: 'revenue', normalSide: 'debit' })).json().normalSide).toBe('debit');
    expect((await add({ code: '1150', name: 'Cash in bank – BPI', type: 'asset' })).json().code).toBe('CASH_PLACE_CODE');
    expect((await add({ code: '6265', name: 'Laundry again', type: 'expense' })).json().code).toBe('CODE_EXISTS');
    expect((await add({ code: '6266', name: 'Encoder account', type: 'expense' }, encoder)).statusCode).toBe(403);
  });

  it('renames with the current version only; code, type and role never change', async () => {
    const rename = (v?: number) => accountant.put(`/api/acc/accounts/${id('6990')}`, { name: 'Miscellaneous expenses' }, v ? { 'if-match': String(v) } : {});
    expect((await rename()).statusCode).toBe(428);
    expect((await rename(version('6990'))).json()).toMatchObject({ name: 'Miscellaneous expenses', version: 2 });
    expect((await rename(1)).json().code).toBe('VERSION_CHANGED');
    expect(() => env.db.prepare(`UPDATE accounts SET type = 'asset' WHERE code = '6990'`).run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare(`UPDATE accounts SET role_key = 'X' WHERE code = '6990'`).run()).toThrow(/IMMUTABLE/);
  });

  it('deactivates only accounts with no role and no balance, after a fresh password', async () => {
    const add = await accountant.post('/api/acc/accounts', { code: '6265', name: 'Laundry and cleaning', type: 'expense' });
    const laundry = add.json().id as number;
    const deactivate = (accountId: number) => accountant.post(`/api/acc/accounts/${accountId}/deactivate`, {}, { 'if-match': String(env.db.prepare('SELECT version FROM accounts WHERE id = ?').pluck().get(accountId)) });
    expect((await deactivate(laundry)).json().code).toBe('STEP_UP_REQUIRED');
    await stepUp(accountant);
    expect((await deactivate(id('6230'))).json().code).toBe('ACCOUNT_HAS_ROLE');

    const cash = id('1101');
    expect((await jv({ memo: 'Laundry paid from the cash box', lines: [{ accountId: laundry, debitCents: 50_000 }, { accountId: cash, creditCents: 50_000 }] }, 50_000)).statusCode).toBe(200);
    expect((await deactivate(laundry)).json().code).toBe('ACCOUNT_HAS_BALANCE');
    expect(() => env.db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(laundry)).toThrow(/ACCOUNT_HAS_BALANCE/);

    await jv({ memo: 'Laundry was really a repair', lines: [{ accountId: id('6170'), debitCents: 50_000 }, { accountId: laundry, creditCents: 50_000 }] }, 50_000);
    expect((await deactivate(laundry)).json()).toMatchObject({ isActive: false });
    const blocked = await jv({ memo: 'Posting to an inactive account', lines: [{ accountId: laundry, debitCents: 100 }, { accountId: cash, creditCents: 100 }] }, 100);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().details.map((i: { code: string }) => i.code)).toContain('INACTIVE');
  });
});

describe('journal voucher (D5 "JV", E12)', () => {
  it('posts any postable accounts with the party they need, and cancels with a mirror', async () => {
    const c = seedCustomers(env.db, encoder.userId);
    const input = {
      memo: 'Write off a small customer balance to other income',
      lines: [
        { accountId: id('1201'), party: { type: 'customer', id: c.school }, debitCents: 12_345 },
        { accountId: id('7103'), creditCents: 12_345, memo: 'Rounding' },
      ],
    };
    const pre = await accountant.post('/api/docs/acc.jv/preview', { input });
    expect(pre.json().summary).toBe('This will record a journal voucher of ₱123.45 over 2 lines: Write off a small customer balance to other income.');
    const res = await jv(input, 12_345);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ number: 'JV-000001', businessDate: '2026-09-28' });
    expect(balances(env.db)).toEqual({ '1201': 12_345, '7103': -12_345 });

    const cancel = await accountant.post(`/api/docs/acc.jv/${res.json().id}/cancel`, { reason: 'Entered on the wrong customer' }, idem());
    expect(cancel.statusCode).toBe(200);
    expect(balances(env.db)).toEqual({});
    noBrokenInvariants();
  });

  it('checks sides, balance and parties', async () => {
    const c = seedCustomers(env.db, encoder.userId);
    const codes = async (lines: object[]) => {
      const r = await accountant.post('/api/docs/acc.jv/preview', { input: { memo: 'Checking the rules', lines } });
      return r.json().issues.filter((i: { level: string }) => i.level === 'error').map((i: { code: string }) => i.code);
    };
    const cash = id('1101');
    expect(await codes([{ accountId: id('6990'), debitCents: 100 }, { accountId: cash, creditCents: 90 }])).toEqual(['UNBALANCED']);
    expect(await codes([{ accountId: id('6990'), debitCents: 100, creditCents: 100 }, { accountId: cash, creditCents: 100 }])).toContain('ONE_SIDE');
    expect(await codes([{ accountId: id('1201'), debitCents: 100 }, { accountId: cash, creditCents: 100 }])).toEqual(['PARTY_REQUIRED']);
    expect(await codes([{ accountId: id('6990'), party: { type: 'customer', id: c.school }, debitCents: 100 }, { accountId: cash, creditCents: 100 }])).toEqual(['PARTY_NOT_ALLOWED']);
    expect(await codes([{ accountId: id('1201'), party: { type: 'customer', id: crypto.randomUUID() }, debitCents: 100 }, { accountId: cash, creditCents: 100 }])).toEqual(['CUSTOMER']);
    expect(await codes([{ accountId: id('6000'), debitCents: 100 }, { accountId: cash, creditCents: 100 }])).toEqual(['HEADER']);
  });

  it('may be backdated by the accountant with a reason (late entry, NR-7)', async () => {
    const lines = [{ accountId: id('6110'), debitCents: 4_000_000 }, { accountId: id('2102'), creditCents: 4_000_000 }];
    const noReason = await jv({ memo: 'Accrue September rent', lines }, 4_000_000, accountant, '2026-09-01');
    expect(noReason.statusCode).toBe(422);
    expect(noReason.json().details.map((i: { code: string }) => i.code)).toEqual(['LATE_REASON']);
    const res = await jv({ memo: 'Accrue September rent', lines, lateReason: 'Lease was signed late; accrual for September' }, 4_000_000, accountant, '2026-09-01');
    expect(res.statusCode).toBe(200);
    expect(res.json().businessDate).toBe('2026-09-01');
    expect(res.json().warnings.map((i: { code: string }) => i.code)).toEqual(['LATE_ENTRY']);
    expect(env.db.prepare('SELECT is_late, late_reason FROM acc_journal_vouchers').get()).toEqual({ is_late: 1, late_reason: 'Lease was signed late; accrual for September' });
    expect(env.db.prepare(`SELECT business_date FROM journals WHERE source_id = ?`).pluck().get(res.json().id)).toBe('2026-09-01');
    expect((await jv({ memo: 'Future entry', lines }, 4_000_000, accountant, '2026-09-29')).json().code).toBe('BAD_DATE');
  });

  it('is for the accountant only (N-04)', async () => {
    const input = { memo: 'Encoder tries a JV', lines: [{ accountId: id('6990'), debitCents: 100 }, { accountId: id('1101'), creditCents: 100 }] };
    expect((await jv(input, 100, encoder)).statusCode).toBe(403);
    const owner = await env.as('owner');
    expect((await jv(input, 100, owner)).statusCode).toBe(403);
  });

  it('property: random JVs store what was computed and cancel to zero', () => {
    const actor = { userId: accountant.userId, permissions: new Set(['acc.jv.create', 'acc.jv.post', 'acc.jv.cancel']) };
    const e = { db: env.db, clock: env.clock };
    const ctx = () => ({ db: env.db, businessDate: '2026-09-28', at: stamp(env.clock), userId: actor.userId, can: () => true });
    fc.assert(
      fc.property(jvDoc.arbitrary(env.db), fc.boolean(), (input, cancel) => {
        const doc = jvDoc.compute(input, ctx());
        expect(jvDoc.validate(doc, ctx()).filter((i) => i.level === 'error')).toEqual([]);
        const p = postDocument(e, jvDoc, actor, { input, expectedTotalCents: doc.totalCents });
        expect(jvDoc.load(env.db, p.id)).toEqual(doc);
        expect(jvDoc.toInput(doc)).toEqual(input);
        if (cancel) cancelDocument(e, jvDoc, actor, p.id, 'Property test cancel');
      }),
      { numRuns: 40 },
    );
    noBrokenInvariants();
  });
});
