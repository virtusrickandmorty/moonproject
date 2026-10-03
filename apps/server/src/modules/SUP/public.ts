/** What other modules may read from customer support (AGENTS.md: other modules only through public.ts). */
import type { Db } from '../../platform/db/driver.ts';

export const KIND_LABELS: Record<string, string> = { inquiry: 'Inquiry', complaint: 'Complaint', suggestion: 'Suggestion', quotation: 'Quotation request' };

/** Messages from the website nobody has started on yet, newest first. */
export function newSupportMessages(db: Db): { id: string; number: string; kind: string; name: string; subject: string; receivedAt: string }[] {
  return db.prepare(`SELECT id, number, kind, name, subject, received_at AS receivedAt FROM sup_messages WHERE status = 'new' ORDER BY received_ms DESC LIMIT 50`)
    .all() as { id: string; number: string; kind: string; name: string; subject: string; receivedAt: string }[];
}
