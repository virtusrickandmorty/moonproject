/**
 * Property test (PLAN I1.3) for the 1702Q: random sales, costs, expenses, penalties and other income in 2026, a
 * random change of the income tax settings, 1702Q payments (in full, in part, now and then more than is due with a
 * note, sometimes with a penalty) and cancels. After every step, for each quarter Q1 to Q3: every figure is whole
 * pesos; gross income, taxable income and the tax follow from them, the tax is the higher of the regular tax and MCIT
 * where MCIT applies; the payable is the tax less the earlier quarters' payments; what is due is never below zero and
 * what is left is due less paid. A recorded payment reads back as it computed and its journal is Dr 1411, Dr 6290 /
 * Cr the cash place; a cancel mirrors it. 1411 is the payments still recorded. L1–L12 at the end.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { createTestEnv, createUser } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { jvDoc } from '../../ACC/doctypes/jv.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { addDays, type Quarter } from '../calendar.ts';
import { birPaymentDoc } from '../doctypes/bir-payment.ts';
import { addIncomeTaxSettings, incomeTaxPosition } from '../income-tax.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED', 'NO_CHANGE']);
const NOTHING = ['Nothing to pay the BIR'];
type Line = { code: string; dr: number; cr: number };

describe('1702Q property test (PLAN I1.3)', () => {
  it('random income, expenses, settings, payments and cancels keep the worksheet, 1411 and the payments in step', async () => {
    const stats = { payments: 0, partial: 0, noted: 0, penalties: 0, cancels: 0, mcit: 0, due: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-01-06T02:00:00Z');
        const db = t.db;
        const userId = createUser(db, 'prop-accountant', ['accountant', 'owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const record = <I>(def: DocTypeDef<I>, input: I) => postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input).totalCents });
        const customer = seedCustomers(db, userId).school;
        const account = (code: string) => db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
        const lines = (id: string, kind: string) =>
          db
            .prepare(
              `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
               WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
            )
            .all(id, kind) as Line[];
        const balance = (code: string) =>
          db.prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').pluck().get(code) as number;
        const recorded = (column: 'amount_cents' | 'penalty_cents', where = '1 = 1') =>
          db.prepare(`SELECT COALESCE(SUM(p.${column}), 0) FROM tax_income_tax_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted' AND ${where}`).pluck().get() as number;
        const posting = (code: string, cents: number) => {
          const party = code.startsWith('41') ? { party: { type: 'customer' as const, id: customer } } : {};
          const [dr, cr] = cents > 0 ? [code, '1101'] : ['1101', code];
          return record(jvDoc, { memo: `Random ${code}`, lines: [{ accountId: account(dr), debitCents: Math.abs(cents), ...(dr === code ? party : {}) }, { accountId: account(cr), creditCents: Math.abs(cents), ...(cr === code ? party : {}) }] });
        };

        const settingsValue = () => g(() => fc.record({ regularRateBp: fc.constantFrom(2000, 2500), mcitRateBp: fc.constantFrom(100, 200), operationsBeganYear: fc.constantFrom(null, 2010, 2010, 2024) }));
        const settings = () => addIncomeTaxSettings(db, { effectiveFrom: today(t.clock), value: settingsValue(), reason: 'Random change for the test' }, { userId, at: stamp(t.clock), today: today(t.clock) });
        settings();
        const steps = g(() =>
          fc.array(fc.constantFrom('tick', 'tick', 'sale', 'sale', 'sale', 'cost', 'expense', 'expense', 'squeeze', 'squeeze', 'penalty', 'other', 'settings', 'pay', 'pay', 'pay', 'cancelPay'), { minLength: 25, maxLength: 60 }),
        );
        for (const step of steps) {
          try {
            if (step === 'tick') {
              const next = addDays(today(t.clock), g(() => fc.integer({ min: 10, max: 60 })));
              if (next <= '2026-12-31') t.clock.set(`${next}T02:00:00Z`);
            } else if (step === 'sale') posting('4101', -g(() => fc.integer({ min: 1, max: 200_000_000 })));
            else if (step === 'cost') posting('5101', g(() => fc.integer({ min: 1, max: 100_000_000 })));
            else if (step === 'expense') posting(g(() => fc.constantFrom('6110', '6120', '7201')), g(() => fc.integer({ min: 1, max: 60_000_000 })));
            else if (step === 'penalty') posting('6290', g(() => fc.integer({ min: 1, max: 500_000 })));
            else if (step === 'other') posting(g(() => fc.constantFrom('7101', '7103')), -g(() => fc.integer({ min: 1, max: 5_000_000 })));
            else if (step === 'settings') settings();
            else if (step === 'squeeze') {
              // Expenses that take most of the year's taxable income so far, so MCIT is often the higher.
              const q = Math.min(Math.ceil(Number(today(t.clock).slice(5, 7)) / 3), 3) as Quarter;
              const taxable = incomeTaxPosition(db, 2026, q).taxableIncomeCents;
              if (taxable > 100) posting('6110', Math.floor(taxable * g(() => fc.integer({ min: 85, max: 99 })) / 100));
            } else if (step === 'pay') {
              const base = g(() => birPaymentDoc.arbitrary(db));
              // Now and then more than is due, with the note the return needs.
              const over = g(() => fc.integer({ min: 0, max: 2 })) === 0;
              const input = over ? { ...base, amountCents: base.amountCents + g(() => fc.integer({ min: 1, max: 1_000_000 })), note: 'The filed return says more' } : base;
              expect(input.form).toBe('1702Q');
              const computed = birPaymentDoc.compute(input, ctx());
              const p = record(birPaymentDoc, input);
              stats.payments++;
              const loaded = birPaymentDoc.load(db, p.id);
              expect(loaded).toEqual(computed);
              expect(birPaymentDoc.toInput(loaded)).toEqual(input);
              expect(lines(p.id, 'original')).toEqual([
                { code: '1411', dr: input.amountCents, cr: 0 },
                ...(input.penaltyCents ? [{ code: '6290', dr: input.penaltyCents, cr: 0 }] : []),
                { code: db.prepare('SELECT code FROM accounts WHERE id = ?').pluck().get(input.cashPlaceId) as string, dr: 0, cr: input.amountCents + (input.penaltyCents ?? 0) },
              ]);
              if (over) stats.noted++;
              else if (input.amountCents < computed.payableCents) stats.partial++;
              if (input.penaltyCents) stats.penalties++;
            } else {
              const ids = db.prepare(`SELECT id FROM documents WHERE doc_type = 'tax.bir_payment' AND status = 'posted'`).pluck().all() as string[];
              if (ids.length) {
                const id = g(() => fc.constantFrom(...ids));
                cancelDocument(e, birPaymentDoc, actor, id, 'Recorded by mistake, redo it');
                stats.cancels++;
                expect(lines(id, 'reversal')).toEqual(lines(id, 'original').map((l) => ({ ...l, dr: l.cr, cr: l.dr })));
              }
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
          }

          // Each quarter's 1702Q.
          for (const q of [1, 2, 3] as Quarter[]) {
            const w = incomeTaxPosition(db, 2026, q);
            for (const l of w.lines) expect(Math.abs(l.cents % 100), `${step} Q${q} ${l.key}`).toBe(0);
            expect(w.grossIncomeCents).toBe(w.salesCents - w.costOfSalesCents);
            expect(w.totalGrossIncomeCents).toBe(w.grossIncomeCents + w.otherIncomeCents);
            expect(w.taxableIncomeCents).toBe(w.totalGrossIncomeCents - w.deductionsCents);
            expect(w.regularTaxCents).toBe(w.taxableIncomeCents > 0 ? Math.round((w.taxableIncomeCents / 100) * w.settings.regularRateBp / 10000) * 100 : 0);
            expect(w.taxDueCents).toBe(w.mcitApplies ? Math.max(w.regularTaxCents, w.mcitCents) : w.regularTaxCents);
            if (w.basis === 'mcit') stats.mcit++;
            const earlier = recorded('amount_cents', `p.period IN (${[1, 2, 3].filter((k) => k < q).map((k) => `'2026-Q${k}'`).join(', ') || "''"})`);
            expect(w.priorPaidCents).toBe(Math.round(earlier / 100) * 100);
            expect(w.payableCents).toBe(w.taxDueCents - w.priorPaidCents - w.priorPrepaidCents - w.cwtCents);
            expect(w.dueCents).toBe(Math.max(w.payableCents, 0));
            expect(w.paidCents).toBe(recorded('amount_cents', `p.period = '2026-Q${q}'`));
            expect(w.leftCents).toBe(w.dueCents - w.paidCents);
            if (w.dueCents > 0) stats.due++;
          }
          // 1411 is the 1702Q payments still recorded; 6290 has their penalties and the random ones.
          expect(balance('1411'), step).toBe(recorded('amount_cents'));
          expect(recorded('amount_cents', 'p.amount_cents > p.payable_cents AND p.note IS NULL')).toBe(0);
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 20, endOnFailure: true },
    );
    expect(stats.payments).toBeGreaterThan(0);
    expect(stats.partial).toBeGreaterThan(0);
    expect(stats.noted).toBeGreaterThan(0);
    expect(stats.penalties).toBeGreaterThan(0);
    expect(stats.cancels).toBeGreaterThan(0);
    expect(stats.mcit).toBeGreaterThan(0);
  });
});
