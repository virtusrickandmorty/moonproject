/**
 * What the month-end checklist (ACC, PLAN D8) reads from INV: whether the month's inventory count is done. Read-only.
 * ACC-13's default is a count every month; a shop whose counts are all in December counts once a year, so the other
 * months need none. A category with no stock at the month end and no count on record has nothing to count.
 */
import type { Db } from '../../platform/db/driver.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { CATEGORIES, CATEGORY_LABEL, INVENTORY_ROLE, monthEndOf } from './costs.ts';

export interface CountCheck { category: string; label: string; state: 'done' | 'not_done' | 'not_needed'; detail: string }

export function inventoryCountChecks(db: Db, month: string): CountCheck[] {
  const [from, to] = [`${month}-01`, monthEndOf(`${month}-01`)];
  const counts = db
    .prepare(`SELECT c.category, c.count_date AS date, d.number FROM inv_counts c JOIN documents d ON d.id = c.document_id WHERE d.status = 'posted' ORDER BY c.count_date, d.number`)
    .all() as { category: string; date: string; number: string }[];
  const yearlyOnly = counts.length > 0 && counts.every((c) => c.date.slice(5, 7) === '12');
  return CATEGORIES.map((category): CountCheck => {
    const base = { category, label: CATEGORY_LABEL[category] };
    const counted = counts.filter((c) => c.category === category && c.date >= from && c.date <= to).at(-1);
    if (counted) return { ...base, state: 'done', detail: `Counted on ${counted.date} (${counted.number}).` };
    if (yearlyOnly && month.slice(5) !== '12') return { ...base, state: 'not_needed', detail: 'Counted once a year, at the end of December.' };
    const onHand = accountBalance(db, resolveAccount(db, { role: INVENTORY_ROLE[category] }).id, { asOf: to });
    if (onHand === 0 && !counts.some((c) => c.category === category)) return { ...base, state: 'not_needed', detail: 'No stock on the books at the month end.' };
    return { ...base, state: 'not_done', detail: `No count dated in ${month}.` };
  });
}
