/**
 * ACC: the month-end checklist (PLAN D8 "Monthly"): a made-up August 2026 with some items done and some not, the
 * accountant's sign-off (step-up, insert-only, audited), a change dated in the month after it, and 403 for other roles.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';

const AUG = '2026-08';
let env: TestEnv;
let accountant: Client, owner: Client, encoder: Client, production: Client;
let CASH: number, BDO: number, plainSupplier: string;

const noBrokenInvariants = () => expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
const goTo = async (iso: string) => {
  env.clock.set(iso);
  [accountant, owner, encoder, production] = await Promise.all([env.as('accountant'), env.as('owner'), env.as('encoder'), env.as('production')]);
};
const receive = (into: number, cents: number) =>
  accountant.post('/api/docs/cash.other_receipt/post', { input: { cashPlaceId: into, category: 'other_income', receivedFrom: 'Made-up Scrap Buyer', description: 'Scrap cloth', amountCents: cents }, expectedTotalCents: cents }, idem());
const stepUp = (c: Client) => c.post('/api/auth/step-up', { password: PASSWORD });
const signOff = (month: string, note = 'Reviewed with the owner; open items agreed', who = accountant) => who.post('/api/acc/month-end/sign-off', { month, note });
const checklist = async (month = AUG, who: Client = accountant) => (await who.get(`/api/acc/month-end?month=${month}`)).json();
const item = (c: { items: { key: string }[] }, key: string) => c.items.find((i) => i.key === key) as { key: string; state: string; detail: string; href: string; rows: { label: string; state: string; detail: string }[] };
const states = (c: { items: { key: string; state: string }[] }) => Object.fromEntries(c.items.map((i) => [i.key, i.state]));

/**
 * August 2026 of a made-up shop, seen on 2026-09-28: cash of ₱12,500 counted (₱50 short) and a furniture purchase paid
 * from BDO, both in August; August depreciated; BDO not reconciled; nothing else happened.
 */
async function augustBooks() {
  await goTo('2026-08-10T02:00:00Z');
  expect((await receive(CASH, 1_250_000)).statusCode).toBe(200);
  expect((await receive(BDO, 2_000_000)).statusCode).toBe(200);
  const buy = await accountant.post('/api/docs/fa.buy/post', {
    input: { classCode: 'furniture', description: 'Cutting table', location: 'Production floor', supplierId: plainSupplier, supplierInvoiceNo: 'SI-100', supplierInvoiceDate: '2026-08-10',
      amountCents: 1_200_000, residualCents: 0, cashPlaceId: BDO, paidCents: 1_200_000 }, expectedTotalCents: 1_200_000 }, idem());
  expect(buy.statusCode, buy.body).toBe(200);
  await goTo('2026-08-14T02:00:00Z');
  const count = await accountant.post('/api/docs/cash.count/post', { input: { cashPlaceId: CASH, lines: [{ denominationCents: 100_000, qty: 12 }, { denominationCents: 10_000, qty: 4 }, { denominationCents: 5_000, qty: 1 }] }, expectedTotalCents: 1_245_000 }, idem());
  expect(count.statusCode, count.body).toBe(200);
  await goTo('2026-08-31T02:00:00Z');
  const preview = await accountant.post('/api/docs/fa.depreciation/preview', { input: { month: AUG } });
  const run = await accountant.post('/api/docs/fa.depreciation/post', { input: { month: AUG }, expectedTotalCents: preview.json().totalCents }, idem());
  expect(run.statusCode, run.body).toBe(200);
  await goTo('2026-09-28T02:00:00Z');
}

beforeEach(async () => {
  env = await createTestEnv('2026-08-10T02:00:00Z');
  CASH = cashPlaceId(env.db, '1101');
  BDO = cashPlaceId(env.db, '1111');
  await goTo('2026-08-10T02:00:00Z');
  plainSupplier = (await accountant.post('/api/pur/suppliers', { name: 'Sample Furniture Shop', registeredName: 'Sample Furniture Shop', tin: '222-333-444-000', isVatRegistered: false })).json().id;
});

describe('the checklist of a made-up month', () => {
  it('reads each item from the app: done, not done or not needed, with the screen that does it', async () => {
    await augustBooks();
    const c = await checklist();
    expect(c).toMatchObject({ month: AUG, asOf: '2026-09-28', over: true, canSignOff: true, signoff: null, changedAfterSignoff: null });
    expect(states(c)).toEqual({
      depreciation: 'done', bank_recon: 'not_done', cash_count: 'done', inventory_count: 'not_needed', remittances: 'not_needed',
      ewt_return: 'not_needed', vat_close: 'not_needed', exceptions: 'done', old_drafts: 'done',
    });

    expect(item(c, 'depreciation')).toMatchObject({ detail: expect.stringMatching(/^Posted on DEPR-000001, dated 2026-08-31\.$/), href: '/docs/fa.depreciation/new' });
    expect(item(c, 'bank_recon')).toMatchObject({ detail: '0 of 1 done.', href: '/cash/recon' });
    expect(item(c, 'bank_recon').rows).toEqual([
      { label: 'Cash in bank – BDO', state: 'not_done', detail: 'Not reconciled to the end of 2026-08.' },
      { label: 'Cash in bank – China Bank', state: 'not_needed', detail: 'No entries up to the month end.' },
    ]);
    expect(item(c, 'cash_count').rows.map((r) => [r.label, r.state])).toEqual([['Cash on hand (main cash box)', 'done'], ['Petty cash fund', 'not_needed']]);
    expect(item(c, 'cash_count').rows[0]!.detail).toMatch(/^Counted on 2026-08-14 \(CNT-\d+\)\.$/);
    expect(item(c, 'inventory_count').rows.map((r) => r.state)).toEqual(['not_needed', 'not_needed']);
    expect(item(c, 'remittances')).toMatchObject({ href: '/stat/2026-08' });
    expect(item(c, 'remittances').rows.map((r) => r.state)).toEqual(['not_needed', 'not_needed', 'not_needed', 'not_needed']);
    expect(item(c, 'ewt_return')).toMatchObject({ href: '/tax/0619e?month=2026-08', detail: 'No EWT was withheld for August 2026.' });
    expect(item(c, 'vat_close').detail).toBe('The VAT is closed in the last month of the quarter.');
    expect(item(c, 'exceptions').href).toBe('/dash/notifications');
  });

  it('follows the books: a reconciled bank, a new count, an old draft and an unread exception change their items', async () => {
    await augustBooks();
    // BDO reconciled to the end of August, then finished at a zero difference.
    const bookBalance = 2_000_000 - 1_200_000;
    const start = await accountant.post('/api/cash/recons', { bankId: BDO, month: AUG, endingBalanceCents: bookBalance });
    expect(start.statusCode, start.body).toBe(200);
    expect(item(await checklist(), 'bank_recon')).toMatchObject({ state: 'not_done', detail: '0 of 1 done.' });
    expect(item(await checklist(), 'bank_recon').rows[0]!.detail).toBe('The 2026-08 reconciliation is started, not finished.');
    // Every book line is a deposit or a payment the bank shows: match them to statement lines, then finish.
    const lines = env.db.prepare(`SELECT l.id, l.debit_cents - l.credit_cents AS cents, j.business_date AS date FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE l.account_id = ? ORDER BY l.id`).all(BDO) as { id: number; cents: number; date: string }[];
    const added = await accountant.post(`/api/cash/recons/${start.json().id}/lines`, { lines: lines.map((l) => ({ date: l.date, description: 'Made-up statement line', amountCents: l.cents })) });
    expect(added.statusCode, added.body).toBe(200);
    const statement = added.json().statementLines as { id: number }[];
    const match = await accountant.post(`/api/cash/recons/${start.json().id}/match`, { statementLineIds: statement.map((s) => s.id), journalLineIds: lines.map((l) => l.id) });
    expect(match.statusCode, match.body).toBe(200);
    await stepUp(accountant);
    const done = await accountant.post(`/api/cash/recons/${start.json().id}/finish`, {});
    expect(done.statusCode, done.body).toBe(200);
    expect(item(await checklist(), 'bank_recon')).toMatchObject({ state: 'done', detail: '1 of 1 done.' });
    expect(item(await checklist(), 'bank_recon').rows[0]).toEqual({ label: 'Cash in bank – BDO', state: 'done', detail: 'Reconciled to the end of 2026-08.' });

    // A draft that waited 4 days, seen on the drafts item by document type.
    const draft = await accountant.post('/api/drafts', { docType: 'cash.count', payload: {} });
    env.db.prepare('UPDATE drafts SET created_at = ? WHERE id = ?').run('2026-09-24T09:00:00.000+08:00', draft.json().id);
    const withDraft = await checklist();
    expect(item(withDraft, 'old_drafts')).toMatchObject({ state: 'not_done', detail: '1 draft has waited more than 3 days, as of today.', rows: [{ label: 'Cash Count', state: 'not_done', detail: '1 waiting' }] });
    env.db.prepare('UPDATE drafts SET created_at = ? WHERE id = ?').run('2026-09-26T09:00:00.000+08:00', draft.json().id);
    expect(item(await checklist(), 'old_drafts').state).toBe('done');

    // An exception (a cash box below zero) is unread until the accountant marks it read.
    const petty = cashPlaceId(env.db, '1102');
    const transfer = await accountant.post('/api/docs/cash.transfer/post', { input: { fromCashPlaceId: petty, toCashPlaceId: CASH, amountSentCents: 10_000, amountReceivedCents: 10_000 }, expectedTotalCents: 10_000 }, idem());
    expect(transfer.statusCode, transfer.body).toBe(200);
    const open = await checklist();
    expect(item(open, 'exceptions')).toMatchObject({ state: 'not_done', detail: '1 unread in your exceptions inbox, as of today.', rows: [{ label: 'Petty cash fund is below zero' }] });
    const inbox = (await accountant.get('/api/dash/notifications')).json() as { id: string; kind: string }[];
    const id = inbox.find((n) => n.kind === 'negative-cash')!.id;
    expect((await accountant.post('/api/dash/notifications/read', { id })).statusCode).toBe(200);
    expect(item(await checklist(), 'exceptions').state).toBe('done');
    noBrokenInvariants();
  });

  it('asks for the quarter-end items in a quarter\'s last month and refuses a month that has not started', async () => {
    await augustBooks();
    const sep = await checklist('2026-09');
    expect(sep).toMatchObject({ over: false, canSignOff: false });
    expect(item(sep, 'ewt_return')).toMatchObject({ href: '/tax/1601eq?year=2026&quarter=3' });
    expect(item(sep, 'vat_close').href).toBe('/docs/tax.vat_close/new?year=2026&quarter=3');
    expect([item(sep, 'ewt_return').state, item(sep, 'vat_close').state]).toEqual(['not_needed', 'not_needed']); // no EWT withheld, no VAT to close
    expect((await accountant.get('/api/acc/month-end?month=2026-10')).json().code).toBe('FUTURE_MONTH');
    expect((await accountant.get('/api/acc/month-end?month=2026-8')).json().code).toBe('BAD_MONTH');
    expect((await accountant.get('/api/acc/month-end')).json().month).toBe(AUG); // the default is last month
  });
});

describe('signing a month off', () => {
  it('is the accountant\'s, with a fresh password and a note, recorded with the items as they read, audited and never edited', async () => {
    await augustBooks();
    expect((await signOff(AUG, undefined, encoder)).statusCode).toBe(403);
    expect((await signOff(AUG, undefined, owner)).statusCode).toBe(403);
    expect((await signOff(AUG)).json().code).toBe('STEP_UP_REQUIRED');
    await stepUp(accountant);
    expect((await signOff(AUG, 'ok')).statusCode).toBe(400); // a note of a few words
    expect((await accountant.post('/api/acc/month-end/sign-off', { month: AUG, note: 'Reviewed and agreed', signedBy: 'x' })).statusCode).toBe(400);
    expect((await signOff('2026-09')).json().code).toBe('MONTH_NOT_OVER');
    expect(env.db.prepare('SELECT COUNT(*) FROM acc_month_signoffs').pluck().get()).toBe(0);

    const res = await signOff(AUG, 'Bank reconciliation of BDO waits for the statement');
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json();
    expect(c.signoff).toMatchObject({ month: AUG, note: 'Bank reconciliation of BDO waits for the statement', signedAt: '2026-09-28T10:00:00.000+08:00', signedBy: accountant.userId });
    expect(Object.fromEntries(c.signoff.items.map((i: { key: string; state: string }) => [i.key, i.state]))).toEqual(states(c));
    expect(c.signoff.items.find((i: { key: string }) => i.key === 'bank_recon')).toMatchObject({ state: 'not_done', detail: '0 of 1 done.' });
    expect(c.changedAfterSignoff).toEqual({ count: 0, documents: [] });
    expect(c.earlierSignoffs).toEqual([]);
    expect(env.db.prepare('SELECT COUNT(*) FROM acc_month_signoff_items').pluck().get()).toBe(9);

    // The owner sees it; the audit log names the month and the counts.
    expect((await checklist(AUG, owner)).signoff).toMatchObject({ note: 'Bank reconciliation of BDO waits for the statement' });
    expect(env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'acc.monthend.signoff'`).pluck().get()).toBe(1); // the refused tries left none
    expect(env.db.prepare(`SELECT entity_id AS month, data FROM audit_log WHERE action = 'acc.monthend.signoff'`).get()).toMatchObject({ month: AUG });
    expect(JSON.parse(env.db.prepare(`SELECT data FROM audit_log WHERE action = 'acc.monthend.signoff'`).pluck().get() as string)).toMatchObject({ done: 4, notDone: 1, notNeeded: 4 });

    // Insert-only.
    expect(() => env.db.prepare(`UPDATE acc_month_signoffs SET note = 'changed the note'`).run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare(`UPDATE acc_month_signoff_items SET state = 'done'`).run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare('DELETE FROM acc_month_signoffs').run()).toThrow();
    noBrokenInvariants();
  });
});

describe('a change after the sign-off', () => {
  it('shows a document dated in the month that was recorded or cancelled later; signing again takes the newest sign-off', async () => {
    await augustBooks();
    await stepUp(accountant);
    expect((await signOff(AUG)).statusCode).toBe(200);
    expect((await checklist()).changedAfterSignoff).toEqual({ count: 0, documents: [] });

    // An hour later: a late journal voucher dated 2026-08-20, and the August ₱20,000 receipt into BDO cancelled.
    await goTo('2026-09-28T03:00:00Z');
    const acct = (code: string) => env.db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
    const lines = [{ accountId: acct('6110'), debitCents: 400_000 }, { accountId: acct('2102'), creditCents: 400_000 }];
    const jv = await accountant.post('/api/docs/acc.jv/post', { input: { memo: 'Accrue August rent', lines, lateReason: 'Lease was signed late; accrual for August' }, expectedTotalCents: 400_000, businessDate: '2026-08-20' }, idem());
    expect(jv.statusCode, jv.body).toBe(200);
    const receipt = env.db.prepare(`SELECT id FROM documents WHERE doc_type = 'cash.other_receipt' AND business_date = '2026-08-10' AND total_cents = 1250000`).pluck().get() as string;
    expect((await accountant.post(`/api/docs/cash.other_receipt/${receipt}/cancel`, { reason: 'Recorded in the wrong box' }, idem())).statusCode).toBe(200);

    const c = await checklist();
    expect(c.signoff).toMatchObject({ signedAt: '2026-09-28T10:00:00.000+08:00' });
    expect(c.changedAfterSignoff.count).toBe(2);
    expect(c.changedAfterSignoff.documents).toEqual([
      { number: 'ORC-000001', title: 'Other Receipt', date: '2026-08-10', action: 'cancelled', at: '2026-09-28T11:00:00.000+08:00' },
      { number: 'JV-000001', title: 'Journal Voucher', date: '2026-08-20', action: 'recorded', at: '2026-09-28T11:00:00.000+08:00' },
    ]);
    // The cancel's mirror is dated today, in September, so it is not counted twice; other months are untouched.
    expect((await checklist('2026-07')).changedAfterSignoff).toBeNull();

    // Signing again keeps the first sign-off and starts a new one: nothing changed since.
    await stepUp(accountant);
    const again = (await signOff(AUG, 'Signed again after the late accrual and the cancelled receipt')).json();
    expect(again.signoff).toMatchObject({ note: 'Signed again after the late accrual and the cancelled receipt' });
    expect(again.earlierSignoffs).toHaveLength(1);
    expect(again.earlierSignoffs[0]).toMatchObject({ note: 'Reviewed with the owner; open items agreed' });
    expect(again.changedAfterSignoff).toEqual({ count: 0, documents: [] });
    expect(env.db.prepare('SELECT COUNT(*) FROM acc_month_signoffs').pluck().get()).toBe(2);
    noBrokenInvariants();
  });
});

describe('who may open the checklist', () => {
  it('is the accountant\'s and the owner\'s to see, the accountant\'s to sign; other roles get 403', async () => {
    await augustBooks();
    for (const who of [encoder, production]) {
      expect((await who.get(`/api/acc/month-end?month=${AUG}`)).statusCode).toBe(403);
      expect((await signOff(AUG, undefined, who)).statusCode).toBe(403);
    }
    expect((await checklist(AUG, owner)).canSignOff).toBe(false);
    expect((await checklist(AUG, accountant)).canSignOff).toBe(true);
    expect((await owner.get(`/api/acc/month-end?month=${AUG}`)).statusCode).toBe(200);
    expect((await signOff(AUG, undefined, owner)).statusCode).toBe(403);
  });
});
