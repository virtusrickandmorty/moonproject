import type { Db } from '../../platform/db/driver.ts';
import { manilaTimestamp } from '@moonproject/shared';
import type { Clock } from '../../platform/clock.ts';
import { today } from '../../platform/clock.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import type { SessionUser } from '../../engine/security/sessions.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { placesFor } from '../CASH/public.ts';
import { currentStage, jobOrdersOf, joMoney } from '../JO/public.ts';
import { board } from '../PRD/public.ts';

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const dateOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const addDays = (date: string, n: number) => dateOf(new Date(day(date).getTime() + n * 86_400_000));
const prevMonthEnd = (date: string) => addDays(`${date.slice(0, 7)}-01`, -1);
const canSee = (user: SessionUser, registry: Registry, type: string) => {
  const doc = registry.docType(type);
  return !!doc && user.permissions.has(doc.permissions.view);
};

export interface DashItem { id: string; label: string; href?: string; detail?: string; amountCents?: number }
export interface DashWidget { key: string; title: string; items?: DashItem[]; amountCents?: number; href?: string }
export interface DashNotification extends DashItem { kind: string; read: boolean }

/** Sales and collections are ledger reads; JO collectibles use its public balance-due calculation. */
function monthSales(db: Db, date: string) {
  const before = prevMonthEnd(date);
  return ['SALES_MTO', 'SALES_RTW', 'SALES_SERVICE', 'SALES_DISCOUNTS', 'SALES_RETURNS'].reduce((sum, role) => {
    const account = resolveAccount(db, { role });
    return sum + accountBalance(db, account.id, { asOf: before }) - accountBalance(db, account.id, { asOf: date });
  }, 0);
}

/** Collection cash received this month, including any reversal dated this month. */
function monthCollections(db: Db, date: string, visibleCashCodes: Set<string>) {
  const from = `${date.slice(0, 7)}-01`;
  if (!visibleCashCodes.size) return 0;
  const codes = [...visibleCashCodes];
  const placeholders = codes.map(() => '?').join(', ');
  const result = db.prepare(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS amount
    FROM journals j JOIN documents d ON d.id = j.source_id
    JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
    WHERE j.source_type = 'document' AND d.doc_type = 'col.collection' AND j.sealed = 1
      AND j.business_date >= ? AND j.business_date <= ? AND a.code IN (${placeholders})`).get(from, date, ...codes) as { amount: number };
  return result.amount;
}

function roleOf(user: SessionUser): 'owner' | 'accountant' | 'production' | 'encoder' {
  if (user.permissions.has('dash.home.owner')) return 'owner';
  if (user.permissions.has('dash.home.accountant')) return 'accountant';
  if (user.permissions.has('dash.home.production')) return 'production';
  return 'encoder';
}

export function home(db: Db, clock: Clock, registry: Registry, user: SessionUser) {
  const can = (key: string) => user.permissions.has(key);
  const date = today(clock);
  const role = roleOf(user);
  const widgets: DashWidget[] = [];
  const orders = can('jo.view') ? jobOrdersOf(db) : [];
  const item = (jo: (typeof orders)[number], amountCents?: number): DashItem => ({
    id: jo.id, label: `${jo.number} · ${jo.customerName}`, href: `/docs/jo.job_order/${jo.id}`,
    detail: `Due ${jo.dueDate}`, ...(amountCents === undefined ? {} : { amountCents }),
  });
  const stage = (id: string) => currentStage(db, id);
  const addOrders = (key: string, title: string, filtered: typeof orders, withBalance = false) =>
    widgets.push({ key, title, items: filtered.slice(0, 20).map((jo) => item(jo, withBalance ? joMoney(db, jo.id).balanceDueCents : undefined)) });

  if (role === 'encoder' || role === 'accountant') {
    const drafts = db.prepare("SELECT id, doc_type AS docType, updated_at AS updatedAt FROM drafts WHERE status = 'open' AND created_by = ? ORDER BY updated_at DESC LIMIT 20")
      .all(user.userId) as { id: string; docType: string; updatedAt: string }[];
    widgets.push({ key: 'drafts', title: 'My drafts', items: drafts.filter((d) => {
      const doc = registry.docType(d.docType);
      return !!doc && can(doc.permissions.create);
    }).map((d) => ({ id: d.id, label: registry.docType(d.docType)!.title, detail: `Updated ${d.updatedAt.slice(0, 10)}`, href: `/docs/${d.docType}/new?draft=${d.id}` })) });
  }
  if (role === 'accountant') {
    widgets.push({ key: 'exceptions', title: 'Exceptions inbox', items: notifications(db, clock, registry, user)
      .filter((n) => !n.read).slice(0, 20).map(({ id, label, href, detail, amountCents }) => ({ id, label, href, detail, amountCents })) });
  }
  if (role === 'encoder') {
    if (can('jo.view')) {
      const weekEnd = addDays(date, 7 - (day(date).getUTCDay() || 7));
      addOrders('due', 'Job orders due this week', orders.filter((jo) => jo.dueDate >= date && jo.dueDate <= weekEnd));
      addOrders('ready', 'Ready for release', orders.filter((jo) => stage(jo.id) === 'ready'));
    }
    if (can('jo.view') && can('col.view')) addOrders('collectibles', 'Collectibles', orders.filter((jo) => joMoney(db, jo.id).balanceDueCents > 0), true);
  }
  if (role === 'owner' && can('jo.view') && can('col.view')) {
    addOrders('overdue-collectibles', 'Overdue collectibles', orders.filter((jo) => jo.dueDate < date && joMoney(db, jo.id).balanceDueCents > 0), true);
  }
  if ((role === 'encoder' || role === 'production') && can('prd.view')) {
    widgets.push({ key: 'production', title: role === 'production' ? 'Production board' : 'Production queue', href: '/prd/board',
      items: board(db).slice(0, 20).map((row) => ({ id: `${row.jobOrderId}:${row.lineNo}`, label: `${row.number} · ${row.description}`,
        detail: `Due ${row.dueDate} · ${row.qty - row.releasedQty} left`, href: '/prd/board' })) });
  }
  if (role === 'owner' && can('cash.places.view')) {
    const places = placesFor(db, can).filter((p) => p.balanceCents !== null);
    widgets.push({ key: 'cash', title: 'Cash position', items: places.map((p) => ({ id: String(p.id), label: p.name,
      amountCents: p.balanceCents! })) });
  }
  if (role === 'owner' && can('acc.journal.view') && can('jo.view') && can('qs.view')) {
    widgets.push({ key: 'sales', title: 'Sales this month', amountCents: monthSales(db, date) });
  }
  if (role === 'owner' && can('col.view') && can('cash.places.view') && can('cash.balances.view_all')) {
    const visible = new Set(placesFor(db, can).filter((p) => p.balanceCents !== null).map((p) => p.code));
    widgets.push({ key: 'collections', title: 'Collections this month', amountCents: monthCollections(db, date, visible) });
  }
  if (role === 'owner' && can('dash.changes.view')) {
    const cancelled = db.prepare("SELECT id, number, doc_type AS docType, cancel_reason AS reason, cancelled_at AS at FROM documents WHERE status = 'cancelled' ORDER BY cancelled_at DESC LIMIT 20")
      .all() as { id: string; number: string; docType: string; reason: string; at: string }[];
    widgets.push({ key: 'cancellations', title: 'Recent cancellations', items: cancelled.filter((d) => canSee(user, registry, d.docType))
      .map((d) => ({ id: d.id, label: d.number, detail: d.reason, href: `/docs/${d.docType}/${d.id}` })) });
  }
  return { role, asOf: date, widgets };
}

export function notifications(db: Db, clock: Clock, registry: Registry, user: SessionUser): DashNotification[] {
  const can = (key: string) => user.permissions.has(key);
  const date = today(clock);
  const out: Omit<DashNotification, 'read'>[] = [];
  const push = (kind: string, id: string, label: string, href?: string, detail?: string, amountCents?: number) =>
    out.push({ kind, id: `${kind}:${id}`, label, ...(href ? { href } : {}), ...(detail ? { detail } : {}), ...(amountCents === undefined ? {} : { amountCents }) });
  // Keep the per-order stage and ledger reads bounded on each home and notification request.
  if (can('jo.view')) for (const jo of jobOrdersOf(db).slice(0, 100)) {
    const stage = currentStage(db, jo.id);
    if (stage !== 'closed' && stage !== 'released' && stage !== 'partially_released') {
      if (jo.dueDate < date) push('jo-overdue', jo.id, `${jo.number} is overdue`, `/docs/jo.job_order/${jo.id}`, `Due ${jo.dueDate}`);
      else if (jo.dueDate <= addDays(date, 3)) push('jo-due', jo.id, `${jo.number} is due soon`, `/docs/jo.job_order/${jo.id}`, `Due ${jo.dueDate}`);
    }
    if (stage === 'ready') push('jo-ready', jo.id, `${jo.number} is ready for release`, `/docs/jo.job_order/${jo.id}`);
    if (can('col.view') && (stage === 'released' || stage === 'partially_released')) {
      const balance = joMoney(db, jo.id).balanceDueCents;
      if (balance > 0) push('released-balance', jo.id, `${jo.number} was released with a balance`, `/docs/jo.job_order/${jo.id}`, undefined, balance);
    }
  }
  const olderThan = manilaTimestamp(new Date(clock.now().getTime() - 3 * 86_400_000));
  const drafts = db.prepare("SELECT id, doc_type AS docType FROM drafts WHERE status = 'open' AND created_by = ? AND created_at < ?")
    .all(user.userId, olderThan) as { id: string; docType: string }[];
  for (const draft of drafts) {
    const doc = registry.docType(draft.docType);
    if (doc && can(doc.permissions.create)) push('old-draft', draft.id, `${doc.title} draft waiting over 3 days`, `/docs/${draft.docType}/new?draft=${draft.id}`);
  }
  if (can('cash.places.view')) for (const place of placesFor(db, can)) {
    if (place.balanceCents !== null && place.balanceCents < 0) push('negative-cash', String(place.id), `${place.name} is below zero`, undefined, undefined, place.balanceCents);
  }
  if (can('dash.changes.view')) {
    const changes = db.prepare("SELECT id, number, doc_type AS docType, cancel_reason AS reason, cancelled_at AS at, replaced_by_id AS replacedById FROM documents WHERE status = 'cancelled' ORDER BY cancelled_at DESC LIMIT 100")
      .all() as { id: string; number: string; docType: string; reason: string; at: string; replacedById: string | null }[];
    for (const change of changes) if (canSee(user, registry, change.docType)) {
      push('cancel', `${change.id}:${change.at}`, `${change.number} was cancelled`, `/docs/${change.docType}/${change.id}`, change.reason);
      if (change.replacedById) push('reissue', `${change.id}:${change.replacedById}`, `${change.number} was reissued`, `/docs/${change.docType}/${change.replacedById}`, change.reason);
    }
  }
  const reads = new Set((db.prepare('SELECT notification_key FROM dash_notification_reads WHERE user_id = ?').all(user.userId) as { notification_key: string }[]).map((r) => r.notification_key));
  return out.map((n) => ({ ...n, read: reads.has(n.id) }));
}
