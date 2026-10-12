/** What other modules may read from TPL (AGENTS.md: other modules only through public.ts). */
import type { Db } from '../../platform/db/driver.ts';
import { toPutIn } from './stock.ts';

/** Restock job orders with pieces finished on the board and not in the client's stock yet (the notifications bell). */
export function restocksReady(db: Db): { jobOrderId: string; number: string; programId: string; customerName: string; pieces: number }[] {
  const rows = db.prepare(`SELECT r.job_order_id AS jobOrderId, d.number, r.program_id AS programId, c.display_name AS customerName
    FROM tpl_restocks r JOIN documents d ON d.id = r.job_order_id JOIN tpl_programs p ON p.id = r.program_id JOIN cus_customers c ON c.id = p.customer_id
    WHERE d.status = 'posted' ORDER BY d.number`).all() as { jobOrderId: string; number: string; programId: string; customerName: string }[];
  return rows.map((r) => ({ ...r, pieces: (toPutIn(db, r.jobOrderId) ?? []).reduce((n, l) => n + l.ready, 0) })).filter((r) => r.pieces > 0);
}
