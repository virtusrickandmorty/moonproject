/** What other modules may read from ALT (AGENTS.md: other modules only through public.ts). */
import type { Db } from '../../platform/db/driver.ts';

/** Returns still waiting for the owner's or the accountant's decision, oldest first (the notifications bell). */
export function returnsAwaitingDecision(db: Db): { id: string; number: string; customerName: string; receivedOn: string; items: number; pieces: number }[] {
  return db.prepare(`SELECT r.id, r.number, c.display_name AS customerName, r.received_on AS receivedOn,
      (SELECT COUNT(*) FROM alt_return_lines l WHERE l.return_id = r.id) AS items, (SELECT SUM(qty) FROM alt_return_lines l WHERE l.return_id = r.id) AS pieces
    FROM alt_returns r JOIN cus_customers c ON c.id = r.customer_id
    WHERE NOT EXISTS (SELECT 1 FROM alt_decisions d WHERE d.return_id = r.id) ORDER BY r.at, r.number`).all() as {
    id: string; number: string; customerName: string; receivedOn: string; items: number; pieces: number;
  }[];
}
