/**
 * The menu (PLAN H1): 9 groups, items filtered by exact permission keys. Document lists come from
 * GET /api/doc-types, which lists only the types the user may view. Other screens go in SCREENS with the
 * permission key their API route checks.
 */
import type { DocTypeInfo } from '../api.ts';

export const MENU_GROUPS = ['Overview', 'Sales', 'Production', 'Purchases & Expenses', 'Money', 'People & Payroll', 'Accounting & Tax', 'Reports', 'Admin'] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];
export interface MenuItem { group: MenuGroup; label: string; path: string; permission?: string }

const MODULES: [MenuGroup, string][] = [
  ['Sales', 'CUS CAT QUO JO COL QS COM'],
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
  { group: 'Money', label: 'Owners and officers', path: '/eq/people', permission: 'eq.people.view' },
  { group: 'Money', label: 'Loans', path: '/loan/loans', permission: 'loan.loans.view' },
  { group: 'Money', label: 'Fixed assets', path: '/fa/assets', permission: 'fa.assets.view' },
  { group: 'Overview', label: 'Home', path: '/' },
  { group: 'Overview', label: 'Notifications', path: '/dash/notifications', permission: 'dash.view' },
  { group: 'Overview', label: 'Calendar', path: '/cal', permission: 'cal.view' },
  { group: 'Sales', label: 'Customers', path: '/cus', permission: 'cus.view' },
  { group: 'Sales', label: 'Price list', path: '/cat', permission: 'cat.view' },
  { group: 'Purchases & Expenses', label: 'Suppliers', path: '/pur/suppliers', permission: 'pur.supplier.view' },
  { group: 'Purchases & Expenses', label: 'Supplies', path: '/pur/supplies', permission: 'pur.supply.view' },
  { group: 'Admin', label: 'Shop certificate', path: '/admin/shop-certificate' },
  { group: 'Admin', label: 'Practice shop', path: '/admin/practice' },
  { group: 'Production', label: 'Production board', path: '/prd/board', permission: 'prd.view' },
  { group: 'Production', label: 'TV board', path: '/prd/tv', permission: 'prd.tv' },
  { group: 'Production', label: 'Piece rates', path: '/prd/rates', permission: 'rate.view' },
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
  { group: 'People & Payroll', label: 'Statutory exposure', path: '/stat/exposure', permission: 'stat.view' },
  { group: 'People & Payroll', label: 'Cash advances owed', path: '/ca/employees', permission: 'ca.view' },
  { group: 'Purchases & Expenses', label: 'Payables by supplier', path: '/ap/suppliers', permission: 'ap.ledger.view' },
  { group: 'Accounting & Tax', label: 'Month-end checklist', path: '/acc/month-end', permission: 'acc.monthend.view' },
  { group: 'Accounting & Tax', label: 'Go-live decisions', path: '/acc/go-live-decisions', permission: 'acc.golive.view' },
  { group: 'Accounting & Tax', label: 'Sales register', path: '/tax/sales', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: '2307s received', path: '/tax/2307-received', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'Purchases register', path: '/tax/purchases', permission: 'tax.registers.view' },
  { group: 'Accounting & Tax', label: 'EWT register', path: '/tax/ewt', permission: 'tax.registers.view' },
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
  { group: 'Accounting & Tax', label: 'Booklets', path: '/tax/booklets', permission: 'tax.booklets.view' },
  { group: 'Reports', label: 'General journal', path: '/rpt/journal', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'BIR books', path: '/rpt/bir-books', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'General ledger', path: '/rpt/ledger', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Trial balance', path: '/rpt/trial-balance', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Income statement', path: '/rpt/income-statement', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Balance sheet', path: '/rpt/balance-sheet', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Cash flow statement', path: '/rpt/cash-flow', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'AR aging', path: '/rpt/ar-aging', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Customer statement', path: '/rpt/customer-statement', permission: 'rpt.books.view' },
  { group: 'Admin', label: 'Users', path: '/admin/users', permission: 'sec.users.manage' },
  { group: 'Admin', label: 'Roles and permissions', path: '/admin/roles', permission: 'sec.users.manage' },
  { group: 'Accounting & Tax', label: 'Chart of accounts', path: '/acc/chart', permission: 'acc.coa.view' },
  { group: 'Accounting & Tax', label: 'Settings', path: '/acc/settings' },
  { group: 'Admin', label: 'System health', path: '/admin/health', permission: 'sec.health.view' },
  { group: 'Reports', label: 'Deposits held', path: '/rpt/deposits-held', permission: 'rpt.books.view' },
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
  { group: 'Reports', label: 'AP aging', path: '/rpt/ap-aging', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Purchases by supplier/category', path: '/rpt/purchases', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Purchase orders by status', path: '/rpt/purchase-orders', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Received but not billed', path: '/rpt/received-not-billed', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Cash position', path: '/rpt/cash-position', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Transfers report', path: '/rpt/transfers', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Cash counts', path: '/rpt/cash-counts', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Fixed-asset schedule', path: '/rpt/assets', permission: 'rpt.books.view' },
  { group: 'Reports', label: 'Late entries', path: '/rpt/late-entries', permission: 'rpt.books.view' },
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
export const docPath = (type: string, rest = '') => `/docs/${type}${rest}`;
export const plural = (title: string) => (/[sy]$/.test(title) ? title : `${title}s`);

/** Doc types found under another name than their document title: a quick sale is an Invoice Record (PLAN H1 "quick sale"). Also plurals the rule above gets wrong. */
const LABELS: Record<string, [one: string, many: string]> = { 'qs.sale': ['Quick Sale', 'Quick Sales'], 'prd.entry': ['Production Entry', 'Production Entries'], 'pay.thirteenth': ['13th-Month Pay', '13th-Month Pay'], 'col.cwt_only': ['2307 Received', '2307s Received'] };
export const labelOf = (d: Pick<DocTypeInfo, 'key' | 'title'>) => LABELS[d.key]?.[0] ?? d.title;
export const pluralLabelOf = (d: Pick<DocTypeInfo, 'key' | 'title'>) => LABELS[d.key]?.[1] ?? plural(d.title);

export function buildMenu(docTypes: DocTypeInfo[], permissions: ReadonlySet<string>, screens = SCREENS): { group: MenuGroup; items: MenuItem[] }[] {
  const items: MenuItem[] = [
    ...screens.filter((s) => !s.permission || permissions.has(s.permission)),
    ...docTypes.map((d) => ({ group: groupOf(d.module), label: pluralLabelOf(d), path: docPath(d.key) })),
  ];
  return MENU_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0);
}
