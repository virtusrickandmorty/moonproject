/**
 * The ATP booklet check (PLAN D7, L7): a sales invoice or collection receipt number typed from a booklet must fall in a
 * registered, active booklet of its kind. The documents that take these numbers (JO invoice records, QS quick sales, COL
 * collections) call it from `validate`; they already refuse a number used twice. Until the accountant registers the
 * first booklet of a kind, numbers of that kind are not checked, so the shop can start before the register is typed in.
 * This file imports no other module, so JO, QS and COL can use it without an import cycle.
 */
import type { Issue } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';

export const BOOKLET_KINDS = ['SALES_INVOICE', 'CR'] as const;
export type BookletKind = (typeof BOOKLET_KINDS)[number];
export const KIND_WORDS: Record<BookletKind, { paper: string; number: (n: string) => string }> = {
  SALES_INVOICE: { paper: 'invoice', number: (n) => `Invoice no. ${n}` },
  CR: { paper: 'collection receipt', number: (n) => `CR ${n}` },
};

/** The booklet a number belongs to, active or retired. */
export function bookletOf(db: Db, kind: BookletKind, n: number): { id: string; atpNo: string; serialFrom: number; serialTo: number; isActive: boolean } | undefined {
  const r = db
    .prepare('SELECT id, atp_no AS atpNo, serial_from AS serialFrom, serial_to AS serialTo, is_active AS isActive FROM tax_booklets WHERE kind = ? AND ? BETWEEN serial_from AND serial_to')
    .get(kind, n) as { id: string; atpNo: string; serialFrom: number; serialTo: number; isActive: number } | undefined;
  return r && { ...r, isActive: r.isActive === 1 };
}

/** The issue for a typed booklet number, or null when it is fine (or the register of that kind is still empty). */
export function bookletIssue(db: Db, kind: BookletKind, typed: string, field: string): Issue | null {
  const n = Number.parseInt(typed, 10);
  if (!Number.isSafeInteger(n)) return null; // the module's own schema rejects a malformed number
  const words = KIND_WORDS[kind];
  const b = bookletOf(db, kind, n);
  if (b?.isActive) return null;
  if (b) {
    return { field, code: 'BOOKLET_RETIRED', level: 'error', message: `${words.number(typed)} is in booklet ATP ${b.atpNo} (${b.serialFrom} to ${b.serialTo}), which is retired. Use the booklet in use now, or ask the accountant.` };
  }
  if (!db.prepare('SELECT 1 FROM tax_booklets WHERE kind = ? AND is_active = 1').get(kind)) return null;
  return { field, code: 'BOOKLET_UNKNOWN', level: 'error', message: `${words.number(typed)} is not in any registered ${words.paper} booklet. Check the number, or ask the accountant to register the booklet (ATP number and range).` };
}
