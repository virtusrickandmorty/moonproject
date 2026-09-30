import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPerfData } from '../src/platform/practice/perf-data.ts';

/** The three-year build (npm run perf-data) at a size a test can afford: same recipe, a few weeks. */
const SMALL = { days: 34, customers: 14, jobOrders: 40, employees: 5 };

describe('perf data', () => {
  it('builds the same database from the same seed, and a different one from another', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moon-perf-'));
    try {
      const a = await createPerfData(join(dir, 'a.db'), { ...SMALL, seed: 7 });
      const b = await createPerfData(join(dir, 'b.db'), { ...SMALL, seed: 7 });
      const c = await createPerfData(join(dir, 'c.db'), { ...SMALL, seed: 8 });
      expect(b.fingerprint).toBe(a.fingerprint);
      expect(b.documents).toEqual(a.documents);
      expect(c.fingerprint).not.toBe(a.fingerprint);
      // The sizes asked for are the sizes built, every job order released and invoiced (or still on its way), payroll twice a month.
      expect(a.customers).toBe(SMALL.customers);
      expect(a.employees).toBe(SMALL.employees);
      expect(a.documents['jo.job_order']).toBe(SMALL.jobOrders);
      expect(a.documents['col.collection']).toBeGreaterThanOrEqual(SMALL.jobOrders);
      expect(a.documents['jo.release']).toBe(a.documents['jo.invoice_record']);
      expect(a.documents['pay.run']).toBe(2); // the 15th and the month end
      expect(a.documents['cash.count']).toBe(1);
      await expect(createPerfData(join(dir, 'a.db'), SMALL)).rejects.toThrow(/not empty/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
