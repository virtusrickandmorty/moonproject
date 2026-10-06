/**
 * Cash advance repayments (CAR-, D5 CA-REPAY) and write-offs (CAW-, CA-WO): goldens to the centavo, their cancels on the
 * cancel day, the refusals, the employee's view (advanceSchedule), and L10: what the CA register says each employee
 * owes = GL 1210 for them. Made-up people only.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser, idem, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { stamp, today } from '../../../platform/clock.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { addDays } from '../../PAY/run-calc.ts';
import { codes, fails, journal, partyBalance, world } from '../../PAY/tests/world.ts';
import { advanceDoc } from '../doctypes/advance.ts';
import { repaymentDoc } from '../doctypes/repayment.ts';
import { writeoffDoc } from '../doctypes/writeoff.ts';
import { advanceSchedule, caBalance } from '../public.ts';

/** L10: the CA register (advances − payroll deductions − repayments − write-offs still recorded) per employee = GL 1210. */
function l10(db: Db): string[] {
  const sum = (sql: string, id: string) => db.prepare(sql).pluck().get(id) as number;
  const posted = (table: string, amount: string) => `SELECT COALESCE(SUM(t.${amount}), 0) FROM ${table} t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted' AND t.employee_id = ?`;
  return (db.prepare('SELECT id FROM emp_employees').pluck().all() as string[]).flatMap((id) => {
    const register = sum(posted('ca_advances', 'amount_cents'), id) - sum(posted('pay_run_employees', 'ca_cents'), id) - sum(posted('ca_repayments', 'amount_cents'), id) - sum(posted('ca_writeoffs', 'amount_cents'), id);
    return register === caBalance(db, id) ? [] : [`${id}: register ${register}, GL 1210 ${caBalance(db, id)}`];
  });
}
const clean = (db: Db) => {
  expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
  expect(l10(db)).toEqual([]);
};
const reversalDate = (db: Db, id: string) => db.prepare(`SELECT business_date FROM journals WHERE source_id = ? AND posting_kind = 'reversal'`).pluck().get(id);
const accountId = (db: Db, code: string) => db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
const daily = { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true } as const;

describe('repayment goldens (D5 CA-REPAY)', () => {
  it('part: ₱500 of a ₱2,000 advance paid back by bank transfer; cancelled the next day', async () => {
    const w = await world('2026-09-14');
    const ana = w.person('Ana Tahi', daily);
    w.record(advanceDoc, { employeeId: ana, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 200_000, installmentCents: 100_000 });
    const input = { employeeId: ana, cashPlaceId: cashPlaceId(w.db, '1111'), amountCents: 50_000, reference: 'BDO 0001 (made up)' };
    expect(w.preview(repaymentDoc, input).summary).toBe('This will record ₱500.00 paid back by Ana Tahi into Cash in bank – BDO, leaving ₱1,500.00 owed on cash advances.');
    const r = w.record(repaymentDoc, input);
    expect(r.number).toBe('CAR-000001');
    expect(journal(w.env, r.id)).toEqual(['1111 Dr 500.00', '1210 Cr 500.00']);
    expect(advanceSchedule(w.db, ana)).toMatchObject({
      outstandingCents: 150_000, installmentCents: 100_000, open: [{ number: 'CA-000001', openCents: 150_000 }],
      settlements: [{ documentId: r.id, number: 'CAR-000001', kind: 'repayment', businessDate: '2026-09-14', amountCents: 50_000, balanceAfterCents: 150_000 }],
    });
    expect(repaymentDoc.toInput(repaymentDoc.load(w.db, r.id))).toEqual(input);
    clean(w.db);

    w.at('2026-09-15');
    w.cancel(repaymentDoc, r.id);
    expect(journal(w.env, r.id, 'reversal')).toEqual(['1111 Cr 500.00', '1210 Dr 500.00']);
    expect(reversalDate(w.db, r.id)).toBe('2026-09-15');
    expect(advanceSchedule(w.db, ana)).toMatchObject({ outstandingCents: 200_000, settlements: [] });
    clean(w.db);
  });

  it('full: all ₱2,000 paid back in cash; nothing is left to deduct, and the advance waits for the repayment', async () => {
    const w = await world('2026-09-14');
    const ana = w.person('Ana Tahi', daily);
    const cash = cashPlaceId(w.db, '1101');
    const ca = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 });
    const r = w.record(repaymentDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_000 });
    expect(journal(w.env, r.id)).toEqual(['1101 Dr 2,000.00', '1210 Cr 2,000.00']);
    expect(advanceSchedule(w.db, ana)).toMatchObject({ outstandingCents: 0, installmentCents: 0, open: [], settlements: [{ number: 'CAR-000001', balanceAfterCents: 0 }] });
    expect(partyBalance(w.env, '1210', ana)).toBe(0);
    expect(fails(() => w.cancel(advanceDoc, ca.id), 'HAS_DEPENDENTS')).toEqual([{ id: r.id, number: 'CAR-000001' }]);
    clean(w.db);
  });

  it('a write-off recorded before an advance still waits for it, once the advance it covered is cancelled (property test seed -1493889512)', async () => {
    const w = await world('2026-09-14');
    const ana = w.person('Ana Tahi', daily);
    const cash = cashPlaceId(w.db, '1101');
    const first = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 100_000, installmentCents: 50_000 });
    const wo = w.record(writeoffDoc, { employeeId: ana, amountCents: 60_000, accountId: accountId(w.db, '6990'), reason: 'Part forgiven (made up)' });
    w.at('2026-09-15');
    const second = w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 80_000, installmentCents: 40_000 });
    w.cancel(advanceDoc, first.id); // ₱1,200 owed covers it: ₱200 left
    expect(caBalance(w.db, ana)).toBe(20_000);
    expect(fails(() => w.cancel(advanceDoc, second.id), 'HAS_DEPENDENTS')).toEqual([{ id: wo.id, number: 'CAW-000001' }]);
    expect(caBalance(w.db, ana)).toBe(20_000);
    clean(w.db);
  });
});

describe('write-off golden (D5 CA-WO)', () => {
  it('G-23 then the rest forgiven: ₱2,000 given, ₱1,000 deducted in payroll, the ₱1,000 left written off after she left', async () => {
    const w = await world('2026-09-30');
    const ana = w.person('Ana Tahi', daily);
    w.record(advanceDoc, { employeeId: ana, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 200_000, installmentCents: 100_000 });
    w.attend(['16', '17', '18', '19', '21', '22', '23', '24', '25', '26'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' })));
    const run = w.record(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' });
    expect(journal(w.env, run.id)).toContain('1210 Cr 1,000.00');

    w.at('2026-10-05');
    w.db.prepare(`UPDATE emp_employees SET is_active = 0, separated_on = '2026-10-02', separation_reason = 'Resigned (made up)' WHERE id = ?`).run(ana);
    const input = { employeeId: ana, accountId: accountId(w.db, '6990'), reason: 'Left the shop; cannot be collected' }; // no amount: all that is owed
    const pre = w.preview(writeoffDoc, input);
    expect([pre.totalCents, codes(pre.issues), codes(pre.issues, 'warning')]).toEqual([100_000, [], ['TAXABLE']]);
    expect(pre.issues[0]!.message).toBe("A forgiven cash advance is taxable compensation: ₱1,000.00 counts in Ana Tahi's taxable pay for 2026 (the year-end tax on compensation and Form 2316).");
    expect(pre.summary).toBe('This will write off ₱1,000.00 that Ana Tahi owes on cash advances, charged to 6990 Miscellaneous. Reason: Left the shop; cannot be collected');
    const wo = w.record(writeoffDoc, input);
    expect(wo.number).toBe('CAW-000001');
    expect(journal(w.env, wo.id)).toEqual(['1210 Cr 1,000.00', '6990 Dr 1,000.00']);
    expect(advanceSchedule(w.db, ana)).toMatchObject({ outstandingCents: 0, open: [], settlements: [{ kind: 'writeoff', businessDate: '2026-10-05', amountCents: 100_000, balanceAfterCents: 0 }] });
    expect(writeoffDoc.toInput(writeoffDoc.load(w.db, wo.id))).toEqual({ ...input, amountCents: 100_000 });
    clean(w.db);

    w.at('2026-10-06');
    w.cancel(writeoffDoc, wo.id);
    expect(journal(w.env, wo.id, 'reversal')).toEqual(['1210 Dr 1,000.00', '6990 Cr 1,000.00']);
    expect(reversalDate(w.db, wo.id)).toBe('2026-10-06');
    expect(caBalance(w.db, ana)).toBe(100_000);
    clean(w.db);
  });
});

describe('refusals', () => {
  it('more than owed, also more than a later payroll deduction leaves (owedFrom); a payroll recorded later leaves the repayment covered', async () => {
    const w = await world('2026-09-30');
    const ana = w.person('Ana Tahi', daily);
    const cash = cashPlaceId(w.db, '1101');
    w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 });
    expect(codes(w.preview(repaymentDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_001 }).issues)).toEqual(['MORE_THAN_OWED']);
    expect(codes(w.preview(writeoffDoc, { employeeId: ana, amountCents: 200_001, accountId: accountId(w.db, '6990'), reason: 'Cannot be collected at all' }).issues)).toEqual(['MORE_THAN_OWED']);
    expect(fails(() => w.record(repaymentDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_001 }), 'VALIDATION')).toMatchObject([{ message: 'Ana Tahi owes ₱2,000.00 on cash advances; the repayment cannot be more.' }]);

    w.attend(['16', '17', '18', '19', '21', '22', '23', '24', '25', '26'].map((d) => ({ employeeId: ana, date: `2026-09-${d}`, status: 'present' })));
    w.at('2026-10-01');
    const r = w.record(repaymentDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 150_000 });
    // The run dated at the period's end (PAY-1) deducts only the ₱500 the repayment of 1 October leaves.
    const run = w.recordOn(runDoc, { payGroup: 'SEMI_DAILY', periodStart: '2026-09-16' }, '2026-09-30');
    expect(runDoc.load(w.db, run.id).employees[0]!.caCents).toBe(50_000);
    expect(advanceSchedule(w.db, ana).settlements).toMatchObject([{ documentId: r.id, balanceAfterCents: 0 }]); // after the run of 30 September
    // Dated 30 September, ₱1,500 was owed that day, but taking any of it would leave the run and the repayment after it uncovered.
    const ctx = { db: w.db, businessDate: '2026-09-30', at: '', userId: w.userId, can: () => true };
    expect(codes(repaymentDoc.validate(repaymentDoc.compute({ employeeId: ana, cashPlaceId: cash, amountCents: 1 }, ctx), ctx))).toEqual(['NOTHING_OWED']);
    clean(w.db);
  });

  it('an employee who owes nothing; an account that is not an operating expense; a short reason', async () => {
    const w = await world('2026-09-30');
    const ben = w.person('Ben Gawa', daily);
    const x = { employeeId: ben, accountId: accountId(w.db, '6990'), reason: 'Cannot be collected at all' };
    expect(codes(w.preview(repaymentDoc, { employeeId: ben, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 100 }).issues)).toEqual(['NOTHING_OWED']);
    expect(codes(w.preview(writeoffDoc, x).issues)).toEqual(['NOTHING_OWED']);
    w.record(advanceDoc, { employeeId: ben, cashPlaceId: cashPlaceId(w.db, '1101'), amountCents: 10_000, installmentCents: 10_000 });
    for (const code of ['1210', '6000', '6270', '4101']) expect(codes(w.preview(writeoffDoc, { ...x, accountId: accountId(w.db, code) }).issues), code).toEqual(['ACCOUNT']);
    expect(fails(() => w.preview(writeoffDoc, { ...x, reason: 'Left' }), 'INVALID_INPUT')).toMatchObject([{ field: 'reason' }]);
  });

  it('the encoder records repayments but cannot write off; the view and pickers over the API', async () => {
    const w = await world('2026-09-30');
    const ana = w.person('Ana Tahi', daily);
    const cash = cashPlaceId(w.db, '1101');
    w.record(advanceDoc, { employeeId: ana, cashPlaceId: cash, amountCents: 200_000, installmentCents: 100_000 });
    const encoder = await w.env.as('encoder');
    const wo = { employeeId: ana, accountId: accountId(w.db, '6990'), reason: 'Cannot be collected at all' };
    expect((await encoder.post('/api/docs/ca.writeoff/preview', { input: wo })).statusCode).toBe(403);
    expect((await encoder.post('/api/docs/ca.writeoff/post', { input: wo, expectedTotalCents: 200_000 }, idem())).statusCode).toBe(403);
    expect((await encoder.get('/api/ca/writeoff-accounts')).statusCode).toBe(403);
    const rep = await encoder.post('/api/docs/ca.repayment/post', { input: { employeeId: ana, cashPlaceId: cash, amountCents: 20_000 }, expectedTotalCents: 20_000 }, idem());
    expect(rep.json()).toMatchObject({ number: 'CAR-000001' });
    expect((await encoder.get('/api/ca/employees')).json()).toEqual([{ employeeId: ana, name: 'Ana Tahi', owedCents: 180_000 }]);
    expect((await encoder.get(`/api/ca/employees/${ana}`)).json()).toMatchObject({ outstandingCents: 180_000, settlements: [{ number: 'CAR-000001', balanceAfterCents: 180_000 }] });

    const accountant = await w.env.as('accountant');
    const codesOf = ((await accountant.get('/api/ca/writeoff-accounts')).json() as { code: string }[]).map((a) => a.code);
    expect([codesOf.includes('6990'), codesOf.includes('6101'), codesOf.some((c) => ['6000', '6100', '6270', '5202', '1210'].includes(c))]).toEqual([true, true, false]);
    expect((await accountant.post('/api/docs/ca.writeoff/post', { input: wo, expectedTotalCents: 180_000 }, idem())).json()).toMatchObject({ number: 'CAW-000001' });
    clean(w.db);
  });
});

describe('repayment and write-off property test (PLAN I1.3)', () => {
  const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS']);
  it('random advances, repayments, write-offs and cancels: stored = computed, nobody owes less than nothing, L10 and L1–L12 hold', async () => {
    let settled = 0;
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-09-01T02:00:00Z'); encoderOwnDefaults(t);
        const db = t.db;
        const userId = createUser(db, 'prop-owner', ['owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        for (const name of ['Ana Araw', 'Ben Halo', 'Cy Piraso']) addEmployee(db, name);
        const defs: Record<string, DocTypeDef> = { advance: advanceDoc, repay: repaymentDoc, writeoff: writeoffDoc };
        const steps = g(() => fc.array(fc.constantFrom('tick', 'advance', 'advance', 'repay', 'repay', 'writeoff', 'cancel'), { minLength: 5, maxLength: 25 }));
        for (const step of steps) {
          try {
            if (step === 'tick') t.clock.set(`${addDays(today(t.clock), g(() => fc.integer({ min: 1, max: 3 })))}T02:00:00Z`);
            else if (step === 'cancel') {
              const open = db.prepare(`SELECT id, doc_type FROM documents WHERE module = 'CA' AND status = 'posted'`).all() as { id: string; doc_type: string }[];
              if (open.length) {
                const d = g(() => fc.constantFrom(...open));
                cancelDocument(e, t.deps.registry.docType(d.doc_type)!, actor, d.id, 'Recorded by mistake, redo it');
                expect(reversalDate(db, d.id)).toBe(today(t.clock));
              }
            } else {
              const def = defs[step]!;
              const input = g(() => def.arbitrary(db));
              const ctx = { db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true };
              const computed = def.compute(input, ctx);
              const p = postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input).totalCents });
              expect(def.load(db, p.id)).toEqual(computed);
              if (step !== 'advance') settled++;
            }
          } catch (err) {
            if (!(err instanceof AppError ? EXPECTED.has(err.code) : String(err).includes('Nobody owes'))) throw err;
          }
          expect(db.prepare(`SELECT party_id FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1210' GROUP BY party_id HAVING SUM(debit_cents - credit_cents) < 0`).all(), step).toEqual([]);
          expect(l10(db), step).toEqual([]);
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 25, endOnFailure: true },
    );
    expect(settled).toBeGreaterThan(0);
  });
});
