/** Pure helpers for the customer-check screens (checks on hand, post-dated checks); tested without a browser. */
import type { CheckOnHand, PostDatedCheck } from '../../api.ts';

export const checkKey = (c: Pick<CheckOnHand, 'collectionId' | 'lineNo'>) => `${c.collectionId}:${c.lineNo}`;

/** The ticked checks as the deposit route wants them, and their total. */
export function ticked(checks: readonly CheckOnHand[], keys: ReadonlySet<string>) {
  const rows = checks.filter((c) => keys.has(checkKey(c)));
  return { refs: rows.map(({ collectionId, lineNo }) => ({ collectionId, lineNo })), totalCents: rows.reduce((s, c) => s + c.amountCents, 0) };
}

export const PDC_STATUS: Record<PostDatedCheck['status'], string> = { due: 'Due: record it now', waiting: 'Waiting for its date', used: 'Recorded', voided: 'Voided' };

/** What the screen offers on a post-dated check: record it once due, void it while it is still listed. */
export const pdcActions = (p: Pick<PostDatedCheck, 'status'>) => ({ record: p.status === 'due', void: p.status === 'due' || p.status === 'waiting' });

/** Where "Record the collection" goes: a new collection filled in from the check. */
export const pdcCollectionPath = (id: string) => `/docs/col.collection/new?pdc=${encodeURIComponent(id)}`;
