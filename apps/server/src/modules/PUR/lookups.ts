/**
 * Read-only lookups for the supplier and purchasing screens: purchase orders and receiving reports with names instead
 * of ids, and what is still to receive on each purchase order line. Nothing here writes or posts.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { notFound } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';

export interface PoLine { lineNo: number; supplyId: string; supplyName: string; unit: string; orderedQty: number; receivedQty: number; remainingQty: number; unitCostCents: number }
interface PoHead { id: string; number: string; status: 'posted' | 'cancelled'; date: string; totalCents: number; expectedDate: string | null; supplierId: string; supplierName: string }

const PO_HEAD = `SELECT d.id, d.number, d.status, d.business_date AS date, d.total_cents AS totalCents, po.expected_date AS expectedDate, po.supplier_id AS supplierId, s.name AS supplierName
  FROM pur_purchase_orders po JOIN documents d ON d.id = po.document_id JOIN pur_suppliers s ON s.id = po.supplier_id`;

/** Every line of a purchase order with what posted receiving reports have received so far (a cancelled report receives nothing). */
function poLines(db: Db, poId: string): PoLine[] {
  const rows = db
    .prepare(
      `SELECT l.line_no AS lineNo, l.supply_id AS supplyId, s.name AS supplyName, s.unit, l.qty AS orderedQty, l.unit_cost_cents AS unitCostCents,
         COALESCE((SELECT SUM(r.qty) FROM pur_rr_lines r JOIN documents rd ON rd.id = r.document_id
                   WHERE r.po_document_id = l.document_id AND r.po_line_no = l.line_no AND rd.status = 'posted'), 0) AS receivedQty
       FROM pur_po_lines l JOIN pur_supplies s ON s.id = l.supply_id WHERE l.document_id = ? ORDER BY l.line_no`,
    )
    .all(poId) as Omit<PoLine, 'remainingQty'>[];
  return rows.map((r) => ({ ...r, remainingQty: Math.max(0, r.orderedQty - r.receivedQty) }));
}

export function purLookupRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const id = (req: { params: unknown }) => z.object({ id: z.string() }).parse(req.params).id;
  const supplierExists = (supplierId: string) => {
    if (!db.prepare('SELECT 1 FROM pur_suppliers WHERE id = ?').get(supplierId)) throw notFound('The supplier');
  };

  /** Posted purchase orders with something still to receive: where a receiving report starts. */
  app.get('/api/pur/purchase-orders/open', { config: { permission: 'pur.rr.create' } }, async () =>
    (db.prepare(`${PO_HEAD} WHERE d.status = 'posted' ORDER BY d.number`).all() as PoHead[])
      .map((po) => ({ ...po, lines: poLines(db, po.id) }))
      .filter((po) => po.lines.some((l) => l.remainingQty > 0)),
  );

  app.get('/api/pur/purchase-orders/:id', { config: { permission: 'pur.po.view' } }, async (req) => {
    const po = db.prepare(`${PO_HEAD} WHERE d.id = ?`).get(id(req)) as PoHead | undefined;
    if (!po) throw notFound('The purchase order');
    return { ...po, lines: poLines(db, po.id) };
  });

  app.get('/api/pur/receiving-reports/:id', { config: { permission: 'pur.rr.view' } }, async (req) => {
    const rr = db
      .prepare(
        `SELECT d.id, d.number, d.status, d.business_date AS date, r.po_document_id AS poId, pd.number AS poNumber, po.supplier_id AS supplierId, s.name AS supplierName
         FROM pur_receiving_reports r JOIN documents d ON d.id = r.document_id JOIN documents pd ON pd.id = r.po_document_id
         JOIN pur_purchase_orders po ON po.document_id = r.po_document_id JOIN pur_suppliers s ON s.id = po.supplier_id WHERE d.id = ?`,
      )
      .get(id(req)) as { id: string; poId: string } | undefined;
    if (!rr) throw notFound('The receiving report');
    const lines = db
      .prepare(
        `SELECT r.line_no AS lineNo, r.po_line_no AS poLineNo, p.supply_id AS supplyId, s.name AS supplyName, s.unit, r.qty
         FROM pur_rr_lines r JOIN pur_po_lines p ON p.document_id = r.po_document_id AND p.line_no = r.po_line_no JOIN pur_supplies s ON s.id = p.supply_id
         WHERE r.document_id = ? ORDER BY r.line_no`,
      )
      .all(rr.id);
    return { ...rr, lines };
  });

  /** A supplier's purchase orders, newest first, and whether everything on each has been received. */
  app.get('/api/pur/suppliers/:id/purchase-orders', { config: { permission: 'pur.po.view' } }, async (req) => {
    supplierExists(id(req));
    return (db.prepare(`${PO_HEAD} WHERE po.supplier_id = ? ORDER BY d.number DESC`).all(id(req)) as PoHead[]).map((po) => {
      const { supplierId: _s, supplierName: _n, ...head } = po;
      return { ...head, fullyReceived: poLines(db, po.id).every((l) => l.remainingQty === 0) };
    });
  });

  app.get('/api/pur/suppliers/:id/receiving-reports', { config: { permission: 'pur.rr.view' } }, async (req) => {
    supplierExists(id(req));
    return db
      .prepare(
        `SELECT d.id, d.number, d.status, d.business_date AS date, r.po_document_id AS poId, pd.number AS poNumber
         FROM pur_receiving_reports r JOIN documents d ON d.id = r.document_id JOIN documents pd ON pd.id = r.po_document_id
         JOIN pur_purchase_orders po ON po.document_id = r.po_document_id WHERE po.supplier_id = ? ORDER BY d.number DESC`,
      )
      .all(id(req));
  });
}
