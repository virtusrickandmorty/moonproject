import { AppError } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';

export interface Account {
  id: number;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal_side: 'debit' | 'credit';
  role_key: string | null;
  party_type: string | null;
  is_header: number;
  is_postable: number;
  is_cash_place: number;
  is_reserved: number;
  is_active: number;
}

/**
 * How posting code names an account (PLAN D1.3): by role key, or by an account id that came from
 * master data the user picked (a cash place, an expense category). Never by a hard-coded code or id.
 */
export type AccountRef = { role: string } | { cashPlace: number } | { accountId: number };

export function resolveAccount(db: Db, ref: AccountRef): Account {
  let a: Account | undefined;
  if ('role' in ref) a = db.prepare('SELECT * FROM accounts WHERE role_key = ?').get(ref.role) as Account | undefined;
  else if ('cashPlace' in ref) {
    a = db.prepare('SELECT * FROM accounts WHERE id = ? AND is_cash_place = 1').get(ref.cashPlace) as Account | undefined;
  } else a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(ref.accountId) as Account | undefined;
  if (!a) throw new AppError('ACCOUNT_NOT_FOUND', `No account for ${JSON.stringify(ref)}.`, 500);
  return a;
}

export function getAccount(db: Db, id: number): Account | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

export interface CashPlace {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

export function listCashPlaces(db: Db, includeInactive = false): CashPlace[] {
  return (
    db
      .prepare(`SELECT id, code, name, is_active FROM accounts WHERE is_cash_place = 1 ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY sort_order, code`)
      .all() as { id: number; code: string; name: string; is_active: number }[]
  ).map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.is_active === 1 }));
}

export function getCashPlace(db: Db, id: number): CashPlace | undefined {
  return listCashPlaces(db, true).find((c) => c.id === id);
}
