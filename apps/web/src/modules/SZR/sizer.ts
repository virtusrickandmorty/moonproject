/** The sizer screen's rules (PLAN E8): the lend and return forms to input, status words, filters. Pure; the server checks everything again. */
import { isBusinessDate } from '@moonproject/shared';
import type { SizerSet } from '../../api.ts';

export const STATUS_WORDS: Record<SizerSet['status'], string> = { 'in shop': 'In the shop', lent: 'Lent out', 'lost or damaged': 'Lost or damaged' };

export interface LendValues { setId: string; customerId: string; expectedReturnDate: string }

/** The lend form -> input. The date out is the server's today, and the return date cannot be before it. */
export function lendInput(v: LendValues, today: string): { input: LendValues; errors: string[] } {
  const errors = [
    ...(v.setId ? [] : ['Pick the set.']),
    ...(v.customerId ? [] : ['Pick who is borrowing it.']),
    ...(!isBusinessDate(v.expectedReturnDate) ? ['Pick the date it is due back.'] : v.expectedReturnDate < today ? ['The date it is due back cannot be before today.'] : []),
  ];
  return { input: v, errors };
}

export interface ReturnValues { status: 'in shop' | 'lost or damaged'; condition: string }

/** The return form -> input: the condition is always written, even when nothing is wrong ("Complete"). */
export function returnInput(v: ReturnValues): { input: { status: ReturnValues['status']; conditionOnReturn: string }; errors: string[] } {
  const errors = v.condition.trim().length === 0 ? ['Say what condition it came back in, for example “Complete”.'] : [];
  return { input: { status: v.status, conditionOnReturn: v.condition.trim() }, errors };
}

/** "3 days overdue", "due today", "due in 4 days" from the server's date. */
export function dueWords(expected: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${expected}T00:00:00Z`)) / 86_400_000);
  const n = Math.abs(days);
  return days > 0 ? `${n} day${n === 1 ? '' : 's'} overdue` : days === 0 ? 'due today' : `due in ${n} day${n === 1 ? '' : 's'}`;
}

export function filterSets(rows: SizerSet[], search: string, status: SizerSet['status'] | 'all'): SizerSet[] {
  const q = search.trim().toLowerCase();
  return rows.filter((s) => (status === 'all' || s.status === status) && (!q || `${s.code} ${s.garmentType} ${s.sizesIncluded} ${s.holder?.customerName ?? ''}`.toLowerCase().includes(q)));
}

export interface SetValues { code: string; garmentType: string; sizesIncluded: string }

/** The sizer set form -> input (the owner's request, Oct 2026): a code, the garment it fits and the sizes in it. */
export function setInput(v: SetValues): { input: SetValues; errors: string[] } {
  const input = { code: v.code.trim(), garmentType: v.garmentType.trim(), sizesIncluded: v.sizesIncluded.trim() };
  const errors = [
    ...(input.code ? input.code.length > 100 ? ['The code takes up to 100 letters.'] : [] : ['Type the set\'s code, for example SZ-JERSEY-01.']),
    ...(input.garmentType ? input.garmentType.length > 100 ? ['The garment type takes up to 100 letters.'] : [] : ['Type the garment it fits, for example Full Sublimation Jersey.']),
    ...(input.sizesIncluded ? input.sizesIncluded.length > 200 ? ['The sizes take up to 200 letters.'] : [] : ['List the sizes in it, for example XS, S, M, L, XL.']),
  ];
  return { input, errors };
}

/** A week from the server's today: the due-back date the lend form starts with. */
export function weekFrom(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + 7));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}
