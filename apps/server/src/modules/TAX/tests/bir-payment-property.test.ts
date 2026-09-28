/**
 * Property test (PLAN I1.3) over random bills and vouchers with EWT, output VAT, VAT closes, BIR payments (some
 * backdated, some with a penalty) and cancels of all of them. After every step: a recorded payment reads back as it
 * computed and its payees' lines add up to its amount, none above what the payee owed; a cancel mirrors the payment's
 * journal; 2311 is the EWT register less the EWT payments still recorded, and the register ties to the GL; 2302 is what
 * the closes still recorded made payable less the 2550Q payments still recorded; the payments' 6290 lines are their
 * penalties. L1–L12 at the end.
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
import { billDoc } from '../../AP/doctypes/bill.ts';
import { voucherDoc } from '../../EXP/doctypes/voucher.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { addDays } from '../calendar.ts';
import { birPaymentDoc } from '../doctypes/bir-payment.ts';
import { vatCloseDoc } from '../doctypes/vat-close.ts';
import { ewtRegister } from '../purchases.ts';

const EXPECTED = new Set(['VALIDATION', 'HAS_DEPENDENTS', 'ALREADY_CANCELLED']);
const NOTHING = ['Nothing to pay the BIR'];
type Line = { code: string; party: string | null; dr: number; cr: number };

describe('BIR payment property test (PLAN I1.3)', () => {
  it('random withholdings, VAT closes, payments and cancels keep the payables, the register and the payments in step', async () => {
    const stats = { payments: 0, partial: 0, penalties: 0, ewt: 0, vat: 0, cancels: 0 };
    await fc.assert(
      fc.asyncProperty(fc.gen(), async (g) => {
        const t = await createTestEnv('2026-06-16T02:00:00Z'); // Tuesday 16 June, Manila: Q2 ends early in the run
        const db = t.db;
        const userId = createUser(db, 'prop-accountant', ['accountant', 'owner']);
        const actor = { userId, permissions: new Set(t.deps.registry.permissions().map((p) => p.key)) };
        const e = { db, clock: t.clock };
        const ctx = () => ({ db, businessDate: today(t.clock), at: stamp(t.clock), userId, can: () => true });
        const record = <I>(def: DocTypeDef<I>, input: I, businessDate?: string) =>
          postDocument(e, def, actor, { input, businessDate, expectedTotalCents: previewDocument(e, def, actor, input, businessDate).totalCents });
        const acct = await t.as('accountant');
        for (const [name, ewtClass] of [['Sample Lessor', 'rent_5'], ['Sample Print', 'contractor_2'], ['Sample Audit', 'prof_firm_10'], ['Sample Fabric', undefined]] as const) {
          await acct.post('/api/pur/suppliers', { name, registeredName: `${name} Corp.`, tin: '123-456-789-000', isVatRegistered: true, ...(ewtClass ? { ewtClass } : {}) });
        }
        await acct.post('/api/pur/supplies', { name: 'Cotton twill', unit: 'yard', category: 'materials' });
        const customer = seedCustomers(db, userId).school;
        const account = (code: string) => db.prepare('SELECT id FROM accounts WHERE code = ?').pluck().get(code) as number;
        const open = (type: string) => db.prepare(`SELECT id FROM documents WHERE doc_type = ? AND status = 'posted' ORDER BY number`).pluck().all(type) as string[];
        const lines = (id: string, kind: string) =>
          db
            .prepare(
              `SELECT a.code, l.party_id AS party, l.debit_cents AS dr, l.credit_cents AS cr FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
               WHERE j.source_type = 'document' AND j.source_id = ? AND j.posting_kind = ? ORDER BY l.line_no`,
            )
            .all(id, kind) as Line[];
        const gl = (role: string, side: 'credit' | 'debit') =>
          db
            .prepare(`SELECT COALESCE(SUM(${side === 'credit' ? 'l.credit_cents - l.debit_cents' : 'l.debit_cents - l.credit_cents'}), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.role_key = ?`)
            .pluck()
            .get(role) as number;
        /** A column summed over the payments still recorded, of these forms. */
        const recorded = (column: 'amount_cents' | 'penalty_cents', forms: string[]) =>
          db
            .prepare(`SELECT COALESCE(SUM(p.${column}), 0) FROM tax_bir_payments p JOIN documents d ON d.id = p.document_id WHERE d.status = 'posted' AND p.form IN (SELECT value FROM json_each(?))`)
            .pluck()
            .get(JSON.stringify(forms)) as number;

        const steps = g(() =>
          fc.array(fc.constantFrom('tick', 'tick', 'bill', 'voucher', 'sale', 'sale', 'close', 'close', 'pay', 'pay', 'pay', 'cancelSource', 'cancelPay', 'cancelClose'), { minLength: 30, maxLength: 70 }),
        );
        for (const step of steps) {
          try {
            if (step === 'tick') t.clock.set(`${addDays(today(t.clock), g(() => fc.integer({ min: 5, max: 20 })))}T02:00:00Z`);
            else if (step === 'bill') record(billDoc, g(() => billDoc.arbitrary(db)));
            else if (step === 'voucher') record(voucherDoc, g(() => voucherDoc.arbitrary(db)));
            else if (step === 'sale') {
              const cents = g(() => fc.integer({ min: 1, max: 300_000_000 })); // output VAT, often more than the vouchers' input VAT
              record(jvDoc, { memo: 'Output VAT on a sale', lines: [{ accountId: account('1101'), debitCents: cents }, { accountId: account('2301'), party: { type: 'customer', id: customer }, creditCents: cents }] });
            } else if (step === 'close') record(vatCloseDoc, { year: 2026, quarter: g(() => fc.constantFrom(2 as const, 3 as const)) });
            else if (step === 'pay') {
              const input = g(() => birPaymentDoc.arbitrary(db));
              const backdate = Math.max(g(() => fc.integer({ min: -10, max: 5 })), 0); // now and then paid a few days before it is recorded
              const computed = birPaymentDoc.compute(input, ctx());
              const p = record(birPaymentDoc, input, backdate ? addDays(today(t.clock), -backdate) : undefined);
              stats.payments++;
              expect(birPaymentDoc.load(db, p.id)).toEqual(computed);
              expect(birPaymentDoc.toInput(birPaymentDoc.load(db, p.id))).toEqual(input);
              expect(computed.totalCents).toBe(input.amountCents + (input.penaltyCents ?? 0));
              if (input.form === '2550Q') {
                stats.vat++;
                expect(computed.lines).toEqual([]);
              } else {
                stats.ewt++;
                expect(computed.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(input.amountCents);
                for (const l of computed.lines) expect(l.amountCents).toBeLessThanOrEqual(l.payableCents);
              }
              if (input.amountCents < computed.payableCents) stats.partial++;
              if (input.penaltyCents) stats.penalties++;
            } else {
              const [def, types] =
                step === 'cancelPay' ? [birPaymentDoc, ['tax.bir_payment']] : step === 'cancelClose' ? [vatCloseDoc, ['tax.vat_close']] : [billDoc, ['ap.bill', 'exp.voucher']];
              const ids = types.flatMap(open);
              if (ids.length) {
                const id = g(() => fc.constantFrom(...ids));
                const type = db.prepare('SELECT doc_type FROM documents WHERE id = ?').pluck().get(id) as string;
                cancelDocument(e, (type === 'exp.voucher' ? voucherDoc : def) as DocTypeDef, actor, id, 'Recorded by mistake, redo it');
                stats.cancels++;
                // Cancel mirrors the stored journal, line for line.
                expect(lines(id, 'reversal')).toEqual(lines(id, 'original').map((l) => ({ ...l, dr: l.cr, cr: l.dr })));
              }
            }
          } catch (err) {
            const ok = err instanceof AppError ? EXPECTED.has(err.code) : NOTHING.some((m) => String(err).includes(m));
            if (!ok) throw err;
          }

          // 2311 is the EWT register (which leaves the payments out and ties to the GL) less the EWT payments still recorded.
          const register = ewtRegister(db, '2000-01-01', '2999-12-31');
          expect(register.totals.ewtCents, step).toBe(register.glEwtCents);
          expect(register.rows.some((r) => r.docType === 'tax.bir_payment'), step).toBe(false);
          expect(gl('EWT_PAYABLE', 'credit'), step).toBe(register.totals.ewtCents - recorded('amount_cents', ['0619-E', '1601-EQ']));
          // 2302 is what the closes still recorded made payable less the 2550Q payments still recorded.
          const closed = db.prepare(`SELECT COALESCE(SUM(c.payable_cents), 0) FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted'`).pluck().get() as number;
          const vatPaid = recorded('amount_cents', ['2550Q']);
          expect(gl('VAT_PAYABLE', 'credit'), step).toBe(closed - vatPaid);
          expect(vatPaid, step).toBeLessThanOrEqual(closed);
          // The payments' 6290 lines are the penalties of the payments still recorded.
          const penalties = db
            .prepare(
              `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
               JOIN tax_bir_payments p ON p.document_id = j.source_id AND j.source_type = 'document' WHERE a.role_key = 'PENALTIES'`,
            )
            .pluck()
            .get();
          expect(penalties, step).toBe(recorded('penalty_cents', ['2550Q', '0619-E', '1601-EQ']));
        }
        expect(runInvariants(db).filter((r) => !r.ok)).toEqual([]);
        await t.app.close();
      }),
      { numRuns: 15, endOnFailure: true },
    );
    expect(stats.ewt).toBeGreaterThan(0);
    expect(stats.vat).toBeGreaterThan(0);
    expect(stats.partial).toBeGreaterThan(0);
    expect(stats.penalties).toBeGreaterThan(0);
  });
});
