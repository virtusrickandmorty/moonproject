import { describe, expect, it, beforeEach } from 'vitest';
import { createTestEnv, createUser, type TestEnv } from './helpers.ts';
import { tx } from '../src/platform/db/driver.ts';
import { postJournal, reverseJournalOf } from '../src/engine/ledger/post.ts';
import { appendAudit, verifyAuditChain } from '../src/engine/audit.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { trialBalance } from '../src/engine/ledger/queries.ts';

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
