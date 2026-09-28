import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { customerRef } from '../CUS/public.ts';
import { receivableSourcesAt } from '../JO/public.ts';

type Bucket = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90';
const buckets: Bucket[] = ['current', 'days1to30', 'days31to60', 'days61to90', 'over90'];
type Amounts = Record<Bucket, number>;
const empty = (): Amounts => ({ current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 });
const sum = (a: Amounts) => buckets.reduce((n, key) => n + a[key], 0);
const ageBucket = (asOf: string, due: string): Bucket => {
  const days = Math.round((Date.parse(asOf) - Date.parse(due)) / 86_400_000);
  return days <= 0 ? 'current' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'over90';
};

interface ArBalance { refDocId: string | null; customerId: string | null; balanceCents: number }
function arBalances(db: Db, asOf: string): ArBalance[] {
  const accountId = resolveAccount(db, { role: 'AR_TRADE' }).id;
  return db.prepare(`SELECT l.ref_doc_id AS refDocId,
    MAX(CASE WHEN l.party_type = 'customer' THEN l.party_id END) AS customerId,
    SUM(l.debit_cents - l.credit_cents) AS balanceCents
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE l.account_id = ? AND j.sealed = 1 AND j.business_date <= ?
    GROUP BY l.ref_doc_id, CASE WHEN l.ref_doc_id IS NULL THEN l.party_id END
    HAVING SUM(l.debit_cents - l.credit_cents) <> 0`)
    .all(accountId, asOf) as ArBalance[];
}

export function arAging(db: Db, asOf: string) {
  const sources = receivableSourcesAt(db, asOf);
  const orders = new Map(sources.orders.map((order) => [order.id, order]));
  const invoices = new Map<string, typeof sources.invoices>();
  for (const invoice of sources.invoices) {
    const list = invoices.get(invoice.jobOrderId) ?? [];
    list.push(invoice);
    invoices.set(invoice.jobOrderId, list);
  }
  const rows: {
    customerId: string | null; customerName: string; documentId: string | null; documentNumber: string;
    documentType: string | null; jobOrderNumber: string; date: string; dueDate: string; buckets: Amounts; totalCents: number;
  }[] = [];
  for (const balance of arBalances(db, asOf)) {
    const order = balance.refDocId ? orders.get(balance.refDocId) : undefined;
    const customerId = order?.customerId ?? balance.customerId;
    const customerName = order?.customerName ?? (customerId ? customerRef(db, customerId)?.display_name : undefined) ?? 'Unassigned';
    let remaining = balance.balanceCents;
    // Collections settle a job order, not an individual invoice. Attribute the remaining AR to the newest
    // invoice records first, so the oldest invoice is considered paid first.
    for (const invoice of [...(balance.refDocId ? invoices.get(balance.refDocId) ?? [] : [])].reverse()) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, invoice.receivableCents);
      remaining -= amount;
      const dueDate = invoice.dueDate;
      const amounts = empty(); amounts[ageBucket(asOf, dueDate)] = amount;
      rows.push({ customerId: invoice.customerId, customerName: invoice.customerName, documentId: invoice.id,
        documentNumber: invoice.number, documentType: 'jo.invoice_record', jobOrderNumber: order?.number ?? '',
        date: invoice.date, dueDate, buckets: amounts, totalCents: amount });
    }
    if (remaining !== 0) {
      const amounts = empty(); amounts.current = remaining;
      rows.push({ customerId: customerId ?? null, customerName, documentId: order?.id ?? null,
        documentNumber: order?.number ?? 'Unallocated AR', documentType: order ? 'jo.job_order' : null,
        jobOrderNumber: order?.number ?? '', date: '', dueDate: '', buckets: amounts, totalCents: remaining });
    }
  }
  rows.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.dueDate.localeCompare(b.dueDate) || a.documentNumber.localeCompare(b.documentNumber));
  const totals = empty();
  for (const row of rows) for (const bucket of buckets) totals[bucket] += row.buckets[bucket];
  const memo = sources.orders.filter((order) => order.notInvoicedCents > 0)
    .map((order) => ({ customerId: order.customerId, customerName: order.customerName, jobOrderId: order.id,
      jobOrderNumber: order.number, dueDate: order.dueDate, notInvoicedCents: order.notInvoicedCents }));
  return { asOf, rows, buckets: totals, totalCents: sum(totals), memo, memoTotalCents: memo.reduce((n, row) => n + row.notInvoicedCents, 0) };
}

interface CustomerLine {
  journalId: string; businessDate: string; journalNumber: string; sourceId: string; documentType: string | null;
  documentNumber: string | null; memo: string; 'debitCents': number; creditCents: number;
}
function customerLedger(db: Db, accountId: number, customerId: string, to: string): CustomerLine[] {
  return db.prepare(`SELECT j.id AS journalId, j.business_date AS businessDate, j.number AS journalNumber,
    j.source_id AS sourceId, d.doc_type AS documentType, d.number AS documentNumber,
    j.memo, SUM(l.debit_cents) AS debitCents, SUM(l.credit_cents) AS creditCents
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    LEFT JOIN documents d ON d.id = j.source_id
    WHERE l.account_id = ? AND j.sealed = 1 AND l.party_type = 'customer' AND l.party_id = ? AND j.business_date <= ?
    GROUP BY j.id ORDER BY j.business_date, j.number, j.id`).all(accountId, customerId, to) as CustomerLine[];
}

export function customerStatement(db: Db, customerId: string, from: string, to: string) {
  const customer = customerRef(db, customerId);
  if (!customer) return null;
  const arId = resolveAccount(db, { role: 'AR_TRADE' }).id;
  const depositId = resolveAccount(db, { role: 'CUSTOMER_DEPOSITS' }).id;
  const all = customerLedger(db, arId, customerId, to);
  const openingBalanceCents = all.filter((line) => line.businessDate < from)
    .reduce((n, line) => n + line.debitCents - line.creditCents, 0);
  let runningBalanceCents = openingBalanceCents;
  const lines = all.filter((line) => line.businessDate >= from).map((line) => ({
    ...line, runningBalanceCents: runningBalanceCents += line.debitCents - line.creditCents,
  }));
  const allDeposits = customerLedger(db, depositId, customerId, to);
  const openingDepositsHeldCents = allDeposits.filter((line) => line.businessDate < from)
    .reduce((n, line) => n + line.creditCents - line.debitCents, 0);
  let depositsHeldCents = openingDepositsHeldCents;
  const depositLines = allDeposits.filter((line) => line.businessDate >= from).map((line) => ({
    ...line, runningHeldCents: depositsHeldCents += line.creditCents - line.debitCents,
  }));
  return { customerId, customerName: customer.display_name, from, to, openingBalanceCents, lines,
    closingBalanceCents: runningBalanceCents, openingDepositsHeldCents, depositLines, depositsHeldCents };
}
