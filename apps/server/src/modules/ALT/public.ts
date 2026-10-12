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

/** Returns decided since `sinceAt`, by someone other than `userId`: for the staff who received them (the notifications bell). */
export function returnsDecidedSince(db: Db, sinceAt: string, userId: string): { id: string; number: string; customerName: string; outcome: 'accepted' | 'declined'; jobOrderNumber: string | null; feeCents: number; decidedBy: string; at: string }[] {
  return db.prepare(`SELECT r.id, r.number, c.display_name AS customerName, x.outcome, j.number AS jobOrderNumber, u.display_name AS decidedBy, x.at,
      COALESCE((SELECT SUM(f.fee_each_cents * l.qty) FROM alt_decision_lines f JOIN alt_return_lines l ON l.return_id = f.return_id AND l.line_no = f.line_no WHERE f.return_id = r.id), 0) AS feeCents
    FROM alt_decisions x JOIN alt_returns r ON r.id = x.return_id JOIN cus_customers c ON c.id = r.customer_id JOIN users u ON u.id = x.user_id
    LEFT JOIN documents j ON j.id = x.job_order_id WHERE x.at >= ? AND x.user_id <> ? ORDER BY x.at DESC`).all(sinceAt, userId) as {
    id: string; number: string; customerName: string; outcome: 'accepted' | 'declined'; jobOrderNumber: string | null; feeCents: number; decidedBy: string; at: string;
  }[];
}
