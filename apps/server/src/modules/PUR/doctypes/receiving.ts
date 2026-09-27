import { z } from 'zod';
import fc from 'fast-check';
import { newId, type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';

export const rrLineInput = z
  .object({
    id: z.string().trim().min(1).optional(),
    poLineId: z.string().trim().min(1),
    qty: z.number().int().positive(),
  })
  .strict();
export type RRLineInput = z.infer<typeof rrLineInput>;

export const receivingReportInput = z
  .object({
    poDocumentId: z.string().trim().min(1),
    lines: z.array(rrLineInput),
  })
  .strict();
export type ReceivingReportInput = z.infer<typeof receivingReportInput>;

export interface RRLine extends RRLineInput {
  id: string;
}

export interface ReceivingReport extends ReceivingReportInput {
  lines: RRLine[];
  totalCents: number; // Always 0 for Receiving, but required by engine compute contract implicitly.
}

export const receivingReportDoc: DocTypeDef<ReceivingReportInput, ReceivingReport> = {
  key: 'pur.rr',
  module: 'PUR',
  title: 'Receiving Report',
  numbering: { series: { key: 'RR', prefix: 'RR-' } },
  permissions: { view: 'pur.rr.view', create: 'pur.rr.create', post: 'pur.rr.post', cancel: 'pur.rr.cancel', print: 'pur.rr.print' },
  dating: 'system',
  inputSchema: receivingReportInput,

  compute(input, ctx) {
    const computedLines = input.lines.map((line) => {
      return {
        ...line,
        id: line.id ?? newId(),
      };
    });

    return {
      ...input,
      totalCents: 0,
      lines: computedLines,
    };
  },

  validate(doc, ctx) {
    const issues: Issue[] = [];
    if (doc.lines.length === 0) {
      issues.push({ field: 'lines', code: 'NO_LINES', level: 'error', message: 'A receiving report must have at least one line.' });
    }
    const poHeader = ctx.db.prepare('SELECT id FROM documents WHERE id = ? AND doc_type = ? AND status = ?').get(doc.poDocumentId, 'pur.po', 'posted') as any;
    if (!poHeader) {
      issues.push({ field: 'poDocumentId', code: 'INVALID_PO', level: 'error', message: 'Posted purchase order not found.' });
    }

    const poLineStmt = ctx.db.prepare('SELECT id, qty FROM pur_po_lines WHERE document_id = ? AND id = ?');
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i]!;
      const poLine = poLineStmt.get(doc.poDocumentId, line.poLineId) as any;
      if (!poLine) {
        issues.push({ field: `lines.${i}.poLineId`, code: 'INVALID_PO_LINE', level: 'error', message: 'PO line not found in this purchase order.' });
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO pur_receiving_reports (document_id, po_document_id) VALUES (?, ?)`
    ).run(h.documentId, doc.poDocumentId);

    const insertLine = db.prepare(
      `INSERT INTO pur_rr_lines (id, document_id, po_line_id, qty) VALUES (?, ?, ?, ?)`
    );
    for (const line of doc.lines) {
      insertLine.run(line.id, h.documentId, line.poLineId, line.qty);
    }
  },

  load(db, documentId) {
    const header = db.prepare('SELECT * FROM pur_receiving_reports WHERE document_id = ?').get(documentId) as any;
    if (!header) throw new Error(`RR ${documentId} not found`);

    const dbLines = db.prepare('SELECT * FROM pur_rr_lines WHERE document_id = ?').all(documentId) as any[];

    const lines = dbLines.map(l => {
      return {
        id: l.id,
        poLineId: l.po_line_id,
        qty: l.qty,
      };
    });

    return {
      poDocumentId: header.po_document_id,
      totalCents: 0,
      lines
    };
  },

  toInput(doc) {
    return {
      poDocumentId: doc.poDocumentId,
      lines: doc.lines.map(l => ({ id: l.id, poLineId: l.poLineId, qty: l.qty }))
    };
  },

  summary(doc) {
    return `This will record receiving for purchase order.`;
  },

  arbitrary(db) {
    const poLines = db.prepare('SELECT l.id as poLineId, l.document_id as poDocumentId FROM pur_po_lines l JOIN documents d ON l.document_id = d.id WHERE d.status = ?').all('posted') as any[];

    return fc.constantFrom(...poLines).chain(pickedPoLine => {
        return fc.record({
            poDocumentId: fc.constant(pickedPoLine.poDocumentId),
            lines: fc.array(fc.record({ poLineId: fc.constant(pickedPoLine.poLineId), qty: fc.integer({ min: 1, max: 100 }) }), { minLength: 1, maxLength: 5 })
        });
    });
  },
};
