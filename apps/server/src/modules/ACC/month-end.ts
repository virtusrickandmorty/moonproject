/**
 * Month-end checklist (PLAN D8 "Monthly", accountant checklist screen). Posts nothing. Each item is read from the app
 * and is done, not done or not needed:
 *   depreciation run posted for the month (FA), each bank reconciled to the month end and each cash box counted in the
 *   month (CASH), the inventory count (INV, ACC-13), each government remittance of the month (STAT), the 0619-E or
 *   1601-EQ (TAX), the quarter's VAT close in a quarter's last month (TAX), the exceptions inbox reviewed (DASH: no
 *   unread exception of the person looking), and drafts older than 3 days (the engine's drafts).
 * The accountant signs a month off with a note (acc_month_signoffs: insert-only, step-up, audited); signing again adds
 * a row and the newest counts. A document dated in a signed-off month that was recorded or cancelled after the sign-off
 * shows on the checklist as "changed after sign-off".
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, manilaTimestamp } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../platform/db/driver.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today, type Clock } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { requireStepUp, type SessionUser } from '../../engine/security/sessions.ts';
import { bankReconChecks, cashCountChecks } from '../CASH/public.ts';
import { notifications } from '../DASH/public.ts';
import { depreciationOfMonth } from '../FA/public.ts';
import { inventoryCountChecks } from '../INV/public.ts';
import { remittanceChecks } from '../STAT/public.ts';
import { ewtReturnCheck, vatCloseCheck } from '../TAX/public.ts';

export type ItemState = 'done' | 'not_done' | 'not_needed';
export interface ItemRow { label: string; state: ItemState; detail: string }
export interface ChecklistItem { key: string; title: string; state: ItemState; detail: string; href: string; linkLabel: string; rows: ItemRow[] }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const signBody = z.object({ month: z.string().regex(MONTH, 'Use a month like 2026-08.'), note: z.string().trim().min(5, 'Write a note of at least 5 characters.').max(500) }).strict();
/** Notifications that are heads-ups, not exceptions; old drafts have their own item. A customer's message never holds up the books. */
const NOT_EXCEPTIONS = new Set(['jo-due', 'jo-ready', 'old-draft', 'support-message']);
const SHOWN = 10;

const lastMonth = (date: string) => {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** An item made of rows: not done if any row is, done if some are done and none is not, otherwise not needed. */
function fromRows(key: string, title: string, href: string, linkLabel: string, rows: ItemRow[], none: string): ChecklistItem {
  const done = rows.filter((r) => r.state === 'done').length;
  const needed = rows.filter((r) => r.state !== 'not_needed').length;
  const state: ItemState = rows.some((r) => r.state === 'not_done') ? 'not_done' : done > 0 ? 'done' : 'not_needed';
  const detail = rows.length === 0 ? none : needed === 0 ? rows[0]!.detail : `${done} of ${needed} done.`;
  return { key, title, state, detail, href, linkLabel, rows };
}

function items(db: Db, clock: Clock, registry: Registry, user: SessionUser, month: string): ChecklistItem[] {
  const year = Number(month.slice(0, 4));
  const quarter = Math.ceil(Number(month.slice(5)) / 3);
  const asRow = (r: { state: ItemState; detail: string }, label: string): ItemRow => ({ label, state: r.state, detail: r.detail });

  const dep = depreciationOfMonth(db, month);
  const depreciation: ChecklistItem = {
    key: 'depreciation', title: 'Depreciation run', href: '/docs/fa.depreciation/new', linkLabel: 'Open depreciation run', rows: [],
    ...(dep.run ? { state: 'done' as const, detail: `Posted on ${dep.run.number}, dated ${dep.run.date}.` }
      : dep.assetsToCharge === 0 ? { state: 'not_needed' as const, detail: 'No asset has depreciation to charge for this month.' }
      : { state: 'not_done' as const, detail: `${dep.assetsToCharge} ${dep.assetsToCharge === 1 ? 'asset has' : 'assets have'} depreciation to charge.` }),
  };

  const ewt = ewtReturnCheck(db, month);
  const ewtItem: ChecklistItem = {
    key: 'ewt_return', title: `${ewt.form} (${ewt.form === '1601-EQ' ? 'quarterly' : 'monthly'} EWT)`, state: ewt.state, detail: ewt.detail, rows: [],
    href: ewt.form === '1601-EQ' ? `/tax/1601eq?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}` : `/tax/0619e?${new URLSearchParams({ month })}`,
    linkLabel: `Open ${ewt.form} worksheet`,
  };
  const vat = vatCloseCheck(db, month);
  const vatItem: ChecklistItem = {
    key: 'vat_close', title: "Quarter's VAT close", state: vat.state, detail: vat.detail, rows: [],
    href: Number(month.slice(5)) % 3 === 0 ? `/docs/tax.vat_close/new?${new URLSearchParams({ year: String(year), quarter: String(quarter) })}` : '/tax/vat',
    linkLabel: Number(month.slice(5)) % 3 === 0 ? 'Open VAT close' : 'Open VAT this quarter',
  };

  const unread = notifications(db, clock, registry, user).filter((n) => !n.read && !NOT_EXCEPTIONS.has(n.kind));
  const exceptions: ChecklistItem = {
    key: 'exceptions', title: 'Exceptions inbox reviewed', href: '/dash/notifications', linkLabel: 'Open the exceptions inbox',
    state: unread.length === 0 ? 'done' : 'not_done',
    detail: unread.length === 0 ? 'Nothing unread in your exceptions inbox.' : `${unread.length} unread in your exceptions inbox, as of today.`,
    rows: unread.slice(0, SHOWN).map((n) => ({ label: n.label, state: 'not_done' as const, detail: n.detail ?? '' })),
  };

  const olderThan = manilaTimestamp(new Date(clock.now().getTime() - 3 * 86_400_000));
  const stale = db.prepare(`SELECT doc_type AS docType, COUNT(*) AS n FROM drafts WHERE status = 'open' AND created_at < ? GROUP BY doc_type ORDER BY doc_type`).all(olderThan) as { docType: string; n: number }[];
  const staleTotal = stale.reduce((s, d) => s + d.n, 0);
  const drafts: ChecklistItem = {
    key: 'old_drafts', title: 'Drafts older than 3 days', href: '/', linkLabel: 'Open home', state: staleTotal === 0 ? 'done' : 'not_done',
    detail: staleTotal === 0 ? 'No draft has waited more than 3 days.' : `${staleTotal} ${staleTotal === 1 ? 'draft has' : 'drafts have'} waited more than 3 days, as of today.`,
    rows: stale.map((d) => ({ label: registry.docType(d.docType)?.title ?? d.docType, state: 'not_done' as const, detail: `${d.n} waiting` })),
  };

  return [
    depreciation,
    fromRows('bank_recon', 'Bank reconciliation, each bank', '/cash/recon', 'Open bank reconciliation', bankReconChecks(db, month).map((c) => asRow(c, c.name)), 'No bank accounts.'),
    fromRows('cash_count', 'Cash count, each cash box', '/docs/cash.count/new', 'Open cash count', cashCountChecks(db, month).map((c) => asRow(c, c.name)), 'No cash boxes.'),
    fromRows('inventory_count', 'Inventory count', '/docs/inv.count/new', 'Open inventory count', inventoryCountChecks(db, month).map((c) => asRow(c, c.label)), 'No inventory categories.'),
    fromRows('remittances', 'Government remittances of the month', `/stat/${month}`, 'Open government remittances', remittanceChecks(db, month).map((c) => asRow(c, c.label)), 'No schemes.'),
    ewtItem,
    vatItem,
    exceptions,
    drafts,
  ];
}

interface SignoffRow { id: number; month: string; signedAt: string; signedBy: string; signedByName: string; note: string }
const SIGNOFFS = `SELECT s.id, s.month, s.signed_at AS signedAt, s.signed_by AS signedBy, u.display_name AS signedByName, s.note
  FROM acc_month_signoffs s JOIN users u ON u.id = s.signed_by`;

/** Documents dated in the month that were recorded or cancelled after this sign-off, newest first. */
function changedAfter(db: Db, registry: Registry, month: string, signedAt: string) {
  const rows = db
    .prepare(
      `SELECT number, doc_type AS docType, business_date AS date, status, posted_at AS postedAt, cancelled_at AS cancelledAt
       FROM documents WHERE business_date BETWEEN ? AND ? AND (posted_at > ? OR cancelled_at > ?) ORDER BY COALESCE(cancelled_at, posted_at) DESC, number DESC`,
    )
    .all(`${month}-01`, monthEnd(month), signedAt, signedAt) as { number: string; docType: string; date: string; status: string; postedAt: string; cancelledAt: string | null }[];
  return {
    count: rows.length,
    documents: rows.slice(0, 50).map((r) => {
      const cancelled = r.cancelledAt !== null && r.cancelledAt > signedAt;
      return { number: r.number, title: registry.docType(r.docType)?.title ?? r.docType, date: r.date, action: cancelled ? 'cancelled' : 'recorded', at: cancelled ? r.cancelledAt! : r.postedAt };
    }),
  };
}

export function monthEndChecklist(db: Db, clock: Clock, registry: Registry, user: SessionUser, month: string) {
  const list = items(db, clock, registry, user, month);
  const rows = db.prepare(`${SIGNOFFS} WHERE s.month = ? ORDER BY s.id DESC`).all(month) as SignoffRow[];
  const latest = rows[0];
  const over = month < today(clock).slice(0, 7);
  return {
    month,
    asOf: today(clock),
    /** A month can be signed off once it has ended. */
    over,
    canSignOff: over && user.permissions.has('acc.monthend.signoff'),
    items: list,
    signoff: latest
      ? { ...latest, items: db.prepare('SELECT item_key AS key, state, detail FROM acc_month_signoff_items WHERE signoff_id = ? ORDER BY rowid').all(latest.id) as { key: string; state: ItemState; detail: string }[] }
      : null,
    /** Earlier sign-offs of the month, newest first (the newest is `signoff`). */
    earlierSignoffs: rows.slice(1),
    changedAfterSignoff: latest ? changedAfter(db, registry, month, latest.signedAt) : null,
  };
}

export function monthEndRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, clock, registry } = deps;

  /** The checklist of a month (default: last month). Future months are refused. */
  app.get<{ Querystring: { month?: string } }>('/api/acc/month-end', { config: { permission: 'acc.monthend.view' } }, async (req) => {
    const month = req.query.month ?? lastMonth(today(clock));
    if (!MONTH.test(month)) throw badRequest('BAD_MONTH', 'Use a month like 2026-08.');
    if (month > today(clock).slice(0, 7)) throw badRequest('FUTURE_MONTH', 'That month has not started yet.');
    return monthEndChecklist(db, clock, registry, currentUser(req), month);
  });

  /** Signs a month off, over the checklist as it reads now. Fresh password; the month must have ended. */
  app.post('/api/acc/month-end/sign-off', { config: { permission: 'acc.monthend.signoff' } }, async (req) => {
    const { month, note } = signBody.parse(req.body);
    const u = currentUser(req);
    requireStepUp(u, clock);
    if (month >= today(clock).slice(0, 7)) throw conflict('MONTH_NOT_OVER', `${month} has not ended yet. Sign it off after its last day.`);
    const at = stamp(clock);
    return tx(db, () => {
      const list = items(db, clock, registry, u, month);
      const id = Number(db.prepare('INSERT INTO acc_month_signoffs (month, signed_at, signed_by, note) VALUES (?, ?, ?, ?)').run(month, at, u.userId, note).lastInsertRowid);
      const insert = db.prepare('INSERT INTO acc_month_signoff_items (signoff_id, item_key, state, detail) VALUES (?, ?, ?, ?)');
      for (const i of list) insert.run(id, i.key, i.state, i.detail);
      const count = (s: ItemState) => list.filter((i) => i.state === s).length;
      appendAudit(db, {
        at, userId: u.userId, action: 'acc.monthend.signoff', entityType: 'acc.month_end', entityId: month,
        data: { month, note, done: count('done'), notDone: count('not_done'), notNeeded: count('not_needed') },
      });
      return monthEndChecklist(db, clock, registry, u, month);
    });
  });
}
