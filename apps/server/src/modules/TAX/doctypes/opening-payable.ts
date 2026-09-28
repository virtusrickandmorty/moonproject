/**
 * Opening Tax Payable (OBTP-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): the BIR returns of periods before the cut-over
 * date that were prepared from the old books and not yet paid. One row per return: the form, the period (a quarter, a
 * month for a 0619-E, a year for a 1702) and the amount still to pay; a 0619-E or 1601-EQ gives it per supplier and ATC.
 *   Dr 3900 opening balance equity / Cr 2302 VAT payable (2550Q), Cr 2311 EWT payable per supplier, party = the
 *   supplier (0619-E, 1601-EQ), Cr 2320 income tax payable (1702Q, 1702); each line tagged with its form and period.
 * Afterwards the BIR payment (BIRP-) of that form and period pays what the opening left (payments.ts): a 2550Q with no
 * VAT close pays its opening; an EWT return pays it per supplier, and a 0619-E left unpaid goes on its quarter's 1601-EQ.
 * A 1702Q is paid the same way, from 2320 (Dr 2320, income-tax.ts); no payment pays a 1702 yet: it stays on 2320
 * until the year-end settlement (IT-SETTLE) is built. The opening is no tax withheld or VAT of any period: the registers, worksheets, QAP and 2307s to issue leave it out (registers.ts IN_REGISTERS).
 * A 2550Q, 1702Q or 1702 is of a period that ended before the cut-over date (VAT and income tax become payable at the
 * period's end). A 0619-E or 1601-EQ is of a period that began before it: EWT is payable when withheld, so the month or
 * quarter the cut-over falls in brings in what the old books withheld before it; what is withheld after it adds on.
 * The ACC opening contract (ACC/public.ts): dated the cut-over date, cancelled on it too while the opening is open, and
 * not while a BIR payment stands on it. A return is opened once.
 */
import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { assertOpeningOpen, cutoverDate, OPENING_PERMISSIONS, openingIssues } from '../../ACC/public.ts';
import { activeSupplierIds, supplier, supplierTaxInfo } from '../../PUR/public.ts';
import { monthRange, quarterRange, type Quarter } from '../calendar.ts';
import { OPENING_PAYABLE, openedReturns, type OpeningForm } from '../opening-payables.ts';
import { birPaymentsOf, parsePeriod, quarterPeriod, type BirForm } from '../payments.ts';

const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

/** The ATCs of the EWT classes (purchases.ts), and "other" for one the old books used that the ERP has no class for. */
export const OPENING_ATCS = ['WC010', 'WC011', 'WC100', 'WC120', 'WC158', 'WC160', 'WI010', 'WI011', 'WI100', 'WI120', 'WI158', 'WI160', 'other'] as const;
const EWT_FORMS = ['0619-E', '1601-EQ'] as const;
const TAX_FORMS = ['2550Q', '1702Q', '1702'] as const;
type EwtForm = (typeof EWT_FORMS)[number];
const isEwt = (form: OpeningForm): form is EwtForm => (EWT_FORMS as readonly string[]).includes(form);
/** The payable each return leaves, and what the tax is called. */
const PAYABLE: Record<OpeningForm, { role: 'VAT_PAYABLE' | 'EWT_PAYABLE' | 'INCOME_TAX_PAYABLE'; tax: string }> = {
  '2550Q': { role: 'VAT_PAYABLE', tax: 'VAT' },
  '0619-E': { role: 'EWT_PAYABLE', tax: 'EWT' },
  '1601-EQ': { role: 'EWT_PAYABLE', tax: 'EWT' },
  '1702Q': { role: 'INCOME_TAX_PAYABLE', tax: 'income tax' },
  '1702': { role: 'INCOME_TAX_PAYABLE', tax: 'income tax' },
};

const cents = z.number().int().positive().max(MAX_CENTS);
const period = z.string().trim().min(4).max(7); // 2026-Q2; 2026-07 for a 0619-E; 2025 for a 1702 (checked in validate)
const payee = z.object({ supplierId: z.string().trim().min(1).max(80), atc: z.enum(OPENING_ATCS), amountCents: cents }).strict();
const row = z.discriminatedUnion('form', [
  z.object({ form: z.enum(TAX_FORMS), period, amountCents: cents }).strict(), // still to pay with the return
  z.object({ form: z.enum(EWT_FORMS), period, payees: z.array(payee).min(1).max(200) }).strict(), // per supplier and ATC
]);

export const openingPayableInput = z
  .object({
    rows: z.array(row).min(1).max(50),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type OpeningPayableInput = z.infer<typeof openingPayableInput>;

export interface OpeningPayablePayee { supplierId: string; supplierName: string; atc: (typeof OPENING_ATCS)[number]; amountCents: number }
export interface OpeningPayableRow {
  rowNo: number; form: OpeningForm; period: string; periodLabel: string;
  /** Still to pay with the return; for a 0619-E or 1601-EQ, the sum of its payees. */
  amountCents: number;
  payees: OpeningPayablePayee[];
}
export interface OpeningTaxPayable {
  rows: OpeningPayableRow[];
  note?: string;
  vatCents: number; ewtCents: number; incomeTaxCents: number;
  totalCents: number;
}

/** What a return covers: its first and last day and its name, or null if the period is not the kind the form takes. */
export function returnPeriod(form: OpeningForm, period: string): { from: string; to: string; label: string; quarter: Quarter | null; month: number | null } | null {
  if (form === '1702') {
    if (!/^\d{4}$/.test(period)) return null;
    return { from: `${period}-01-01`, to: `${period}-12-31`, label: period, quarter: null, month: null };
  }
  const p = parsePeriod(period);
  if (!p || p.kind !== (form === '0619-E' ? 'month' : 'quarter')) return null;
  return { from: p.from, to: p.to, label: p.label, quarter: p.quarter, month: p.month };
}

const sumOf = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

function build(rows: OpeningPayableRow[], note: string | null | undefined): OpeningTaxPayable {
  const of = (role: string) => sumOf(rows.filter((r) => PAYABLE[r.form].role === role), (r) => r.amountCents);
  const [vatCents, ewtCents, incomeTaxCents] = [of('VAT_PAYABLE'), of('EWT_PAYABLE'), of('INCOME_TAX_PAYABLE')];
  return { rows, ...(note ? { note } : {}), vatCents, ewtCents, incomeTaxCents, totalCents: vatCents + ewtCents + incomeTaxCents };
}

/** The BIR payments that would pay a return: its own, and for a 0619-E also its quarter's 1601-EQ (which takes it if unpaid). */
function paymentKeys(form: OpeningForm, period: string): [BirForm, string][] {
  if (form === '1702') return [];
  if (form !== '0619-E') return [[form, period]];
  const p = parsePeriod(period);
  return p ? [['0619-E', period], ['1601-EQ', quarterPeriod(p.year, p.quarter)]] : [];
}

/** Where a period that may not be opened goes instead. */
const AFTER: Record<OpeningForm, string> = {
  '2550Q': 'Its VAT is closed and paid in these books.',
  '0619-E': 'EWT withheld after it comes in with the bills and vouchers.',
  '1601-EQ': 'EWT withheld after it comes in with the bills and vouchers.',
  '1702Q': 'Its income tax comes from these books.',
  '1702': 'Its income tax comes from these books.',
};

export const openingPayableDoc: DocTypeDef<OpeningPayableInput, OpeningTaxPayable> = {
  key: OPENING_PAYABLE,
  module: 'TAX',
  title: 'Opening Tax Payable',
  numbering: { series: { key: 'OBTP', prefix: 'OBTP-' } },
  permissions: OPENING_PERMISSIONS,
  dating: 'accountant_may_backdate',
  cancelOn: 'document_date',
  inputSchema: openingPayableInput,

  compute(input, ctx) {
    const rows = input.rows.map((r, i): OpeningPayableRow => {
      const payees = 'payees' in r
        ? r.payees.map((p) => ({ supplierId: p.supplierId, supplierName: supplierTaxInfo(ctx.db, p.supplierId)?.registeredName ?? '?', atc: p.atc, amountCents: p.amountCents }))
        : [];
      return {
        rowNo: i + 1, form: r.form, period: r.period, periodLabel: returnPeriod(r.form, r.period)?.label ?? r.period,
        amountCents: 'payees' in r ? sumOf(payees, (p) => p.amountCents) : r.amountCents, payees,
      };
    });
    return build(rows, input.note);
  },

  validate(doc, ctx) {
    const issues: Issue[] = [...openingIssues(ctx.db, ctx.businessDate)];
    const add = (level: 'error' | 'warning', field: string, code: string, message: string) => issues.push({ field, code, level, message });
    const cutover = ctx.businessDate; // openingIssues refuses any other date
    const earlier = ctx.db.prepare(
      `SELECT d.number FROM tax_opening_payable_lines l JOIN documents d ON d.id = l.document_id
       WHERE d.status = 'posted' AND l.form = ? AND l.period = ? ORDER BY d.number LIMIT 1`,
    );
    const closed = ctx.db.prepare(
      `SELECT d.number FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted' AND c.year = ? AND c.quarter = ?`,
    );
    const seen = new Set<string>();
    doc.rows.forEach((r, i) => {
      const n = `Row ${r.rowNo}`;
      const what = `the ${r.form} for ${r.periodLabel}`;
      const p = returnPeriod(r.form, r.period);
      if (!p) {
        const kind = r.form === '0619-E' ? 'a month like 2026-07' : r.form === '1702' ? 'a year like 2025' : 'a quarter like 2026-Q2';
        add('error', `rows.${i}.period`, 'PERIOD', `${n}: a ${r.form} is for ${kind}.`);
        return;
      }
      if (r.form === '0619-E' && p.month! % 3 === 0) {
        add('error', `rows.${i}.period`, 'THIRD_MONTH', `${n}: ${p.label} is the last month of a quarter, which has no 0619-E: its EWT goes on the 1601-EQ.`);
      }
      if (r.form === '1702Q' && p.quarter === 4) {
        add('error', `rows.${i}.period`, 'NO_Q4', `${n}: the fourth quarter has no 1702Q: its income tax goes on the annual 1702.`);
      }
      // VAT and income tax are payable once the period ends; EWT as soon as it is withheld.
      if (isEwt(r.form) ? p.from >= cutover : p.to >= cutover) {
        const when = isEwt(r.form) ? 'begins on or after' : 'ends on or after';
        add('error', `rows.${i}.period`, 'PERIOD_AFTER_CUTOVER', `${n}: ${p.label} ${when} the cut-over date, ${cutover}. ${AFTER[r.form]}`);
      }
      if (r.form === '2550Q') {
        const close = closed.pluck().get(Number(r.period.slice(0, 4)), p.quarter) as string | undefined;
        if (close) add('error', `rows.${i}.period`, 'VAT_CLOSED', `${n}: ${p.label} has a VAT close in these books (${close}): its 2550Q pays what the close made payable.`);
      }
      const key = `${r.form} ${r.period}`;
      const on = seen.has(key) ? 'this opening' : (earlier.pluck().get(r.form, r.period) as string | undefined);
      if (on) add('error', `rows.${i}.period`, 'SAME_RETURN', `${n}: ${what} is on ${on} already. Put all of a return on one row.`);
      seen.add(key);
      const payees = new Set<string>();
      r.payees.forEach((x, j) => {
        const s = supplier(ctx.db, x.supplierId);
        if (!s?.isActive) add('error', `rows.${i}.payees.${j}.supplierId`, 'SUPPLIER', `${n}: pick an active supplier for payee ${j + 1}.`);
        const k = `${x.supplierId} ${x.atc}`;
        if (payees.has(k)) add('error', `rows.${i}.payees.${j}.supplierId`, 'SAME_PAYEE', `${n}: ${x.supplierName} is on ${what} twice under ${x.atc}. Add the amounts up.`);
        payees.add(k);
      });
    });
    return issues;
  },

  persist(db, doc, h) {
    db.prepare('INSERT INTO tax_opening_payables (document_id, note) VALUES (?, ?)').run(h.documentId, doc.note ?? null);
    const ins = db.prepare(
      `INSERT INTO tax_opening_payable_lines (document_id, line_no, row_no, form, period, supplier_id, supplier_name, atc, amount_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let lineNo = 0;
    for (const r of doc.rows) {
      if (!isEwt(r.form)) ins.run(h.documentId, ++lineNo, r.rowNo, r.form, r.period, null, null, null, r.amountCents);
      else for (const p of r.payees) ins.run(h.documentId, ++lineNo, r.rowNo, r.form, r.period, p.supplierId, p.supplierName, p.atc, p.amountCents);
    }
  },

  journal(doc) {
    const lines: DraftLine[] = doc.rows.flatMap((r): DraftLine[] => {
      const tag = `${r.form} ${r.periodLabel}`;
      if (!isEwt(r.form)) return [{ account: { role: PAYABLE[r.form].role }, creditCents: r.amountCents, memo: tag }];
      return r.payees.map((p) => ({ account: { role: 'EWT_PAYABLE' }, party: { type: 'supplier', id: p.supplierId }, creditCents: p.amountCents, memo: `${tag} ${p.atc}` }));
    });
    lines.unshift({ account: { role: 'OPENING_EQUITY' }, debitCents: doc.totalCents, memo: 'Opening balance equity' });
    const n = doc.rows.length;
    return { memo: `Opening: ${n === 1 ? 'a BIR return' : `${n} BIR returns`} of the old books not yet paid`, lines };
  },

  load(db, documentId) {
    const h = db.prepare('SELECT note FROM tax_opening_payables WHERE document_id = ?').get(documentId) as { note: string | null } | undefined;
    if (!h) throw new Error(`Opening tax payable ${documentId} not found`);
    const lines = db
      .prepare(
        `SELECT row_no AS rowNo, form, period, supplier_id AS supplierId, supplier_name AS supplierName, atc, amount_cents AS amountCents
         FROM tax_opening_payable_lines WHERE document_id = ? ORDER BY line_no`,
      )
      .all(documentId) as { rowNo: number; form: OpeningForm; period: string; supplierId: string | null; supplierName: string | null; atc: OpeningPayablePayee['atc'] | null; amountCents: number }[];
    const rows: OpeningPayableRow[] = [];
    for (const l of lines) {
      let r = rows.at(-1);
      if (r?.rowNo !== l.rowNo) {
        r = { rowNo: l.rowNo, form: l.form, period: l.period, periodLabel: returnPeriod(l.form, l.period)?.label ?? l.period, amountCents: 0, payees: [] };
        rows.push(r);
      }
      r.amountCents += l.amountCents;
      if (l.supplierId) r.payees.push({ supplierId: l.supplierId, supplierName: l.supplierName!, atc: l.atc!, amountCents: l.amountCents });
    }
    return build(rows, h.note);
  },

  toInput(doc) {
    return {
      rows: doc.rows.map((r) =>
        isEwt(r.form)
          ? { form: r.form, period: r.period, payees: r.payees.map((p) => ({ supplierId: p.supplierId, atc: p.atc, amountCents: p.amountCents })) }
          : { form: r.form as (typeof TAX_FORMS)[number], period: r.period, amountCents: r.amountCents },
      ),
      ...(doc.note ? { note: doc.note } : {}),
    };
  },

  /** A BIR payment of one of its returns (or, for a 0619-E, of its quarter's 1601-EQ) paid what it opened: cancel that first. */
  dependents(db, documentId) {
    const returns = db.prepare('SELECT DISTINCT form, period FROM tax_opening_payable_lines WHERE document_id = ?').all(documentId) as { form: OpeningForm; period: string }[];
    const keys = returns.flatMap((r) => paymentKeys(r.form, r.period));
    return keys.length ? birPaymentsOf(db, keys).filter((p) => p.status === 'posted').map(({ id, number }) => ({ id, number })) : [];
  },

  /** Runs in the cancel transaction: throwing rolls the cancel back, so a closed opening keeps its payables. */
  afterCancel(db) {
    assertOpeningOpen(db);
    return null;
  },

  summary(doc, ctx) {
    const n = doc.rows.length;
    const suppliers = new Set(doc.rows.flatMap((r) => r.payees.map((p) => p.supplierId))).size;
    const forms = (role: string) => [...new Set(doc.rows.filter((r) => PAYABLE[r.form].role === role).map((r) => r.form))].join(', ');
    const amounts = [
      ...(doc.vatCents ? [`${formatPeso(doc.vatCents)} VAT (${forms('VAT_PAYABLE')})`] : []),
      ...(doc.ewtCents ? [`${formatPeso(doc.ewtCents)} EWT (${forms('EWT_PAYABLE')}) of ${suppliers} ${suppliers === 1 ? 'supplier' : 'suppliers'}`] : []),
      ...(doc.incomeTaxCents ? [`${formatPeso(doc.incomeTaxCents)} income tax (${forms('INCOME_TAX_PAYABLE')})`] : []),
    ];
    const list = amounts.length > 1 ? `${amounts.slice(0, -1).join(', ')} and ${amounts.at(-1)}` : (amounts[0] ?? formatPeso(0));
    return `This will record ${n === 1 ? 'a BIR return' : `${n} BIR returns`} of the old books not yet paid as open on the cut-over date ${ctx.businessDate}: ${list}.`;
  },

  /**
   * Needs a cut-over date and active suppliers on file. A few returns of the year before the cut-over's and of its own
   * year, each not opened yet (a return is opened once) and with no VAT close.
   */
  arbitrary(db) {
    const cutover = cutoverDate(db);
    if (!cutover) throw new Error('Set the cut-over date first');
    const suppliers = activeSupplierIds(db);
    const year = Number(cutover.slice(0, 4));
    const taken = new Set(openedReturns(db).map((r) => `${r.form} ${r.period}`));
    const closes = new Set(
      (db.prepare(`SELECT c.year || '-Q' || c.quarter FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted'`).pluck().all() as string[]),
    );
    const candidates: { form: OpeningForm; period: string }[] = [];
    for (const y of [year - 1, year]) {
      for (const q of [1, 2, 3, 4] as Quarter[]) {
        const { from, to } = quarterRange(y, q);
        const qp = quarterPeriod(y, q);
        if (to < cutover && !closes.has(qp)) candidates.push({ form: '2550Q', period: qp });
        if (to < cutover && q < 4) candidates.push({ form: '1702Q', period: qp });
        if (from < cutover) candidates.push({ form: '1601-EQ', period: qp });
        for (const m of [3 * q - 2, 3 * q - 1]) if (monthRange(y, m).from < cutover) candidates.push({ form: '0619-E', period: `${y}-${String(m).padStart(2, '0')}` });
      }
      if (`${y}-12-31` < cutover) candidates.push({ form: '1702', period: String(y) });
    }
    const open = candidates.filter((c) => !taken.has(`${c.form} ${c.period}`));
    if (!open.length || !suppliers.length) throw new Error('Nothing left to open');
    const amount = fc.integer({ min: 1, max: 5_000_000 });
    const payees = fc.uniqueArray(fc.record({ supplierId: fc.constantFrom(...suppliers), atc: fc.constantFrom(...OPENING_ATCS), amountCents: amount }), {
      minLength: 1, maxLength: 3, selector: (p) => `${p.supplierId} ${p.atc}`,
    });
    return fc
      .record({
        returns: fc.shuffledSubarray(open, { minLength: 1, maxLength: Math.min(3, open.length) }),
        amounts: fc.array(fc.tuple(amount, payees), { minLength: 3, maxLength: 3 }),
        note: fc.option(fc.constantFrom('From the old books at the cut-over', 'Filed, not yet paid'), { nil: undefined }),
      })
      .map(({ returns, amounts, note }) => ({
        rows: returns.map((r, i) => {
          const [amountCents, payeeRows] = amounts[i]!;
          return isEwt(r.form)
            ? { form: r.form, period: r.period, payees: payeeRows }
            : { form: r.form as (typeof TAX_FORMS)[number], period: r.period, amountCents };
        }),
        ...(note ? { note } : {}),
      }));
  },
};
