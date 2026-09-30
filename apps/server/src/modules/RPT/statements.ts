/**
 * Financial statements (PLAN G "Books & statements", D1.7) from sealed journal lines only. Codes decide the statement:
 * 1xxx assets, 2xxx liabilities and 3xxx equity go to the balance sheet; 4xxx to 8xxx to the income statement. The
 * year-end close is virtual: 3290 current-year earnings and the earlier years' earnings not yet closed to retained
 * earnings are computed here and never posted, so total assets always equal total liabilities and equity.
 */
import type { Db } from '../../platform/db/driver.ts';

type Side = 'debit' | 'credit';
type ChartRow = { id: number; code: string; name: string; isHeader: number; roleKey: string | null; sortOrder: number };
type Movement = { netCents: number; lineCount: number };

/** One amount on the side of its section: a contra account (accumulated depreciation, sales discounts) is negative. */
/** With a comparison (compareSections): the other period's amount, the difference, and the change in percent (null from zero). */
export type Compared = { compareAmountCents?: number; differenceCents?: number; percentChange?: number | null };
export type StatementLine = Compared & { accountId: number | null; code: string | null; name: string; amountCents: number; computed: boolean };
/** The accounts under one header account (1100, 4100, ...) with their subtotal; no header when only x000 is above them. */
export type StatementGroup = Compared & { code: string | null; name: string | null; lines: StatementLine[]; totalCents: number };
export type StatementSection = Compared & { key: string; title: string; side: Side; groups: StatementGroup[]; totalCents: number };

export type Comparison = 'previous_month' | 'last_year';

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const shifted = (date: string, years: number, months: number) => {
  const [year, month, day] = parts(date);
  const index = year * 12 + month - 1 + years * 12 + months;
  const shiftedYear = Math.floor(index / 12); const shiftedMonth = index % 12 + 1;
  const targetDay = day === daysInMonth(year, month) ? daysInMonth(shiftedYear, shiftedMonth) : Math.min(day, daysInMonth(shiftedYear, shiftedMonth));
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
};

export function comparisonDates(compare: Comparison, from: string, to?: string) {
  const years = compare === 'last_year' ? -1 : 0; const months = compare === 'previous_month' ? -1 : 0;
  return { from: shifted(from, years, months), ...(to === undefined ? {} : { to: shifted(to, years, months) }) };
}

const comparisonValues = (amountCents: number, compareAmountCents: number) => ({ amountCents, compareAmountCents,
  differenceCents: amountCents - compareAmountCents,
  percentChange: compareAmountCents === 0 ? null : (amountCents - compareAmountCents) / Math.abs(compareAmountCents) * 100 });

/** The keys of both periods: this period's in its order, and one only in the other period put before the first coded key above it. */
function mergedKeys<T>(current: T[], other: T[], key: (item: T) => string, code: (item: T) => string | null): string[] {
  const keys = current.map(key);
  const codes = new Map([...current, ...other].map((item) => [key(item), code(item)]));
  for (const item of other) {
    const k = key(item);
    if (keys.includes(k)) continue;
    const c = code(item);
    const at = c === null ? -1 : keys.findIndex((x) => { const xc = codes.get(x); return xc != null && xc > c; });
    if (at < 0) keys.push(k); else keys.splice(at, 0, k);
  }
  return keys;
}

/** Merge two independently calculated statements without losing accounts present in only one period. */
export function compareSections(current: StatementSection[], other: StatementSection[]): StatementSection[] {
  return current.map((section, sectionIndex) => {
    const compared = other[sectionIndex]!;
    const groupKeys = mergedKeys(section.groups, compared.groups, (g) => g.code ?? '', (g) => g.code ?? g.lines[0]?.code ?? null);
    const groups = groupKeys.map((key) => {
      const group = section.groups.find((g) => (g.code ?? '') === key);
      const otherGroup = compared.groups.find((g) => (g.code ?? '') === key);
      const lineKeys = mergedKeys(group?.lines ?? [], otherGroup?.lines ?? [], (l) => `${l.accountId ?? ''}:${l.code ?? ''}:${l.name}`, (l) => l.code);
      const lines = lineKeys.map((lineKey) => {
        const find = (lines: StatementLine[]) => lines.find((l) => `${l.accountId ?? ''}:${l.code ?? ''}:${l.name}` === lineKey);
        const line = find(group?.lines ?? []) ?? find(otherGroup?.lines ?? [])!;
        return { ...line, ...comparisonValues(find(group?.lines ?? [])?.amountCents ?? 0, find(otherGroup?.lines ?? [])?.amountCents ?? 0) };
      });
      const sample = group ?? otherGroup!;
      return { ...sample, lines, ...comparisonValues(group?.totalCents ?? 0, otherGroup?.totalCents ?? 0) };
    });
    return { ...section, groups, ...comparisonValues(section.totalCents, compared.totalCents) };
  });
}

const IS_SECTIONS = [
  { digit: '4', key: 'revenue', title: 'Revenue', side: 'credit' },
  { digit: '5', key: 'costOfSales', title: 'Cost of sales', side: 'debit' },
  { digit: '6', key: 'operatingExpenses', title: 'Operating expenses', side: 'debit' },
  { digit: '7', key: 'otherIncomeAndExpenses', title: 'Other income and expenses', side: 'credit' },
  { digit: '8', key: 'incomeTax', title: 'Income tax', side: 'debit' },
] as const;
const BS_SECTIONS = [
  { digit: '1', key: 'assets', title: 'Assets', side: 'debit' },
  { digit: '2', key: 'liabilities', title: 'Liabilities', side: 'credit' },
  { digit: '3', key: 'equity', title: 'Equity', side: 'credit' },
] as const;
const onBalanceSheet = (code: string) => BS_SECTIONS.some((s) => s.digit === code[0]);

function chart(db: Db): ChartRow[] {
  return db.prepare(`SELECT id, code, name, is_header AS isHeader, role_key AS roleKey, sort_order AS sortOrder
    FROM accounts ORDER BY sort_order, code`).all() as ChartRow[];
}

/** Debit-positive net and line count per account, from sealed journals dated from..to (no lower bound when from is null). */
function movements(db: Db, from: string | null, to: string): Map<number, Movement> {
  const rows = db.prepare(`SELECT l.account_id AS accountId, SUM(l.debit_cents - l.credit_cents) AS netCents, COUNT(*) AS lineCount
    FROM journal_lines l JOIN journals j ON j.id = l.journal_id
    WHERE j.sealed = 1 AND (@from IS NULL OR j.business_date >= @from) AND j.business_date <= @to
    GROUP BY l.account_id`).all({ from, to }) as ({ accountId: number } & Movement)[];
  return new Map(rows.map((r) => [r.accountId, r]));
}

/** Net income (credit-positive) of every income statement account, dated from..to. */
function netIncome(db: Db, accounts: ChartRow[], from: string | null, to: string): number {
  const codes = new Map(accounts.map((a) => [a.id, a.code]));
  let net = 0;
  for (const [id, m] of movements(db, from, to)) if (!onBalanceSheet(codes.get(id) ?? '')) net -= m.netCents;
  return net;
}

/** The header an account sits under: the longest xx00 prefix (x000 is the section itself, so it gives no group). */
function headerOf(code: string, headers: ChartRow[]): ChartRow | null {
  let best: ChartRow | null = null;
  for (const h of headers) {
    const prefix = h.code.replace(/0+$/, '');
    if (prefix.length >= 2 && code.startsWith(prefix) && code !== h.code && (!best || prefix.length > best.code.replace(/0+$/, '').length)) best = h;
  }
  return best;
}

type Entry = StatementLine & { sortOrder: number; groupCode: string | null };

/** Groups a section's entries under their headers in chart order, with subtotals. */
function section(def: { key: string; title: string; side: Side }, entries: Entry[], headers: ChartRow[]): StatementSection {
  const groups = new Map<string, StatementGroup>();
  for (const e of [...entries].sort((a, b) => a.sortOrder - b.sortOrder || String(a.code).localeCompare(String(b.code)))) {
    const header = headers.find((h) => h.code === e.groupCode) ?? null;
    const key = header?.code ?? '';
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { code: header?.code ?? null, name: header?.name ?? null, lines: [], totalCents: 0 }));
    const { sortOrder: _s, groupCode: _g, ...line } = e;
    group.lines.push(line);
    group.totalCents += e.amountCents;
  }
  const list = [...groups.values()];
  return { key: def.key, title: def.title, side: def.side, groups: list, totalCents: list.reduce((s, g) => s + g.totalCents, 0) };
}

const signed = (side: Side, debitPositive: number) => (side === 'debit' ? debitPositive : -debitPositive);

/** Revenue, cost of sales, operating expenses, other income and expenses and income tax for from..to; accounts with no lines in the range are left out. */
export function incomeStatement(db: Db, from: string, to: string) {
  const accounts = chart(db);
  const headers = accounts.filter((a) => a.isHeader === 1);
  const moved = movements(db, from, to);
  const sections = IS_SECTIONS.map((def) => {
    const entries = accounts
      .filter((a) => a.isHeader === 0 && a.code[0] === def.digit && (moved.get(a.id)?.lineCount ?? 0) > 0)
      .map((a): Entry => ({ accountId: a.id, code: a.code, name: a.name, amountCents: signed(def.side, moved.get(a.id)!.netCents),
        computed: false, sortOrder: a.sortOrder, groupCode: headerOf(a.code, headers)?.code ?? null }));
    return section(def, entries, headers);
  });
  const [revenue, costOfSales, operatingExpenses, other, incomeTax] = sections.map((s) => s.totalCents) as [number, number, number, number, number];
  const grossProfitCents = revenue - costOfSales;
  const incomeBeforeTaxCents = grossProfitCents - operatingExpenses + other;
  return { from, to, sections, grossProfitCents, incomeBeforeTaxCents, netIncomeCents: incomeBeforeTaxCents - incomeTax };
}

/**
 * Assets, liabilities and equity as of a date; accounts with a zero balance are left out (so 3900 opening balance equity
 * shows only while it is not zero). Equity adds the current-year earnings (1 January of the asOf year to asOf) on 3290
 * and the earlier years' earnings (every income and expense before that 1 January) under retained earnings.
 */
export function balanceSheet(db: Db, asOf: string) {
  const accounts = chart(db);
  const headers = accounts.filter((a) => a.isHeader === 1);
  const balances = movements(db, null, asOf);
  const year = Number(asOf.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const currentYearEarningsCents = netIncome(db, accounts, yearStart, asOf);
  const earlierYearsEarningsCents = netIncome(db, accounts, null, `${year - 1}-12-31`);
  const currentYear = accounts.find((a) => a.roleKey === 'CURRENT_YEAR_EARNINGS');
  const retained = accounts.find((a) => a.roleKey === 'RETAINED_EARNINGS') ?? currentYear;
  const entry = (a: ChartRow, side: Side, amountCents: number, computed = false): Entry => ({ accountId: a.id, code: a.code, name: a.name,
    amountCents, computed, sortOrder: a.sortOrder, groupCode: headerOf(a.code, headers)?.code ?? null });

  const sections = BS_SECTIONS.map((def) => {
    const entries = accounts
      .filter((a) => a.isHeader === 0 && a.code[0] === def.digit && a.id !== currentYear?.id && (balances.get(a.id)?.netCents ?? 0) !== 0)
      .map((a) => entry(a, def.side, signed(def.side, balances.get(a.id)!.netCents)));
    if (def.key === 'equity') {
      // 3290 is never posted; anything that reached it anyway stays in the total so the check still holds.
      const posted = currentYear ? -(balances.get(currentYear.id)?.netCents ?? 0) : 0;
      entries.push(currentYear
        ? entry(currentYear, def.side, posted + currentYearEarningsCents, true)
        : { accountId: null, code: null, name: 'Current-year earnings', amountCents: currentYearEarningsCents, computed: true, sortOrder: Number.MAX_SAFE_INTEGER, groupCode: null });
      entries.push({ accountId: null, code: null, name: 'Earlier years’ earnings not yet closed to retained earnings', amountCents: earlierYearsEarningsCents,
        computed: true, sortOrder: (retained?.sortOrder ?? Number.MAX_SAFE_INTEGER) + 0.5, groupCode: retained ? (headerOf(retained.code, headers)?.code ?? null) : null });
    }
    return section(def, entries, headers);
  });
  const [totalAssetsCents, totalLiabilitiesCents, totalEquityCents] = sections.map((s) => s.totalCents) as [number, number, number];
  const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;
  // Trade receivables less the allowance for credit losses (1201 − 1209); the two lines also sit under Receivables.
  const balanceOf = (role: string) => { const a = accounts.find((x) => x.roleKey === role); return a ? (balances.get(a.id)?.netCents ?? 0) : 0; };
  const tradeCents = balanceOf('AR_TRADE'); const allowanceCents = -balanceOf('AR_ALLOWANCE');
  const receivables = { tradeCents, allowanceCents, netCents: tradeCents - allowanceCents };
  return { asOf, yearStart, sections, receivables, currentYearEarningsCents, earlierYearsEarningsCents, totalAssetsCents, totalLiabilitiesCents,
    totalEquityCents, totalLiabilitiesAndEquityCents, differenceCents: totalAssetsCents - totalLiabilitiesAndEquityCents,
    balanced: totalAssetsCents === totalLiabilitiesAndEquityCents };
}
