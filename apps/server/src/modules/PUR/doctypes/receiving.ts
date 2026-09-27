import { z } from 'zod';
import fc from 'fast-check';
import { type Issue } from '@moonproject/shared';
import type { DocTypeDef } from '../../../engine/documents/registry.ts';

const MAX_CENTS = 100_000_000_00;

export const rrLineInput = z
  .object({
    poLineNo: z.number().int().positive(),
    qty: z.number().int().positive().max(MAX_CENTS),
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
  lineNo: number;
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
    const computedLines = input.lines.map((line, idx) => {
      return {
        ...line,
        lineNo: idx + 1,
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
    const poHeader = ctx.db.prepare('SELECT id, number FROM documents WHERE id = ? AND doc_type = ? AND status = ?').get(doc.poDocumentId, 'pur.po', 'posted') as { number: string } | undefined;
    if (!poHeader) {
      issues.push({ field: 'poDocumentId', code: 'INVALID_PO', level: 'error', message: 'Posted purchase order not found.' });
      return issues;
    }

    const poLineStmt = ctx.db.prepare('SELECT qty FROM pur_po_lines WHERE document_id = ? AND line_no = ?');

    // Check total received qty (past RRs) for warning
    const pastReceivedStmt = ctx.db.prepare(`
      SELECT SUM(rrl.qty) as sumQty
      FROM pur_rr_lines rrl
      JOIN documents d ON d.id = rrl.document_id
      WHERE rrl.po_document_id = ? AND rrl.po_line_no = ? AND d.status = 'posted'
    `);

    const seenLineNos = new Set<number>();

    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i]!;

      if (seenLineNos.has(line.poLineNo)) {
         issues.push({ field: `lines.${i}.poLineNo`, code: 'DUPLICATE_PO_LINE', level: 'error', message: 'A PO line can only appear once in a single receiving report.' });
      }
      seenLineNos.add(line.poLineNo);

      const poLine = poLineStmt.get(doc.poDocumentId, line.poLineNo) as { qty: number } | undefined;
      if (!poLine) {
        issues.push({ field: `lines.${i}.poLineNo`, code: 'INVALID_PO_LINE', level: 'error', message: 'PO line not found in this purchase order.' });
      } else {
        const pastRecv = pastReceivedStmt.get(doc.poDocumentId, line.poLineNo) as { sumQty: number | null };
        const sumQty = (pastRecv?.sumQty || 0) + line.qty;
        if (sumQty > poLine.qty) {
            issues.push({ field: `lines.${i}.qty`, code: 'OVER_RECEIVE', level: 'warning', message: `Total received (${sumQty}) exceeds PO line quantity (${poLine.qty}).` });
        }
      }
    }
    return issues;
  },

  persist(db, doc, h) {
    db.prepare(
      `INSERT INTO pur_receiving_reports (document_id, po_document_id) VALUES (?, ?)`
    ).run(h.documentId, doc.poDocumentId);

    const insertLine = db.prepare(
      `INSERT INTO pur_rr_lines (document_id, line_no, po_document_id, po_line_no, qty) VALUES (?, ?, ?, ?, ?)`
    );
    for (const line of doc.lines) {
      insertLine.run(h.documentId, line.lineNo, doc.poDocumentId, line.poLineNo, line.qty);
    }
  },

  load(db, documentId) {
    const header = db.prepare('SELECT * FROM pur_receiving_reports WHERE document_id = ?').get(documentId) as any;
    if (!header) throw new Error(`RR ${documentId} not found`);

    const dbLines = db.prepare('SELECT * FROM pur_rr_lines WHERE document_id = ? ORDER BY line_no ASC').all(documentId) as any[];

    const lines = dbLines.map(l => {
      return {
        lineNo: l.line_no,
        poLineNo: l.po_line_no,
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
      lines: doc.lines.map(l => ({ poLineNo: l.poLineNo, qty: l.qty }))
    };
  },

  summary(doc, ctx) {
    const poNum = (ctx.db.prepare('SELECT number FROM documents WHERE id = ?').get(doc.poDocumentId) as { number: string } | undefined)?.number ?? '?';
    return `This will record receiving for purchase order ${poNum} (${doc.lines.length} line${doc.lines.length !== 1 ? 's' : ''}).`;
  },

  arbitrary(db) {
    const poLines = db.prepare('SELECT line_no as poLineNo, document_id as poDocumentId FROM pur_po_lines l JOIN documents d ON l.document_id = d.id WHERE d.status = ?').all('posted') as any[];

    return fc.constantFrom(...poLines).chain(pickedPoLine => {
        return fc.record({
            poDocumentId: fc.constant(pickedPoLine.poDocumentId),
            lines: fc.array(fc.record({ poLineNo: fc.constant(pickedPoLine.poLineNo), qty: fc.integer({ min: 1, max: 100 }) }), { minLength: 1, maxLength: 1 })
        });
    });
  },
};
