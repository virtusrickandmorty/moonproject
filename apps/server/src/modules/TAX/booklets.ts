/**
 * The ATP booklet register (PLAN D7, E12, L7): each BIR-approved booklet of sales invoices or collection receipts with
 * its ATP number and serial range. Master data: registered once, retired or switched back on (If-Match, audited),
 * never edited or deleted. The usage report lists, per booklet, the numbers used (cancelled ones included, since
 * that paper was written), the numbers skipped below the last one used, and what is left.
 */
import { z } from 'zod';
import { AppError, badRequest, conflict, isBusinessDate, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { crNumbersBetween } from '../COL/public.ts';
import { invoiceNumbersBetween } from '../JO/public.ts';
import { BOOKLET_KINDS, type BookletKind } from './check.ts';

const serial = z.number().int().min(1).max(999_999_999_999);
export const bookletInput = z
  .object({
    kind: z.enum(BOOKLET_KINDS),
    atpNo: z.string().trim().min(3).max(40),
    printer: z.string().trim().min(2).max(120).optional(),
    serialFrom: serial,
    serialTo: serial,
    receivedOn: z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.'),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export const bookletActiveInput = z.object({ note: z.string().trim().min(10).max(300) }).strict();

export interface Booklet {
  id: string; kind: BookletKind; atpNo: string; printer: string | null; serialFrom: number; serialTo: number; receivedOn: string;
  note: string | null; isActive: boolean; version: number;
}
const SELECT = `SELECT id, kind, atp_no AS atpNo, printer, serial_from AS serialFrom, serial_to AS serialTo, received_on AS receivedOn, note,
  is_active AS isActive, version FROM tax_booklets`;
type Row = Omit<Booklet, 'isActive'> & { isActive: number };
const asBooklet = (r: Row): Booklet => ({ ...r, isActive: r.isActive === 1 });

export function booklet(db: Db, id: string): Booklet | undefined {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r && asBooklet(r);
}

export const listBooklets = (db: Db): Booklet[] => (db.prepare(`${SELECT} ORDER BY kind, serial_from`).all() as Row[]).map(asBooklet);

export interface Who { userId: string; at: string }

/** Registers a booklet. Its range may not overlap another booklet of its kind. Call inside a transaction. */
export function registerBooklet(db: Db, raw: unknown, who: Who): Booklet {
  const v = bookletInput.parse(raw);
  if (v.serialTo < v.serialFrom) throw badRequest('BAD_RANGE', 'The last number is smaller than the first.');
  if (v.serialTo - v.serialFrom >= 100_000) throw badRequest('BAD_RANGE', 'That is more than 100,000 forms. Check the first and last numbers.');
  if (v.receivedOn > who.at.slice(0, 10)) throw badRequest('BAD_DATE', 'The date received cannot be after today.');
  const clash = db
    .prepare('SELECT atp_no, serial_from, serial_to FROM tax_booklets WHERE kind = ? AND serial_from <= ? AND ? <= serial_to')
    .get(v.kind, v.serialTo, v.serialFrom) as { atp_no: string; serial_from: number; serial_to: number } | undefined;
  if (clash) throw conflict('BOOKLET_OVERLAP', `Numbers ${clash.serial_from} to ${clash.serial_to} are already registered (ATP ${clash.atp_no}). Check the range.`);
  const id = newId();
  db.prepare(
    `INSERT INTO tax_booklets (id, kind, atp_no, printer, serial_from, serial_to, received_on, note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, v.kind, v.atpNo, v.printer ?? null, v.serialFrom, v.serialTo, v.receivedOn, v.note ?? null, who.at, who.userId);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tax.booklet.register', entityType: 'tax.booklet', entityId: id, data: v });
  return booklet(db, id)!;
}

/** Retires a booklet (used up, lost, spoiled) or switches it back on, with the reason (If-Match). Call inside a transaction. */
export function setBookletActive(db: Db, id: string, ifMatch: unknown, active: boolean, raw: unknown, who: Who): Booklet {
  const { note } = bookletActiveInput.parse(raw);
  const b = booklet(db, id);
  if (!b) throw notFound('The booklet');
  if (typeof ifMatch !== 'string' || !/^\d+$/.test(ifMatch)) throw new AppError('VERSION_REQUIRED', 'Reload the booklet before saving.', 428);
  if (Number(ifMatch) !== b.version) throw conflict('VERSION_CHANGED', 'Someone changed this booklet. Reload it and check their change.');
  if (b.isActive === active) throw conflict('NO_CHANGE', `The booklet is already ${active ? 'in use' : 'retired'}.`);
  db.prepare('UPDATE tax_booklets SET is_active = ?, note = ?, version = version + 1 WHERE id = ?').run(+active, note, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: active ? 'tax.booklet.activate' : 'tax.booklet.retire', entityType: 'tax.booklet', entityId: id, data: { note } });
  return booklet(db, id)!;
}

const MAX_LISTED = 200;
export interface BookletUsage {
  booklet: Booklet;
  usedCount: number; cancelledCount: number; lastUsed: number | null; leftCount: number;
  /** Numbers below the last one used that no document took (the skipped-number report), at most 200 listed. */
  skipped: number[]; skippedCount: number;
  used: { n: number; number: string; status: 'posted' | 'cancelled' }[];
}

/** What a booklet's numbers were used for, from the documents that typed them (JO and QS invoices, COL receipts). */
export function bookletUsage(db: Db, b: Booklet, withLines = false): BookletUsage {
  const used = b.kind === 'SALES_INVOICE' ? invoiceNumbersBetween(db, b.serialFrom, b.serialTo) : crNumbersBetween(db, b.serialFrom, b.serialTo);
  const taken = new Set(used.map((u) => u.n));
  const lastUsed = used.length ? Math.max(...taken) : null;
  const skipped: number[] = [];
  let skippedCount = 0;
  if (lastUsed !== null) {
    for (let n = b.serialFrom; n < lastUsed; n++) {
      if (taken.has(n)) continue;
      skippedCount++;
      if (skipped.length < MAX_LISTED) skipped.push(n);
    }
  }
  return {
    booklet: b, usedCount: taken.size, cancelledCount: used.filter((u) => u.status === 'cancelled').length, lastUsed,
    leftCount: b.serialTo - (lastUsed ?? b.serialFrom - 1), skipped, skippedCount, used: withLines ? used : [],
  };
}
