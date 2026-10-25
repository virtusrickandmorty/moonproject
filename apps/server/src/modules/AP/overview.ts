/**
 * The purchases and expenses overview (the owner's request, 25 Oct 2026): where each purchase is on its way from order
 * to payment, and what this month cost. A purchase goes Order (PO-) → Receive (RR-) → Bill (BILL-) → Pay (SPAY-); a
 * thing paid on the spot is an expense voucher (EXP-) instead. For each step: what is waiting at it.
 *   toReceive: ordered, not all received yet (PUR);      toBill: received, no recorded bill names the delivery yet (PUR);
 *   toPay: bills with something still owed, from the ledger (AP aging), soonest due first.
 * spending: this month's costs NET of input VAT by account, on bills (by their invoice's recording date) and on expense
 * vouchers, side by side. Read-only.
 */
import type { Db } from '../../platform/db/driver.ts';
import { voucherSpending } from '../EXP/public.ts';
import { deliveriesToBill, ordersToReceive, supplier } from '../PUR/public.ts';
import { supplierBalances } from './ledger.ts';
import { payableAgingAt } from './public.ts';

/** The last day of a date's month (YYYY-MM-DD, no clock). */
function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${date.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** What bills recorded between two dates cost, NET of input VAT, by the account each line went to. */
function billSpending(db: Db, from: string, to: string): { accountId: number; name: string; cents: number }[] {
  return db.prepare(`SELECT a.id AS accountId, a.name, SUM(l.amount_cents - l.vat_cents) AS cents FROM ap_bill_lines l JOIN documents d ON d.id = l.document_id
    JOIN accounts a ON a.id = COALESCE(l.account_id, (SELECT r.id FROM accounts r WHERE r.role_key = l.cost_role))
    WHERE d.status = 'posted' AND d.doc_type = 'ap.bill' AND d.business_date BETWEEN ? AND ? GROUP BY a.id`).all(from, to) as { accountId: number; name: string; cents: number }[];
}

export function purchasesOverview(db: Db, today: string) {
  const from = `${today.slice(0, 7)}-01`, to = monthEnd(today);
  const week = (() => { const [y, m, d] = today.split('-').map(Number) as [number, number, number]; const t = new Date(Date.UTC(y, m - 1, d + 7)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; })();
  const toPay = payableAgingAt(db, today).filter((b) => b.balanceCents > 0)
    .map((b) => ({ id: b.id, number: b.number, docType: b.docType, supplierId: b.supplierId, supplierName: supplier(db, b.supplierId)?.name ?? '?', dueDate: b.dueDate, balanceCents: b.balanceCents, overdue: b.dueDate < today, dueThisWeek: b.dueDate >= today && b.dueDate <= week }));
  const spent = new Map<number, { name: string; billsCents: number; vouchersCents: number }>();
  const add = (rows: { accountId: number; name: string; cents: number }[], key: 'billsCents' | 'vouchersCents') => {
    for (const r of rows) { const s = spent.get(r.accountId) ?? { name: r.name, billsCents: 0, vouchersCents: 0 }; s[key] += r.cents; spent.set(r.accountId, s); }
  };
  add(billSpending(db, from, to), 'billsCents');
  add(voucherSpending(db, from, to), 'vouchersCents');
  return {
    today, month: today.slice(0, 7),
    toReceive: ordersToReceive(db).map((o) => ({ ...o, late: !!o.expectedDate && o.expectedDate < today })),
    toBill: deliveriesToBill(db),
    toPay,
    advancesCents: supplierBalances(db).reduce((n, s) => n + s.advancesCents, 0),
    spending: [...spent.values()].sort((a, b) => b.billsCents + b.vouchersCents - (a.billsCents + a.vouchersCents)),
  };
}
export type PurchasesOverview = ReturnType<typeof purchasesOverview>;
