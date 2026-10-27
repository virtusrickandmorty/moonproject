import { z } from 'zod';
import fc from 'fast-check';
import { formatPeso, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';
import { requestStatus } from '../requests.ts';
import { fromHundredths, lineCents, qtySchema, toHundredths } from '../qty.ts';

/** Who may make a purchase order without an approved purchase request (the owner's decision, 26 Oct 2026: the owner and the accountant). */
export const WITHOUT_REQUEST = 'pur.po.without_request';

const MAX_CENTS = 100_000_000_00;

export const poLineInput = z
  .object({
    supplyId: z.string().trim().min(1),
    qty: qtySchema, // up to 2 decimal places (12.5 yards, Oct 27, 2026)
    unitCostCents: z.number().int().nonnegative().max(MAX_CENTS),
  })
  .strict()
  .refine(l => l.qty * l.unitCostCents <= MAX_CENTS, 'Line total must be safe');
export type POLineInput = z.infer<typeof poLineInput>;

function isValidDate(dateString: string) {
  const date = new Date(dateString);
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return iso.startsWith(dateString);
}

export const purchaseOrderInput = z
  .object({
    supplierId: z.string().trim().min(1),
    expectedDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').refine(isValidDate, 'Must be a real date').optional(),
    lines: z.array(poLineInput).max(200),
    requestId: z.string().trim().min(1).max(80).optional(), // the approved purchase request (PRQ-) it orders
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
      const lineTotal = lineCents(toHundredths(line.qty), line.unitCostCents);
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

    // The approved request it orders (the owner's request, 26 Oct 2026): required unless the user may order without one.
    if (doc.requestId) {
      const r = requestStatus(ctx.db, doc.requestId);
      const add = (level: Issue['level'], code: string, message: string) => issues.push({ field: 'requestId', code, level, message });
      if (!r || r.status !== 'posted') add('error', 'REQUEST', 'Pick a recorded purchase request.');
      else if (r.state === 'waiting') add('error', 'REQUEST_WAITING', `${r.number} is still waiting for the owner or the accountant to approve it.`);
      else if (r.state === 'rejected') add('error', 'REQUEST_REJECTED', `${r.number} was not approved${r.decision?.note ? `: ${r.decision.note}` : ''}.`);
      else if (r.state === 'used') add('error', 'REQUEST_USED', `${r.number} is already used on ${r.usedBy!.number}.`);
      else {
        if (r.supplierId && r.supplierId !== doc.supplierId) add('warning', 'REQUEST_SUPPLIER', `${r.number} asked for ${r.supplierName}. Check that this supplier is right.`);
        if (doc.totalCents > r.totalCents) add('warning', 'REQUEST_MORE', `This order (${formatPeso(doc.totalCents)}) is more than ${r.number} was approved for (${formatPeso(r.totalCents)}).`);
      }
    } else if (!ctx.can(WITHOUT_REQUEST)) {
      issues.push({ field: 'requestId', code: 'NEED_REQUEST', level: 'error', message: 'Make the purchase order from an approved purchase request. The owner or the accountant approves the request first.' });
    }

    if (doc.totalCents > MAX_CENTS) {
        issues.push({ field: 'lines', code: 'TOTAL_TOO_LARGE', level: 'error', message: 'Total amount exceeds safe limits.' });
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
      `INSERT INTO pur_purchase_orders (document_id, supplier_id, expected_date, request_id) VALUES (?, ?, ?, ?)`
    ).run(h.documentId, doc.supplierId, doc.expectedDate ?? null, doc.requestId ?? null);

    const insertLine = db.prepare(
      `INSERT INTO pur_po_lines (document_id, line_no, supply_id, qty_hundredths, unit_cost_cents) VALUES (?, ?, ?, ?, ?)`
    );
    for (const line of doc.lines) {
      insertLine.run(h.documentId, line.lineNo, line.supplyId, toHundredths(line.qty), line.unitCostCents);
    }
  },

  load(db, documentId) {
    const header = db.prepare('SELECT * FROM pur_purchase_orders WHERE document_id = ?').get(documentId) as any;
    if (!header) throw new Error(`PO ${documentId} not found`);

    const dbLines = db.prepare('SELECT * FROM pur_po_lines WHERE document_id = ? ORDER BY line_no ASC').all(documentId) as any[];

    let total = 0;
    const lines = dbLines.map(l => {
      const lineTotal = lineCents(l.qty_hundredths, l.unit_cost_cents);
      total += lineTotal;
      return {
        lineNo: l.line_no,
        supplyId: l.supply_id,
        qty: fromHundredths(l.qty_hundredths),
        unitCostCents: l.unit_cost_cents,
        lineTotalCents: lineTotal
      };
    });

    return {
      supplierId: header.supplier_id,
      ...(header.expected_date ? { expectedDate: header.expected_date } : {}),
      ...(header.request_id ? { requestId: header.request_id } : {}),
      totalCents: total,
      lines
    };
  },

  toInput(doc) {
    return {
      supplierId: doc.supplierId,
      ...(doc.expectedDate ? { expectedDate: doc.expectedDate } : {}),
      ...(doc.requestId ? { requestId: doc.requestId } : {}),
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

    const dateStrArb = fc.integer({ min: 1, max: 12 }).chain(m => fc.integer({ min: 1, max: 28 }).map(d => `2030-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`));

    return fc.record({
      supplierId: fc.constantFrom(...suppliers),
      expectedDate: fc.option(dateStrArb, { nil: undefined }),
      lines: fc.array(lineArb, { minLength: 1, maxLength: 5 })
    }).map((r) => {
        if (!r.expectedDate) delete r.expectedDate;
        return r;
    });
  },
};
