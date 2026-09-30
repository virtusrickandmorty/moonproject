/**
 * Property test (PLAN I1.3) over random income and expenses, share changes in the register, dividend declarations (some
 * backdated), dividend payments, 1601-FQ payments and cancels of all three. After every step: a recorded declaration
 * reads back as it computed, its lines add up to its total by the shares held on the record date, individuals carry the
 * final tax and corporations none, and it was covered by the retained earnings on its date; a cancel mirrors the
 * journal; 3210 is the declarations still recorded; 2503 per stockholder is their net dividends less their payments,
 * never below zero; 2312 is the tax of the declarations less the 1601-FQ payments, and no quarter is paid for more than
 * it withheld. L1–L12 at the end.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AppError, applyRate } from '@moonproject/shared';
import { createTestEnv, createUser } from '../../../../test/helpers.ts';
import { runInvariants } from '../../../engine/ledger/invariants.ts';
import { cancelDocument, postDocument, previewDocument } from '../../../engine/documents/lifecycle.ts';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { stamp, today } from '../../../platform/clock.ts';
import { jvDoc } from '../../ACC/doctypes/jv.ts';
import { addDays, finalTaxQuarters } from '../../TAX/calendar.ts';
import { birPaymentDoc } from '../../TAX/doctypes/bir-payment.ts';
import { finalTaxDue, periodsDue } from '../../TAX/payments.ts';
import { dividendDoc } from '../doctypes/dividend.ts';
import { dividendPaymentDoc } from '../doctypes/dividend-payment.ts';
import { createPerson, holdingsOn, listPeople, updatePerson } from '../people.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED']);
const NOTHING = ['No dividends to pay'];
type Line = { code: string; party: string | null; dr: number; cr: number };

describe('Dividend property test (PLAN I1.3)', () => {
  it('random earnings, share changes, declarations, payments, 1601-FQ payments and cancels keep 3210, 2503 and 2312 in step', async () => {
    const stats = { declared: 0, refused: 0, backdated: 0, paid: 0, taxPaid: 0, cancels: 0, corporations: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-07-01T02:00:00Z'); // Wednesday 1 July, Manila: Q3 ends during the run
        const db = t.db;
        const userId = createUser(db, 'prop-accountant', ['accountant', 'owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const ctx = (businessDate = today(t.clock)) => ({ db, businessDate, at: stamp(t.clock), userId, can: () => true });
        const record = <I>(def: DocTypeDef<I>, input: I, businessDate?: string) =>
          postDocument(e, def, actor, { input, businessDate, expectedTotalCents: previewDocument(e, def, actor, input, businessDate).totalCents });
        const who = () => ({ userId, at: stamp(t.clock) });
        db.transaction(() => {
          createPerson(db, { name: 'Sample Owner A', isStockholder: true, isOfficer: true, shares: 2500, tin: '123-456-789-000' }, who());
          createPerson(db, { name: 'Sample Holdings Corp.', isStockholder: true, isOfficer: false, shares: 1500, holderKind: 'corporation', tin: '222-333-444-000' }, who());
          createPerson(db, { name: 'Sample Owner D', isStockholder: true, isOfficer: false, shares: 999 }, who());
          createPerson(db, { name: 'Sample Officer B', isStockholder: false, isOfficer: true }, who());
        })();
        const account = (code: string) => db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
        const jv = (memo: string, debit: string, credit: string, cents: number) =>
          record(jvDoc, { memo, lines: [{ accountId: account(debit), debitCents: cents }, { accountId: account(credit), creditCents: cents }] });
        jv('Retained earnings brought forward', '1111', '3201', g(() => fc.integer({ min: 0, max: 20_000_000 })) + 1);
        const open = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const lines = (id: string, kind: string) =>
          db
            .prepare(
              `SELECT a.code, l.party_id AS party, l.debit_cents AS dr, l.credit_cents AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
               WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
            )
            .all(id, kind) as Line[];
        const gl = (role: string, party?: string) =>
          db
            .prepare(`SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = ? AND (? IS NULL OR l.party_id = ?)`)
            .pluck()
            .get(role, party ?? null, party ?? null) as number;
        const sum = (sql: string, ...args: unknown[]) => db.prepare(sql).pluck().get(...args) as number;

        const steps = g(() =>
          fc.array(fc.constantFrom('tick', 'tick', 'earn', 'spend', 'shares', 'declare', 'declare', 'declare', 'pay', 'pay', 'payTax', 'cancelDeclaration', 'cancelPay', 'cancelTax'), { minLength: 25, maxLength: 60 }),
        );
        for (const step of steps) {
          try {
            if (step === 'tick') t.clock.set(`${addDays(today(t.clock), g(() => fc.integer({ min: 3, max: 25 })))}T02:00:00Z`);
            else if (step === 'earn') jv('Scrap cloth sold', '1101', '7103', g(() => fc.integer({ min: 1, max: 5_000_000 })));
            else if (step === 'spend') jv('Repairs', '6170', '1101', g(() => fc.integer({ min: 1, max: 8_000_000 })));
            else if (step === 'shares') {
              const p = g(() => fc.constantFrom(...listPeople(db).filter((x) => x.isStockholder)));
              db.transaction(() => updatePerson(db, p.id, String(p.version), { shares: g(() => fc.integer({ min: 0, max: 4000 })) }, who()))();
            } else if (step === 'declare') {
              const input = g(() => dividendDoc.arbitrary(db));
              const back = Math.max(g(() => fc.integer({ min: -6, max: 3 })), 0);
              const date = back ? addDays(today(t.clock), -back) : undefined;
              const computed = dividendDoc.compute(input, ctx(date));
              let posted;
              try {
                posted = record(dividendDoc, input, date);
              } catch (err) {
                if (err instanceof AppError && err.code === 'VALIDATION') stats.refused++;
                throw err;
              }
              stats.declared++;
              if (back) stats.backdated++;
              expect(dividendDoc.load(db, posted.id)).toEqual(computed);
              expect(dividendDoc.toInput(dividendDoc.load(db, posted.id))).toEqual(input);
              // Covered by the retained earnings on its date, split by the shares held at the end of the record date.
              expect(computed.totalCents).toBeLessThanOrEqual(computed.retained.availableCents);
              const held = holdingsOn(db, input.recordDate);
              const got = computed.lines.map((l) => [l.personId, l.shares]);
              expect(got).toEqual(held.map((h) => [h.personId, h.shares]).filter(([id]) => computed.lines.some((l) => l.personId === id)));
              if (input.basis === 'per_share') expect(got).toHaveLength(held.length);
              expect(computed.lines.reduce((s, l) => s + l.grossCents, 0)).toBe(computed.totalCents);
              if (input.basis === 'total') expect(computed.totalCents).toBe(input.amountCents);
              for (const l of computed.lines) {
                if (input.basis === 'per_share') expect(l.grossCents).toBe(l.shares * input.amountCents);
                expect(l.taxCents).toBe(l.holderKind === 'individual' ? applyRate(l.grossCents, 1000) : 0);
                expect(l.netCents).toBe(l.grossCents - l.taxCents);
                if (l.holderKind === 'corporation') stats.corporations++;
              }
            } else if (step === 'pay') {
              const input = g(() => dividendPaymentDoc.arbitrary(db));
              const computed = dividendPaymentDoc.compute(input, ctx());
              const p = record(dividendPaymentDoc, input);
              stats.paid++;
              expect(dividendPaymentDoc.load(db, p.id)).toEqual(computed);
              expect(input.amountCents).toBeLessThanOrEqual(computed.payableCents);
            } else if (step === 'payTax') {
              const due = periodsDue(db, today(t.clock)).filter((d) => d.form === '1601-FQ');
              if (due.length) {
                const d = g(() => fc.constantFrom(...due));
                const amountCents = g(() => fc.boolean()) ? d.payableCents : g(() => fc.integer({ min: 1, max: d.payableCents }));
                const input = { form: '1601-FQ' as const, period: d.period, cashPlaceId: account('1111'), amountCents, reference: 'eFPS 700001' };
                const computed = birPaymentDoc.compute(input, ctx());
                const p = record(birPaymentDoc, input);
                stats.taxPaid++;
                expect(birPaymentDoc.load(db, p.id)).toEqual(computed);
              }
            } else {
              const [def, type] = step === 'cancelDeclaration' ? [dividendDoc, 'eq.dividend'] : step === 'cancelPay' ? [dividendPaymentDoc, 'eq.dividend_payment'] : [birPaymentDoc, 'tax.bir_payment'];
              const ids = open(type);
              if (ids.length) {
                const id = g(() => fc.constantFrom(...ids));
                cancelDocument(e, def as DocTypeDef, actor, id, 'Recorded by mistake, redo it');
                stats.cancels++;
                expect(lines(id, 'reversal')).toEqual(lines(id, 'original').map((l) => ({ ...l, dr: l.cr, cr: l.dr })));
              }
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
          }

          // 3210 is the declarations still recorded.
          const declared = sum(`SELECT COALESCE(SUM(v.total_cents), 0) FROM eq_dividend_declarations v JOIN documents d ON d.id = v.document_id WHERE d.status = 'posted'`);
          expect(0 - gl('DIVIDENDS_DECLARED'), step).toBe(declared);
          // 2503 per stockholder: net dividends still declared less payments still recorded, never below zero.
          for (const p of listPeople(db, true)) {
            const net = sum(`SELECT COALESCE(SUM(l.net_cents), 0) FROM eq_dividend_lines l JOIN documents d ON d.id = l.document_id WHERE d.status = 'posted' AND l.person_id = ?`, p.id);
            const paid = sum(`SELECT COALESCE(SUM(x.amount_cents), 0) FROM eq_dividend_payments x JOIN documents d ON d.id = x.document_id WHERE d.status = 'posted' AND x.person_id = ?`, p.id);
            expect(gl('DIVIDENDS_PAYABLE', p.id), step).toBe(net - paid);
            expect(net - paid, step).toBeGreaterThanOrEqual(0);
          }
          // 2312: the tax of the declarations still recorded less the 1601-FQ payments still recorded; no quarter overpaid.
          const tax = sum(`SELECT COALESCE(SUM(v.tax_cents), 0) FROM eq_dividend_declarations v JOIN documents d ON d.id = v.document_id WHERE d.status = 'posted'`);
          const taxPaid = sum(`SELECT COALESCE(SUM(x.amount_cents), 0) FROM tax_final_tax_payments x JOIN documents d ON d.id = x.document_id WHERE d.status = 'posted'`);
          expect(gl('FINAL_TAX_PAYABLE'), step).toBe(tax - taxPaid);
          for (const q of finalTaxQuarters(db)) {
            const due = finalTaxDue(db, Number(q.slice(0, 4)), Number(q.slice(6)) as 1 | 2 | 3 | 4);
            expect(due.leftCents, `${step} ${q}`).toBeGreaterThanOrEqual(0);
          }
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 15, endOnFailure: true },
    );
    expect(stats.declared).toBeGreaterThan(0);
    expect(stats.refused).toBeGreaterThan(0);
    expect(stats.paid).toBeGreaterThan(0);
    expect(stats.taxPaid).toBeGreaterThan(0);
    expect(stats.cancels).toBeGreaterThan(0);
    expect(stats.corporations).toBeGreaterThan(0);
  });
});
