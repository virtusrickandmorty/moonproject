/**
 * Opening officer balance form's rules (PLAN D8 "Cut-over" step 3, OBOF-): what an officer owed the shop, or the shop
 * owed an officer, on the cut-over date. Pure, so they are tested without a browser; the server checks everything again
 * and settles it afterwards like any officer money (eq.officer).
 */
import { formatPesos } from '@moonproject/shared';
import { cents } from '../COL/money.ts';

export type Direction = 'owes_shop' | 'shop_owes' | '';
export interface OpeningValues { personId: string; direction: Direction; amount: string; note: string }
export const emptyOpening = (): OpeningValues => ({ personId: '', direction: '', amount: '', note: '' });

/** The form's values -> opening officer balance input, with plain errors. */
export function openingInput(v: OpeningValues): { input: Record<string, unknown>; errors: string[] } {
  const amount = cents(v.amount);
  const errors = [
    ...(v.personId ? [] : ['Pick the officer from the register.']),
    ...(v.direction ? [] : ['Pick which way the balance goes.']),
    ...(amount && amount > 0 ? [] : ['Type the amount, like 2,500.00']),
    ...(v.note.trim().length >= 3 ? [] : ['Type a note.']),
  ];
  const input = { personId: v.personId, direction: v.direction || 'owes_shop', amountCents: amount ?? 0, note: v.note.trim() };
  return { input, errors };
}

type Stored = { personId: string; direction: 'owes_shop' | 'shop_owes'; amountCents: number; note: string };
/** Stored input -> the form's values, to prefill an edit. */
export const openingValues = (s: Stored): OpeningValues => ({ personId: s.personId, direction: s.direction, amount: formatPesos(s.amountCents), note: s.note });
