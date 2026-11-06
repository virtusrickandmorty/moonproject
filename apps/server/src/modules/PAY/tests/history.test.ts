/** An employee's payroll history (the owner's request, Nov 2026): the same figures as the payroll and the release. Made-up people. */
import { expect, it } from 'vitest';
import { cashPlaceId, createUser, login, PASSWORD } from '../../../../test/helpers.ts';
import { releaseDoc, releaseStatus } from '../doctypes/release.ts';
import { runDoc } from '../doctypes/run.ts';
import { thirteenthDoc } from '../doctypes/thirteenth.ts';
import { payHistory } from '../history.ts';
import { periodEndOf } from '../run-calc.ts';
import { world } from './world.ts';

const DAYS = ['16', '17', '18', '19', '21', '22', '23', '24'];
async function shop() {
  const w = await world('2026-09-30');
  const ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  const ben = w.person('Ben Uy', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  w.attend(DAYS.flatMap((d) => [ana, ben].map((employeeId) => ({ employeeId, date: `2026-09-${d}`, status: 'present' }))));
  const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' });
  return { w, ana, ben, run, cash: cashPlaceId(w.db, '1101') };
}

it('shows each payroll with the figures of the payroll and the release, and the parts paid', async () => {
  const { w, ana, run, cash } = await shop();
  const slip = runDoc.load(w.db, run.id).employees.find((e) => e.employeeId === ana)!;
  const net = releaseStatus(w.db, run.id).find((s) => s.employeeId === ana)!.netCents;
  expect(payHistory(w.db, ana, true)).toMatchObject([{ id: run.id, kind: 'run', number: run.number, periodStart: '2026-09-16', periodEnd: '2026-09-30', grossCents: slip.grossCents, netCents: net, paidCents: 0, leftCents: net, releases: [] }]);
  const first = w.record(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: 100_000 }], amounts: [{ employeeId: ana, amountCents: 100_000 }] });
  expect(payHistory(w.db, ana, true)[0]).toMatchObject({ paidCents: 100_000, leftCents: net - 100_000, releases: [{ id: first.id, number: first.number, amountCents: 100_000 }] });
  const last = w.record(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: net - 100_000 }] });
  const row = payHistory(w.db, ana, true)[0]!;
  expect(row).toMatchObject({ paidCents: net, leftCents: 0 });
  expect(row.releases.map((r) => r.number).sort()).toEqual([first.number, last.number].sort());
});

it('leaves out a cancelled release, and a cancelled payroll', async () => {
  const { w, ana, run, cash } = await shop();
  const net = releaseStatus(w.db, run.id).find((s) => s.employeeId === ana)!.netCents;
  const paid = w.record(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: net }] });
  w.cancel(releaseDoc, paid.id);
  expect(payHistory(w.db, ana, true)[0]).toMatchObject({ paidCents: 0, leftCents: net, releases: [] });
  w.cancel(runDoc, run.id);
  expect(payHistory(w.db, ana, true)).toEqual([]);
});

it("shows only that employee's pay, and nothing for one on no payroll", async () => {
  const { w, ana, ben, cash, run } = await shop();
  const net = releaseStatus(w.db, run.id).find((s) => s.employeeId === ana)!.netCents;
  w.record(releaseDoc, { runId: run.id, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: net }] });
  expect(payHistory(w.db, ben, true)).toMatchObject([{ paidCents: 0, releases: [] }]);
  expect(payHistory(w.db, w.person('Cora Lim', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 }), true)).toEqual([]);
});

it('lists 13th-month pay and its release for those who may see it, newest first', async () => {
  const w = await world('2026-01-15');
  const carla = w.person('Carla Opisina', { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: 1_500_000 }, { costCentre: 'office' });
  const cash = cashPlaceId(w.db, '1101');
  for (const start of ['2026-11-01', '2026-11-16', '2026-12-01']) {
    w.at(periodEndOf('SEMI_MONTHLY', start)!);
    w.record(runDoc, { payGroup: 'SEMI_MONTHLY', periodStart: start });
  }
  w.at('2026-12-20');
  const th = w.record(thirteenthDoc, { payGroup: 'SEMI_MONTHLY', year: 2026 });
  const due = releaseStatus(w.db, th.id).find((s) => s.employeeId === carla)!.netCents;
  const paid = w.record(releaseDoc, { runId: th.id, employeeIds: [carla], tenders: [{ cashPlaceId: cash, amountCents: due }] });
  const rows = payHistory(w.db, carla, true);
  expect(rows[0]).toMatchObject({ id: th.id, kind: 'thirteenth', number: th.number, periodEnd: '2026-12-31', netCents: due, paidCents: due, leftCents: 0, releases: [{ id: paid.id, amountCents: due }] });
  expect(rows.map((r) => r.periodEnd)).toEqual(['2026-12-31', '2026-12-15', '2026-11-30', '2026-11-15']);
  expect(payHistory(w.db, carla, false).map((r) => r.kind)).toEqual(['run', 'run', 'run']);
});

it('is for those who may see payrolls', async () => {
  const { w, ana, run } = await shop();
  const owner = await w.env.as('owner');
  const r = await owner.get(`/api/pay/employees/${ana}/history`);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().rows).toMatchObject([{ id: run.id }]);
  expect((await (await w.env.as('encoder')).get(`/api/pay/employees/${ana}/history`)).statusCode).toBe(403);
  createUser(w.db, 'ana.floor', ['worker']);
  expect((await (await login(w.env.app, 'ana.floor', PASSWORD)).get(`/api/pay/employees/${ana}/history`)).statusCode).toBe(403);
});
