/** Read-only operational reports. Money comes from sealed journals; source modules provide labels and line detail. */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { customerRef } from '../CUS/public.ts';
import { jobOrderRef, jobOrderStatusRows, invoiceSaleLines, releasesAwaitingInvoice } from '../JO/public.ts';
import { collectionsBetween } from '../COL/public.ts';
import { quickSaleLines } from '../QS/public.ts';

export const documentPath = (type: string, id: string) => `/docs/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;

export function depositsHeld(db: Db, asOf: string) {
  const accountId = resolveAccount(db, { role: 'CUSTOMER_DEPOSITS' }).id;
  const balances = db.prepare(`SELECT l.ref_doc_id AS jobOrderId,
    MAX(CASE WHEN l.party_type = 'customer' THEN l.party_id END) AS customerId,
    MAX(j.source_id) AS sourceId, SUM(l.credit_cents - l.debit_cents) AS heldCents
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE l.account_id = ? AND j.sealed = 1 AND j.business_date <= ?
    GROUP BY l.ref_doc_id, CASE WHEN l.ref_doc_id IS NULL THEN l.party_id END
    HAVING SUM(l.credit_cents - l.debit_cents) <> 0`).all(accountId, asOf) as {
      jobOrderId: string | null; customerId: string | null; sourceId: string; heldCents: number }[];
  const rows = balances.map((balance) => {
    const order = balance.jobOrderId ? jobOrderRef(db, balance.jobOrderId) : undefined;
    const source = db.prepare('SELECT id, doc_type AS type, number FROM documents WHERE id = ?')
      .get(balance.sourceId) as { id: string; type: string; number: string } | undefined;
    const customerId = order?.customerId ?? balance.customerId;
    const id = order?.id ?? source?.id ?? '';
    const type = order ? 'jo.job_order' : source?.type ?? '';
    return { customerId, customerName: order?.customerName ?? (customerId ? customerRef(db, customerId)?.display_name : undefined) ?? 'Unassigned',
      jobOrderId: order?.id ?? null, jobOrderNumber: order?.number ?? '', heldCents: balance.heldCents,
      id, number: order?.number ?? source?.number ?? '', documentId: id, documentType: type, documentNumber: order?.number ?? source?.number ?? '',
      documentPath: id && type ? documentPath(type, id) : '' };
  }).sort((a, b) => a.customerName.localeCompare(b.customerName) || a.jobOrderNumber.localeCompare(b.jobOrderNumber));
  return { asOf, rows, totalCents: rows.reduce((n, row) => n + row.heldCents, 0) };
}

export function collectionsRegister(db: Db, from: string, to: string) {
  const rows = collectionsBetween(db, from, to).map((r) => ({ ...r,
    documentType: 'col.collection', documentPath: documentPath('col.collection', r.id) }));
  const byCashPlace = new Map<string, { cashPlaceId: number | null; cashPlaceName: string; tenderCents: number }>();
  const byRecorder = new Map<string, { recordedBy: string; recordedByName: string; tenderCents: number }>();
  for (const r of rows) {
    if (r.status !== 'posted') continue;
    const place = byCashPlace.get(String(r.cashPlaceId)) ?? { cashPlaceId: r.cashPlaceId, cashPlaceName: r.cashPlaceName ?? 'No cash tender', tenderCents: 0 };
    place.tenderCents += r.tenderCents ?? 0; byCashPlace.set(String(r.cashPlaceId), place);
    const user = byRecorder.get(r.recordedBy) ?? { recordedBy: r.recordedBy, recordedByName: r.recordedByName, tenderCents: 0 };
    user.tenderCents += r.tenderCents ?? 0; byRecorder.set(r.recordedBy, user);
  }
  return { from, to, rows, byCashPlace: [...byCashPlace.values()], byRecorder: [...byRecorder.values()],
    tenderCents: [...byCashPlace.values()].reduce((n, r) => n + r.tenderCents, 0) };
}

type SaleLine = { id: string; customerId: string; customerName: string; lineNo: number;
  description: string; kind: string; qty: number; grossCents: number };
/** Divide ledger net sales across sold lines; the last line receives the rounding remainder. */
function allocate(total: number, lines: SaleLine[]) {
  const gross = lines.reduce((n, l) => n + l.grossCents, 0);
  let remaining = total;
  return lines.map((line, i) => {
    const salesCents = i === lines.length - 1 ? remaining : gross ? Math.trunc(total * line.grossCents / gross) : 0;
    remaining -= salesCents;
    return { ...line, salesCents };
  });
}
export function salesByPeriod(db: Db, from: string, to: string) {
  const sources = db.prepare(`SELECT j.source_id AS id, j.business_date AS date, d.number,
    d.doc_type AS documentType, SUM(l.credit_cents - l.debit_cents) AS salesCents
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    JOIN documents d ON d.id = j.source_id JOIN accounts a ON a.id = l.account_id
    WHERE j.sealed = 1 AND j.business_date BETWEEN ? AND ?
      AND d.doc_type IN ('jo.invoice_record', 'qs.sale')
      AND a.role_key IN ('SALES_MTO', 'SALES_RTW', 'SALES_SERVICE', 'SALES_DISCOUNTS')
    GROUP BY j.source_id, j.business_date ORDER BY j.business_date, d.number`).all(from, to) as {
      id: string; date: string; number: string; documentType: string; salesCents: number }[];
  const allLines = [...invoiceSaleLines(db), ...quickSaleLines(db)];
  const bySource = new Map<string, SaleLine[]>();
  for (const line of allLines) bySource.set(line.id, [...(bySource.get(line.id) ?? []), line]);
  const rows = sources.flatMap((source) => allocate(source.salesCents, bySource.get(source.id) ?? [{
    id: source.id, customerId: '', customerName: 'Unallocated', lineNo: 0,
    description: 'Unallocated sale', kind: 'other', qty: 0, grossCents: 0,
  }]).map((line) => ({
    ...line, date: source.date, number: source.number, documentType: source.documentType,
    documentPath: documentPath(source.documentType, source.id),
    // The posted line records its class and description, but has no catalog item ID or garment type.
    garmentType: line.kind === 'made_to_order' ? 'Unspecified garment type' : 'Other',
  })));
  const group = (key: (row: typeof rows[number]) => string) => {
    const sums = new Map<string, number>();
    for (const row of rows) sums.set(key(row), (sums.get(key(row)) ?? 0) + row.salesCents);
    return [...sums].map(([label, salesCents]) => ({ label, salesCents }));
  };
  return { from, to, rows, byPeriod: group((r) => r.date.slice(0, 7)),
    byCustomer: group((r) => r.customerName), byItem: group((r) => r.description),
    byGarmentType: group((r) => r.garmentType), totalCents: rows.reduce((n, r) => n + r.salesCents, 0) };
}

export function jobOrderFollowUp(db: Db) {
  const rows = jobOrderStatusRows(db).map((r) => ({ ...r, documentType: 'jo.job_order',
    documentPath: documentPath('jo.job_order', r.id) }));
  const awaiting = releasesAwaitingInvoice(db, '9999-12-31').map((r) => ({ ...r, documentType: 'jo.release',
    documentPath: documentPath('jo.release', r.id) }));
  const statuses = new Map<string, number>();
  for (const r of rows) statuses.set(r.stage, (statuses.get(r.stage) ?? 0) + 1);
  return { rows, byStatus: [...statuses].map(([stage, count]) => ({ stage, count })),
    releasedWithBalance: rows.filter((r) => r.stage === 'released' && r.balanceDueCents > 0), awaitingInvoice: awaiting };
}
