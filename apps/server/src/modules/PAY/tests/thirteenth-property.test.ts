/**
 * Property test (PLAN I1.3) over random payroll runs, 13th-month pay, releases and cancels, across a year end. After
 * every step: a recorded 13th-month pay stores what it computed; each payroll-run row is counted by at most one recorded
 * 13th-month pay, and each employee's due is one twelfth of the basic pay of the rows it counted; nobody's 2111 is a
 * debit, and it is empty for someone just paid (up to runs after the year); net pay released never passes net pay
 * recorded; one recorded per group and year; L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError, divRoundHalfAway } from '@moonproject/shared';
import { createTestEnv, createUser } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { addEmployee, addPay } from '../../EMP/tests/fixture.ts';
import { saveAttendance } from '../../EMP/time.ts';
import { runDoc } from '../doctypes/run.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { thirteenthDoc } from '../doctypes/thirteenth.ts';
import { addDays } from '../run-calc.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED']);
const NOTHING = ['No period has anyone to pay', 'Nothing to release', 'No 13th-month pay to work out'];

describe('13th-month pay property test (PLAN I1.3)', () => {
  it('random runs, 13th-month pay, releases and cancels across a year end keep 2111, 2110 and the counted runs consistent', async () => {
    const stats = { runs: 0, thirteenths: 0, releases: 0, cancels: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-11-02T02:00:00Z'); // Monday 2 November, Manila
        const db = t.db;
        const userId = createUser(db, 'prop-owner', ['owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const record = <I>(def: DocTypeDef<I>, input: I) => postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input).totalCents });
        const staff = {
          m1: addEmployee(db, 'Ana Buwan', { costCentre: 'office' }), m2: addEmployee(db, 'Ben Buwan', { hireDate: '2026-11-10' }), d1: addEmployee(db, 'Cy Araw'),
        };
        addPay(db, staff.m1, userId, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: g(() => fc.integer({ min: 1_000_000, max: 20_000_000 })) });
        addPay(db, staff.m2, userId, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: g(() => fc.integer({ min: 1_000_000, max: 5_000_000 })), effectiveFrom: '2026-11-10' });
        addPay(db, staff.d1, userId, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 60_000 });

        const ids = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const steps = g(() => fc.array(fc.constantFrom('tick', 'tick', 'tick', 'tick', 'attend', 'run', 'run', 'run', 'th13', 'th13', 'release', 'cancelRun', 'cancelTh13', 'cancelRelease'), { minLength: 20, maxLength: 60 }));
        for (const step of steps) {
          let check: (() => void) | null = null;
          try {
            if (step === 'tick') t.clock.set(`${addDays(today(t.clock), g(() => fc.integer({ min: 1, max: 9 })))}T02:00:00Z`);
            else if (step === 'attend') {
              const date = addDays(today(t.clock), -g(() => fc.integer({ min: 0, max: 12 })));
              tx(db, () => saveAttendance(db, { days: [{ employeeId: staff.d1, date, status: g(() => fc.constantFrom('present', 'half_day', 'absent', 'leave')) }] }, { userId, at: stamp(t.clock), today: today(t.clock), can: () => true }));
            } else if (step === 'run') {
              record(runDoc, g(() => runDoc.arbitrary(db)));
              stats.runs++;
            } else if (step === 'th13') {
              const input = g(() => thirteenthDoc.arbitrary(db));
              const computed = thirteenthDoc.compute(input, ctx());
              const p = record(thirteenthDoc, input);
              stats.thirteenths++;
              check = () => {
                const stored = thirteenthDoc.load(db, p.id);
                expect(stored).toEqual(computed);
                expect(thirteenthDoc.toInput(stored)).toEqual(input);
                // Everyone paid owes nothing more on 2111, apart from what runs of periods after the year accrued.
                for (const x of stored.employees) {
                  const bal = db
                    .prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2111' AND l.party_id = ?`)
                    .pluck()
                    .get(x.employeeId) as number;
                  const later = db
                    .prepare(
                      `SELECT COALESCE(SUM(e.thirteenth_cents), 0) FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id
                       WHERE d.status = 'posted' AND e.employee_id = ? AND r.period_end > ?`,
                    )
                    .pluck()
                    .get(x.employeeId, `${stored.year}-12-31`) as number;
                  expect(bal, x.name).toBe(later);
                }
              };
            } else if (step === 'release') {
              const input = g(() => releaseDoc.arbitrary(db));
              const p = record(releaseDoc, input);
              stats.releases++;
              check = () => expect(releaseDoc.toInput(releaseDoc.load(db, p.id))).toEqual(input);
            } else {
              const [def, type] = step === 'cancelRun' ? [runDoc, 'pay.run'] : step === 'cancelTh13' ? [thirteenthDoc, 'pay.thirteenth'] : [releaseDoc, 'pay.release'];
              const open = ids(type);
              if (open.length) {
                cancelDocument(e, def as DocTypeDef, actor, g(() => fc.constantFrom(...open)), 'Recorded by mistake, redo it');
                stats.cancels++;
              }
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
          }
          check?.();

          // Each run row is counted by at most one recorded 13th-month pay, and a due is one twelfth of what it counted.
          const twice = db
            .prepare(
              `SELECT b.run_employee_id FROM pay_thirteenth_basis b JOIN pay_thirteenth_employees t ON t.id = b.thirteenth_employee_id JOIN documents d ON d.id = t.document_id
               WHERE d.status = 'posted' GROUP BY 1 HAVING COUNT(*) > 1`,
            )
            .all();
          expect(twice, step).toEqual([]);
          const dues = db
            .prepare(
              `SELECT t.due_cents AS due, (SELECT COALESCE(SUM(l.amount_cents), 0) FROM pay_thirteenth_basis b JOIN pay_run_lines l ON l.run_employee_id = b.run_employee_id
                 WHERE b.thirteenth_employee_id = t.id AND l.thirteenth_base = 1) AS basic, t.basic_cents AS stored
               FROM pay_thirteenth_employees t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted'`,
            )
            .all() as { due: number; basic: number; stored: number }[];
          for (const x of dues) expect([x.stored, x.due], step).toEqual([x.basic, Math.max(0, divRoundHalfAway(x.basic, 12))]);
          // Nobody's 13th-month payable is a debit; net pay released never passes net pay recorded.
          const bad = db
            .prepare(
              `SELECT a.code, l.party_id, SUM(l.debit_cents - l.credit_cents) AS bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id
               WHERE a.code IN ('2111', '2110') GROUP BY a.code, l.party_id HAVING bal > 0`,
            )
            .all();
          expect(bad, step).toEqual([]);
          const dup = db
            .prepare(`SELECT t.pay_group, t.year FROM pay_thirteenths t JOIN documents d ON d.id = t.document_id WHERE d.status = 'posted' GROUP BY 1, 2 HAVING COUNT(*) > 1`)
            .all();
          expect(dup, step).toEqual([]);
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 20, endOnFailure: true },
    );
    expect(stats.thirteenths).toBeGreaterThan(0);
  });
});
