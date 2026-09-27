/**
 * Property test (PLAN I1.3) over random attendance, piece work, cash advances, payroll runs, releases and cancels. After
 * every step: what is stored equals what was computed; each piece row is paid by at most one recorded run line and every
 * recorded piece line holds its row; nobody owes a negative cash advance or is released more than their net pay; each
 * month's SSS and Pag-IBIG employer shares equal the month's share of the pay recorded (the true-up adds up); L1–L12.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { createTestEnv, createUser } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { tx } from '../../../platform/db/driver.ts';
import { addEmployee, addPay } from '../../EMP/tests/fixture.ts';
import { holidaysBetween } from '../../EMP/public.ts';
import { saveAttendance } from '../../EMP/time.ts';
import { advanceDoc } from '../../CA/doctypes/advance.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { jobOrderDoc } from '../../JO/doctypes/job-order.ts';
import { entryDoc } from '../../PRD/doctypes/entry.ts';
import { setupLine } from '../../PRD/production.ts';
import { runDoc } from '../doctypes/run.ts';
import { releaseDoc } from '../doctypes/release.ts';
import { addDays } from '../run-calc.ts';
import { hdmfMonthly, hdmfRateAt, sssMonthly, sssRateAt } from '../statutory.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED']);
/** What the generators throw when the database has nothing for them yet. */
const NOTHING = ['No period has anyone to pay', 'Nothing to release', 'prd.entry.arbitrary needs'];

describe('payroll property test (PLAN I1.3)', () => {
  it('random time, piece work, advances, runs, releases and cancels keep payroll and the ledger consistent', async () => {
    const stats = { runs: 0, releases: 0, cancels: 0, refused: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-08-03T02:00:00Z'); // Monday 3 August, Manila
        const db = t.db;
        const userId = createUser(db, 'prop-owner', ['owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const record = <I>(def: DocTypeDef<I>, input: I) => postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input).totalCents });
        const hired = '2025-01-06';
        const staff = {
          d1: addEmployee(db, 'Ana Araw'), d2: addEmployee(db, 'Ben Halo'), p1: addEmployee(db, 'Cy Piraso'), m1: addEmployee(db, 'Di Buwan', { costCentre: 'office', hireDate: '2026-08-10' }),
        };
        addPay(db, staff.d1, userId, { payType: 'daily', payGroup: 'SEMI_DAILY', dailyRateCents: 55_000, isMwe: true, effectiveFrom: hired });
        addPay(db, staff.d2, userId, { payType: 'mixed', payGroup: 'WEEKLY_PIECE', dailyRateCents: 60_000, effectiveFrom: hired });
        addPay(db, staff.p1, userId, { payType: 'piece', payGroup: 'WEEKLY_PIECE', effectiveFrom: hired });
        addPay(db, staff.m1, userId, { payType: 'monthly', payGroup: 'SEMI_MONTHLY', monthlyRateCents: g(() => fc.integer({ min: 1_000_000, max: 8_000_000 })), effectiveFrom: '2026-08-10' });
        if (g(() => fc.boolean())) db.prepare(`UPDATE emp_employees SET wtax_on = 0, statutory_off_reason = 'Made-up exemption for the test' WHERE id = ?`).run(staff.d2);
        const cs = seedCustomers(db, userId);
        const jo = record(jobOrderDoc, { customerId: cs.school, dueInDays: 60, priority: 'normal', paymentTerms: 'full', lines: [1, 2].map(() => ({ kind: 'made_to_order' as const, description: 'Team shirt', qty: 400, unitPriceCents: 30_000, discountCents: 0, roster: [] })) }).id;
        for (const line of [1, 2]) tx(db, () => setupLine(db, jo, line, { templateId: 1, stepIds: [4, 6, 8], garmentType: 'T-shirt', complexity: g(() => fc.constantFrom('simple', 'standard', 'complex')) }, { userId, at: stamp(t.clock) }));

        const ids = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const steps = g(() => fc.array(fc.constantFrom('tick', 'tick', 'attend', 'attend', 'entry', 'entry', 'ca', 'run', 'run', 'run', 'release', 'release', 'cancelRun', 'cancelRelease', 'cancelCa'), { minLength: 10, maxLength: 50 }));
        for (const step of steps) {
          let check: (() => void) | null = null;
          try {
            if (step === 'tick') t.clock.set(`${addDays(today(t.clock), g(() => fc.integer({ min: 1, max: 4 })))}T02:00:00Z`);
            else if (step === 'attend') {
              const who = g(() => fc.constantFrom(...Object.values(staff)));
              const date = addDays(today(t.clock), -g(() => fc.integer({ min: 0, max: 12 })));
              const holiday = holidaysBetween(db, date, date).length > 0;
              const status = g(() => fc.constantFrom(...(holiday ? ['holiday_off', 'holiday_worked', 'rest_day', 'rest_day_worked'] : ['present', 'present', 'half_day', 'absent', 'rest_day', 'unpaid_leave', 'rest_day_worked', 'leave'])));
              const ot = ['present', 'holiday_worked', 'rest_day_worked'].includes(status) ? g(() => fc.constantFrom(0, 0, 60, 90)) : 0;
              tx(db, () => saveAttendance(db, { days: [{ employeeId: who, date, status, ...(ot ? { otMinutes: ot } : {}) }] }, { userId, at: stamp(t.clock), today: today(t.clock), can: () => true }));
            } else if (step === 'entry') {
              const input = g(() => entryDoc.arbitrary(db));
              record(entryDoc, { ...input, overCapReason: 'Cut earlier by the old shop (made up)' });
            } else if (step === 'ca') record(advanceDoc, g(() => advanceDoc.arbitrary(db)));
            else if (step === 'run') {
              const input = g(() => runDoc.arbitrary(db));
              const computed = runDoc.compute(input, ctx());
              const p = record(runDoc, input);
              stats.runs++;
              check = () => {
                expect(runDoc.load(db, p.id)).toEqual(computed);
                expect(runDoc.toInput(runDoc.load(db, p.id))).toEqual(input);
              };
            } else if (step === 'release') {
              const input = g(() => releaseDoc.arbitrary(db));
              const p = record(releaseDoc, input);
              stats.releases++;
              check = () => expect(releaseDoc.toInput(releaseDoc.load(db, p.id))).toEqual(input);
            } else {
              const [def, type] = step === 'cancelRun' ? [runDoc, 'pay.run'] : step === 'cancelRelease' ? [releaseDoc, 'pay.release'] : [advanceDoc, 'ca.advance'];
              const open = ids(type);
              if (open.length) {
                cancelDocument(e, def as DocTypeDef, actor, g(() => fc.constantFrom(...open)), 'Recorded by mistake, redo it');
                stats.cancels++;
              }
            }
          } catch (err) {
            // A generator with nothing to generate from, or a rule refusing the step: both fine; the state must still hold.
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
            if (err instanceof AppError) stats.refused++;
          }
          check?.();

          // Paid once, both ways.
          const stray = db
            .prepare(
              `SELECT COUNT(*) FROM prd_assignments a WHERE a.pay_run_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pay_run_lines l JOIN pay_run_employees x ON x.id = l.run_employee_id
                 JOIN documents d ON d.id = x.document_id WHERE l.id = a.pay_run_line_id AND l.assignment_id = a.id AND d.status = 'posted')`,
            )
            .pluck()
            .get();
          const unmarked = db
            .prepare(
              `SELECT COUNT(*) FROM pay_run_lines l JOIN pay_run_employees x ON x.id = l.run_employee_id JOIN documents d ON d.id = x.document_id
               WHERE d.status = 'posted' AND l.assignment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prd_assignments a WHERE a.id = l.assignment_id AND a.pay_run_line_id = l.id)`,
            )
            .pluck()
            .get();
          expect([stray, unmarked], step).toEqual([0, 0]);
          // Nobody owes a negative advance; net pay released never passes net pay recorded.
          const bad = db
            .prepare(
              `SELECT a.code, l.party_id, SUM(l.debit_cents - l.credit_cents) AS bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id
               WHERE a.code IN ('1210', '2110') GROUP BY a.code, l.party_id HAVING (a.code = '1210' AND bal < 0) OR (a.code = '2110' AND bal > 0)`,
            )
            .all();
          expect(bad, step).toEqual([]);
          // The month-to-date true-up adds up: employer shares recorded for a month = the month's share of the pay recorded.
          const months = db
            .prepare(
              `SELECT e.employee_id AS id, r.contribution_month AS m, SUM(e.gross_cents) AS gross, SUM(e.sss_er_cents + e.sss_ec_cents) AS sssEr, SUM(e.hdmf_er_cents) AS hdmfEr
               FROM pay_run_employees e JOIN pay_runs r ON r.document_id = e.document_id JOIN documents d ON d.id = r.document_id WHERE d.status = 'posted' GROUP BY 1, 2`,
            )
            .all() as { id: string; m: string; gross: number; sssEr: number; hdmfEr: number }[];
          for (const x of months) {
            const sss = sssMonthly(sssRateAt(db, `${x.m}-01`), x.gross);
            expect([x.sssEr, x.hdmfEr], `${step} ${x.m}`).toEqual([sss.er + sss.ec, hdmfMonthly(hdmfRateAt(db, `${x.m}-01`), x.gross).er]);
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 20, endOnFailure: true },
    );
    expect(stats.runs).toBeGreaterThan(0);
  });
});
