/** What other modules may read from TPL (AGENTS.md: other modules only through public.ts). */
import type { Db } from '../../platform/db/driver.ts';
import { settingAt } from '../../engine/settings.ts';
import { invoiceAmounts } from '../JO/public.ts';
import { deliveryDoc } from './doctypes/delivery.ts';
import { toPutIn } from './stock.ts';

/** Restock job orders with pieces finished on the board and not in the client's stock yet (the notifications bell). */
export function restocksReady(db: Db): { jobOrderId: string; number: string; programId: string; customerName: string; pieces: number }[] {
  const rows = db.prepare(`SELECT r.job_order_id AS jobOrderId, d.number, r.program_id AS programId, c.display_name AS customerName
    FROM tpl_restocks r JOIN documents d ON d.id = r.job_order_id JOIN tpl_programs p ON p.id = r.program_id JOIN cus_customers c ON c.id = p.customer_id
    WHERE d.status = 'posted' ORDER BY d.number`).all() as { jobOrderId: string; number: string; programId: string; customerName: string }[];
  return rows.map((r) => ({ ...r, pieces: (toPutIn(db, r.jobOrderId) ?? []).reduce((n, l) => n + l.ready, 0) })).filter((r) => r.pieces > 0);
}

/** Restock job orders and the client each was made for (the job margin report: a restock is billed on delivery, per client). */
export function restockPrograms(db: Db): Map<string, { programId: string; customerName: string }> {
  const rows = db.prepare(`SELECT r.job_order_id AS jobOrderId, r.program_id AS programId, c.display_name AS customerName
    FROM tpl_restocks r JOIN tpl_programs p ON p.id = r.program_id JOIN cus_customers c ON c.id = p.customer_id`).all() as { jobOrderId: string; programId: string; customerName: string }[];
  return new Map(rows.map((r) => [r.jobOrderId, { programId: r.programId, customerName: r.customerName }]));
}

/**
 * Each client's TPL figures (the job margin report): the pieces put into stock and delivered, and the pieces' invoiced
 * NET (VAT out, the delivery fee left out: it is delivery income), as their invoices split it (invoiceAmounts).
 */
export function programFigures(db: Db): { programId: string; customerName: string; piecesIn: number; piecesDelivered: number; goodsNetCents: number }[] {
  const programs = db.prepare(`SELECT p.id AS programId, c.display_name AS customerName,
      COALESCE((SELECT SUM(m.qty) FROM tpl_stock_moves m JOIN tpl_items i ON i.id = m.item_id WHERE i.program_id = p.id AND m.kind = 'in'), 0) AS piecesIn
    FROM tpl_programs p JOIN cus_customers c ON c.id = p.customer_id ORDER BY c.display_name COLLATE NOCASE`).all() as { programId: string; customerName: string; piecesIn: number }[];
  const delivered = db.prepare(`SELECT t.document_id AS id, t.program_id AS programId, d.business_date AS date FROM tpl_deliveries t JOIN documents d ON d.id = t.document_id
    WHERE d.status = 'posted'`).all() as { id: string; programId: string; date: string }[];
  const totals = new Map<string, { pieces: number; net: number }>();
  for (const r of delivered) {
    const d = deliveryDoc.load(db, r.id);
    const lines = [...d.lines.map((l) => ({ kind: l.kind, listCents: l.amountCents, discountCents: 0 })), ...(d.feeCents > 0 ? [{ kind: 'service' as const, listCents: d.feeCents, discountCents: 0 }] : [])];
    const sales = invoiceAmounts(lines, settingAt(db, 'tax.vat_rate_bp', r.date)).salesCents;
    const t = totals.get(r.programId) ?? { pieces: 0, net: 0 };
    totals.set(r.programId, { pieces: t.pieces + d.lines.reduce((n, l) => n + l.qty, 0), net: t.net + sales.made_to_order + sales.ready_made });
  }
  return programs.map((p) => ({ ...p, piecesDelivered: totals.get(p.programId)?.pieces ?? 0, goodsNetCents: totals.get(p.programId)?.net ?? 0 }));
}
