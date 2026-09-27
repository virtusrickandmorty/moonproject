/**
 * Cash places (PLAN D2, E10): each is its own GL account (is_cash_place) with a cash_place_settings row for its kind,
 * the bank account number and whether encoders see its balance (OWN-27). They are made here, never in the chart of
 * accounts screen; renaming and deactivating use the chart of accounts routes. The cash book is the GL detail of one
 * place with a running balance.
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, forbidden, isBusinessDate, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';

export const KINDS = ['cash', 'checks', 'bank', 'ewallet'] as const;
export type CashKind = (typeof KINDS)[number];
/** Code ranges per kind (1101-1189 are cash places, PLAN D2). 1103 is the seeded checks-on-hand place. */
const RANGE: Record<CashKind, [number, number]> = { cash: [1101, 1109], checks: [1101, 1109], bank: [1111, 1119], ewallet: [1121, 1129] };

export interface PlaceRow {
  id: number; code: string; name: string; isActive: boolean; kind: CashKind; accountNo: string | null; encoderSeesBalance: boolean; version: number;
}
const PLACES = `SELECT a.id, a.code, a.name, a.is_active AS isActive, s.kind, s.account_no AS accountNo, s.encoder_sees_balance AS encoderSeesBalance, s.version
  FROM accounts a JOIN cash_place_settings s ON s.account_id = a.id WHERE a.is_cash_place = 1`;
type Raw = Omit<PlaceRow, 'isActive' | 'encoderSeesBalance'> & { isActive: number; encoderSeesBalance: number };
const asPlace = (r: Raw): PlaceRow => ({ ...r, isActive: r.isActive === 1, encoderSeesBalance: r.encoderSeesBalance === 1 });

export const listPlaces = (db: Db, includeInactive: boolean): PlaceRow[] =>
  (db.prepare(`${PLACES} ${includeInactive ? '' : 'AND a.is_active = 1'} ORDER BY a.sort_order, a.code`).all() as Raw[]).map(asPlace);

export function place(db: Db, id: number): PlaceRow | undefined {
  const r = db.prepare(`${PLACES} AND a.id = ?`).get(id) as Raw | undefined;
  return r && asPlace(r);
}

/** Whether this user may see the place's balance (and so its cash book and counts). */
export const seesBalance = (p: Pick<PlaceRow, 'encoderSeesBalance'>, can: (permission: string) => boolean) => can('cash.balances.view_all') || p.encoderSeesBalance;

const mask = (v: string | null) => (v ? `••••${v.slice(-4)}` : null);

/** The list staff see: names always, balances and account numbers only where allowed. */
export function placesFor(db: Db, can: (permission: string) => boolean, includeInactive = false) {
  const all = can('cash.balances.view_all');
  return listPlaces(db, includeInactive).map((p) => ({
    id: p.id, code: p.code, name: p.name, kind: p.kind, isActive: p.isActive,
    accountNo: all ? p.accountNo : mask(p.accountNo),
    balanceCents: seesBalance(p, can) ? accountBalance(db, p.id) : null,
    ...(can('cash.places.manage') ? { encoderSeesBalance: p.encoderSeesBalance, version: p.version } : {}),
  }));
}

const accountNo = z.string().trim().regex(/^[0-9A-Za-z -]{4,30}$/, 'Type the account number with digits, letters, spaces or dashes.');
export const newPlaceInput = z
  .object({ name: z.string().trim().min(3).max(120), kind: z.enum(KINDS), accountNo: accountNo.optional(), encoderSeesBalance: z.boolean() })
  .strict();
export const placeSettingsInput = z.object({ accountNo: accountNo.nullable().optional(), encoderSeesBalance: z.boolean().optional() }).strict();

export interface Who { userId: string; at: string }

/** Adds a cash place: the next free code in its kind's range, a GL account and its settings row. Call inside a transaction. */
export function createPlace(db: Db, raw: unknown, who: Who): PlaceRow {
  const v = newPlaceInput.parse(raw);
  if (v.accountNo && (v.kind === 'cash' || v.kind === 'checks')) throw badRequest('ACCOUNT_NO', 'Only banks and e-wallets have an account number.');
  if (db.prepare('SELECT 1 FROM accounts WHERE is_cash_place = 1 AND name = ? COLLATE NOCASE').get(v.name)) throw conflict('NAME_EXISTS', `There is already a cash place called ${v.name}.`);
  const [lo, hi] = RANGE[v.kind];
  const used = new Set(db.prepare('SELECT CAST(code AS INTEGER) FROM accounts WHERE CAST(code AS INTEGER) BETWEEN ? AND ?').pluck().all(lo, hi) as number[]);
  let code = lo;
  while (code <= hi && used.has(code)) code++;
  if (code > hi) throw conflict('NO_CODE_LEFT', `All codes from ${lo} to ${hi} are used. Ask the accountant to deactivate an old place or plan new codes.`);
  const sort = (db.prepare('SELECT MAX(sort_order) FROM accounts WHERE code < ?').pluck().get(String(code)) as number | null) ?? 0;
  const id = Number(
    db
      .prepare(`INSERT INTO accounts (code, name, type, normal_side, party_type, is_header, is_postable, is_cash_place, is_reserved, is_active, sort_order)
                VALUES (?, ?, 'asset', 'debit', NULL, 0, 1, 1, 0, 1, ?)`)
      .run(String(code), v.name, sort + 1).lastInsertRowid,
  );
  db.prepare('INSERT INTO cash_place_settings (account_id, encoder_sees_balance, kind, account_no) VALUES (?, ?, ?, ?)').run(id, +v.encoderSeesBalance, v.kind, v.accountNo ?? null);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'cash.place.create', entityType: 'account', entityId: String(id), data: { code: String(code), name: v.name, kind: v.kind, encoderSeesBalance: v.encoderSeesBalance, accountNo: v.accountNo ? 'set' : null } });
  return place(db, id)!;
}

/** Changes the account number or who sees the balance (If-Match: the settings version). Call inside a transaction. */
export function updatePlaceSettings(db: Db, id: number, ifMatch: unknown, raw: unknown, who: Who): PlaceRow {
  const v = placeSettingsInput.parse(raw);
  const p = place(db, id);
  if (!p) throw notFound('The cash place');
  if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Reload the cash place before saving.', 428);
  if (Number(ifMatch) !== p.version) throw conflict('VERSION_CHANGED', 'Someone changed this cash place. Reload it and check their change.');
  if (v.accountNo && (p.kind === 'cash' || p.kind === 'checks')) throw badRequest('ACCOUNT_NO', 'Only banks and e-wallets have an account number.');
  const accountNoAfter = v.accountNo === undefined ? p.accountNo : v.accountNo;
  const seesAfter = v.encoderSeesBalance ?? p.encoderSeesBalance;
  if (accountNoAfter === p.accountNo && seesAfter === p.encoderSeesBalance) throw conflict('NO_CHANGE', 'Nothing changed.');
  db.prepare('UPDATE cash_place_settings SET account_no = ?, encoder_sees_balance = ?, version = version + 1 WHERE account_id = ?').run(accountNoAfter, +seesAfter, id);
  appendAudit(db, {
    at: who.at, userId: who.userId, action: 'cash.place.settings', entityType: 'account', entityId: String(id),
    data: { encoderSeesBalance: { before: p.encoderSeesBalance, after: seesAfter }, ...(accountNoAfter !== p.accountNo ? { accountNo: 'changed' } : {}) },
  });
  return place(db, id)!;
}

export interface BookLine {
  date: string; journalNumber: string; documentId: string | null; documentNumber: string | null; docType: string | null; memo: string;
  /** Money in (a debit to the place) and out (a credit). */
  inCents: number; outCents: number; balanceCents: number;
}
const MAX_BOOK_DAYS = 366;
const bookQuery = z.object({ from: z.string().refine(isBusinessDate), to: z.string().refine(isBusinessDate) }).strict();

/** The cash book (E10): opening balance, every GL line of the place in the range with a running balance, closing. */
export function cashBook(db: Db, id: number, rawQuery: unknown, can: (permission: string) => boolean) {
  const p = place(db, id);
  if (!p) throw notFound('The cash place');
  if (!seesBalance(p, can)) throw forbidden('cash.balances.view_all');
  const q = bookQuery.safeParse(rawQuery);
  if (!q.success) throw badRequest('BAD_DATE', 'Pick the dates to show, like 2026-09-01 to 2026-09-30.');
  const { from, to } = q.data;
  if (to < from) throw badRequest('BAD_RANGE', 'The end date is before the start date.');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= MAX_BOOK_DAYS) throw badRequest('BAD_RANGE', 'Show at most one year at a time.');
  const openingCents = db
    .prepare('SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM journal_lines l JOIN journals j ON j.id = l.journal_id WHERE l.account_id = ? AND j.business_date < ?')
    .pluck()
    .get(id, from) as number;
  const rows = db
    .prepare(
      `SELECT j.business_date AS date, j.number AS journalNumber, d.id AS documentId, d.number AS documentNumber, d.doc_type AS docType,
         COALESCE(l.memo, j.memo) AS memo, l.debit_cents AS inCents, l.credit_cents AS outCents
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id LEFT JOIN documents d ON d.id = j.source_id
       WHERE l.account_id = ? AND j.business_date BETWEEN ? AND ? ORDER BY j.business_date, j.number, l.line_no`,
    )
    .all(id, from, to) as Omit<BookLine, 'balanceCents'>[];
  let running = openingCents;
  const lines: BookLine[] = rows.map((r) => ({ ...r, balanceCents: (running += r.inCents - r.outCents) }));
  return { place: { id: p.id, code: p.code, name: p.name, kind: p.kind }, from, to, openingCents, lines, closingCents: running };
}
