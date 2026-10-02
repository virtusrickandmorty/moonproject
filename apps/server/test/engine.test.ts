import { describe, expect, it, beforeEach } from 'vitest';
import { createTestEnv, createUser, type TestEnv } from './helpers.ts';
import { tx } from '../src/platform/db/driver.ts';
import { postJournal, reverseJournalOf } from '../src/engine/ledger/post.ts';
import { appendAudit, verifyAuditChain } from '../src/engine/audit.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { accountBalance, trialBalance } from '../src/engine/ledger/queries.ts';
import { resolveAccount } from '../src/engine/ledger/accounts.ts';

let env: TestEnv;
let userId: string;
beforeEach(async () => {
  env = await createTestEnv();
  userId = createUser(env.db, 'engine-user', ['owner']);
});

const ctx = (id: string) => ({ sourceType: 'test', sourceId: id, businessDate: '2026-09-28', userId, at: '2026-09-28T10:00:00.000+08:00' });
const cash = (code: string) => (env.db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as { id: number }).id;

describe('database rules (PLAN C5, D9)', () => {
  it('blocks DELETE on every table (N-08, L5)', () => {
    const tables = env.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[];
    expect(tables.length).toBeGreaterThan(10);
    const triggers = new Set((env.db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all() as { name: string }[]).map((t) => t.name));
    for (const { name } of tables) {
      expect(triggers.has(`${name}_no_delete`), name).toBe(true);
      const rows = (env.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;
      if (rows > 0) expect(() => env.db.prepare(`DELETE FROM ${name}`).run(), name).toThrow(/NO_DELETE/);
    }
  });

  it('posts a balanced journal and blocks changes to it (L1, L5)', () => {
    const j = tx(env.db, () =>
      postJournal(env.db, { memo: 'test', lines: [{ account: { cashPlace: cash('1111') }, debitCents: 500 }, { account: { cashPlace: cash('1101') }, creditCents: 500 }] }, ctx('a')),
    );
    expect(j.number).toBe('JE-2026-000001');
    expect(() => env.db.prepare('UPDATE journal_lines SET debit_cents = 1').run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare(`UPDATE journals SET memo = 'x'`).run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare(`UPDATE journals SET sealed = 0`).run()).toThrow(/IMMUTABLE/);
    expect(() =>
      env.db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, debit_cents) VALUES (?, 9, ?, 1)`).run(j.journalId, cash('1101')),
    ).toThrow(/sealed/);
  });

  it('refuses unbalanced journals even when inserted by hand (L1)', () => {
    expect(() =>
      tx(env.db, () => {
        env.db.prepare(`INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, memo, created_at, created_by) VALUES ('j1','X1','2026-09-28','t','s','original','m','t',?)`).run(userId);
        env.db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, debit_cents) VALUES ('j1', 1, ?, 100)`).run(cash('1101'));
        env.db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, credit_cents) VALUES ('j1', 2, ?, 99)`).run(cash('1111'));
        env.db.prepare(`UPDATE journals SET sealed = 1 WHERE id = 'j1'`).run();
      }),
    ).toThrow(/UNBALANCED/);
    expect(() =>
      tx(env.db, () =>
        postJournal(env.db, { memo: 'bad', lines: [{ account: { cashPlace: cash('1101') }, debitCents: 100 }, { account: { cashPlace: cash('1111') }, creditCents: 99 }] }, ctx('b')),
      ),
    ).toThrow(/does not balance/);
  });

  it('blocks header accounts and requires parties on subledger accounts (L2, L3)', () => {
    const header = (env.db.prepare(`SELECT id FROM accounts WHERE code = '1100'`).get() as { id: number }).id;
    expect(() =>
      tx(env.db, () => postJournal(env.db, { memo: 'h', lines: [{ account: { accountId: header }, debitCents: 1 }, { account: { cashPlace: cash('1101') }, creditCents: 1 }] }, ctx('c'))),
    ).toThrow(/cannot be posted/);
    expect(() =>
      tx(env.db, () => postJournal(env.db, { memo: 'p', lines: [{ account: { role: 'AR_TRADE' }, debitCents: 1 }, { account: { cashPlace: cash('1101') }, creditCents: 1 }] }, ctx('d'))),
    ).toThrow(/needs a customer/);
  });

  it('reverses by mirroring the stored lines, netting to zero (L4)', () => {
    tx(env.db, () => {
      postJournal(env.db, { memo: 'x', lines: [{ account: { cashPlace: cash('1112') }, debitCents: 997_500 }, { account: { role: 'BANK_CHARGES' }, debitCents: 2_500 }, { account: { cashPlace: cash('1111') }, creditCents: 1_000_000 }] }, ctx('e'));
      reverseJournalOf(env.db, 'test', 'e', ctx('e'), 'undo');
    });
    expect(trialBalance(env.db).rows).toEqual([]);
    expect(() => tx(env.db, () => reverseJournalOf(env.db, 'test', 'e', ctx('e'), 'again'))).toThrow(/UNIQUE/);
  });

  it('keeps number series moving forward by one only (L7)', () => {
    env.db.prepare(`INSERT INTO number_series (series_key, prefix) VALUES ('T', 'T-')`).run();
    expect(() => env.db.prepare(`UPDATE number_series SET next_value = 5 WHERE series_key = 'T'`).run()).toThrow(/forward/);
  });

  it('hash-chains the audit log and detects tampering (L12)', () => {
    tx(env.db, () => {
      for (let i = 0; i < 3; i++) appendAudit(env.db, { at: 't', userId, action: 'x', entityType: 'y', data: { i } });
    });
    expect(verifyAuditChain(env.db)).toBeNull();
    expect(() => env.db.prepare(`UPDATE audit_log SET data = '{}'`).run()).toThrow(/append-only/);
    env.db.exec('DROP TRIGGER audit_log_no_update');
    env.db.prepare(`UPDATE audit_log SET data = '{"i":9}' WHERE seq = 2`).run();
    expect(verifyAuditChain(env.db)).toBe(2);
  });

  it('passes every invariant on a fresh database', () => {
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('document references on journal lines (ref_doc_id)', () => {
  const role = (key: string) => resolveAccount(env.db, { role: key }).id;
  const customer = { type: 'customer', id: 'cus-test-school' };
  /** A posted document to point at, e.g. a job order. */
  const doc = (id: string, status: 'posted' | 'cancelled' = 'posted') => {
    env.db
      .prepare(
        `INSERT INTO documents (id, doc_type, module, series_key, number, business_date, status, total_cents, summary, posted_at, posted_by)
         VALUES (?, 'test.doc', 'TEST', 'T', ?, '2026-09-28', ?, 0, 's', 't', ?)`,
      )
      .run(id, id, status, userId);
    return id;
  };
  /** Deposit received for a document: Dr cash / Cr customer deposits (party customer + document), like DEP-RCV. */
  const deposit = (cents: number, ref: string, on = '2026-09-28') => ({
    memo: 'deposit',
    lines: [
      { account: { cashPlace: cash('1101') }, debitCents: cents },
      { account: { role: 'CUSTOMER_DEPOSITS' }, party: customer, ref: { documentId: ref }, creditCents: cents },
    ],
    on,
  });
  const post = (id: string, d: ReturnType<typeof deposit>) => tx(env.db, () => postJournal(env.db, d, { ...ctx(id), businessDate: d.on }));
  const lines = (journalId: string) =>
    env.db.prepare('SELECT line_no, ref_doc_id, debit_cents, credit_cents FROM journal_lines WHERE journal_id = ? ORDER BY line_no').all(journalId);

  it('posts a line with a reference and reverses it with the same reference', () => {
    const jo = doc('jo-1');
    const orig = post('a', deposit(2_800_000, jo));
    expect(lines(orig.journalId)).toEqual([
      { line_no: 1, ref_doc_id: null, debit_cents: 2_800_000, credit_cents: 0 },
      { line_no: 2, ref_doc_id: jo, debit_cents: 0, credit_cents: 2_800_000 },
    ]);
    const rev = tx(env.db, () => reverseJournalOf(env.db, 'test', 'a', ctx('a'), 'undo'))!;
    expect(lines(rev.journalId)).toEqual([
      { line_no: 1, ref_doc_id: null, debit_cents: 0, credit_cents: 2_800_000 },
      { line_no: 2, ref_doc_id: jo, debit_cents: 2_800_000, credit_cents: 0 },
    ]);
    expect(accountBalance(env.db, role('CUSTOMER_DEPOSITS'), { refDocId: jo })).toBe(0);
    expect(() => env.db.prepare('UPDATE journal_lines SET ref_doc_id = NULL').run()).toThrow(/IMMUTABLE/);
    expect(() => post('b', deposit(100, 'no-such-document'))).toThrow(/FOREIGN KEY/);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('filters a balance by reference, alone or with a date and a party', () => {
    const [a, b] = [doc('jo-a'), doc('jo-b')];
    post('1', deposit(2_800_000, a));
    post('2', deposit(1_000_000, b));
    // Part of A's deposit is refunded the next day: Dr deposits (A) / Cr cash.
    tx(env.db, () =>
      postJournal(
        env.db,
        { memo: 'refund', lines: [{ account: { role: 'CUSTOMER_DEPOSITS' }, party: customer, ref: { documentId: a }, debitCents: 500_000 }, { account: { cashPlace: cash('1101') }, creditCents: 500_000 }] },
        { ...ctx('3'), businessDate: '2026-09-29' },
      ),
    );
    const deposits = role('CUSTOMER_DEPOSITS');
    expect(accountBalance(env.db, deposits)).toBe(-3_300_000);
    expect(accountBalance(env.db, deposits, { refDocId: a })).toBe(-2_300_000);
    expect(accountBalance(env.db, deposits, { refDocId: b })).toBe(-1_000_000);
    expect(accountBalance(env.db, deposits, { refDocId: a, asOf: '2026-09-28' })).toBe(-2_800_000);
    expect(accountBalance(env.db, deposits, { refDocId: a, party: customer })).toBe(-2_300_000);
    expect(accountBalance(env.db, deposits, { refDocId: a, party: { type: 'customer', id: 'someone-else' } })).toBe(0);
    // Cash lines carry no reference.
    expect(accountBalance(env.db, cash('1101'), { refDocId: a })).toBe(0);
    expect(accountBalance(env.db, cash('1101'))).toBe(3_300_000);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('L4 flags a cancelled document whose reversal moves money to another reference', () => {
    const [a, b, src] = [doc('jo-a'), doc('jo-b'), doc('dep-1')];
    const orig = tx(env.db, () => postJournal(env.db, deposit(1_000, a), { ...ctx(src), sourceType: 'document' }));
    // A hand-made "reversal" that mirrors the amounts but not the reference; posting code never does this.
    tx(env.db, () => {
      env.db
        .prepare(
          `INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, reverses_journal_id, memo, created_at, created_by)
           VALUES ('bad-rev', 'X-1', '2026-09-28', 'document', ?, 'reversal', ?, 'bad', 't', ?)`,
        )
        .run(src, orig.journalId, userId);
      const ins = env.db.prepare('INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, ref_doc_id, debit_cents, credit_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      ins.run('bad-rev', 1, cash('1101'), null, null, null, 0, 1_000);
      ins.run('bad-rev', 2, role('CUSTOMER_DEPOSITS'), customer.type, customer.id, b, 1_000, 0);
      env.db.prepare(`UPDATE journals SET sealed = 1 WHERE id = 'bad-rev'`).run();
      env.db.prepare(`UPDATE documents SET status = 'cancelled', cancelled_at = 't', cancelled_by = ?, cancel_reason = 'made-up test cancel' WHERE id = ?`).run(userId, src);
    });
    expect(runInvariants(env.db).find((r) => r.id === 'L4')!.problems).toEqual([`Cancelled document ${src} does not net to zero`, `Cancelled document ${src} does not net to zero`]);
  });
});
