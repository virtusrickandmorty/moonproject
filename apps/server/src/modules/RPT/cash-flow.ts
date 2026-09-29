/**
 * Direct-method cash flow from sealed journal lines. D2 account ranges are classified as follows: 12xx, 14xx,
 * 21xx-24xx and 4xxx-8xxx are operating; 15xx fixed assets (plus 7102/7202 disposal results) are investing;
 * 1220, 25xx, 26xx and 3xxx owner/loan/equity accounts are financing. If counterpart accounts span sections,
 * their absolute line amounts vote and the largest section wins. Journals containing only cash places (and 1190
 * transfer clearing) are internal transfers and are omitted.
 */
import type { Db } from '../../platform/db/driver.ts';

export type CashFlowSectionKey = 'operating' | 'investing' | 'financing';
export type CashFlowLine = { key: string; name: string; amountCents: number };
export type CashFlowSection = { key: CashFlowSectionKey; title: string; lines: CashFlowLine[]; totalCents: number };
type FlowRow = { journalId: string; cashCents: number; code: string; roleKey: string | null; amountCents: number };

const sectionOf = (code: string): CashFlowSectionKey => {
  if (/^15/.test(code) || code === '7102' || code === '7202') return 'investing';
  if (code === '1220' || /^(25|26|3)/.test(code)) return 'financing';
  return 'operating';
};

function description(section: CashFlowSectionKey, rows: FlowRow[], cashCents: number): [string, string] {
  const codes = rows.map((r) => r.code);
  if (section === 'investing') return cashCents >= 0 ? ['assetSales', 'Fixed assets sold'] : ['assetPurchases', 'Fixed assets bought'];
  if (section === 'financing') {
    const loan = codes.some((c) => /^26/.test(c));
    if (loan) return cashCents >= 0 ? ['loansReceived', 'Loans received'] : ['loansRepaid', 'Loans repaid'];
    return cashCents >= 0 ? ['ownerMoneyIn', 'Owners’ money in'] : ['ownerMoneyOut', 'Owners’ money out'];
  }
  if (cashCents >= 0 && codes.some((c) => /^12|^22|^4/.test(c))) return ['customerCollections', 'Collections from customers'];
  if (codes.some((c) => /^(14|23|24|8)|^6195/.test(c))) return cashCents >= 0 ? ['taxRefunds', 'Tax refunds'] : ['government', 'Government remittances and taxes'];
  if (codes.some((c) => /^(211|52)|^610[123]/.test(c))) return cashCents >= 0 ? ['payrollRefunds', 'Payroll refunds'] : ['payroll', 'Payroll paid'];
  if (cashCents < 0 && codes.some((c) => /^(21|5|6)/.test(c))) return ['suppliersExpenses', 'Payments to suppliers and for expenses'];
  return cashCents >= 0 ? ['otherOperatingReceipts', 'Other operating receipts'] : ['otherOperatingPayments', 'Other operating payments'];
}

const cashBalance = (db: Db, before: string, inclusive: boolean) => db.prepare(`SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0)
  FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN cash_place_settings p ON p.account_id=l.account_id
  WHERE j.sealed=1 AND j.business_date ${inclusive ? '<=' : '<'} ?`).pluck().get(before) as number;

/** One statement per line: opening + classified period movements = closing; the check independently reads cash GL balances. */
export function cashFlowStatement(db: Db, from: string, to: string) {
  const raw = db.prepare(`WITH cash AS (SELECT account_id FROM cash_place_settings), cash_moves AS (
      SELECT j.id AS journalId,SUM(cl.debit_cents-cl.credit_cents) AS cashCents
      FROM journals j JOIN journal_lines cl ON cl.journal_id=j.id JOIN cash c ON c.account_id=cl.account_id
      WHERE j.sealed=1 AND j.business_date BETWEEN @from AND @to GROUP BY j.id)
    SELECT m.journalId,m.cashCents,a.code,a.role_key AS roleKey,(l.debit_cents+l.credit_cents) AS amountCents
    FROM cash_moves m JOIN journal_lines l ON l.journal_id=m.journalId JOIN accounts a ON a.id=l.account_id
    WHERE l.account_id NOT IN (SELECT account_id FROM cash) AND a.code<>'1190' ORDER BY m.journalId,l.line_no`).all({ from, to }) as FlowRow[];
  const journals = new Map<string, FlowRow[]>();
  for (const row of raw) { const list = journals.get(row.journalId) ?? []; list.push(row); journals.set(row.journalId, list); }
  const defs: [CashFlowSectionKey, string][] = [['operating', 'Operating activities'], ['investing', 'Investing activities'], ['financing', 'Financing activities']];
  const buckets = new Map<string, CashFlowLine>();
  for (const rows of journals.values()) {
    const cashCents = rows[0]!.cashCents;
    if (cashCents === 0 || rows.length === 0) continue;
    const votes = new Map<CashFlowSectionKey, number>();
    for (const r of rows) votes.set(sectionOf(r.code), (votes.get(sectionOf(r.code)) ?? 0) + r.amountCents);
    const section = defs.map(([key]) => key).sort((a, b) => (votes.get(b) ?? 0) - (votes.get(a) ?? 0))[0]!;
    const [key, name] = description(section, rows.filter((r) => sectionOf(r.code) === section), cashCents);
    const id = `${section}:${key}`; const line = buckets.get(id) ?? { key, name, amountCents: 0 };
    line.amountCents += cashCents; buckets.set(id, line);
  }
  const sections = defs.map(([key, title]): CashFlowSection => {
    const order = ['customerCollections', 'otherOperatingReceipts', 'suppliersExpenses', 'payroll', 'government', 'otherOperatingPayments',
      'assetSales', 'assetPurchases', 'ownerMoneyIn', 'ownerMoneyOut', 'loansReceived', 'loansRepaid'];
    const lines = [...buckets].filter(([id]) => id.startsWith(`${key}:`)).map(([, line]) => line).filter((l) => l.amountCents !== 0)
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return { key, title, lines, totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0) };
  });
  const openingCashCents = cashBalance(db, from, false);
  const netChangeCents = sections.reduce((sum, section) => sum + section.totalCents, 0);
  const closingCashCents = openingCashCents + netChangeCents;
  const balanceSheetCashCents = cashBalance(db, to, true);
  return { from, to, openingCashCents, sections, netChangeCents, closingCashCents, balanceSheetCashCents,
    checkDifferenceCents: closingCashCents - balanceSheetCashCents, balanced: closingCashCents === balanceSheetCashCents };
}
