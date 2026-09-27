import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';

const MAX_CENTS = 100_000_000_00;

export const poLineInput = z
  .object({
    supplyId: z.string().trim().min(1),
    qty: z.number().int().positive().max(MAX_CENTS),
    unitCostCents: z.number().int().nonnegative().max(MAX_CENTS),
  })
  .strict();
export type POLineInput = z.infer<typeof poLineInput>;

export const purchaseOrderInput = z
  .object({
    supplierId: z.string().trim().min(1),
    expectedDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
    lines: z.array(poLineInput),
  })
  .strict();
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInput>;

export interface POLine extends POLineInput {
  lineNo: number;
  lineTotalCents: number;
}

export interface PurchaseOrder extends PurchaseOrderInput {
  totalCents: number;
  lines: POLine[];
}

export const purchaseOrderDoc: DocTypeDef<PurchaseOrderInput, PurchaseOrder> = {
  key: 'pur.po',
  module: 'PUR',
  title: 'Purchase Order',
  numbering: { series: { key: 'PO', prefix: 'PO-' } },
  permissions: { view: 'pur.po.view', create: 'pur.po.create', post: 'pur.po.post', cancel: 'pur.po.cancel', print: 'pur.po.print' },
  dating: 'system',
  inputSchema: purchaseOrderInput,

  compute(input, ctx) {
    let total = 0;
    const computedLines = input.lines.map((line, idx) => {
      const lineTotal = line.qty * line.unitCostCents;
      total += lineTotal;
      return {
        ...line,
        lineNo: idx + 1,
        lineTotalCents: lineTotal,
      };
    });

    return {
      ...input,
      totalCents: total,
      lines: computedLines,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    if (doc.lines.length === 0) {
      issues.push({ field: 'lines', code: 'NO_LINES', level: 'error', message: 'A purchase order must have at least one line.' });
    }
    if (doc.expectedDate && doc.expectedDate < ctx.businessDate) {
      issues.push({ field: 'expectedDate', code: 'PAST_DATE', level: 'error', message: 'Expected date cannot be in the past.' });
    }

    const supplier = ctx.db.prepare('SELECT is_active FROM pur_suppliers WHERE id = ?').get(doc.supplierId) as { is_active: number } | undefined;
    if (!supplier) {
      issues.push({ field: 'supplierId', code: 'INVALID_SUPPLIER', level: 'error', message: 'Supplier not found.' });
    } else if (!supplier.is_active) {
      issues.push({ field: 'supplierId', code: 'INACTIVE_SUPPLIER', level: 'error', message: 'Supplier is inactive.' });
    }

    const supplyStmt = ctx.db.prepare('SELECT is_active FROM pur_supplies WHERE id = ?');
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i]!;
      const supply = supplyStmt.get(line.supplyId) as { is_active: number } | undefined;
      if (!supply) {
        issues.push({ field: `lines.${i}.supplyId`, code: 'INVALID_SUPPLY', level: 'error', message: 'Supply not found.' });
      } else if (!supply.is_active) {
        issues.push({ field: `lines.${i}.supplyId`, code: 'INACTIVE_SUPPLY', level: 'error', message: 'Supply is inactive.' });
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO pur_purchase_orders (document_id, supplier_id, expected_date) VALUES (?, ?, ?)`
    ).run(h.documentId, doc.supplierId, doc.expectedDate ?? null);

    const insertLine = db.prepare(
      `INSERT INTO pur_po_lines (document_id, line_no, supply_id, qty, unit_cost_cents) VALUES (?, ?, ?, ?, ?)`
    );
    for (const line of doc.lines) {
      insertLine.run(h.documentId, line.lineNo, line.supplyId, line.qty, line.unitCostCents);
    }
  },

  load(db, documentId) {
    const header = db.prepare('SELECT * FROM pur_purchase_orders WHERE document_id = ?').get(documentId) as any;
    if (!header) throw new Error(`PO ${documentId} not found`);

    const dbLines = db.prepare('SELECT * FROM pur_po_lines WHERE document_id = ? ORDER BY line_no ASC').all(documentId) as any[];

    let total = 0;
    const lines = dbLines.map(l => {
      const lineTotal = l.qty * l.unit_cost_cents;
      total += lineTotal;
      return {
        lineNo: l.line_no,
        supplyId: l.supply_id,
        qty: l.qty,
        unitCostCents: l.unit_cost_cents,
        lineTotalCents: lineTotal
      };
    });

    return {
      supplierId: header.supplier_id,
      ...(header.expected_date ? { expectedDate: header.expected_date } : {}),
      totalCents: total,
      lines
    };
  },

  toInput(doc) {
    return {
      supplierId: doc.supplierId,
      ...(doc.expectedDate ? { expectedDate: doc.expectedDate } : {}),
      lines: doc.lines.map(l => ({ supplyId: l.supplyId, qty: l.qty, unitCostCents: l.unitCostCents }))
    };
  },

  dependents(db, id) {
    return (db.prepare(`
      SELECT d.id, d.number
      FROM documents d
      JOIN pur_receiving_reports rr ON rr.document_id = d.id
      WHERE rr.po_document_id = ? AND d.status <> 'cancelled'
    `).all(id) as { id: string, number: string }[]);
  },

  summary(doc, ctx) {
    const sName = (ctx.db.prepare('SELECT name FROM pur_suppliers WHERE id = ?').get(doc.supplierId) as { name: string } | undefined)?.name ?? '?';
    return `This will issue a purchase order to ${sName} for ${doc.lines.length} supply line(s) totaling ${formatPeso(doc.totalCents)}.`;
  },

  arbitrary(db) {
    const suppliers = (db.prepare('SELECT id FROM pur_suppliers WHERE is_active = 1').all() as any[]).map(r => r.id);
    const supplies = (db.prepare('SELECT id FROM pur_supplies WHERE is_active = 1').all() as any[]).map(r => r.id);

    const lineArb = fc.record({
      supplyId: fc.constantFrom(...supplies),
      qty: fc.integer({ min: 1, max: 1000 }),
      unitCostCents: fc.integer({ min: 0, max: 1000000 })
    });

    return fc.record({
      supplierId: fc.constantFrom(...suppliers),
      expectedDate: fc.option(fc.constant('2026-12-31')),
      lines: fc.array(lineArb, { minLength: 1, maxLength: 5 })
    });
  },
};
