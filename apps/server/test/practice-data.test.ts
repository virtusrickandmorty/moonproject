import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createPracticeData } from '../src/platform/practice/data.ts';
import { runInvariants } from '../src/engine/ledger/invariants.ts';

describe('practice data', () => {
  it('posts five shop days through the API, with no failed documents or broken invariants', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moon-practice-'));
    const file = join(dir, 'practice.db');
    try {
      // Any API preview or post error throws, so reaching the summary proves
      // that every attempted document completed successfully.
      const summary = await createPracticeData(file, 5);
      const db = new Database(file, { readonly: true });
      try {
        expect(runInvariants(db).filter((result) => !result.ok)).toEqual([]);
        expect(db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status <> 'posted'`).get()).toEqual({ n: 0 });
        for (const type of ['quo.quotation', 'jo.job_order', 'prd.entry', 'jo.release',
          'jo.invoice_record', 'qs.sale', 'ap.bill', 'ap.payment', 'exp.voucher',
          'cash.transfer', 'cash.count']) expect(summary.documents[type]).toBe(5);
        expect(summary.documents['col.collection']).toBe(15);
        expect(summary.documents['pay.run']).toBe(1); // first weekly cutoff
        expect(summary.documents['pay.release']).toBe(1);
        expect(Object.keys(summary.passwords).sort()).toEqual(['accountant', 'encoder', 'owner', 'production']);
        await expect(createPracticeData(file, 1)).rejects.toThrow(/not empty/);
      } finally {
        db.close();
      }
    } finally {
      await rm(file, { force: true });
      await rm(`${file}-wal`, { force: true });
      await rm(`${file}-shm`, { force: true });
      await rmdir(dir);
    }
  }, 120_000);

  it('starts on a month end: the payroll the till cannot pay yet waits for its release instead of the count going negative', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moon-practice-'));
    const file = join(dir, 'practice.db');
    try {
      const summary = await createPracticeData(file, 2, '2026-08-31'); // what a practice shop made on 30 September starts on
      expect(summary.documents['pay.run']).toBe(1); // 16 to 31 August, on the first day
      expect(summary.documents['pay.release']).toBeUndefined();
      expect(summary.documents['cash.count']).toBe(2);
    } finally {
      await rm(file, { force: true });
      await rm(`${file}-wal`, { force: true });
      await rm(`${file}-shm`, { force: true });
      await rmdir(dir);
    }
  }, 120_000);
});
