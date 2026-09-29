/**
 * Output VAT on uncollected receivables (EOPT law RA 11976, RR 3-2024, RMC 65-2024; PLAN E12, K ACC-26). A seller may
 * take the output VAT of a credit sale off its 2550Q when all eight hold: (1) the sale was after 27 April 2024; (2) it
 * was on credit; (3) a written agreement sets the time to pay; (4) the invoice shows VAT separately; (5) the sale is
 * listed on its own in the SLSP; (6) its output VAT was declared on time in a filed 2550Q; (7) the agreed time has
 * fully passed; (8) the VAT was not claimed as part of a bad debt deduction. It is claimed in the quarter after the
 * time to pay ends and added back in the quarter the customer pays.
 *   Claim (UVAT-, tax.uncollected_vat), accountant only, while setting tax.uncollected_vat_credit is on:
 *     Dr 2301 output VAT / Cr 2303 output VAT deferred, party the customer, 2303 ref the invoice.
 *     The books check 1 (invoice date), 2 (a due date after the invoice date, and a receivable left after deposits),
 *     4 (VAT on the invoice), 6 (the quarter's VAT close recorded after the invoice), 7 (the due date's quarter is over)
 *     and 8 in part (no write-off on the invoice); the accountant confirms 3, 5, 6 (filed on time) and 8.
 *     The VAT claimed is the invoice's VAT on what it still owes: VAT × owed ÷ gross.
 *   Add-back (UVATR-, tax.uncollected_vat_recovery), proposed once the customer pays some of it:
 *     Dr 2303 / Cr 2301, the same party and ref. It adds back the claim's VAT on what was paid since the claim (credit
 *     memos, write-offs and 2307s on the invoice are no payment), so a full payment adds back the rest.
 * A release's invoice record (JO, IR-) is the only sale with an agreed time to pay; a quick sale is paid on the spot.
 * What an invoice still owes is the job order's receivable shared out newest invoice first (the AR aging's rule, COL).
 * This file reads the books; the two document types are in doctypes/uncollected-vat.ts.
 */
import type { Db } from '../../platform/db/driver.ts';
import { creditsOn, invoiceCreditsAt } from '../COL/public.ts';
import { invoiceRecordRef, invoiceRecordsOf, joLedger, receivableSourcesAt, type InvoiceRecordRef } from '../JO/public.ts';
import { quarterOf, quarterRange, vatReturnDue, type Quarter } from './calendar.ts';
import { vatCloseOf } from './vat.ts';

/** The first sale date that can qualify: sales after 27 April 2024 (EOPT took effect). */
export const FIRST_SALE_DATE = '2024-04-28';

/** round_half_away(vat × part ÷ whole), in BigInt (the product can pass 2^53). */
export function vatShare(vatCents: number, partCents: number, wholeCents: number): number {
  if (wholeCents <= 0 || partCents <= 0) return 0;
  const [v, p, w] = [BigInt(vatCents), BigInt(partCents), BigInt(wholeCents)];
  return Number((2n * v * p + w) / (2n * w));
}

export const quarterKey = (date: string) => { const q = quarterOf(date); return q.year * 4 + q.quarter; };
export const nextQuarterStart = (date: string) => { const q = quarterOf(date); return q.quarter === 4 ? `${q.year + 1}-01-01` : quarterRange(q.year, (q.quarter + 1) as Quarter).from; };
/** When a document was recorded: its timestamp, and its Manila date. */
const recorded = (db: Db, id: string) => db.prepare(`SELECT posted_at AS at, date(posted_at, '+8 hours') AS day FROM documents WHERE id = ?`).get(id) as { at: string; day: string };

/** What the books say about an invoice, today: its due date, what it still owes and what credits took off it. */
export interface InvoiceFacts extends InvoiceRecordRef {
  dueDate: string | null; owedCents: number; creditedCents: number; writeOffs: string[];
  close: { documentId: string; number: string; date: string; recordedAt: string; recordedOn: string } | null; recordedAt: string; returnDue: string;
}

export function invoiceFacts(db: Db, invoiceId: string, today: string): InvoiceFacts | undefined {
  const inv = invoiceRecordRef(db, invoiceId);
  if (!inv) return undefined;
  const credited = invoiceCreditsAt(db, today);
  let owedCents = 0;
  if (inv.status === 'posted') {
    let remaining = joLedger(db, inv.jobOrderId).receivableCents;
    for (const r of invoiceRecordsOf(db, { jobOrderId: inv.jobOrderId }).reverse()) {
      const share = Math.max(0, Math.min(remaining, r.grossCents - r.depositAppliedCents - (credited.get(r.id) ?? 0)));
      if (r.id === inv.id) { owedCents = share; break; }
      remaining -= share;
    }
  }
  const { year, quarter } = quarterOf(inv.businessDate);
  const close = vatCloseOf(db, year, quarter);
  const writeOffs = creditsOn(db, invoiceId)
    .filter((c) => db.prepare('SELECT doc_type FROM documents WHERE id = ?').pluck().get(c.id) === 'col.write_off')
    .map((c) => c.number);
  return {
    ...inv, owedCents, creditedCents: credited.get(inv.id) ?? 0, writeOffs,
    dueDate: receivableSourcesAt(db, today).invoices.find((i) => i.id === invoiceId)?.dueDate ?? null,
    close: close ? { ...close, recordedAt: recorded(db, close.documentId).at, recordedOn: recorded(db, close.documentId).day } : null,
    recordedAt: recorded(db, inv.id).at, returnDue: vatReturnDue(db, year, quarter),
  };
}

export const invoiceWords = (i: { invoiceNumber: string; number: string; jobOrderNumber: string }) => `invoice no. ${i.invoiceNumber} (${i.number}, ${i.jobOrderNumber})`;

/** The posted claim on an invoice, with the VAT still deferred (claimed less added back). */
export function claimOn(db: Db, invoiceId: string): { documentId: string; number: string } | undefined {
  return db
    .prepare(`SELECT d.id AS documentId, d.number FROM tax_uncollected_vat u JOIN documents d ON d.id = u.document_id WHERE u.invoice_id = ? AND d.status = 'posted'`)
    .get(invoiceId) as { documentId: string; number: string } | undefined;
}

export interface ClaimRow {
  documentId: string; number: string; date: string; invoiceId: string; customerId: string; owedCents: number; creditedCents: number; vatCents: number; addedBackCents: number;
}
export const CLAIMS = `SELECT d.id AS documentId, d.number, d.business_date AS date, u.invoice_id AS invoiceId, u.customer_id AS customerId, u.owed_cents AS owedCents,
    u.credited_cents AS creditedCents, u.vat_cents AS vatCents,
    (SELECT COALESCE(SUM(r.vat_cents), 0) FROM tax_uncollected_vat_recoveries r JOIN documents x ON x.id = r.document_id
      WHERE r.claim_id = u.document_id AND x.status = 'posted' AND x.id <> @except) AS addedBackCents
  FROM tax_uncollected_vat u JOIN documents d ON d.id = u.document_id WHERE d.status = 'posted'`;
export const claim = (db: Db, id: string, except = '') => db.prepare(`${CLAIMS} AND d.id = @id`).get({ id, except }) as ClaimRow | undefined;

/**
 * The add-back a claim has coming today: its VAT on what was paid since it was claimed, less what was added back
 * already. Paid = the drop in what the invoice owes, less the credits recorded on it since (they are no payment).
 */
export function paidSince(c: Pick<ClaimRow, 'owedCents' | 'creditedCents'>, owedCents: number, creditedCents: number) {
  const creditedSinceCents = Math.max(0, creditedCents - c.creditedCents);
  return { paidCents: Math.min(c.owedCents, Math.max(0, c.owedCents - owedCents - creditedSinceCents)), creditedSinceCents };
}

export function addBackOf(db: Db, c: ClaimRow, today: string) {
  const f = invoiceFacts(db, c.invoiceId, today)!;
  const { paidCents, creditedSinceCents } = paidSince(c, f.owedCents, f.creditedCents);
  const stillDeferred = vatShare(c.vatCents, c.owedCents - paidCents, c.owedCents);
  return { facts: f, paidCents, creditedSinceCents, vatCents: Math.max(0, c.vatCents - c.addedBackCents - stillDeferred) };
}

/** The claims whose customer has paid since: the add-backs to record (the 2550Q worksheet proposes them). */
export function addBacksDue(db: Db, today: string) {
  return (db.prepare(`${CLAIMS} ORDER BY d.number`).all({ except: '' }) as ClaimRow[])
    .filter((c) => c.vatCents > c.addedBackCents)
    .map((c) => ({ claim: c, ...addBackOf(db, c, today) }))
    .filter((x) => x.vatCents > 0)
    .map((x) => ({ claimId: x.claim.documentId, claimNumber: x.claim.number, invoiceId: x.claim.invoiceId, invoiceNumber: x.facts.invoiceNumber, customerName: x.facts.customerName, paidCents: x.paidCents, vatCents: x.vatCents }));
}

/** Release invoices whose agreed time to pay ended in an earlier quarter and that still owe, with no claim yet: what may be claimed. */
export function claimCandidates(db: Db, today: string) {
  return receivableSourcesAt(db, today).invoices
    .filter((i) => i.receivableCents > 0 && i.dueDate > i.date && quarterKey(i.dueDate) < quarterKey(today) && i.date >= FIRST_SALE_DATE && !claimOn(db, i.id))
    .map((i) => invoiceFacts(db, i.id, today)!)
    .filter((f) => f.owedCents > 0 && f.vatCents > 0 && f.writeOffs.length === 0)
    .map((f) => ({ invoiceId: f.id, invoiceNumber: f.invoiceNumber, number: f.number, customerName: f.customerName, dueDate: f.dueDate, owedCents: f.owedCents, vatCents: vatShare(f.vatCents, f.owedCents, f.grossCents) }));
}

/** Output VAT a quarter's claims took off (negative) or its add-backs put back (positive): 2301's movement from them. */
export function uncollectedVatOfQuarter(db: Db, from: string, to: string, docType: 'tax.uncollected_vat' | 'tax.uncollected_vat_recovery'): number {
  return db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
       JOIN documents d ON d.id = j.source_id AND j.source_type = 'document'
       WHERE j.sealed = 1 AND a.role_key = 'OUTPUT_VAT' AND d.doc_type = ? AND j.business_date BETWEEN ? AND ?`,
    )
    .pluck()
    .get(docType, from, to) as number;
}

