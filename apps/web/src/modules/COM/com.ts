/** Customer email screens' words (PLAN E14): the template names, the status of each email and what happens next. Pure. */
import type { EmailTemplate, OutboxRow } from '../../api.ts';
import { manilaTime } from '../../components/ui.tsx';

export const TEMPLATE_WORDS: Record<EmailTemplate, string> = {
  job_order_created: 'Order received', job_order_ready: 'Ready for pick-up', claimed: 'Picked up', statement: 'Statement of account',
};
export const STATUS_WORDS: Record<OutboxRow['status'], string> = { queued: 'Waiting to be sent', sent: 'Sent', failed: 'Failed' };

/** One line about where an email stands. */
export function progressWords(r: Pick<OutboxRow, 'status' | 'attempts' | 'nextAttemptAt' | 'sentAt' | 'lastError'>): string {
  if (r.status === 'sent') return `Sent ${manilaTime(r.sentAt!)}`;
  if (r.status === 'failed') return `Failed after ${r.attempts === 1 ? '1 try' : `${r.attempts} tries`}${r.lastError ? `: ${r.lastError}` : ''}`;
  return r.attempts === 0 ? 'Waiting to be sent' : `Try ${r.attempts} failed${r.lastError ? ` (${r.lastError})` : ''}. Next try ${manilaTime(r.nextAttemptAt)}`;
}

export const documentWords = (r: Pick<OutboxRow, 'documentNumber' | 'periodFrom' | 'periodTo'>) =>
  r.documentNumber ?? (r.periodFrom ? `${r.periodFrom} to ${r.periodTo}` : '');

/** The mail server's usual ports, so the owner is not asked to know them. */
export const PORT_HINT = 'Gmail: smtp.gmail.com, port 587 (or 465).';
