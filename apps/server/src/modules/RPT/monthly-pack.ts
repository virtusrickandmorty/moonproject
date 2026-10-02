import type { Db } from '../../platform/db/driver.ts';
import { arAging } from './receivables.ts';
import { cashFlowStatement } from './cash-flow.ts';
import { balanceSheet, compareSections, incomeStatement } from './statements.ts';
import { payrollRegister, productionTiming } from './payroll-production.ts';
import { printField, printLineTable, printMoney } from '../PRT/public.ts';
import type { StatementSection } from './statements.ts';

const day = 86_400_000;
const PAY_GROUPS: Record<string, string> = { WEEKLY_PIECE: 'Weekly piece-rate', SEMI_DAILY: 'Semi-monthly daily-paid', SEMI_MONTHLY: 'Semi-monthly monthly staff' };
const previousMonth = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, number! - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${new Date(Date.UTC(year!, number!, 0)).getUTCDate()}`;
};

/** The six source reports used by the owners' pack, without independently recomputing any money figure. */
export function monthlyOwnersPack(db: Db, month: string) {
  const previous = previousMonth(month), from = `${month}-01`, to = monthEnd(month);
  const previousFrom = `${previous}-01`, previousTo = monthEnd(previous);
  const income = incomeStatement(db, from, to), previousIncome = incomeStatement(db, previousFrom, previousTo);
  const balance = balanceSheet(db, to), previousBalance = balanceSheet(db, previousTo);
  const cashFlow = cashFlowStatement(db, from, to), aging = arAging(db, to);
  const customers = new Map<string, { customerName: string; owedCents: number; oldestDate: string }>();
  for (const row of aging.rows) {
    const key = row.customerId ?? row.customerName;
    const current = customers.get(key) ?? { customerName: row.customerName, owedCents: 0, oldestDate: '' };
    current.owedCents += row.totalCents;
    if (row.date && (!current.oldestDate || row.date < current.oldestDate)) current.oldestDate = row.date;
    customers.set(key, current);
  }
  const topCustomers = [...customers.values()].filter((row) => row.owedCents > 0)
    .sort((a, b) => b.owedCents - a.owedCents || a.customerName.localeCompare(b.customerName)).slice(0, 10)
    .map((row) => ({ ...row, oldestInvoiceAgeDays: row.oldestDate ? Math.max(0, Math.floor((Date.parse(to) - Date.parse(row.oldestDate)) / day)) : null }));
  const payroll = payrollRegister(db, month);
  const payrollByGroup = new Map<string, { payGroup: string; grossCents: number; employerSharesCents: number; costCents: number }>();
  for (const row of payroll.rows as Record<string, string | number | null>[]) {
    const payGroup = String(row.payGroup), current = payrollByGroup.get(payGroup) ?? { payGroup, grossCents: 0, employerSharesCents: 0, costCents: 0 };
    current.grossCents += Number(row.grossCents); current.employerSharesCents += Number(row.employerSharesCents);
    current.costCents = current.grossCents + current.employerSharesCents; payrollByGroup.set(payGroup, current);
  }
  const orders = productionTiming(db, to).rows as Record<string, string | number | null>[];
  const jobs = { received: orders.filter((row) => String(row.orderDate) >= from && String(row.orderDate) <= to).length,
    released: orders.filter((row) => row.releaseDate !== null && String(row.releaseDate) >= from && String(row.releaseDate) <= to).length,
    stillOpen: orders.filter((row) => String(row.orderDate) <= to && (row.releaseDate === null || String(row.releaseDate) > to)).length };
  return { month, from, to, previousMonth: previous, previousFrom, previousTo,
    income: { ...income, sections: compareSections(income.sections, previousIncome.sections), previous: previousIncome },
    balance: { ...balance, sections: compareSections(balance.sections, previousBalance.sections), previous: previousBalance },
    cashFlow, receivables: { asOf: to, topCustomers, sourceTotalCents: aging.totalCents },
    payroll: { groups: [...payrollByGroup.values()], totals: payroll.totals }, jobs };
}

const statementRows = (sections: StatementSection[]) => sections.flatMap((section) => [
  [section.title, '', ''],
  ...section.groups.flatMap((group) => [
    ...group.lines.map((line) => [line.code ? `${line.code} ${line.name}` : line.name, printMoney(line.amountCents), printMoney(line.compareAmountCents ?? 0)]),
    [`Total ${group.name}`, printMoney(group.totalCents), printMoney(group.compareAmountCents ?? 0)],
  ]),
  [`Total ${section.title.toLowerCase()}`, printMoney(section.totalCents), printMoney(section.compareAmountCents ?? 0)],
]);

export function monthlyOwnersPackBody(data: ReturnType<typeof monthlyOwnersPack>): string {
  const section = (name: string, source: string, contents: string) => `<section class="pack-section"><h2>${name}</h2><p><b>Source report:</b> ${source}</p>${contents}</section>`;
  const income = section('1. Income statement', 'Income statement', printField('Periods', `${data.from} to ${data.to}; previous ${data.previousFrom} to ${data.previousTo}`) +
    printLineTable(['Line', data.month, data.previousMonth], statementRows(data.income.sections)) +
    printLineTable(['Result', data.month, data.previousMonth], [
      ['Gross profit', printMoney(data.income.grossProfitCents), printMoney(data.income.previous.grossProfitCents)],
      ['Income before tax', printMoney(data.income.incomeBeforeTaxCents), printMoney(data.income.previous.incomeBeforeTaxCents)],
      ['Net income', printMoney(data.income.netIncomeCents), printMoney(data.income.previous.netIncomeCents)],
    ]));
  const balance = section('2. Balance sheet', 'Balance sheet', printField('As of', `${data.to}; previous ${data.previousTo}`) +
    printLineTable(['Line', data.to, data.previousTo], statementRows(data.balance.sections)) +
    printLineTable(['Check', data.to, data.previousTo], [['Total assets', printMoney(data.balance.totalAssetsCents), printMoney(data.balance.previous.totalAssetsCents)],
      ['Total liabilities and equity', printMoney(data.balance.totalLiabilitiesAndEquityCents), printMoney(data.balance.previous.totalLiabilitiesAndEquityCents)]]));
  const cash = section('3. Cash flow statement', 'Cash flow statement', printField('Period', `${data.from} to ${data.to}`) +
    printLineTable(['Line', 'Amount'], [['Opening cash', printMoney(data.cashFlow.openingCashCents)],
      ...data.cashFlow.sections.flatMap((part) => [...part.lines.map((line) => [line.name, printMoney(line.amountCents)]), [`Net cash from ${part.title.toLowerCase()}`, printMoney(part.totalCents)]]),
      ['Net change in cash', printMoney(data.cashFlow.netChangeCents)], ['Closing cash', printMoney(data.cashFlow.closingCashCents)]]));
  const receivables = section('4. Ten customers who owe the most', 'AR aging', printField('As of', data.receivables.asOf) +
    printLineTable(['Customer', 'Amount owed', "Oldest invoice's age (days)"], data.receivables.topCustomers.map((row) =>
      [row.customerName, printMoney(row.owedCents), row.oldestInvoiceAgeDays ?? 'No invoice record'])));
  const payroll = section('5. Payroll cost by pay group', 'Payroll register', printField('Month', data.month) +
    printLineTable(['Pay group', 'Gross pay', 'Employer shares', 'Payroll cost'], data.payroll.groups.map((row) =>
      [PAY_GROUPS[row.payGroup] ?? row.payGroup, printMoney(row.grossCents), printMoney(row.employerSharesCents), printMoney(row.costCents)])));
  const jobs = section('6. Job orders', 'Production timing', printField('Month', data.month) +
    printLineTable(['Received', 'Released', 'Still open at month end'], [[data.jobs.received, data.jobs.released, data.jobs.stillOpen]]) +
    '<div style="margin-top:18mm"><b>Noted by:</b><p>______________________________ &nbsp; Owner 1</p><p>______________________________ &nbsp; Owner 2</p><p>______________________________ &nbsp; Owner 3</p></div>');
  return income + balance + cash + receivables + payroll + jobs;
}
