/** A piece line of a payroll says what it was for: the job order item and the wearers ticked (the owner's request, Nov 2026). Made-up people only. */
import { describe, expect, it } from 'vitest';
import { createUser, login, PASSWORD } from '../../../../test/helpers.ts';
import { tx } from '../../../platform/db/driver.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';
import { runDoc } from '../doctypes/run.ts';
import { world } from './world.ts';

const SEWING = 6;
const wearer = (name: string, size: string, qty = 1) => ({ name, sizeMode: 'preset' as const, size, qty });

async function shop() {
  const w = await world('2026-09-22');
  const worker = w.person('Eli Tahi', { payType: 'piece', payGroup: 'WEEKLY_PIECE' });
  const cs = seedCustomers(w.db, w.userId);
  const line = (description: string, qty: number, roster: ReturnType<typeof wearer>[]) => ({ kind: 'made_to_order' as const, description, qty, unitPriceCents: 30_000, discountCents: 0, roster });
  const jo = w.record(jobOrderDoc, { customerId: cs.school, dueInDays: 20, priority: 'normal', paymentTerms: 'full',
    lines: [line('Made-up team shirt', 3, [wearer('Ana Reyes', 'M'), wearer('Ben Cruz', 'L', 2)]), line('Made-up cap', 4, [])] }).id;
  for (const n of [1, 2]) tx(w.db, () => setupLine(w.db, jo, n, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: 'standard' }, w.who()));
  const over = 'Cut earlier by the old shop (made up)';
  w.record(entryDoc, { jobOrderId: jo, stepId: SEWING, overCapReason: over, rows: [{ lineNo: 1, employeeId: worker, pieces: 3, wearers: [1, 2] }, { lineNo: 2, employeeId: worker, pieces: 4 }] });
  w.at('2026-09-26');
  return { ...w, worker };
}
const input = { payGroup: 'WEEKLY_PIECE', periodStart: '2026-09-21' } as const;
const made = { step: 'Sewing', workDate: '2026-09-22', rowKind: 'work' };
const expected = [
  { ...made, item: 'Made-up team shirt', wearers: [{ name: 'Ana Reyes', size: 'M', pieces: 1 }, { name: 'Ben Cruz', size: 'L', pieces: 2 }] },
  { ...made, item: 'Made-up cap', wearers: [] },
];
type Lines = { employees: { lines: { kind: string; work?: unknown; description: string }[] }[] };
const works = (doc: Lines) => doc.employees[0]!.lines.filter((l) => l.kind === 'piece').map((l) => l.work);

describe('the earnings of a payroll', () => {
  it('name the item and the wearers on a piece line, before recording and once recorded', async () => {
    const w = await shop();
    expect(works(w.preview(runDoc, input).doc as unknown as Lines)).toMatchObject(expected);
    const run = w.record(runDoc, input);
    const owner = await w.env.as('owner');
    const stored = (await owner.get(`/api/docs/pay.run/${run.id}`)).json();
    expect(works((stored.doc ?? stored) as Lines)).toMatchObject(expected);
  });

  it('show the worker the same breakdown on their own payslip', async () => {
    const w = await shop();
    w.record(runDoc, input);
    const owner = await w.env.as('owner');
    expect((await owner.put(`/api/emp/employees/${w.worker}/floor-user`, { userId: createUser(w.db, 'eli.floor', ['worker']) })).statusCode).toBe(200);
    const app = await login(w.env.app, 'eli.floor', PASSWORD);
    const slip = (await app.get('/api/pay/my-payslips')).json().payslips[0] as { earnings: { kind: string; work?: unknown }[] };
    expect(slip.earnings.filter((l) => l.kind === 'piece').map((l) => l.work)).toMatchObject(expected);
  });

  it('leave what is stored on the run as it was', async () => {
    const w = await shop();
    const run = w.record(runDoc, input);
    const lines = w.db.prepare(`SELECT l.description FROM pay_run_lines l JOIN pay_run_employees e ON e.id = l.run_employee_id WHERE e.document_id = ? AND l.kind = 'piece' ORDER BY l.line_no`).pluck().all(run.id) as string[];
    expect(lines).toHaveLength(2);
    for (const d of lines) expect(d).toMatch(/^JO-\d+ \S+ 2026-09-22, \d+ pcs$/);
    expect(runDoc.load(w.db, run.id).employees[0]!.lines.some((l) => 'work' in l)).toBe(false);
  });
});
