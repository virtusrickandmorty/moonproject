/**
 * A worker's own payslips on the floor app (the owner's request, Nov 2026): the net pay of each recorded run with its
 * breakdown, and whether it was released; their own only.
 */
import { expect, it } from 'vitest';
import { cashPlaceId, createUser, login, PASSWORD } from '../../../../test/helpers.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { runDoc } from '../doctypes/run.ts';
import { world } from './world.ts';

it("shows a worker their own net pay and its breakdown, paid or not, and nobody else's", async () => {
  const w = await world('2026-09-30');
  const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  const ben = w.person('Ben Uy', { payType: 'daily', payGroup: 'WEEKLY_DAILY', dailyRateCents: 60_000 });
  w.attend(['16', '17', '18', '19', '21', '22', '23', '24'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' })));
  const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16', deductions: [{ employeeId: ana, goesTo: 'other_income', amountCents: 35_000, reason: 'Two company polo shirts' }] });
  const slip = runDoc.load(w.db, run.id).employees[0]!;

  // Each worker's own sign-in, linked to their employee record.
  const owner = await w.env.as('owner');
  for (const [username, id] of [['ana.floor', ana], ['ben.floor', ben]] as const) {
    expect((await owner.put(`/api/emp/employees/${id}/floor-user`, { userId: createUser(w.db, username, ['worker']) })).statusCode).toBe(200);
  }
  const anaApp = await login(w.env.app, 'ana.floor', PASSWORD);
  const mine = (await anaApp.get('/api/pay/my-payslips')).json().payslips;
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ runId: run.id, periodStart: '2026-09-16', periodEnd: '2026-09-30', grossCents: slip.grossCents, netCents: slip.netCents, released: false });
  expect(mine[0].earnings).toMatchObject(slip.lines.map((l) => ({ lineNo: l.lineNo, kind: l.kind, description: l.description, qty: l.qty, rateCents: l.rateCents, amountCents: l.amountCents })));
  expect(mine[0].deductions).toContainEqual({ what: 'Two company polo shirts', amountCents: 35_000 });
  // Gross less every deduction is the net pay.
  expect(mine[0].grossCents - mine[0].deductions.reduce((n: number, d: { amountCents: number }) => n + d.amountCents, 0) + mine[0].refundCents).toBe(mine[0].netCents);

  // Released: paid.
  w.record(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cashPlaceId(w.db, '1111'), amountCents: slip.netCents }] });
  expect((await anaApp.get('/api/pay/my-payslips')).json().payslips[0]).toMatchObject({ released: true });

  // Ben is on no run: nothing, and never Ana's. A sign-in not linked to anyone is told so; the office roles have no floor payslips.
  expect((await (await login(w.env.app, 'ben.floor', PASSWORD)).get('/api/pay/my-payslips')).json()).toEqual({ payslips: [] });
  createUser(w.db, 'new.floor', ['worker']);
  expect((await (await login(w.env.app, 'new.floor', PASSWORD)).get('/api/pay/my-payslips')).json()).toMatchObject({ code: 'FLOOR_NOT_LINKED' });
  expect((await (await w.env.as('encoder')).get('/api/pay/my-payslips')).statusCode).toBe(403);
});
