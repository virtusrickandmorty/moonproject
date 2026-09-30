/** Read-only board for the sizer screen (PLAN E8): every set with who has it, and the loans already returned. Posts nothing. */
import type { Db } from '../../platform/db/driver.ts';
import { customerRef } from '../CUS/public.ts';

export interface SizerHolder { loanId: string; loanVersion: number; customerId: string; customerName: string; dateOut: string; expectedReturnDate: string; daysOverdue: number }
export interface SizerSet { id: string; code: string; garmentType: string; sizesIncluded: string; status: 'in shop' | 'lent' | 'lost or damaged'; holder: SizerHolder | null }
export interface SizerReturned { loanId: string; setCode: string; garmentType: string; customerName: string; dateOut: string; expectedReturnDate: string; returnedDate: string; conditionOnReturn: string }

const customerName = (db: Db, id: string) => customerRef(db, id)?.display_name ?? '?';
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Sets not switched off, by code, each with the open loan if lent; `overdue` lists the lent ones past their return date, oldest first. */
export function sizerBoard(db: Db, date: string) {
  const open = new Map(
    (db
      .prepare(
        `SELECT l.id AS loanId, l.version AS loanVersion, l.set_id AS setId, l.customer_id AS customerId, l.date_out AS dateOut, l.expected_return_date AS expectedReturnDate
         FROM szr_loans l WHERE l.returned_date IS NULL`,
      )
      .all() as (Omit<SizerHolder, 'daysOverdue' | 'customerName'> & { setId: string })[]).map(({ setId, ...h }) => [setId, { ...h, customerName: customerName(db, h.customerId), daysOverdue: Math.max(0, dayNumber(date) - dayNumber(h.expectedReturnDate)) }]),
  );
  const sets = (
    db.prepare(`SELECT id, code, garment_type AS garmentType, sizes_included AS sizesIncluded, status FROM szr_sets WHERE status != 'inactive' ORDER BY code`).all() as Omit<SizerSet, 'holder'>[]
  ).map((s) => ({ ...s, holder: open.get(s.id) ?? null }));
  const overdue = sets.filter((s) => s.holder && s.holder.daysOverdue > 0).sort((a, b) => a.holder!.expectedReturnDate.localeCompare(b.holder!.expectedReturnDate));
  const returned = (db
    .prepare(
      `SELECT l.id AS loanId, s.code AS setCode, s.garment_type AS garmentType, l.customer_id AS customerId, l.date_out AS dateOut, l.expected_return_date AS expectedReturnDate,
         l.returned_date AS returnedDate, l.condition_on_return AS conditionOnReturn
       FROM szr_loans l JOIN szr_sets s ON s.id = l.set_id
       WHERE l.returned_date IS NOT NULL ORDER BY l.returned_date DESC, l.created_at DESC LIMIT 50`,
    )
    .all() as (Omit<SizerReturned, 'customerName'> & { customerId: string })[]).map(({ customerId, ...r }) => ({ ...r, customerName: customerName(db, customerId) }));
  return { today: date, sets, overdue, returned };
}
