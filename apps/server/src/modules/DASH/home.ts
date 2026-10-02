import type { Db } from '../../platform/db/driver.ts';
import { manilaTimestamp } from '@moonproject/shared';
import type { Clock } from '../../platform/clock.ts';
import { today } from '../../platform/clock.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import type { SessionUser } from '../../engine/security/sessions.ts';
import { accountBalance } from '../../engine/ledger/queries.ts';
import { resolveAccount } from '../../engine/ledger/accounts.ts';
import { placesFor } from '../CASH/public.ts';
import { activeJobOrders, joMoney, joMoneyAll, releasesAwaitingInvoice } from '../JO/public.ts';
import { pendingCertificates } from '../COL/public.ts';
import { board } from '../PRD/public.ts';
import { sizerBoard } from '../SZR/public.ts';
import { hasReceived2307, paidTaxPeriods, taxDeadlines, vatSummary } from '../TAX/public.ts';
import { monthEndChecklist } from '../ACC/public.ts';
import { remittanceChecks, remittanceDueDate } from '../STAT/public.ts';
import { nightlyStatus } from '../AUD/public.ts';
import { redLightNotices, type Host } from '../../platform/health/health.ts';

/** What the owner is told about for 14 days: actions that need a fresh password, in words (the audit log has the rest). */
const GUARDED: Record<string, string> = {
  'bak.restore': 'restored a backup',
  'user.create': 'added a user',
  'user.roles': "changed a user's roles",
  'user.reset_password': "reset a user's password",
  'user.activate': 'turned a user back on',
  'user.deactivate': 'turned a user off',
  'role.permission': "changed a role's permissions",
  'acc.setting.add': 'changed a setting',
  'acc.account.deactivate': 'turned an account off',
  'acc.opening.cutover': 'moved the cut-over date',
  'acc.opening.close': 'closed the opening balances',
  'acc.monthend.signoff': 'signed off a month',
  'bak.settings': 'changed the backup settings',
  'bak.drill': 'checked a backup in a restore drill',
  'com.settings': 'changed the email settings',
  'com.test_email': 'sent a test email',
  'tax.booklet.register': 'registered a booklet',
  'tax.booklet.retire': 'retired a booklet',
  'tax.booklet.activate': 'turned a booklet back on',
  'tax.income_tax_settings.add': 'changed the income tax settings',
  'tax.income_tax_deduction.add': 'changed the income tax deduction method',
  'stat.employer_number_set': 'changed a government employer number',
  'mig.commit': 'imported master data',
  'mig.clear_staging': 'cleared an import staging area',
  'prt.company_profile_edit': 'changed the company details for printing',
  'prt.loose_leaf_paper': 'changed the paper size for the books',
  'practice.reset': 'reset the practice shop',
};

/** Where the app runs, for the System Health notifications: the practice shop has no backups to warn about. */
export interface HomeContext { practice?: boolean; host?: Host }

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const dateOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const addDays = (date: string, n: number) => dateOf(new Date(day(date).getTime() + n * 86_400_000));
const prevMonthEnd = (date: string) => addDays(`${date.slice(0, 7)}-01`, -1);
const canSee = (user: SessionUser, registry: Registry, type: string) => {
  const doc = registry.docType(type);
  return !!doc && user.permissions.has(doc.permissions.view);
};

export interface DashItem { id: string; label: string; href?: string; detail?: string; amountCents?: number }
export interface DashWidget { key: string; title: string; items?: DashItem[]; amountCents?: number; href?: string; tone?: 'danger' }
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

export function home(db: Db, clock: Clock, registry: Registry, user: SessionUser, where: HomeContext = {}) {
  const can = (key: string) => user.permissions.has(key);
  const date = today(clock);
  const role = roleOf(user);
  const widgets: DashWidget[] = [];
  const orders = can('jo.view') ? activeJobOrders(db) : [];
  const item = (jo: (typeof orders)[number], amountCents?: number): DashItem => ({
    id: jo.id, label: `${jo.number} · ${jo.customerName}`, href: `/docs/jo.job_order/${jo.id}`,
    detail: `Due ${jo.dueDate}`, ...(amountCents === undefined ? {} : { amountCents }),
  });
  const addOrders = (key: string, title: string, filtered: typeof orders, withBalance = false) =>
    widgets.push({ key, title, items: filtered.slice(0, 20).map((jo) => item(jo, withBalance ? joMoney(db, jo.id).balanceDueCents : undefined)) });
  /** The first 20 orders with money owing: each balance is asked for only until 20 are found, not for every order there is. */
  const owing = (list: typeof orders) => {
    const found: typeof orders = [];
    for (const jo of list) if (joMoney(db, jo.id).balanceDueCents > 0 && found.push(jo) === 20) break;
    return found;
  };

  if (role === 'encoder' || role === 'accountant') {
    const drafts = db.prepare("SELECT id, doc_type AS docType, updated_at AS updatedAt FROM drafts WHERE status = 'open' AND created_by = ? ORDER BY updated_at DESC LIMIT 20")
      .all(user.userId) as { id: string; docType: string; updatedAt: string }[];
    widgets.push({ key: 'drafts', title: 'My drafts', items: drafts.filter((d) => {
      const doc = registry.docType(d.docType);
      return !!doc && can(doc.permissions.create);
    }).map((d) => ({ id: d.id, label: registry.docType(d.docType)!.title, detail: `Updated ${d.updatedAt.slice(0, 10)}`, href: `/docs/${d.docType}/new?draft=${d.id}` })) });
  }
  if (role === 'accountant') {
    widgets.push({ key: 'exceptions', title: 'Exceptions inbox', items: notifications(db, clock, registry, user, where)
      .filter((n) => !n.read).slice(0, 20).map(({ id, label, href, detail, amountCents }) => ({ id, label, href, detail, amountCents })) });
  }
  if ((role === 'accountant' || role === 'owner') && can('tax.registers.view')) {
    const year = Number(date.slice(0, 4));
    const quarter = Math.ceil(Number(date.slice(5, 7)) / 3) as 1 | 2 | 3 | 4;
    const vat = vatSummary(db, year, quarter);
    widgets.push({ key: 'vat-quarter', title: 'VAT this quarter', href: '/tax/vat', items: [
      { id: 'output', label: 'Output VAT', amountCents: vat.outputVatCents },
      { id: 'input', label: 'Input VAT', amountCents: vat.inputVatCents },
      { id: 'payable', label: 'VAT payable so far', amountCents: vat.payableCents },
    ] });
  }
  if ((role === 'accountant' || role === 'owner') && can('acc.monthend.view')) {
    const month = prevMonthEnd(date).slice(0, 7);
    const checklist = monthEndChecklist(db, clock, registry, user, month);
    const done = checklist.items.filter((step) => step.state === 'done').length;
    widgets.push({ key: 'month-end', title: 'Month-end checklist', href: '/acc/month-end', items: [
      { id: month, label: `${done} of ${checklist.items.length} steps done`, detail: month },
    ] });
  }
  if ((role === 'accountant' || role === 'owner') && can('aud.integrity.view')) {
    const status = nightlyStatus(db);
    const nightlyFailed = status.foundCount > 0;
    const integrityFailed = status.integrity !== null && !status.integrity.passed;
    widgets.push({ key: 'integrity', title: 'Integrity', href: '/aud/integrity', ...(nightlyFailed || integrityFailed ? { tone: 'danger' as const } : {}), items: [
      { id: 'nightly', label: 'Last nightly check', detail: status.ranAt ? `${status.ranAt} · ${nightlyFailed ? `${status.foundCount} found` : 'Passed'}` : 'Not run yet' },
      { id: 'integrity', label: 'Last integrity check', detail: status.integrity ? `${status.integrity.ranAt} · ${status.integrity.passed ? 'Passed' : `${status.integrity.foundCount} found`}` : 'Not run yet' },
    ] });
  }
  if (role === 'encoder') {
    if (can('jo.view')) {
      const weekEnd = addDays(date, 7 - (day(date).getUTCDay() || 7));
      addOrders('due', 'Job orders due this week', orders.filter((jo) => jo.dueDate >= date && jo.dueDate <= weekEnd));
      addOrders('ready', 'Ready for release', orders.filter((jo) => jo.stage === 'ready'));
    }
    if (can('jo.view') && can('col.view')) addOrders('collectibles', 'Collectibles', owing(orders), true);
  }
  if (role === 'owner' && can('jo.view') && can('col.view')) {
    addOrders('overdue-collectibles', 'Overdue collectibles', owing(orders.filter((jo) => jo.dueDate < date)), true);
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
  return { role, asOf: date, widgets, showCharts: role === 'owner' && can('rpt.books.view') };
}

export function notifications(db: Db, clock: Clock, registry: Registry, user: SessionUser, where: HomeContext = {}): DashNotification[] {
  const can = (key: string) => user.permissions.has(key);
  const date = today(clock);
  const out: Omit<DashNotification, 'read'>[] = [];
  const push = (kind: string, id: string, label: string, href?: string, detail?: string, amountCents?: number) =>
    out.push({ kind, id: `${kind}:${id}`, label, ...(href ? { href } : {}), ...(detail ? { detail } : {}), ...(amountCents === undefined ? {} : { amountCents }) });
  if (roleOf(user) === 'owner' && can('aud.log.view')) {
    const since = manilaTimestamp(new Date(clock.now().getTime() - 14 * 86_400_000));
    const guarded = db.prepare(`SELECT a.seq, a.at, a.action, a.entity_id AS entityId, u.display_name AS userName
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.at >= ? AND a.action IN (SELECT value FROM json_each(?))
      ORDER BY a.at DESC, a.seq DESC`).all(since, JSON.stringify(Object.keys(GUARDED))) as { seq: number; at: string; action: string; entityId: string | null; userName: string | null }[];
    for (const a of guarded) {
      const named = a.action === 'acc.setting.add' || a.action === 'bak.restore' ? `${a.entityId} · ` : ''; // a setting's key, a backup's file
      push('step-up-action', String(a.seq), `${a.userName ?? 'The system'} ${GUARDED[a.action]}`, '/aud/log', `${named}${a.at}`);
    }
  }
  if (can('jo.view') && can('jo.invoice')) for (const release of releasesAwaitingInvoice(db, date)) {
    push('invoice-to-follow', release.id, `${release.number} still needs its invoice record`, `/docs/jo.invoice_record/new?releaseId=${release.id}`, `${release.jobOrderNumber} · released ${release.date}`);
  }
  if (can('col.view') && (roleOf(user) === 'encoder' || roleOf(user) === 'accountant')) {
    for (const c of pendingCertificates(db, addDays(date, -30))) if (!hasReceived2307(db, c.id)) {
      push('2307-to-chase', c.id, `${c.number}: 2307 to chase`, `/docs/col.collection/${c.id}`, `${c.customerName} · collected ${c.date}`);
    }
  }
  if (can('tax.calendar.view') && can('tax.payment.view')) {
    const paid = paidTaxPeriods(db);
    const payable = new Set(['0619-E', '1601-C', '2550Q', '1601-EQ', '1601-FQ', '1702Q', '1702-RT']);
    for (const deadline of taxDeadlines(db, date, addDays(date, 7))) if (payable.has(deadline.form) && !paid.has(`${deadline.form}:${deadline.period}`)) {
      push('tax-deadline', `${deadline.form}:${deadline.period}`, `${deadline.form} is due ${deadline.dueDate}`, '/tax/calendar', deadline.periodLabel);
    }
  }
  if (can('stat.view')) {
    let month = prevMonthEnd(date).slice(0, 7);
    for (let n = 0; n < 3; n++, month = prevMonthEnd(`${month}-01`).slice(0, 7)) {
      const dueDate = remittanceDueDate(month); // STAT's rule: the last day of the month after the pay month
      if (date < addDays(dueDate, -7)) continue;
      const monthLabel = day(`${month}-01`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      for (const check of remittanceChecks(db, month)) if (check.scheme !== 'WTAX' && check.state === 'not_done') {
        push('remittance-deadline', `${check.scheme}:${month}`, `${check.label} for ${monthLabel} ${date > dueDate ? 'was' : 'is'} due ${dueDate}`, '/stat');
      }
    }
  }
  if (can('szr.loan.view') && (roleOf(user) === 'encoder' || roleOf(user) === 'production')) {
    for (const set of sizerBoard(db, date).overdue) push('sizer-overdue', set.holder!.loanId, `${set.code} sizer set is overdue`, '/szr/sets',
      `${set.holder!.customerName} · due ${set.holder!.expectedReturnDate}`);
  }
  // Closed orders are excluded by JO's batch stage read before any balance-due lookup.
  let money: ReturnType<typeof joMoneyAll> | undefined;
  if (can('jo.view')) for (const jo of activeJobOrders(db)) {
    const stage = jo.stage;
    if (stage !== 'released' && stage !== 'partially_released') {
      if (jo.dueDate < date) push('jo-overdue', jo.id, `${jo.number} is overdue`, `/docs/jo.job_order/${jo.id}`, `Due ${jo.dueDate}`);
      else if (jo.dueDate <= addDays(date, 3)) push('jo-due', jo.id, `${jo.number} is due soon`, `/docs/jo.job_order/${jo.id}`, `Due ${jo.dueDate}`);
    }
    if (stage === 'ready') push('jo-ready', jo.id, `${jo.number} is ready for release`, `/docs/jo.job_order/${jo.id}`);
    if (can('col.view') && (stage === 'released' || stage === 'partially_released')) {
      const balance = (money ??= joMoneyAll(db)).get(jo.id)!.balanceDueCents;
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
  if (can('sec.health.view') && where.host) {
    for (const n of redLightNotices(db, clock, { practice: where.practice ?? false, host: where.host })) push('health-red', n.id, n.label, '/admin/health', n.detail);
  }
  const reads = new Set((db.prepare('SELECT notification_key FROM dash_notification_reads WHERE user_id = ?').all(user.userId) as { notification_key: string }[]).map((r) => r.notification_key));
  return out.map((n) => ({ ...n, read: reads.has(n.id) }));
}
