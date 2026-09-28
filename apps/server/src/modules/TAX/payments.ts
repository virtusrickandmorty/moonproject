/**
 * What a BIR return leaves to pay (PLAN D5 VAT-PAY and EWT-REM), read from the ledger the way STAT reads a month:
 *   2550Q, a quarter: what the quarter's posted VAT close credited to 2302 VAT payable, less the quarter's 2550Q payments.
 *   0619-E, month 1 or 2 of a quarter: per payee, the EWT withheld in the month on 2311, less the month's 0619-E payments.
 *   1601-EQ, a quarter: per payee, the EWT withheld in the quarter, less the 0619-E payments of its months 1 and 2 and
 *   the quarter's earlier 1601-EQ payments.
 * "Withheld in the period" is what the EWT register reads (registers.ts IN_REGISTERS): bills and vouchers by date, a
 * cancel on its cancel date, journal vouchers; never a BIR payment. What was paid is read from the payments' journals,
 * reversals included, so a cancelled payment counts for nothing. A payee below zero was paid for more than is now
 * withheld (a bill cancelled after its EWT was paid, D6).
 */
import type { Db } from '../../platform/db/driver.ts';
import { voucherTaxFacts } from '../EXP/public.ts';
import { supplierTaxInfo } from '../PUR/public.ts';
import { monthRange, quarterRange, type Quarter } from './calendar.ts';
import { IN_REGISTERS } from './registers.ts';

export const BIR_FORMS = ['2550Q', '0619-E', '1601-EQ'] as const;
export type BirForm = (typeof BIR_FORMS)[number];
/** The payable each return clears, the tax it names, and whether it pays a month or a quarter. */
export const BIR_FORM: Record<BirForm, { role: 'VAT_PAYABLE' | 'EWT_PAYABLE'; tax: 'VAT' | 'EWT'; period: 'month' | 'quarter' }> = {
  '2550Q': { role: 'VAT_PAYABLE', tax: 'VAT', period: 'quarter' },
  '0619-E': { role: 'EWT_PAYABLE', tax: 'EWT', period: 'month' },
  '1601-EQ': { role: 'EWT_PAYABLE', tax: 'EWT', period: 'quarter' },
};

export interface Period { kind: 'month' | 'quarter'; year: number; quarter: Quarter; /** 1-12, for a month. */ month: number | null; from: string; to: string; label: string }

/** A month (2026-07, "July 2026") or a quarter (2026-Q3, "Q3 2026"), or null. */
export function parsePeriod(period: string): Period | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (m) {
    const [year, month] = [Number(m[1]), Number(m[2])];
    return { kind: 'month', year, quarter: Math.ceil(month / 3) as Quarter, month, ...monthRange(year, month) };
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!q) return null;
  const [year, quarter] = [Number(q[1]), Number(q[2]) as Quarter];
  return { kind: 'quarter', year, quarter, month: null, ...quarterRange(year, quarter), label: `Q${quarter} ${year}` };
}
export const quarterPeriod = (year: number, quarter: Quarter) => `${year}-Q${quarter}`;
/** The months of a quarter: 2026-07, 2026-08, 2026-09. */
export const monthsOf = (year: number, quarter: Quarter) => [1, 2, 3].map((i) => `${year}-${String(3 * quarter - 3 + i).padStart(2, '0')}`);

export interface BirPaymentRef {
  id: string; number: string; status: 'posted' | 'cancelled'; date: string; form: BirForm; period: string; reference: string; amountCents: number; penaltyCents: number;
}
/** The BIR payments of these forms and periods, recorded or cancelled, oldest first. */
export function birPaymentsOf(db: Db, keys: [BirForm, string][]): BirPaymentRef[] {
  return db
    .prepare(
      `SELECT d.id, d.number, d.status, d.business_date AS date, p.form, p.period, p.reference, p.amount_cents AS amountCents, p.penalty_cents AS penaltyCents
       FROM tax_bir_payments p JOIN documents d ON d.id = p.document_id
       WHERE p.form || ' ' || p.period IN (SELECT value FROM json_each(?)) ORDER BY d.number`,
    )
    .all(JSON.stringify(keys.map(([f, p]) => `${f} ${p}`))) as BirPaymentRef[];
}

/** Net debit per party on the payable, over the journals of the BIR payments of these forms and periods (cancels net to zero). */
function paidByParty(db: Db, role: BirPaymentRole, keys: [BirForm, string][]): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT COALESCE(l.party_id, '') AS partyId, SUM(l.debit_cents - l.credit_cents) AS cents
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       JOIN tax_bir_payments p ON p.document_id = j.source_id AND j.source_type = 'document'
       WHERE j.sealed = 1 AND a.role_key = ? AND p.form || ' ' || p.period IN (SELECT value FROM json_each(?)) GROUP BY 1`,
    )
    .all(role, JSON.stringify(keys.map(([f, p]) => `${f} ${p}`))) as { partyId: string; cents: number }[];
  return new Map(rows.map((r) => [r.partyId, r.cents]));
}
type BirPaymentRole = (typeof BIR_FORM)[BirForm]['role'];

/** EWT withheld in [from, to] per payee: the net credit on 2311 of the journals the EWT register reads. */
function withheldByPayee(db: Db, from: string, to: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT l.party_id AS partyId, SUM(l.credit_cents - l.debit_cents) AS cents
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND a.role_key = 'EWT_PAYABLE' AND j.business_date BETWEEN ? AND ? AND ${IN_REGISTERS} GROUP BY 1`,
    )
    .all(from, to) as { partyId: string; cents: number }[];
  return new Map(rows.map((r) => [r.partyId, r.cents]));
}

/** A payee's registered name and TIN: a supplier on file, or the one-off payee its latest expense voucher typed (party tin:…). */
export function payeeOf(db: Db, partyId: string): { name: string; tin: string | null } {
  const s = supplierTaxInfo(db, partyId);
  if (s) return { name: s.registeredName, tin: s.tin };
  const voucher = db
    .prepare(
      `SELECT d.id FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN documents d ON d.id = j.source_id AND j.source_type = 'document'
       WHERE l.party_type = 'supplier' AND l.party_id = ? AND d.doc_type = 'exp.voucher' ORDER BY j.rowid DESC LIMIT 1`,
    )
    .pluck()
    .get(partyId) as string | undefined;
  const v = voucher ? voucherTaxFacts(db, voucher) : undefined;
  const digits = /^tin:(\d{12,14})$/.exec(partyId)?.[1];
  return { name: v?.payeeName ?? '?', tin: v?.payeeTin ?? (digits ? digits.replace(/^(\d{3})(\d{3})(\d{3})/, '$1-$2-$3-') : null) };
}

/** The payments that already paid a period's EWT: a month's 0619-E; a quarter's 0619-E of months 1 and 2, and its 1601-EQ. */
export function ewtPaidWith(form: '0619-E' | '1601-EQ', period: string, p: Period): [BirForm, string][] {
  if (form === '0619-E') return [['0619-E', period]];
  const [m1, m2] = monthsOf(p.year, p.quarter);
  return [['0619-E', m1!], ['0619-E', m2!], ['1601-EQ', period]];
}

export interface PayeeDue { partyId: string; name: string; withheldCents: number; paidCents: number; dueCents: number }

/** Per payee: EWT withheld in the period, paid for it with the BIR, and left (withheld − paid), by name; payees at zero left out. */
export function ewtDue(db: Db, form: '0619-E' | '1601-EQ', period: string, p: Period): PayeeDue[] {
  const withheld = withheldByPayee(db, p.from, p.to);
  const paid = paidByParty(db, 'EWT_PAYABLE', ewtPaidWith(form, period, p));
  return [...new Set([...withheld.keys(), ...paid.keys()])]
    .map((partyId) => {
      const [w, x] = [withheld.get(partyId) ?? 0, paid.get(partyId) ?? 0];
      return { partyId, name: payeeOf(db, partyId).name, withheldCents: w, paidCents: x, dueCents: w - x };
    })
    .filter((d) => d.withheldCents !== 0 || d.paidCents !== 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.partyId.localeCompare(b.partyId));
}

export interface VatDue {
  close: { documentId: string; number: string; date: string } | null;
  /** What the close credited to 2302, paid with the quarter's 2550Q payments, and left. */
  closedCents: number; paidCents: number; dueCents: number;
}

/** The VAT a quarter's posted close made payable, and what its 2550Q payments paid of it. */
export function vatDue(db: Db, year: number, quarter: Quarter): VatDue {
  const close = db
    .prepare(
      `SELECT d.id AS documentId, d.number, d.business_date AS date, c.payable_cents AS payable FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id
       WHERE c.year = ? AND c.quarter = ? AND d.status = 'posted'`,
    )
    .get(year, quarter) as { documentId: string; number: string; date: string; payable: number } | undefined;
  const paidCents = [...paidByParty(db, 'VAT_PAYABLE', [['2550Q', quarterPeriod(year, quarter)]]).values()].reduce((s, c) => s + c, 0);
  const closedCents = close?.payable ?? 0;
  return { close: close ? { documentId: close.documentId, number: close.number, date: close.date } : null, closedCents, paidCents, dueCents: closedCents - paidCents };
}

/**
 * Every return with something left to pay, for the property test's generator and a "to pay" list: the quarters closed
 * with VAT payable, and the months (0619-E) and quarters (1601-EQ) with EWT withheld, as far as the ledger goes.
 */
export function periodsDue(db: Db): { form: BirForm; period: string; payableCents: number }[] {
  const out: { form: BirForm; period: string; payableCents: number }[] = [];
  const closed = db
    .prepare(`SELECT c.year, c.quarter FROM tax_vat_closes c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted' ORDER BY 1, 2`)
    .all() as { year: number; quarter: Quarter }[];
  for (const c of closed) {
    const due = vatDue(db, c.year, c.quarter).dueCents;
    if (due > 0) out.push({ form: '2550Q', period: quarterPeriod(c.year, c.quarter), payableCents: due });
  }
  const months = db
    .prepare(
      `SELECT DISTINCT substr(j.business_date, 1, 7) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       WHERE j.sealed = 1 AND a.role_key = 'EWT_PAYABLE' ORDER BY 1`,
    )
    .pluck()
    .all() as string[];
  const positive = (xs: PayeeDue[]) => xs.filter((d) => d.dueCents > 0).reduce((s, d) => s + d.dueCents, 0);
  for (const period of [...months, ...new Set(months.map((m) => quarterPeriod(Number(m.slice(0, 4)), Math.ceil(Number(m.slice(5)) / 3) as Quarter)))]) {
    const p = parsePeriod(period)!;
    const form = p.kind === 'month' ? '0619-E' : '1601-EQ';
    if (form === '0619-E' && (p.month! % 3 === 0 || birPaymentsOf(db, [['1601-EQ', quarterPeriod(p.year, p.quarter)]]).some((x) => x.status === 'posted'))) continue;
    const due = positive(ewtDue(db, form, period, p));
    if (due > 0) out.push({ form, period, payableCents: due });
  }
  return out;
}
