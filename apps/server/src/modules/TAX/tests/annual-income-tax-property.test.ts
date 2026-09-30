/**
 * Property test (PLAN I1.3) for the year-end income tax: random 2026 sales, costs, expenses, penalties, other income,
 * collections with CWT (2307 in hand or pending, some coming in January), 1702Q payments, rates and the deduction
 * method. Then the 1702-RT: every figure whole pesos and the payable the tax less the credits; the provision
 * (Dr 8101 = Cr 2320 = the tax due) and the settlement balance; after them 1411 is zero or the overpayment carried
 * over, 1410 holds only the 2307s still pending, and 2320 holds what the return leaves to pay, which the 1702 payment
 * clears. Cancelling both mirrors them back to where the year was. L1–L12 at the end.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, createUser } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { jvDoc } from '../../ACC/doctypes/jv.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { addDays } from '../calendar.ts';
import { birPaymentDoc } from '../doctypes/bir-payment.ts';
import { incomeTaxProvisionDoc } from '../doctypes/income-tax-provision.ts';
import { incomeTaxSettlementDoc } from '../doctypes/income-tax-settlement.ts';
import { addDeductionSetting, annualIncomeTaxPosition } from '../annual-income-tax.ts';
import { addIncomeTaxSettings } from '../income-tax.ts';
import { markReceived } from '../withholding.ts';

const EXPECTED = new Set(['VALIDATION', 'NO_CHANGE']);
const NOTHING = ['Nothing to pay the BIR'];
type Line = { code: string; dr: number; cr: number };

describe('year-end income tax property test (PLAN I1.3)', () => {
  it('provision and settlement always balance; after them 1411 and the year’s 2320 are zero or the overpayment carried over', async () => {
    const stats = { provided: 0, payable: 0, overpaid: 0, osd: 0, mcit: 0, pending: 0, rounded: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-01-06T02:00:00Z');
        const db = t.db;
        const userId = createUser(db, 'prop-accountant', ['accountant', 'owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const record = <I>(def: DocTypeDef<I>, input: I, businessDate?: string) =>
          postDocument(e, def, actor, { input, expectedTotalCents: previewDocument(e, def, actor, input, businessDate).totalCents, ...(businessDate ? { businessDate } : {}) });
        const collection = t.deps.registry.docType('col.collection')!;
        const customer = seedCustomers(db, userId).school;
        const CASH = cashPlaceId(db, '1101');
        const account = (code: string) => db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
        const lines = (id: string, kind: string) =>
          db.prepare(
            `SELECT a.code, l.debit_cents AS dr, l.credit_cents AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
             WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
          ).all(id, kind) as Line[];
        const balance = (code: string) =>
          db.prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?').pluck().get(code) as number;
        const posting = (code: string, cents: number) => {
          const party = code.startsWith('41') ? { party: { type: 'customer' as const, id: customer } } : {};
          const [dr, cr] = cents > 0 ? [code, '1101'] : ['1101', code];
          return record(jvDoc, { memo: `Random ${code}`, lines: [{ accountId: account(dr), debitCents: Math.abs(cents), ...(dr === code ? party : {}) }, { accountId: account(cr), creditCents: Math.abs(cents), ...(cr === code ? party : {}) }] });
        };
        const who = () => ({ userId, at: stamp(t.clock), today: today(t.clock) });
        let cr = 1000;
        const pendingIds: string[] = [];

        addIncomeTaxSettings(db, {
          effectiveFrom: today(t.clock), reason: 'Random rates for the test',
          value: g(() => fc.record({ regularRateBp: fc.constantFrom(2000, 2500), mcitRateBp: fc.constantFrom(100, 200), operationsBeganYear: fc.constantFrom(null, 2010, 2024) })),
        }, who());
        const steps = g(() => fc.array(fc.constantFrom('tick', 'tick', 'sale', 'sale', 'sale', 'cost', 'expense', 'expense', 'penalty', 'other', 'cwt', 'cwt', 'pay', 'pay'), { minLength: 15, maxLength: 45 }));
        for (const step of steps) {
          try {
            if (step === 'tick') {
              const next = addDays(today(t.clock), g(() => fc.integer({ min: 10, max: 60 })));
              if (next <= '2026-12-31') t.clock.set(`${next}T02:00:00Z`);
            } else if (step === 'sale') posting('4101', -g(() => fc.integer({ min: 1, max: 200_000_000 })));
            else if (step === 'cost') posting('5101', g(() => fc.integer({ min: 1, max: 100_000_000 })));
            else if (step === 'expense') posting(g(() => fc.constantFrom('6110', '6120', '7201')), g(() => fc.integer({ min: 1, max: 80_000_000 })));
            else if (step === 'penalty') posting('6290', g(() => fc.integer({ min: 1, max: 500_000 })));
            else if (step === 'other') posting(g(() => fc.constantFrom('7101', '7103')), -g(() => fc.integer({ min: 1, max: 5_000_000 })));
            else if (step === 'cwt') {
              const certificate = g(() => fc.constantFrom('received', 'received', 'pending'));
              const cwtCents = g(() => fc.integer({ min: 1, max: 3_000_000 }));
              const p = record(collection, {
                customerId: customer, crNumber: String(cr++), applications: [], tenders: [{ cashPlaceId: CASH, amountCents: g(() => fc.integer({ min: 100, max: 50_000_000 })) }],
                withholding: { cwtCents, atc: 'WC158', certificate },
              });
              if (certificate === 'pending') pendingIds.push(p.id);
            } else {
              const input = g(() => birPaymentDoc.arbitrary(db));
              record(birPaymentDoc, input);
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
          }
        }

        // January: some pending 2307s come in; the accountant picks the deduction method (or leaves the default).
        t.clock.set('2027-01-25T02:00:00Z');
        for (const id of pendingIds) if (g(() => fc.boolean())) markReceived(db, { documentId: id, lineNo: 0 }, who());
        const method = g(() => fc.constantFrom('default', 'itemized', 'osd'));
        if (method !== 'default') addDeductionSetting(db, { year: 2026, method, effectiveFrom: today(t.clock), reason: 'Picked for the test year' }, who());
        const before = { '1411': balance('1411'), '1410': balance('1410'), '2320': balance('2320'), '8101': balance('8101') };

        const w = annualIncomeTaxPosition(db, 2026, today(t.clock));
        for (const l of w.lines) expect(Math.abs(l.cents % 100), l.key).toBe(0);
        expect(w.taxableIncomeCents).toBe(w.totalGrossIncomeCents - w.deductionsCents);
        expect(w.taxDueCents).toBe(w.mcitApplies ? Math.max(w.regularTaxCents, w.mcitCents) : w.regularTaxCents);
        expect(w.payableCents).toBe(w.taxDueCents - w.priorExcessCents - w.quarterlyPaidCents - w.otherPrepaidCents - w.cwtCents);
        expect(w.prepaidCents).toBe(before['1411']); // every 1411 debit is a 2026 1702Q payment
        if (w.deduction.method === 'osd') stats.osd++;
        if (w.basis === 'mcit') stats.mcit++;
        if (w.cwtPendingCents > 0) stats.pending++;

        // The provision: Dr 8101 = Cr 2320 = the tax due, dated 31 December.
        let provision: string | null = null;
        if (w.provisionCents > 0) {
          const p = record(incomeTaxProvisionDoc, { year: 2026 }, '2026-12-31');
          provision = p.id;
          stats.provided++;
          expect(lines(p.id, 'original')).toEqual([{ code: '8101', dr: w.taxDueCents, cr: 0 }, { code: '2320', dr: 0, cr: w.taxDueCents }]);
        } else expect(w.taxDueCents).toBe(0);

        // The settlement balances; after it 1411 is the carry-over, 1410 the 2307s still pending, 2320 what is left to pay.
        let settlement: string | null = null;
        const s = incomeTaxSettlementDoc.compute({ year: 2026 }, { db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const errors = incomeTaxSettlementDoc.validate(s, { db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true }).filter((i) => i.level === 'error');
        if (errors.length) {
          expect(errors.map((i) => i.code)).toEqual(['NOTHING_TO_SETTLE']);
          expect([w.taxDueCents, w.prepaidCents, w.cwtExactCents, w.payableCents]).toEqual([0, 0, 0, 0]);
        } else {
          const p = record(incomeTaxSettlementDoc, { year: 2026 });
          settlement = p.id;
          const ls = lines(p.id, 'original');
          expect(ls.reduce((x, l) => x + l.dr, 0)).toBe(ls.reduce((x, l) => x + l.cr, 0));
          expect(Math.abs(s.roundingCents)).toBeLessThanOrEqual(200); // four credits, each rounded to whole pesos
          if (s.roundingCents) stats.rounded++;
          expect(incomeTaxSettlementDoc.load(db, p.id)).toEqual(s);
          expect(balance('1411')).toBe(Math.max(-w.payableCents, 0));
          expect(balance('1410')).toBe(w.cwtPendingCents);
          expect(balance('2320') + Math.max(w.payableCents, 0)).toBe(0); // a credit balance: what is left to pay
          expect(balance('8101')).toBe(w.taxDueCents - s.roundingCents);
          if (w.payableCents > 0) {
            stats.payable++;
            record(birPaymentDoc, { form: '1702', period: '2026', cashPlaceId: cashPlaceId(db, '1111'), amountCents: w.payableCents, reference: 'eFPS 1702-2026' });
            expect(balance('2320')).toBe(0);
          } else if (w.payableCents < 0) stats.overpaid++;
        }

        // Cancelling everything mirrors it: the year is back where it was before the provision.
        const payments = db.prepare(`SELECT d.id FROM tax_income_tax_annual_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted'`).pluck().all() as string[];
        if (g(() => fc.boolean())) {
          for (const id of payments) cancelDocument(e, birPaymentDoc, actor, id, 'Paid with the wrong reference');
          for (const [def, id] of [[incomeTaxSettlementDoc, settlement], [incomeTaxProvisionDoc, provision]] as const) {
            if (!id) continue;
            cancelDocument(e, def as DocTypeDef, actor, id, 'Redone with the corrected figures');
            expect(lines(id, 'reversal')).toEqual(lines(id, 'original').map((l) => ({ ...l, dr: l.cr, cr: l.dr })));
          }
          expect({ '1411': balance('1411'), '1410': balance('1410'), '2320': balance('2320'), '8101': balance('8101') }).toEqual(before);
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      // A fixed seed: the counts below check that the runs reach each case.
      { numRuns: 20, endOnFailure: true, seed: 1702 },
    );
    expect(stats.provided).toBeGreaterThan(0);
    expect(stats.payable).toBeGreaterThan(0);
    expect(stats.overpaid).toBeGreaterThan(0);
    expect(stats.osd).toBeGreaterThan(0);
    expect(stats.pending).toBeGreaterThan(0);
  });
});
