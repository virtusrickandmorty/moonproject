/**
 * Negative tests of PLAN I3 that had no test on main: N-01 (two users at the same instant), N-14 (no discount on a
 * collection), N-15 end to end (a newer backup is refused) and the strict-schema tripwire behind N-03. The other rows are mapped in docs/review/negative-tests.md.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { cashPlaceId, createTestEnv, idem, type Client, type TestEnv } from './helpers.ts';
import { openDb } from '../src/platform/db/driver.ts';
import { prepareDatabase } from '../src/app.ts';
import { fixedClock } from '../src/platform/clock.ts';
import { loadModules } from '../src/modules/load.ts';
import { openBackup } from '../src/modules/BAK/restore.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';
import { seedCustomers } from '../src/modules/JO/tests/cus-fixture.ts';
import { joLedger } from '../src/modules/JO/public.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;
let school: string;
let CASH: number;

beforeEach(async () => {
  env = await createTestEnv();
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
  school = seedCustomers(env.db, encoder.userId).school;
  CASH = cashPlaceId(env.db, '1101');
});

const COL = '/api/docs/col.collection';
const collect = (input: object, total: number, who = encoder, key = idem()) => who.post(`${COL}/post`, { input, expectedTotalCents: total }, key);

async function jobOrder(totalCents: number): Promise<string> {
  const lines = [{ kind: 'made_to_order', description: 'Team jersey set', qty: 1, unitPriceCents: totalCents, discountCents: 0, roster: [] }];
  const r = await encoder.post('/api/docs/jo.job_order/post', { input: { customerId: school, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', lines }, expectedTotalCents: totalCents }, idem());
  expect(r.statusCode).toBe(200);
  return r.json().id;
}

const pay = (jo: string, cents: number, crNumber: string) => ({
  customerId: school,
  crNumber,
  applications: [{ jobOrderId: jo, amountCents: cents }],
  tenders: [{ cashPlaceId: CASH, amountCents: cents }],
});

describe('N-01: two users record collections at the same instant', () => {
  it('gives two consecutive numbers, no gap and no duplicate', async () => {
    const [a, b] = [await jobOrder(1_000_000), await jobOrder(1_000_000)];
    const [x, y] = await Promise.all([collect(pay(a, 100_000, '0401'), 100_000, encoder), collect(pay(b, 200_000, '0402'), 200_000, accountant)]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    const numbers = [x.json().number, y.json().number].sort();
    expect(numbers).toEqual(['COL-000001', 'COL-000002']);
    const stored = env.db.prepare(`SELECT number FROM documents WHERE doc_type = 'col.collection' ORDER BY number`).pluck().all();
    expect(stored).toEqual(numbers);
    expect(env.db.prepare(`SELECT next_value FROM number_series WHERE series_key = 'COL'`).pluck().get()).toBe(3);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });

  it('a refused request in the middle leaves no hole in the numbers', async () => {
    const [a, b] = [await jobOrder(1_000_000), await jobOrder(1_000_000)];
    const results = await Promise.all([collect(pay(a, 100_000, '0411'), 100_000), collect({ ...pay(a, 1_000, '0412'), date: '2026-01-01' }, 1_000, accountant), collect(pay(b, 100_000, '0413'), 100_000, accountant)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 400, 200]);
    expect(results.filter((r) => r.statusCode === 200).map((r) => r.json().number).sort()).toEqual(['COL-000001', 'COL-000002']);
    expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
  });
});

describe('N-14: a collection cannot clear a receivable with a "discount"', () => {
  it('has no field for one: every discount-like field is refused, and nothing is recorded', async () => {
    const jo = await jobOrder(1_000_000);
    for (const extra of [{ discountCents: 100_000 }, { discount: 100_000 }, { allowanceCents: 100_000 }, { writeOffCents: 100_000 }, { adjustmentCents: 100_000 }, { shortOverCents: 100_000 }]) {
      const res = await collect({ ...pay(jo, 900_000, '0421'), ...extra }, 900_000);
      expect([res.statusCode, res.json().code], JSON.stringify(extra)).toEqual([400, 'INVALID_INPUT']);
    }
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type = 'col.collection'`).pluck().get()).toBe(0);
  });

  it('a smaller tender does not clear the receivable; the only allowance is the ₱1.00 rounding of D4.9', async () => {
    const jo = await jobOrder(1_000_000);
    const short = { ...pay(jo, 1_000_000, '0422'), tenders: [{ cashPlaceId: CASH, amountCents: 900_000 }] };
    const refused = await collect(short, 900_000);
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    // Even asking to settle the difference: only up to ₱1.00 may go to cash short and over.
    const settle = await collect({ ...short, settleSmallDifference: true }, 900_000);
    expect(settle.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(settle.json())).toContain('DIFFERENCE_TOO_BIG');
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type = 'col.collection'`).pluck().get()).toBe(0);
    expect(joLedger(env.db, jo)).toEqual({ receivableCents: 0, depositsHeldCents: 0 });
  });

  it('a later discount needs a credit memo, which only the accountant may record', async () => {
    const memo = { customerName: 'Sample', reason: 'Late delivery allowance (made up)' };
    for (const role of ['encoder', 'production', 'tv'] as const) {
      const who = await env.as(role);
      expect((await who.post('/api/docs/col.credit_memo/post', { input: memo, expectedTotalCents: 100 }, idem())).json(), role).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'col.credit_memo' } });
      expect((await who.post('/api/docs/col.write_off/post', { input: memo, expectedTotalCents: 100 }, idem())).json(), role).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'col.write_off' } });
    }
    expect((await accountant.post('/api/docs/col.credit_memo/preview', { input: memo })).json().code).not.toBe('FORBIDDEN');
  });
});

describe('N-15: restore of a backup made by a newer version', () => {
  it('is refused with a plain message, and nothing is left staged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'moonproject-n15-'));
    try {
      // A real, migrated database that also carries a migration this version has never heard of.
      const copyFile = join(dir, 'copy.db');
      const copy = openDb(copyFile);
      prepareDatabase(copy, fixedClock('2026-09-28T02:00:00Z'), await loadModules());
      copy.prepare(`INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ('TAX/9999_from_a_newer_version.sql', 'x', '2026-09-28T10:00:00.000+08:00')`).run();
      copy.pragma('wal_checkpoint(TRUNCATE)');
      copy.close();
      const identity = await generateX25519Identity();
      const encrypter = new Encrypter();
      encrypter.addRecipient(await identityToRecipient(identity));
      const backup = join(dir, 'moonproject-2026-09-28T10-00-00-snapshot.db.gz.age');
      writeFileSync(backup, await encrypter.encrypt(gzipSync(readFileSync(copyFile))));

      const mine = env.db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all() as { id: string; checksum: string }[];
      const staged = join(dir, 'staged', 'copy.db');
      const refusal = await openBackup(backup, identity, staged, mine, () => undefined).catch((e: unknown) => e as { code: string; status: number; message: string; details: unknown });
      expect(refusal).toMatchObject({
        code: 'NEWER_VERSION',
        status: 409,
        message: 'This backup was made by a newer version of Virtus. Update Virtus on this PC first, then restore it.',
        details: { newer: ['TAX/9999_from_a_newer_version.sql'] },
      });
      expect(existsSync(staged)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('strict schemas behind N-03: the client never sends a date, number, total, status, user or VAT figure', () => {
  const ROOT = join(import.meta.dirname, '../src');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? sources(p) : /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
    });

  /** Path-parameter and query schemas only: they carry an id or a filter, never a document. */
  const NOT_A_BODY = [/^z\.object\(\{ id: z\.string\(\) \}\)$/, /^z\.object\(\{ supplierId: z\.string\(\), id: z\.string\(\) \}\)$/, /^z\.object\(\{ status: z\.enum\(\['active', 'inactive', 'all'\]\)\.default\('active'\) \}\)$/, /^z\.object\(\{ status: z\.enum\(\['queued', 'sent', 'failed'\]\)/];

  it('every z.object in server code is .strict(), except the path and query schemas listed here', () => {
    const loose: string[] = [];
    for (const file of sources(ROOT)) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText() === 'z.object') {
          // Walk up the chain of `.something(...)` calls to see whether one of them is .strict().
          let strict = false;
          let up: ts.Node = node;
          while (ts.isPropertyAccessExpression(up.parent) && ts.isCallExpression(up.parent.parent)) {
            if (up.parent.name.text === 'strict') strict = true;
            up = up.parent.parent;
          }
          const text = node.getText().replace(/\s+/g, ' ');
          if (!strict && !NOT_A_BODY.some((re) => re.test(text))) loose.push(`${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(loose).toEqual([]);
  });
});
