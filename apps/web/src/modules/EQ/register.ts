/** The owners and officers screens' rules (PLAN E10): the register's roles in words, filters, and what a person owes or is owed. Pure. */
import type { EqBalance, EqDocument, EqPersonRecord } from '../../api.ts';

export const rolesOf = (p: Pick<EqPersonRecord, 'isStockholder' | 'isOfficer' | 'position'>) =>
  [p.isStockholder && 'Stockholder', p.isOfficer && (p.position ? `Officer (${p.position})` : 'Officer')].filter(Boolean).join(', ');

export function filterPeople(rows: EqPersonRecord[], search: string, role: 'all' | 'stockholder' | 'officer', showOff: boolean): EqPersonRecord[] {
  const q = search.trim().toLowerCase();
  return rows.filter((p) => (showOff || p.isActive) && (role === 'all' || (role === 'stockholder' ? p.isStockholder : p.isOfficer)) && (!q || `${p.name} ${p.position ?? ''}`.toLowerCase().includes(q)));
}

export const balanceOf = (balances: EqBalance[], personId: string): EqBalance => balances.find((b) => b.personId === personId) ?? { personId, dueFromCents: 0, dueToCents: 0, unpaidSubscriptionCents: 0 };

/** The person's position in words: what they owe the company, what it owes them, what is left on their subscription. */
export function positionWords(b: Pick<EqBalance, 'dueFromCents' | 'dueToCents' | 'unpaidSubscriptionCents'>, peso: (c: number) => string): string[] {
  return [
    ...(b.dueFromCents > 0 ? [`Owes the company ${peso(b.dueFromCents)}`] : []),
    ...(b.dueToCents > 0 ? [`The company owes them ${peso(b.dueToCents)}`] : []),
    ...(b.unpaidSubscriptionCents > 0 ? [`Still to pay on their stock subscription: ${peso(b.unpaidSubscriptionCents)}`] : []),
    ...(b.dueFromCents === 0 && b.dueToCents === 0 && b.unpaidSubscriptionCents === 0 ? ['Nothing owed either way'] : []),
  ];
}

export const OWNER_KIND_WORDS: Record<string, string> = {
  advance: 'Advance (the company owes it back)', capital_stock: 'Capital stock', subscription_payment: 'Subscription payment',
  dffs_equity: 'Deposit for future stock subscription (equity)', dffs_liability: 'Deposit for future stock subscription (liability)',
};
export const OFFICER_KIND_WORDS: Record<string, string> = { taken: 'Money out (taken)', returned: 'Money back (paid back)', repaid_to_officer: 'Money out (advance repaid to them)' };

/** Recorded documents only, summed: cancelled ones stay listed but count for nothing. */
export const recordedTotal = (docs: Pick<EqDocument, 'status' | 'amountCents'>[]) => docs.filter((d) => d.status === 'posted').reduce((s, d) => s + d.amountCents, 0);
