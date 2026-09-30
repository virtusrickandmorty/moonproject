/**
 * The bulk reads that lists of thousands use (JO's joMoneyAll, stagesAll, leftPiecesAll) give exactly what asking about each job
 * order in turn gives (joMoney, currentStage, lineState): over the month in the life, which has cancels, deposits in every VAT
 * mode, credit memos and partly released orders, and over a stretch of the three-years data.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMonth } from '../../../tools/month-scenario.ts';
import { openDb, type Db } from '../src/platform/db/driver.ts';
import { createPerfData } from '../src/platform/practice/perf-data.ts';
import { currentStage, joMoney, joMoneyAll, leftPiecesAll, lineState, stagesAll } from '../src/modules/JO/public.ts';

function same(db: Db) {
  const money = joMoneyAll(db);
  const stages = stagesAll(db);
  const left = leftPiecesAll(db);
  const ids = db.prepare('SELECT document_id FROM jo_orders').pluck().all() as string[];
  expect(ids.length).toBeGreaterThan(0);
  expect(money.size).toBe(ids.length);
  for (const id of ids) {
    expect(money.get(id), id).toEqual(joMoney(db, id));
    const stage = currentStage(db, id);
    if (stage !== 'cancelled') expect(stages.get(id) ?? 'open', id).toBe(stage);
    expect(left.get(id) ?? 0, id).toBe(lineState(db, id).reduce((n, l) => n + l.qty - l.releasedQty, 0));
  }
}

describe('bulk reads agree with the one-order reads', () => {
  it('over the month in the life', async () => {
    const month = await runMonth();
    same(month.env.db);
  }, 120_000);

  it('over the perf data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moon-bulk-'));
    try {
      await createPerfData(join(dir, 'p.db'), { days: 30, customers: 10, jobOrders: 40, employees: 4, seed: 3 });
      const db = openDb(join(dir, 'p.db'));
      try { same(db); } finally { db.close(); }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
