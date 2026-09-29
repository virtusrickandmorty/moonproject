/**
 * Downpayment VAT modes (PLAN D3 "Downpayment VAT modes", ACC-02): what collections, deposit transfers, refunds,
 * forfeits and JO's invoice records share. The mode is the effective-dated setting sales.deposit_vat_mode, read on each
 * document's date, except that a job order keeps the mode its first downpayment used (the first recorded, not cancelled
 * collection or deposit transfer that put a deposit on it, or downpayment invoice; an opening job order's deposits count
 * as mode A, the old books' treatment): a later document in another mode is recorded in the job order's mode, with a
 * warning. So one job order never mixes modes, and 2209 and the downpayment invoices always clear against its own invoices.
 *   A  deposit only: 2201 holds the gross; the release invoice books all the VAT.
 *   B  VAT on deposit: each deposit also posts Dr 2209 / Cr 2301 VAT(deposit) (DEP-VAT). Whatever takes deposits out
 *      (an invoice record applying them, a refund, a forfeit, a transfer to a job order not in mode B) takes out the same
 *      share of 2209, Dr 2301 / Cr 2209 (DEP-VAT-REV), so 2209 is zero once the job order holds no deposit; a transfer
 *      to another mode-B job order moves it, 2209 to 2209.
 *   C  invoice on downpayment: a downpayment invoice (JO) books Dr 1201 / Cr 2201 NET_dp, Cr 2301 VAT_dp (INV-DP); the
 *      release invoice takes NET_dp out of 2201 into sales and books only the rest of the VAT. What 2201 holds of a
 *      job order is then its NET_dp plus money not yet invoiced; the money is what refunds, transfers and forfeits move.
 * Each document writes col_deposit_vat rows: the mode (the first one fixes the job order's), the 2209 and downpayment
 * movements, and what they add to the sales register's VATable sales (TAX registers.ts), so the 2550Q sees the VATable
 * amount of the VAT in the quarter it is booked.
 */
import { vatFromGross, type Issue } from '@moonproject/shared';
import type { Db } from '../../../platform/db/driver.ts';
import type { DraftLine } from '../../../engine/ledger/post.ts';
import { resolveAccount } from '../../../engine/ledger/accounts.ts';
import { accountBalance } from '../../../engine/ledger/queries.ts';
import { settingAt } from '../../../engine/settings.ts';
import { joLedger, openingDepositOn, settleLines } from '../../JO/public.ts';

export type DepositMode = 'A' | 'B' | 'C';
export const MODE_WORDS: Record<DepositMode, string> = { A: 'deposit only', B: 'VAT on deposit', C: 'invoice on downpayment' };

export interface DepositVatRow {
  jobOrderId: string;
  customerId: string;
  mode: DepositMode;
  depositCents: number;
  depositVatCents: number;
  depositBaseCents: number;
  dpInvoicedCents: number;
  dpVatCents: number;
  registerBaseCents: number;
}

export const vatRow = (r: Pick<DepositVatRow, 'jobOrderId' | 'customerId' | 'mode'> & Partial<DepositVatRow>): DepositVatRow => ({
  depositCents: 0, depositVatCents: 0, depositBaseCents: 0, dpInvoicedCents: 0, dpVatCents: 0, registerBaseCents: 0, ...r,
});

/** Writes a document's rows: its own journal's ('original', from persist) or its cancel follow-up's ('cancel', from afterCancel). */
export function recordDepositVat(db: Db, documentId: string, posting: 'original' | 'cancel', rows: readonly DepositVatRow[]): void {
  const ins = db.prepare(
    `INSERT INTO col_deposit_vat (document_id, posting, line_no, job_order_id, customer_id, mode, deposit_cents, deposit_vat_cents, deposit_base_cents,
       dp_invoiced_cents, dp_vat_cents, register_base_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // A cancel settles each job order of the document in turn: its rows follow on.
  const after = db.prepare('SELECT COALESCE(MAX(line_no), 0) FROM col_deposit_vat WHERE document_id = ? AND posting = ?').pluck().get(documentId, posting) as number;
  rows.forEach((r, i) =>
    ins.run(documentId, posting, after + i + 1, r.jobOrderId, r.customerId, r.mode, r.depositCents, r.depositVatCents, r.depositBaseCents, r.dpInvoicedCents, r.dpVatCents, r.registerBaseCents),
  );
}

/** Rows that stand: those of recorded documents, and the cancel follow-ups (a cancelled document's own rows are mirrored). */
const STANDING = `FROM col_deposit_vat v JOIN documents d ON d.id = v.document_id WHERE v.job_order_id = ? AND (v.posting = 'cancel' OR d.status = 'posted')`;

/** Output VAT recognised on the job order's deposits (2209, a debit balance), from the ledger. */
export function depositVatHeld(db: Db, jobOrderId: string): number {
  return accountBalance(db, resolveAccount(db, { role: 'DEPOSIT_VAT' }).id, { refDocId: jobOrderId });
}

/** The VATable amount behind depositVatHeld (not a GL figure: the register needs it). */
function depositBaseHeld(db: Db, jobOrderId: string): number {
  return db.prepare(`SELECT COALESCE(SUM(v.deposit_base_cents), 0) ${STANDING}`).pluck().get(jobOrderId) as number;
}

/** Mode C: downpayments invoiced on the job order and not yet taken into sales by a release invoice. 2201 holds their NET. */
export function dpHeld(db: Db, jobOrderId: string): { grossCents: number; vatCents: number; netCents: number } {
  const r = db.prepare(`SELECT COALESCE(SUM(v.dp_invoiced_cents), 0) AS g, COALESCE(SUM(v.dp_vat_cents), 0) AS v ${STANDING}`).get(jobOrderId) as { g: number; v: number };
  return { grossCents: r.g, vatCents: r.v, netCents: r.g - r.v };
}

/** The mode the job order's first downpayment used, and the document that recorded it; null before any downpayment. */
export function lockedMode(db: Db, jobOrderId: string): { mode: DepositMode; number: string } | null {
  const opening = openingDepositOn(db, jobOrderId);
  if (opening) return { mode: 'A', number: opening };
  // Collections and transfers recorded before these rows existed were all mode A.
  return (
    (db
      .prepare(
        `SELECT mode, number FROM (
           SELECT v.mode, d.number, d.business_date AS day, d.posted_at AS at FROM col_deposit_vat v JOIN documents d ON d.id = v.document_id
            WHERE v.job_order_id = @jo AND v.posting = 'original' AND d.status = 'posted' AND (v.deposit_cents > 0 OR v.dp_invoiced_cents > 0)
           UNION ALL SELECT 'A', d.number, d.business_date, d.posted_at FROM col_applications a JOIN documents d ON d.id = a.document_id
            WHERE a.job_order_id = @jo AND a.to_deposit_cents > 0 AND d.status = 'posted' AND NOT EXISTS (SELECT 1 FROM col_deposit_vat v WHERE v.document_id = d.id)
           UNION ALL SELECT 'A', d.number, d.business_date, d.posted_at FROM col_deposit_transfers x JOIN documents d ON d.id = x.document_id
            WHERE x.to_job_order_id = @jo AND x.to_deposit_cents > 0 AND d.status = 'posted' AND NOT EXISTS (SELECT 1 FROM col_deposit_vat v WHERE v.document_id = d.id))
         ORDER BY day, at, number LIMIT 1`,
      )
      .get({ jo: jobOrderId }) as { mode: DepositMode; number: string } | undefined) ?? null
  );
}

export interface ModeOn { mode: DepositMode; setting: DepositMode; lockedBy: string | null }

/** The mode a document on the job order dated `date` follows: the job order's own, else the setting in force that day. */
export function depositModeOn(db: Db, jobOrderId: string, date: string, fallback?: DepositMode | null): ModeOn {
  const setting = settingAt(db, 'sales.deposit_vat_mode', date);
  const locked = lockedMode(db, jobOrderId);
  return { mode: locked?.mode ?? fallback ?? setting, setting, lockedBy: locked?.number ?? null };
}

/** The warning when the job order keeps a mode other than the one in force (rule: the first downpayment's mode stays). */
export function modeKeptIssue(m: ModeOn, jobOrderNumber: string, field: string): Issue | null {
  if (m.mode === m.setting) return null;
  const since = m.lockedBy ? `took its first downpayment on ${m.lockedBy} in mode ${m.mode}` : `has its money from a job order in mode ${m.mode}`;
  return {
    field,
    code: 'DEPOSIT_VAT_MODE_KEPT',
    level: 'warning',
    message: `${jobOrderNumber} ${since} (${MODE_WORDS[m.mode]}), so it stays in mode ${m.mode} although mode ${m.setting} (${MODE_WORDS[m.setting]}) is in force now. A job order never mixes the two.`,
  };
}

/** part/of of whole, rounded half away from zero; all of it when part is all (so a balance always clears exactly). */
export function shareOf(whole: number, part: number, of: number): number {
  if (of <= 0 || part >= of) return whole;
  if (part <= 0 || whole === 0) return 0;
  const n = BigInt(whole) * BigInt(part);
  const d = BigInt(of);
  const q = ((n < 0n ? -n : n) * 2n + d) / (2n * d);
  return Number(n < 0n ? -q : q);
}

/** VAT recognised on a mode-B deposit (DEP-VAT) at the rate in force on `date`, and its VATable amount. */
export function vatOnDeposit(db: Db, depositCents: number, date: string): { vatCents: number; baseCents: number } {
  const { vatCents, netCents } = vatFromGross(depositCents, settingAt(db, 'tax.vat_rate_bp', date));
  return { vatCents, baseCents: netCents };
}

/** The share of 2209 (and its VATable amount) that leaves with `outCents` of the job order's deposits (DEP-VAT-REV). */
export function vatLeaving(db: Db, jobOrderId: string, outCents: number): { vatCents: number; baseCents: number } {
  const vat = depositVatHeld(db, jobOrderId);
  const base = depositBaseHeld(db, jobOrderId);
  if ((vat === 0 && base === 0) || outCents <= 0) return { vatCents: 0, baseCents: 0 };
  const held = joLedger(db, jobOrderId).depositsHeldCents;
  return { vatCents: shareOf(vat, outCents, held), baseCents: shareOf(base, outCents, held) };
}

/** + recognised on the job order's deposits (Dr 2209 / Cr 2301), − released from them (Dr 2301 / Cr 2209). */
export function depositVatLines(customerId: string, jobOrderId: string, jobOrderNumber: string, vatCents: number): DraftLine[] {
  if (vatCents === 0) return [];
  const party = { type: 'customer', id: customerId };
  const held = { account: { role: 'DEPOSIT_VAT' }, party, ref: { documentId: jobOrderId }, memo: `VAT on the deposits of ${jobOrderNumber}` };
  const output = { account: { role: 'OUTPUT_VAT' }, party, memo: `VAT on the deposits of ${jobOrderNumber}` };
  return vatCents > 0
    ? [{ ...held, debitCents: vatCents }, { ...output, creditCents: vatCents }]
    : [{ ...output, debitCents: -vatCents }, { ...held, creditCents: -vatCents }];
}

/**
 * After a cancel's mirror (D6), for the cancel's follow-up journal: settleLines puts the job order's receivable and
 * deposits back in line, then 2209 is put back in line with the deposits: when the job order holds no deposit any more,
 * or 2209 went below zero, what is left of it goes back to output VAT, so 2209 never outlives the deposits it was on.
 * Writes the 2209 part's row (posting 'cancel') under `documentId`, the cancelled document.
 */
export function settleJobOrder(db: Db, documentId: string, customerId: string, jobOrderId: string, jobOrderNumber: string): DraftLine[] {
  const lines = settleLines(db, customerId, jobOrderId, jobOrderNumber);
  const into = lines.filter((l) => 'role' in l.account && l.account.role === 'CUSTOMER_DEPOSITS').reduce((s, l) => s + (l.creditCents ?? 0) - (l.debitCents ?? 0), 0);
  const held = joLedger(db, jobOrderId).depositsHeldCents + into;
  const vat = depositVatHeld(db, jobOrderId);
  const base = depositBaseHeld(db, jobOrderId);
  if ((vat === 0 && base === 0) || (held > 0 && vat >= 0 && base >= 0)) return lines;
  recordDepositVat(db, documentId, 'cancel', [vatRow({ jobOrderId, customerId, mode: 'B', depositVatCents: -vat, depositBaseCents: -base, registerBaseCents: -base })]);
  return [...lines, ...depositVatLines(customerId, jobOrderId, jobOrderNumber, -vat)];
}

/**
 * What a journal's deposit VAT rows add to its VATable sales in the sales register (TAX): the document's own rows,
 * negative on its mirror, or its cancel follow-up's rows.
 */
export function registerBaseOf(db: Db, sourceType: string, sourceId: string, posting: 'original' | 'reversal'): number {
  const rows = (p: 'original' | 'cancel') =>
    db.prepare('SELECT COALESCE(SUM(register_base_cents), 0) FROM col_deposit_vat WHERE document_id = ? AND posting = ?').pluck().get(sourceId, p) as number;
  if (sourceType === 'document-cancel') return rows('cancel');
  if (sourceType !== 'document') return 0;
  return posting === 'reversal' ? 0 - rows('original') : rows('original');
}

/** Documents whose rows add a VATable amount to the sales register (TAX lists their journals even with no 2301 line). */
export function registerBaseSources(db: Db): string[] {
  return db.prepare('SELECT DISTINCT document_id FROM col_deposit_vat WHERE register_base_cents <> 0').pluck().all() as string[];
}

/** Mode C: the downpayment gross each release invoice took into sales, by invoice record (the AR aging's memo, JO). */
export function dpAppliedByInvoice(db: Db): Map<string, number> {
  const rows = db
    .prepare(`SELECT document_id AS id, 0 - SUM(dp_invoiced_cents) AS cents FROM col_deposit_vat WHERE posting = 'original' AND dp_invoiced_cents < 0 GROUP BY document_id`)
    .all() as { id: string; cents: number }[];
  return new Map(rows.map((r) => [r.id, r.cents]));
}

/** A document's own rows, in order (for loading it back). */
export function depositVatRowsOf(db: Db, documentId: string): DepositVatRow[] {
  return db
    .prepare(
      `SELECT job_order_id AS jobOrderId, customer_id AS customerId, mode, deposit_cents AS depositCents, deposit_vat_cents AS depositVatCents,
         deposit_base_cents AS depositBaseCents, dp_invoiced_cents AS dpInvoicedCents, dp_vat_cents AS dpVatCents, register_base_cents AS registerBaseCents
       FROM col_deposit_vat WHERE document_id = ? AND posting = 'original' ORDER BY line_no`,
    )
    .all(documentId) as DepositVatRow[];
}

/**
 * What a release invoice of `grossCents` does with the job order's deposits on `date` (D5 DEP-APPLY, DEP-VAT-REV, mode C):
 * the downpayments invoiced ahead (mode C) are taken into sales first, oldest first as one pool, up to the gross, with
 * their share of VAT; then money held is applied, up to what is left; in mode B the share of 2209 on that money leaves.
 */
export function invoiceDeposits(db: Db, jobOrderId: string, grossCents: number, date: string) {
  const m = depositModeOn(db, jobOrderId, date);
  const dp = dpHeld(db, jobOrderId);
  const dpAppliedCents = Math.max(0, Math.min(dp.grossCents, grossCents));
  const dpVatAppliedCents = shareOf(dp.vatCents, dpAppliedCents, dp.grossCents);
  const depositAppliedCents = Math.max(0, Math.min(joLedger(db, jobOrderId).depositsHeldCents, grossCents - dpAppliedCents));
  const out = vatLeaving(db, jobOrderId, depositAppliedCents);
  return {
    depositVatMode: m.mode,
    depositAppliedCents, depositVatCents: out.vatCents, depositVatBaseCents: out.baseCents, dpAppliedCents, dpVatAppliedCents,
  };
}
