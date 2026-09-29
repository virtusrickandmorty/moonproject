/**
 * Cash advance given (CA-, PLAN D5 CA-GIVE): Dr 1210 (the employee) / Cr Cash X, and its cancel (D6 "Transfer, owner
 * money, ... Always / Mirror"): the mirror dated the cancel day, the employee owing nothing again. Worked by hand from
 * the plan's words; made-up people only. (Posting coverage check, docs/review/posting-coverage.md.)
 */
import { describe, expect, it } from 'vitest';
import { cashPlaceId } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { journal, partyBalance, world } from '../../PAY/tests/world.ts';
import { advanceDoc } from '../doctypes/advance.ts';
import { advanceSchedule } from '../public.ts';

const daily = { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true } as const;

describe('cash advance given golden (D5 CA-GIVE)', () => {
  it('₱2,000 from GCash: Dr 1210 2,000.00 (the employee) / Cr 1121 2,000.00; cancelled the next day, the mirror puts it back', async () => {
    const w = await world('2026-09-14');
    const ana = w.person('Ana Tahi', daily);
    const ca = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cashPlaceId(w.db, '1121'), amountCents: 200_000, installmentCents: 100_000 });
    expect(ca.number).toBe('CA-000001');
    expect(journal(w.env, ca.id)).toEqual(['1121 Cr 2,000.00', '1210 Dr 2,000.00']);
    expect(partyBalance(w.env, '1210', ana)).toBe(200_000);
    expect(advanceSchedule(w.db, ana)).toMatchObject({ outstandingCents: 200_000, installmentCents: 100_000 });

    w.at('2026-09-15');
    w.cancel(advanceDoc, ca.id);
    expect(journal(w.env, ca.id, 'reversal')).toEqual(['1121 Dr 2,000.00', '1210 Cr 2,000.00']);
    expect(w.db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(ca.id)).toBe('2026-09-15');
    expect(partyBalance(w.env, '1210', ana)).toBe(0);
    expect(advanceSchedule(w.db, ana)).toMatchObject({ outstandingCents: 0, open: [] });
    expect(runInvariants(w.db).filter((r) => !r.ok)).toEqual([]);
  });
});
