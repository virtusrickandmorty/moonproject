/**
 * Purchase requests (PRQ-, the owner's request, 26 Oct 2026): where each one stands, read-only. A recorded request waits
 * for the owner or the accountant to approve or reject it (pur_request_decisions, once); an approved one goes on to one
 * purchase order (pur_purchase_orders.request_id) or one expense voucher (EXP's exp_vouchers.request_id, read here as
 * receivedNotBilledForReport reads AP's bills), and is then used. Who may approve is checked by the route.
 */
import type { Db } from '../../platform/db/driver.ts';

export type RequestState = 'waiting' | 'approved' | 'rejected' | 'used' | 'cancelled';
export interface RequestLine { lineNo: number; supplyId: string | null; supplyName: string | null; unit: string | null; description: string; qty: number; unitCostCents: number }
export interface RequestStatus {
  id: string; number: string; date: string; status: 'posted' | 'cancelled'; state: RequestState; totalCents: number;
  purpose: string; neededBy: string | null; supplierId: string | null; supplierName: string | null; note: string | null;
  requestedBy: string; requestedByName: string;
  decision: { decision: 'approved' | 'rejected'; note: string | null; userName: string; at: string } | null;
  /** The posted purchase order or expense voucher that used it. */
  usedBy: { id: string; number: string; docType: 'pur.po' | 'exp.voucher' } | null;
  lines: RequestLine[];
}

/** The posted purchase order or expense voucher that names a request, if any (one at most is allowed). */
export function requestUsedBy(db: Db, requestId: string, except?: string): RequestStatus['usedBy'] {
  return (db.prepare(`SELECT d.id, d.number, d.doc_type AS docType FROM documents d
      WHERE d.status = 'posted' AND d.id <> @except AND d.id IN (SELECT document_id FROM pur_purchase_orders WHERE request_id = @id
        UNION SELECT document_id FROM exp_vouchers WHERE request_id = @id)
      ORDER BY d.posted_at LIMIT 1`).get({ id: requestId, except: except ?? '' }) as RequestStatus['usedBy'] | undefined) ?? null;
}

const HEAD = `SELECT d.id, d.number, d.business_date AS date, d.status, d.total_cents AS totalCents, r.purpose, r.needed_by AS neededBy,
    r.supplier_id AS supplierId, s.name AS supplierName, r.note, d.posted_by AS requestedBy, u.display_name AS requestedByName,
    x.decision, x.note AS decisionNote, xu.display_name AS decisionUser, x.at AS decisionAt
  FROM pur_requests r JOIN documents d ON d.id = r.document_id JOIN users u ON u.id = d.posted_by
  LEFT JOIN pur_suppliers s ON s.id = r.supplier_id LEFT JOIN pur_request_decisions x ON x.request_id = r.document_id LEFT JOIN users xu ON xu.id = x.user_id`;
type HeadRow = Omit<RequestStatus, 'state' | 'decision' | 'usedBy' | 'lines'> & { decision: 'approved' | 'rejected' | null; decisionNote: string | null; decisionUser: string | null; decisionAt: string | null };

function shape(db: Db, r: HeadRow, withLines: boolean): RequestStatus {
  const usedBy = r.status === 'posted' ? requestUsedBy(db, r.id) : null;
  const state: RequestState = r.status === 'cancelled' ? 'cancelled' : usedBy ? 'used' : r.decision ?? 'waiting';
  const { decision, decisionNote, decisionUser, decisionAt, ...head } = r;
  const lines = withLines ? db.prepare(`SELECT l.line_no AS lineNo, l.supply_id AS supplyId, s.name AS supplyName, s.unit, l.description, l.qty_hundredths / 100.0 AS qty, l.unit_cost_cents AS unitCostCents
    FROM pur_request_lines l LEFT JOIN pur_supplies s ON s.id = l.supply_id WHERE l.document_id = ? ORDER BY l.line_no`).all(r.id) as RequestLine[] : [];
  return { ...head, state, decision: decision ? { decision, note: decisionNote, userName: decisionUser ?? '?', at: decisionAt! } : null, usedBy, lines };
}

/** One request with its lines, its decision and what used it. */
export function requestStatus(db: Db, id: string): RequestStatus | undefined {
  const r = db.prepare(`${HEAD} WHERE d.id = ?`).get(id) as HeadRow | undefined;
  return r && shape(db, r, true);
}

/** Recorded requests in a state, oldest first (waiting: the approvers' list; approved: ready to order or pay). */
export function requestsIn(db: Db, state: 'waiting' | 'approved', withLines = false): RequestStatus[] {
  return (db.prepare(`${HEAD} WHERE d.status = 'posted' AND ${state === 'waiting' ? 'x.decision IS NULL' : "x.decision = 'approved'"} ORDER BY d.number`).all() as HeadRow[])
    .map((r) => shape(db, r, withLines)).filter((r) => r.state === state);
}
