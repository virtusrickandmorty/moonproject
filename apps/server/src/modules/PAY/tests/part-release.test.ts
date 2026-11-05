/**
 * Paying someone's net pay part by part (the owner's request, Nov 2026): the rest stays owed until released, never more than
 * what is left, and a cancelled part is owed again. Made-up people only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { releaseDoc, releaseStatus } from '../doctypes/release.ts';
import { runDoc } from '../doctypes/run.ts';
import { payToRelease, payrollReleasesAfter } from '../public.ts';
import { codes, fails, journal, partyBalance, world } from './world.ts';

let w: Awaited<ReturnType<typeof world>>, ana: string, ben: string, runId: string, cash: number, net: number;
beforeEach(async () => {
  w = await world('2026-09-30');
  ana = w.person('Ana Tahi', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  ben = w.person('Ben Uy', { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });
  w.attend(['16', '17', '18', '19', '21', '22', '23', '24'].flatMap((d) => [ana, ben].map((employeeId) => ({ employeeId, date: `2026-09-${d}`, status: 'present' }))));
  runId = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' }).id;
  cash = cashPlaceId(w.db, '1101');
  net = releaseStatus(w.db, runId)[0]!.netCents;
});
const of = (id: string) => releaseStatus(w.db, runId).find((s) => s.employeeId === id)!;
const part = (amountCents: number) => ({ runId, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents }], amounts: [{ employeeId: ana, amountCents }] });
const pay = (amountCents: number) => w.record(releaseDoc, part(amountCents));
const refused = (input: ReturnType<typeof part>) => codes(w.preview(releaseDoc, input).issues);

describe('releasing part of the pay', () => {
  it('leaves the rest owed, on the list, until the last part; the books follow each part', async () => {
    const first = pay(100_000);
    expect(of(ana)).toMatchObject({ paidCents: 100_000, leftCents: net - 100_000, releasedBy: null });
    expect(journal(w.env, first.id)).toEqual(['1101 Cr 1,000.00', '2110 Dr 1,000.00']);
    expect(partyBalance(w.env, '2110', ana)).toBe(-(net - 100_000));
    expect(payToRelease(w.db)).toMatchObject([{ id: runId, people: 2, dueCents: 2 * net - 100_000 }]);

    const last = w.record(releaseDoc, { runId, employeeIds: [ana], tenders: [{ cashPlaceId: cash, amountCents: net - 100_000 }] }); // what is left, unnamed
    expect(of(ana)).toMatchObject({ paidCents: net, leftCents: 0 });
    expect(of(ana).releasedBy).toContain(first.number);
    expect(of(ana).releasedBy).toContain(last.number);
    expect(partyBalance(w.env, '2110', ana)).toBe(0);
    expect(payToRelease(w.db)).toMatchObject([{ people: 1, dueCents: net }]); // Ben only
  });

  it('never pays more than what is left, and not at all once paid', async () => {
    pay(100_000);
    expect(refused(part(net))).toEqual(['MORE_THAN_LEFT']);
    pay(net - 100_000);
    expect(refused(part(1_000))).toContain('RELEASED');
  });

  it('must name someone ticked, once, and the money must match the part', async () => {
    expect(refused({ ...part(net), amounts: [{ employeeId: ben, amountCents: 1_000 }] })).toEqual(['PART_NOT_PICKED']);
    expect(refused({ ...part(net), amounts: [{ employeeId: ana, amountCents: 1_000 }] })).toEqual(['TENDERS']);
  });

  it('owes a cancelled part again, and the run waits until every part is cancelled', async () => {
    const first = pay(100_000);
    const second = pay(50_000);
    fails(() => w.cancel(runDoc, runId), 'HAS_DEPENDENTS');
    w.cancel(releaseDoc, first.id);
    expect(of(ana)).toMatchObject({ paidCents: 50_000, leftCents: net - 50_000 });
    fails(() => w.cancel(runDoc, runId), 'HAS_DEPENDENTS');
    w.cancel(releaseDoc, second.id);
    w.cancel(runDoc, runId);
  });

  it('keeps a part as typed when stored, and a full release as before', async () => {
    const part = pay(100_000);
    expect(releaseDoc.toInput(releaseDoc.load(w.db, part.id)).amounts).toEqual([{ employeeId: ana, amountCents: 100_000 }]);
    const full = w.record(releaseDoc, { runId, employeeIds: [ben], tenders: [{ cashPlaceId: cash, amountCents: net }] });
    expect(releaseDoc.toInput(releaseDoc.load(w.db, full.id))).not.toHaveProperty('amounts');
  });

  it('sends the payslip with the first part only', async () => {
    pay(100_000);
    pay(50_000);
    const sent = payrollReleasesAfter(w.db, 0, 10).items.map((r) => r.employeeIds);
    expect(sent).toEqual([[ana], []]);
  });
});
