/** The run screen lists piece work done after the payroll's cut-off and not paid yet (the owner's request, Nov 2026). Made-up people only. */
import { describe, expect, it } from 'vitest';
import { tx } from '../../../platform/db/driver.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';
import { runDoc } from '../doctypes/run.ts';
import { world } from './world.ts';

const SEWING = 6;
const week = { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-21' } as const; // Monday Sep 21 to Saturday Sep 26
const url = `/api/pay/after-cutoff?payGroup=${week.payGroup}&periodStart=${week.periodStart}`;

async function shop() {
  const w = await world('2026-09-22');
  const worker = w.person('Eli Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
  w.person('Ida Lumen', { payType: 'piece', payGroup: 'WEEKLY_PIECE' }); // nothing after the cut-off
  const daily = w.person('Rio Dalan', { payType: 'daily', payGroup: 'WEEKLY_PIECE', dailyRateCents: 69_500 }); // pieces, but paid by the day
  const cs = seedCustomers(w.db, w.userId);
  const jo = w.record(jobOrderDoc, { customerId: cs.school, dueInDays: 20, priority: 'normal', paymentTerms: 'full',
    lines: [{ kind: 'made_to_order' as const, description: 'Made-up cap', qty: 10, unitPriceCents: 30_000, discountCents: 0, roster: [] }] }).id;
  tx(w.db, () => setupLine(w.db, jo, 1, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: 'standard' }, w.who()));
  const over = 'Cut earlier by the old shop (made up)';
  w.record(entryDoc, { jobOrderId: jo, stepId: SEWING, overCapReason: over, rows: [{ lineNo: 1, employeeId: worker, pieces: 3 }] }); // Sep 22, in the week
  w.at('2026-09-28');
  w.record(entryDoc, { jobOrderId: jo, stepId: SEWING, overCapReason: over, rows: [{ lineNo: 1, employeeId: worker, pieces: 4 }, { lineNo: 1, employeeId: daily, pieces: 2 }] }); // Sep 28, after it
  return { ...w, worker };
}
type Answer = { periodEnd: string; employees: { name: string; totalCents: number; lines: { qty: number; amountCents: number; work: { item: string; workDate: string } | null }[] }[] };

describe('piece work after the cut-off', () => {
  it('is listed per worker paid by the piece, with its item and day, and is not in the payroll', async () => {
    const w = await shop();
    const owner = await w.env.as('owner');
    const res = await owner.get(url);
    expect(res.statusCode).toBe(200);
    const a = res.json() as Answer;
    expect(a.periodEnd).toBe('2026-09-26');
    expect(a.employees).toHaveLength(1);
    const [eli] = a.employees;
    expect(eli).toMatchObject({ name: 'Eli Tahi', lines: [{ qty: 4, work: { item: 'Made-up cap', workDate: '2026-09-28' } }] });
    expect(eli!.totalCents).toBe(eli!.lines[0]!.amountCents);
    expect(eli!.totalCents).toBeGreaterThan(0);
    const pieces = (w.preview(runDoc, week).doc as unknown as { employees: { lines: { kind: string; qty: number }[] }[] }).employees.flatMap((e) => e.lines).filter((l) => l.kind === 'piece');
    expect(pieces.map((l) => l.qty)).toEqual([3]);
  });

  it('is gone once a later payroll pays it', async () => {
    const w = await shop();
    w.at('2026-10-05');
    w.record(runDoc, week);
    w.record(runDoc, { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-28' });
    const owner = await w.env.as('owner');
    expect(((await owner.get(url)).json() as Answer).employees).toEqual([]);
  });

  it('turns down a day that does not start a period, and needs the right to make payrolls', async () => {
    const w = await shop();
    const owner = await w.env.as('owner');
    expect((await owner.get(`/api/pay/after-cutoff?payGroup=WEEKLY_PIECE&periodStart=2026-09-23`)).statusCode).toBe(400);
    const worker = await w.env.as('worker');
    expect((await worker.get(url)).statusCode).toBe(403);
  });
});
