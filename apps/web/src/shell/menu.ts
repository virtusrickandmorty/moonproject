/**
 * The menu (PLAN H1): 9 groups, items filtered by exact permission keys. Document lists come from
 * GET /api/doc-types, which lists only the types the user may view. Other screens go in SCREENS with the
 * permission key their API route checks.
 */
import type { DocTypeInfo } from '../api.ts';

export const MENU_GROUPS = ['Overview', 'Sales', 'Production', 'Purchases & Expenses', 'Money', 'People & Payroll', 'Accounting & Tax', 'Reports', 'Admin'] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];
/** `sub`: the sub-category within the group, when set by hand; otherwise worked out by subOf (SUBS). */
export interface MenuItem { group: MenuGroup; label: string; path: string; permission?: string; sub?: string }

const MODULES: [MenuGroup, string][] = [
  ['Sales', 'CUS CAT QUO JO COL QS COM SUP SHP'],
  ['Production', 'PRD RATE SZR'],
  ['Purchases & Expenses', 'PUR AP EXP INV'],
  ['Money', 'CASH EQ LOAN FA'],
  ['People & Payroll', 'EMP PAY CA STAT'],
  ['Accounting & Tax', 'ACC TAX'],
  ['Reports', 'RPT'],
  ['Admin', 'PLT SEC AUD BAK MIG'],
];
const groupOf = (module: string): MenuGroup => MODULES.find(([, codes]) => codes.split(' ').includes(module))?.[0] ?? 'Overview';

export const SCREENS: MenuItem[] = [
  { group: 'Money', label: 'Cash Accounts', path: '/cash/accounts', permission: 'cash.places.view' },
  { group: 'Money', label: 'Cash book', path: '/cash/book', permission: 'cash.book.view' },
  { group: 'Money', label: 'Bank reconciliation', path: '/cash/recon', permission: 'cash.recon.view' },
  { group: 'Money', label: 'Checks on hand', path: '/col/checks', permission: 'col.checks.view' },
  { group: 'Sales', label: 'Post-dated checks', path: '/col/pdcs', permission: 'col.checks.view' },
  { group: 'Money', label: 'Owners and officers', path: '/eq/people', permission: 'eq.people.view' },
  { group: 'Money', label: 'Loans', path: '/loan/loans', permission: 'loan.loans.view' },
  { group: 'Money', label: 'Fixed assets', path: '/fa/assets', permission: 'fa.assets.view' },
  { group: 'Overview', label: 'Home', path: '/' },
  { group: 'Overview', label: 'Notifications', path: '/dash/notifications', permission: 'dash.view' },
  { group: 'Overview', label: 'Calendar', path: '/cal', permission: 'cal.view' },
  { group: 'Sales', label: 'Customers', path: '/cus', permission: 'cus.view' },
  { group: 'Sales', label: 'Support inbox', path: '/sup', permission: 'sup.view' },
  { group: 'Sales', label: 'Website assistant', path: '/aia', permission: 'aia.view' },
  { group: 'Sales', label: 'POS', path: '/pos', permission: 'shp.pos' },
  { group: 'Sales', label: 'Website shop', path: '/shp', permission: 'shp.view' },
  { group: 'Sales', label: 'Online orders', path: '/shp/orders', permission: 'shp.orders.view' },
  { group: 'Sales', label: 'Price list & piece rates', path: '/cat', permission: 'cat.view' },
  { group: 'Purchases & Expenses', label: 'Suppliers', path: '/pur/suppliers', permission: 'pur.supplier.view' },
  { group: 'Purchases & Expenses', label: 'Supplies', path: '/pur/supplies', permission: 'pur.supply.view' },
  { group: 'Admin', label: 'Shop certificate', path: '/admin/shop-certificate' },
  { group: 'Admin', label: 'Practice shop', path: '/admin/practice' },
  { group: 'Production', label: 'Production board', path: '/prd/board', permission: 'prd.view' },
  { group: 'Production', label: 'TV board', path: '/prd/tv', permission: 'prd.tv' },
  { group: 'Production', label: 'Sizer sets', path: '/szr/sets', permission: 'szr.loan.view' },
  { group: 'People & Payroll', label: 'Employees', path: '/emp/employees', permission: 'emp.view' },
  { group: 'People & Payroll', label: 'Leave balances', path: '/emp/leave-balances', permission: 'emp.view' },
  { group: 'People & Payroll', label: 'Attendance', path: '/emp/attendance', permission: 'emp.view' },
  { group: 'People & Payroll', label: 'Holidays', path: '/emp/holidays', permission: 'emp.view' },
  { group: 'People & Payroll', label: 'Government loans', path: '/pay/loans', permission: 'pay.loans.view' },
  { group: 'People & Payroll', label: '2316 and alphalist', path: '/pay/2316', permission: 'pay.yearend.view' },
  { group: 'Admin', label: 'Company print details', path: '/prt/company-profile', permission: 'prt.profile.manage' },
  { group: 'Admin', label: 'Printer test pack', path: '/prt/test-pack', permission: 'prt.test_pack' },
  { group: 'People & Payroll', label: 'Government remittances', path: '/stat', permission: 'stat.view' },
  { group: 'People & Payroll', label: 'Missing past government contributions', path: '/stat/exposure', permission: 'stat.view' },
  { group: 'People & Payroll', label: 'Cash advances owed', path: '/ca/employees', permission: 'ca.view' },
  { group: 'Purchases & Expenses', label: 'Payables by supplier', path: '/ap/suppliers', permission: 'ap.ledger.view' },
  { group: 'Accounting & Tax', label: 'Month-end checklist', path: '/acc/month-end', permission: 'acc.monthend.view' },
  { group: 'Accounting & Tax', label: 'Go-live decisions', path: '/acc/go-live-decisions', permission: 'acc.golive.view' },
  { group: 'Accounting & Tax', label: 'Reversals due', path: '/acc/reversals-due', permission: 'acc.jv.create' },
  { group: 'Accounting & Tax', label: 'Sales register', path: '/tax/sales', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '2307s received', path: '/tax/2307-received', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'Purchases register', path: '/tax/purchases', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'Tax withheld from suppliers (EWT register)', path: '/tax/ewt', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '2307s to issue', path: '/tax/2307-to-issue', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'VAT this quarter', path: '/tax/vat', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '2550Q worksheet', path: '/tax/2550q', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'SLSP: sales', path: '/tax/slsp-sales', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'SLSP: purchases', path: '/tax/slsp-purchases', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'SAWT', path: '/tax/sawt', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '0619-E (monthly EWT)', path: '/tax/0619e', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '1601-EQ (quarterly EWT)', path: '/tax/1601eq', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '1702Q worksheet', path: '/tax/1702q', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '1702-RT worksheet (annual)', path: '/tax/1702rt', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '1604-E (annual EWT)', path: '/tax/1604e', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'Tax calendar', path: '/tax/calendar', permission: 'tax.calendar.view' },
  { group: 'Accounting & Tax', label: 'Filed returns', path: '/tax/filed-returns', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'Booklets', path: '/tax/booklets', permission: 'tax.booklets.view' },
  { group: 'Reports', label: 'General journal', path: '/rpt/journal', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'BIR books', path: '/rpt/bir-books', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'General ledger', path: '/rpt/ledger', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Trial balance', path: '/rpt/trial-balance', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Income statement', path: '/rpt/income-statement', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Balance sheet', path: '/rpt/balance-sheet', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Statement of changes in equity', path: '/rpt/changes-in-equity', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Cash flow statement', path: '/rpt/cash-flow', permission: 'rpt.books.view' },
  { group: 'Reports', label: "Monthly owners' pack", path: '/rpt/monthly-owners-pack', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Unpaid customer balances (AR aging)', path: '/rpt/ar-aging', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Customer statement', path: '/rpt/customer-statement', permission: 'rpt.books.view' },
  { group: 'Admin', label: 'Users', path: '/admin/users', permission: 'sec.users.manage' },
  { group: 'Admin', label: 'Roles and permissions', path: '/admin/roles', permission: 'sec.users.manage' },
  { group: 'Accounting & Tax', label: 'Chart of accounts', path: '/acc/chart', permission: 'acc.coa.view' },
  { group: 'Accounting & Tax', label: 'Settings', path: '/acc/settings' },
  { group: 'Admin', label: 'System health', path: '/admin/health', permission: 'sec.health.view' },
  { group: 'Reports', label: 'Deposits held', path: '/rpt/deposits-held', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Deposits crossing a VAT quarter', path: '/rpt/deposits-crossing-quarter', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Collections register', path: '/rpt/collections-register', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Sales by period', path: '/rpt/sales-by-period', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Job order follow-up', path: '/rpt/job-order-follow-up', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Payroll register', path: '/rpt/payroll-register', permission: 'pay.run.view' },
  { group: 'Reports', label: 'Piece-work summary', path: '/rpt/piece-work', permission: 'pay.run.view' },
  { group: 'Reports', label: 'Labor cost by job order', path: '/rpt/labor-cost', permission: 'pay.run.view' },
  { group: 'Reports', label: '13th-month register', path: '/rpt/thirteenth-register', permission: 'pay.run.view' },
  { group: 'Reports', label: 'Production status counts', path: '/rpt/production-status', permission: 'prd.view' },
  { group: 'Reports', label: 'Production throughput', path: '/rpt/throughput', permission: 'prd.view' },
  { group: 'Reports', label: 'Job order lead time', path: '/rpt/lead-time', permission: 'prd.view' },
  { group: 'Reports', label: 'Late job orders', path: '/rpt/late-jobs', permission: 'prd.view' },
  { group: 'Reports', label: 'Worker output', path: '/rpt/worker-output', permission: 'prd.view' },
  { group: 'Reports', label: 'Job margin', path: '/rpt/job-margin', permission: 'pay.run.view' },
  { group: 'Reports', label: 'Unpaid supplier bills (AP aging)', path: '/rpt/ap-aging', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Purchases by supplier/category', path: '/rpt/purchases', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Purchase orders by status', path: '/rpt/purchase-orders', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Received but not billed', path: '/rpt/received-not-billed', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Cash position', path: '/rpt/cash-position', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Transfers report', path: '/rpt/transfers', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Cash counts', path: '/rpt/cash-counts', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Fixed-asset schedule', path: '/rpt/assets', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Late entries', path: '/rpt/late-entries', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Changes after filing', path: '/tax/changes-after-filing', permission: 'tax.registers.view' },
  { group: 'Reports', label: 'Cancellations and reissues', path: '/rpt/cancellations', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Exceptions', path: '/rpt/exceptions', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Sign-in history', path: '/rpt/sign-ins', permission: 'rpt.signins.view' },
  { group: 'Admin', label: 'Backups', path: '/bak', permission: 'bak.view' },
  { group: 'Sales', label: 'Customer emails', path: '/com', permission: 'com.outbox.view' },
  { group: 'Admin', label: 'Customer email settings', path: '/com/settings', permission: 'com.settings.manage' },
  { group: 'Admin', label: 'Opening balances', path: '/acc/opening', permission: 'acc.opening.view' },
  { group: 'Admin', label: 'Import old data', path: '/mig', permission: 'mig.run' },
  { group: 'Admin', label: 'Audit log', path: '/aud/log', permission: 'aud.log.view' },
  { group: 'Admin', label: 'Integrity check', path: '/aud/integrity', permission: 'aud.integrity.view' },
  { group: 'Admin', label: 'Nightly checks', path: '/aud/nightly', permission: 'aud.integrity.view' },
];
/**
 * The permission a screen's address needs: its menu item's, or for a page under one (like /pur/suppliers/12) the closest
 * menu item above it. Undefined: any signed-in user may open it (the server still checks every call).
 */
export function pagePermission(path: string): string | undefined {
  const under = SCREENS.filter((s) => s.permission && (path === s.path || path.startsWith(`${s.path}/`)));
  return under.sort((a, b) => b.path.length - a.path.length)[0]?.permission;
}

export const docPath = (type: string, rest = '') => `/docs/${type}${rest}`;
export const plural = (title: string) => (/[sy]$/.test(title) ? title : `${title}s`);

/**
 * Doc types found under another name than their document title: a quick sale is an Invoice Record (PLAN H1 "quick sale"),
 * and so is a downpayment invoice, kept apart from the release invoices' list. Also plurals the rule above gets wrong.
 */
const LABELS: Record<string, [one: string, many: string]> = { 'qs.sale': ['Quick Sale', 'Quick Sales'], 'jo.dp_invoice': ['Downpayment Invoice Record', 'Downpayment Invoice Records'], 'prd.entry': ['Production Entry', 'Production Entries'], 'pay.thirteenth': ['13th-Month Pay', '13th-Month Pay'], 'col.cwt_only': ['2307 Received', '2307s Received'] };
export const labelOf = (d: Pick<DocTypeInfo, 'key' | 'title'>) => LABELS[d.key]?.[0] ?? d.title;
export const pluralLabelOf = (d: Pick<DocTypeInfo, 'key' | 'title'>) => LABELS[d.key]?.[1] ?? plural(d.title);

/** True when the screen at `path` is the item's screen or one under it (a document of a list, say). */
export const isHere = (path: string, itemPath: string) => path === itemPath || (itemPath !== '/' && path.startsWith(`${itemPath}/`));

/** A menu with more items than this folds: each group shows its heading only, until opened. */
export const FOLD_AFTER = 20;
/** Where the browser keeps the groups a person opened or closed (only a convenience: without it the menu still works). */
export const MENU_FOLDS_KEY = 'moonproject.menu.groups';

/**
 * Which groups show their items. A short menu shows them all. A long one (an owner sees every screen) shows the groups
 * the person opened, and the group of the screen they are on unless they closed it.
 */
export function openGroups(menu: { group: MenuGroup; items: MenuItem[] }[], path: string, chosen: Readonly<Record<string, boolean>>): { folds: boolean; open: Set<MenuGroup> } {
  const all = menu.map((g) => g.group);
  if (menu.reduce((n, g) => n + g.items.length, 0) <= FOLD_AFTER) return { folds: false, open: new Set(all) };
  const here = menu.find((g) => g.items.some((i) => isHere(path, i.path)))?.group;
  return { folds: true, open: new Set(all.filter((g) => chosen[g] ?? g === here)) };
}

/**
 * A person's own order of the menu (PREF): their groups first in the order they chose, and within each group their screens
 * in their order. A group or screen they did not place (one added since, or newly allowed) keeps its usual place after
 * the placed ones; a placed one they can no longer open is simply not there.
 */
export function applyMenuOrder<G extends { group: MenuGroup; items: MenuItem[] }>(menu: G[], order?: { groups: string[]; items: Record<string, string[]> } | null): G[] {
  if (!order || (!order.groups.length && !Object.keys(order.items).length)) return menu;
  const rank = (placed: readonly string[], key: string, usual: number) => { const i = placed.indexOf(key); return i < 0 ? placed.length + usual : i; };
  const sorted = <T,>(list: T[], placed: readonly string[], key: (t: T) => string) =>
    list.map((t, usual) => ({ t, at: rank(placed, key(t), usual) })).sort((a, b) => a.at - b.at).map((x) => x.t);
  return sorted(menu.map((g) => ({ ...g, items: sorted(g.items, order.items[g.group] ?? [], (i) => i.path) })), order.groups, (g) => g.group);
}

/**
 * Sub-categories within a group (the owner's request, Oct 2026): screens and document lists that work together, in this
 * order. An item is placed by its document type, or by its address (the longest match); one placed nowhere goes last
 * under "More". A group with one sub-category shows no sub-headings.
 */
export const SUBS: Partial<Record<MenuGroup, [sub: string, keys: string[]][]>> = {
  Sales: [
    ['Customers & quotes', ['/cus', 'quo.quotation', '/cat', '/com', '/sup', '/aia']],
    ['Job orders & release', ['jo.job_order', 'jo.release', 'jo.invoice_record', 'jo.dp_invoice', 'jo.opening']],
    ['Collections', ['col.', '/col/pdcs']],
    ['Shop & POS', ['/pos', 'qs.sale', '/shp']],
  ],
  Production: [
    ['Production', ['/prd/board', 'prd.entry', '/prd/tv']],
    ['Sizers', ['/szr']],
  ],
  'Purchases & Expenses': [
    ['Purchasing', ['/pur/suppliers', '/pur/supplies', 'pur.']],
    ['Supplier bills & payments', ['ap.', '/ap/']],
    ['Expenses', ['exp.']],
    ['Inventory', ['inv.']],
  ],
  Money: [
    ['Cash & bank', ['/cash/', 'cash.', '/col/checks']],
    ['Owners & loans', ['/eq/', 'eq.', '/loan/', 'loan.']],
    ['Fixed assets', ['/fa/', 'fa.']],
  ],
  'People & Payroll': [
    ['Employees & time', ['/emp/']],
    ['Payroll', ['pay.', '/pay/']],
    ['Cash advances', ['/ca/', 'ca.']],
    ['Government contributions', ['/stat', 'stat.']],
  ],
  'Accounting & Tax': [
    ['Books', ['/acc/', 'acc.']],
    ['Tax registers', ['/tax/sales', '/tax/purchases', '/tax/ewt', '/tax/2307-received', '/tax/2307-to-issue', '/tax/slsp-sales', '/tax/slsp-purchases', '/tax/sawt']],
    ['Tax returns & payments', ['/tax/', 'tax.']],
  ],
  Reports: [
    ['Financial statements & books', ['/rpt/journal', '/rpt/bir-books', '/rpt/ledger', '/rpt/trial-balance', '/rpt/income-statement', '/rpt/balance-sheet', '/rpt/changes-in-equity', '/rpt/cash-flow', '/rpt/monthly-owners-pack']],
    ['Sales & customers', ['/rpt/ar-aging', '/rpt/customer-statement', '/rpt/deposits-held', '/rpt/deposits-crossing-quarter', '/rpt/collections-register', '/rpt/sales-by-period', '/rpt/job-order-follow-up', '/rpt/job-margin']],
    ['Production & payroll', ['/rpt/payroll-register', '/rpt/piece-work', '/rpt/labor-cost', '/rpt/thirteenth-register', '/rpt/production-status', '/rpt/throughput', '/rpt/lead-time', '/rpt/late-jobs', '/rpt/worker-output']],
    ['Purchases', ['/rpt/ap-aging', '/rpt/purchases', '/rpt/purchase-orders', '/rpt/received-not-billed']],
    ['Cash & assets', ['/rpt/cash-position', '/rpt/transfers', '/rpt/cash-counts', '/rpt/assets']],
    ['Controls', ['/rpt/late-entries', '/tax/changes-after-filing', '/rpt/cancellations', '/rpt/exceptions', '/rpt/sign-ins']],
  ],
  Admin: [
    ['Users & access', ['/admin/users', '/admin/roles']],
    ['Setup', ['/prt/', '/com/settings', '/admin/shop-certificate', '/acc/opening', '/mig', '/admin/practice']],
    ['Safety & checks', ['/bak', '/aud/', '/admin/health']],
  ],
};
const MORE = 'More';
/** The sub-category of an item in its group: by its document type key ("jo.release") or its address, the longest match. */
export function subOf(item: Pick<MenuItem, 'group' | 'path'>): string {
  const doc = /^\/docs\/([^/?]+)/.exec(item.path)?.[1];
  let best: [string, number] | null = null;
  for (const [sub, keys] of SUBS[item.group] ?? []) {
    for (const k of keys) {
      const hit = k.startsWith('/') ? !doc && (item.path === k || item.path.startsWith(k.endsWith('/') ? k : `${k}/`) || item.path === k.replace(/\/$/, ''))
        : !!doc && (doc === k || (k.endsWith('.') && doc.startsWith(k)));
      if (hit && (!best || k.length > best[1])) best = [sub, k.length];
    }
  }
  return best?.[0] ?? MORE;
}
/**
 * A group's items by sub-category: in the person's own order of the sub-categories (`subOrder`, Arrange menu), then the
 * usual SUBS order ("More" last); each keeps its order within (a person's own order too).
 */
export function sectionsOf(group: MenuGroup, items: MenuItem[], subOrder: readonly string[] = []): { sub: string; items: MenuItem[] }[] {
  const usual = [...(SUBS[group] ?? []).map(([s]) => s), MORE];
  const order = [...subOrder.filter((s) => usual.includes(s)), ...usual.filter((s) => !subOrder.includes(s))];
  return order.map((sub) => ({ sub, items: items.filter((i) => (i.sub ?? subOf(i)) === sub) })).filter((s) => s.items.length > 0);
}

export function buildMenu(docTypes: DocTypeInfo[], permissions: ReadonlySet<string>, screens = SCREENS): { group: MenuGroup; items: MenuItem[] }[] {
  const items: MenuItem[] = [
    ...screens.filter((s) => !s.permission || permissions.has(s.permission)),
    ...docTypes.map((d) => ({ group: groupOf(d.module), label: pluralLabelOf(d), path: docPath(d.key) })),
  ];
  return MENU_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0);
}
