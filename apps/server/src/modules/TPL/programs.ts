/**
 * Stock programs (TPL, the owner's request, 11 Oct 2026): one per client, with its terms, credit limit and the items Virtus
 * makes and holds for it. Master data: a change bumps the version and writes an audit row; nothing is deleted, an item or
 * a program is switched off (is_active = 0).
 */
import { z } from 'zod';
import { conflict, newId, notFound } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import { appendAudit } from '../../engine/audit.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { customerRef } from '../CUS/public.ts';

export const MAX_PRICE_CENTS = 10_000_000; // ₱100,000 a piece: a typo guard
export interface Who { userId: string; at: string }

export interface Program {
  id: string; customerId: string; customerName: string; termsDays: number; creditLimitCents: number; note: string | null;
  isActive: boolean; version: number; createdAt: string;
}
export interface Item {
  id: string; programId: string; kind: 'made_to_order' | 'ready_made'; description: string; size: string; priceCents: number;
  reorderLevel: number; isActive: boolean; version: number; onHand: number;
}

/** Pieces of item i on hand: put in and counted, less those on recorded deliveries. */
const ON_HAND = `(COALESCE((SELECT SUM(m.qty) FROM tpl_stock_moves m WHERE m.item_id = i.id), 0)
  - COALESCE((SELECT SUM(l.qty) FROM tpl_delivery_lines l JOIN documents d ON d.id = l.document_id WHERE l.item_id = i.id AND d.status = 'posted'), 0))`;
const PROGRAM = `SELECT id, customer_id AS customerId, terms_days AS termsDays, credit_limit_cents AS creditLimitCents, note, is_active AS isActive,
  version, created_at AS createdAt FROM tpl_programs`;
const ITEM = `SELECT i.id, i.program_id AS programId, i.kind, i.description, i.size, i.price_cents AS priceCents, i.reorder_level AS reorderLevel,
  i.is_active AS isActive, i.version, ${ON_HAND} AS onHand FROM tpl_items i`;

const asProgram = (db: Db, r: Omit<Program, 'isActive' | 'customerName'> & { isActive: number }): Program =>
  ({ ...r, isActive: r.isActive === 1, customerName: customerRef(db, r.customerId)?.display_name ?? '?' });
const asItem = (r: Omit<Item, 'isActive'> & { isActive: number }): Item => ({ ...r, isActive: r.isActive === 1 });

export function program(db: Db, id: string): Program | undefined {
  const r = db.prepare(`${PROGRAM} WHERE id = ?`).get(id) as Parameters<typeof asProgram>[1] | undefined;
  return r && asProgram(db, r);
}
export function programOfCustomer(db: Db, customerId: string): Program | undefined {
  const r = db.prepare(`${PROGRAM} WHERE customer_id = ?`).get(customerId) as Parameters<typeof asProgram>[1] | undefined;
  return r && asProgram(db, r);
}
export function itemsOf(db: Db, programId: string): Item[] {
  return (db.prepare(`${ITEM} WHERE i.program_id = ? ORDER BY i.is_active DESC, i.description COLLATE NOCASE, i.size`).all(programId) as Parameters<typeof asItem>[0][]).map(asItem);
}
export function item(db: Db, id: string): Item | undefined {
  const r = db.prepare(`${ITEM} WHERE i.id = ?`).get(id) as Parameters<typeof asItem>[0] | undefined;
  return r && asItem(r);
}
export const itemLabel = (i: { description: string; size: string }) => (i.size ? `${i.description} (${i.size})` : i.description);

/** What the client owes now on every invoice (its receivable), and how much of it is past due on TPL invoices. */
export function openBalance(db: Db, customerId: string, today: string): { openCents: number; overdueCents: number; overdue: { number: string; dueDate: string; openCents: number }[] } {
  const ar = resolveAccount(db, { role: 'AR_TRADE' }).id;
  const openCents = accountBalance(db, ar, { party: { type: 'customer', id: customerId } });
  const overdue = (db.prepare(`SELECT d.number, t.due_date AS dueDate, x.sale_id AS saleId FROM tpl_delivery_invoices x JOIN tpl_deliveries t ON t.document_id = x.document_id
      JOIN documents d ON d.id = x.sale_id WHERE t.customer_id = ? AND d.status = 'posted' AND t.due_date < ? ORDER BY t.due_date`)
    .all(customerId, today) as { number: string; dueDate: string; saleId: string }[])
    .map((r) => ({ number: r.number, dueDate: r.dueDate, openCents: accountBalance(db, ar, { refDocId: r.saleId }) }))
    .filter((r) => r.openCents > 0);
  return { openCents, overdueCents: overdue.reduce((s, r) => s + r.openCents, 0), overdue };
}

/** The TPL clients list: one row per program with its stock and money at a glance. */
export function programList(db: Db, today: string) {
  return (db.prepare(`${PROGRAM} ORDER BY is_active DESC, created_at`).all() as Parameters<typeof asProgram>[1][]).map((r) => {
    const p = asProgram(db, r);
    const items = itemsOf(db, p.id).filter((i) => i.isActive);
    const money = openBalance(db, p.customerId, today);
    return { ...p, items: items.length, onHand: items.reduce((s, i) => s + i.onHand, 0), belowReorder: items.filter((i) => i.onHand <= i.reorderLevel).length,
      openCents: money.openCents, overdueCents: money.overdueCents };
  });
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const programInput = z.object({
  customerId: z.uuid(),
  termsDays: z.number().int().min(1).max(365),
  creditLimitCents: z.number().int().min(0).max(10_000_000_000),
  note: text(500).optional(),
}).strict();
export const programChange = programInput.omit({ customerId: true }).extend({ isActive: z.boolean(), version: z.number().int().min(1) }).strict();
export const itemInput = z.object({
  kind: z.enum(['made_to_order', 'ready_made']),
  description: text(200),
  size: z.string().trim().max(20).default(''),
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  reorderLevel: z.number().int().min(0).max(1_000_000),
}).strict();
export const itemChange = itemInput.extend({ isActive: z.boolean(), version: z.number().int().min(1) }).strict();

/** A new program for a customer (one each). Call inside a transaction. */
export function createProgram(db: Db, raw: unknown, who: Who): Program {
  const v = programInput.parse(raw);
  const c = customerRef(db, v.customerId);
  if (c?.is_active !== 1) throw conflict('CUSTOMER', c ? `${c.display_name} is inactive. Pick an active customer.` : 'Pick a customer.');
  const had = programOfCustomer(db, v.customerId);
  if (had) throw conflict('PROGRAM_EXISTS', `${c.display_name} already has a stock program. Open it to add items.`);
  const id = newId();
  db.prepare(`INSERT INTO tpl_programs (id, customer_id, terms_days, credit_limit_cents, note, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.customerId, v.termsDays, v.creditLimitCents, v.note ?? null, who.at, who.userId, who.at);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.program.create', entityType: 'tpl_program', entityId: id, data: v });
  return program(db, id)!;
}

/** Terms, credit limit, note, on or off; version-checked. Call inside a transaction. */
export function changeProgram(db: Db, id: string, raw: unknown, who: Who): Program {
  const v = programChange.parse(raw);
  const before = program(db, id);
  if (!before) throw notFound('The stock program');
  if (before.version !== v.version) throw conflict('VERSION_CHANGED', 'Someone changed this program meanwhile. Open it again.');
  db.prepare(`UPDATE tpl_programs SET terms_days = ?, credit_limit_cents = ?, note = ?, is_active = ?, version = version + 1, updated_at = ? WHERE id = ?`)
    .run(v.termsDays, v.creditLimitCents, v.note ?? null, v.isActive ? 1 : 0, who.at, id);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.program.change', entityType: 'tpl_program', entityId: id,
    data: { before: { termsDays: before.termsDays, creditLimitCents: before.creditLimitCents, note: before.note, isActive: before.isActive }, after: v } });
  return program(db, id)!;
}

function sameItem(db: Db, programId: string, description: string, size: string, notId: string | null) {
  return db.prepare(`SELECT id FROM tpl_items WHERE program_id = ? AND description = ? COLLATE NOCASE AND size = ? COLLATE NOCASE AND id IS NOT ?`)
    .get(programId, description, size, notId) as { id: string } | undefined;
}

/** A new item held for the client. Call inside a transaction. */
export function addItem(db: Db, programId: string, raw: unknown, who: Who): Item {
  const v = itemInput.parse(raw);
  if (!program(db, programId)) throw notFound('The stock program');
  if (sameItem(db, programId, v.description, v.size, null)) throw conflict('ITEM_EXISTS', `${itemLabel(v)} is already on this program.`);
  const id = newId();
  db.prepare(`INSERT INTO tpl_items (id, program_id, kind, description, size, price_cents, reorder_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, programId, v.kind, v.description, v.size, v.priceCents, v.reorderLevel, who.at, who.at);
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.item.create', entityType: 'tpl_item', entityId: id, data: { programId, ...v } });
  return item(db, id)!;
}

/** Price, reorder level, name, on or off; version-checked. A price change applies to deliveries from now on. */
export function changeItem(db: Db, id: string, raw: unknown, who: Who): Item {
  const v = itemChange.parse(raw);
  const before = item(db, id);
  if (!before) throw notFound('The item');
  if (before.version !== v.version) throw conflict('VERSION_CHANGED', 'Someone changed this item meanwhile. Open it again.');
  if (sameItem(db, before.programId, v.description, v.size, id)) throw conflict('ITEM_EXISTS', `${itemLabel(v)} is already on this program.`);
  if (!v.isActive && before.onHand !== 0) throw conflict('HAS_STOCK', `${itemLabel(before)} still has ${before.onHand} pieces on hand. Deliver or count them out before switching it off.`);
  db.prepare(`UPDATE tpl_items SET kind = ?, description = ?, size = ?, price_cents = ?, reorder_level = ?, is_active = ?, version = version + 1, updated_at = ? WHERE id = ?`)
    .run(v.kind, v.description, v.size, v.priceCents, v.reorderLevel, v.isActive ? 1 : 0, who.at, id);
  const { onHand: _, version: _v, ...was } = before;
  appendAudit(db, { at: who.at, userId: who.userId, action: 'tpl.item.change', entityType: 'tpl_item', entityId: id, data: { before: was, after: v } });
  return item(db, id)!;
}
