/**
 * The Reports overview (the owner's request, Nov 2026): the first stop under Reports. One month read as a manager reads it:
 * how it did against the month before, where the cash and the expenses went, who to collect from, what to pay, what to
 * review before closing it. What is happening today stays on the home. Pointing at a graph shows its details.
 */
import { useEffect, useState } from 'react';
import type { DocTypeInfo, Me } from '../../api.ts';
import { useTip, type Tip } from '../../components/charts.tsx';
import { FigureStrip, PageHead } from '../../components/Figures.tsx';
import { Button, Loading, Notice, inputClass, peso, showDate } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { buildMenu, sectionsOf } from '../../shell/menu.ts';
import { Card, Icon } from '../DASH/Cards.tsx';
import { monthLabel, monthName, shortPeso, signedScale } from '../DASH/MoneyCharts.tsx';
import { useReport, useToday } from './Books.tsx';
import { addressValue } from './ReportParts.tsx';

type Profit = { salesCents: number; costOfSalesCents: number; grossProfitCents: number; operatingCents: number; otherCents: number; incomeBeforeTaxCents: number; incomeTaxCents: number; netIncomeCents: number };
type Ratios = { netIncomeCents: number; netMarginBp: number | null; grossMarginBp: number | null; collectionRateBp: number | null; daysToCollect: number | null };
type Cancelled = { number: string; amountCents: number };
export interface OverviewData {
  month: string; from: string; to: string; running: boolean; previousMonth: string; previousFrom: string; previousTo: string;
  now: Ratios; previous: Ratios; cashMonths: number | null; averagePaidCents: number;
  profit: { month: Profit; previous: Profit; yearToDate: Profit };
  cancelledExpenses: Cancelled[];
  cash: { openingCents: number; netChangeCents: number; closingCents: number; sections: { key: string; title: string; totalCents: number; lines: { key: string; name: string; amountCents: number }[] }[] };
  trend: (Profit & { month: string; from: string; to: string; cancelledExpenses: Cancelled[] })[];
  expenses: { totalCents: number; rows: { code: string; name: string; amountCents: number; previousCents: number }[] };
  collect: { totalCents: number; overdueCents: number; customers: number; rows: { customerName: string; owedCents: number; overdueCents: number; daysOverdue: number }[] };
  bills: { totalCents: number; overdueCents: number; bills: number; rows: { number: string; supplierName: string; dueDate: string; balanceCents: number; late: boolean; documentPath: string }[] };
  customers: { totalCents: number; rows: { customerName: string; salesCents: number; shareBp: number | null }[] };
  review: { key: string; label: string; count: number | null; amountCents: number | null; ok: boolean; href: string }[];
}

const percent = (bp: number | null) => (bp === null ? '—' : `${(bp / 100).toFixed(1)}%`);
const signed = (cents: number) => `${cents > 0 ? '+' : ''}${peso(cents)}`;
const shareOfSales = (cents: number, sales: number) => (sales > 0 ? percent(Math.round((cents * 10_000) / sales)) : '—');
const right = { textAlign: 'right' } as const; // the app's table headings lean left; a figure's heading stands over its figure
const cancelNote = (rows: Cancelled[]) => `${rows.slice(0, 3).map((c) => `${c.number} ${peso(c.amountCents)}`).join(', ')}${rows.length > 3 ? ` and ${rows.length - 3} more` : ''}`;

function monthTip(row: OverviewData['trend'][number]): Tip {
  return {
    title: monthName(row.month),
    rows: [
      { label: 'Sales', value: peso(row.salesCents) }, { label: 'Gross profit', value: peso(row.grossProfitCents) }, { label: 'Operating expenses', value: peso(row.operatingCents) },
      { label: 'Net income', value: peso(row.netIncomeCents), strong: true }, { label: 'Net margin', value: shareOfSales(row.netIncomeCents, row.salesCents) },
    ],
    notes: row.cancelledExpenses.length ? [`Includes ${cancelNote(row.cancelledExpenses)} taken back: recorded in an earlier month, cancelled in this one.`] : [],
  };
}

/** Net income by month: one series, above or below zero. */
export function ProfitBars({ data, month }: { data: OverviewData['trend']; month: string }) {
  const { active, mark, box } = useTip();
  const scale = signedScale(data.map((row) => row.netIncomeCents), 176, 136);
  const zero = scale.y(0);
  return <div>{box}<svg viewBox="0 0 720 210" role="group" aria-label="Net income by month" className="h-auto w-full min-w-[540px] print:min-w-0">
    <line x1="42" y1={zero} x2="710" y2={zero} stroke="#cbd5e1" />
    {data.map((row, index) => {
      const x = 48 + index * 55;
      const y = scale.y(row.netIncomeCents);
      const chosen = row.month === month;
      return <g key={row.month}>
        <rect x={x} y="32" width="42" height="146" rx="10" fill={chosen ? '#eef1fb' : '#f8fafc'} stroke={active === row.month ? '#8c9ee2' : 'none'} strokeWidth="2" />
        <rect x={x + 9} y={Math.min(zero, y)} width="24" height={Math.abs(y - zero)} rx="4" fill={row.netIncomeCents < 0 ? '#dc2626' : '#1f3bb3'} />
        <text x={x + 21} y="196" textAnchor="middle" fontSize="11" fill={chosen ? '#0f172a' : '#64748b'} fontWeight={chosen ? 600 : 400}>{monthLabel(row.month)}</text>
        <rect {...mark(row.month, monthTip(row))} x={x - 6} y="24" width="55" height="180" fill="transparent" className="outline-none" />
      </g>;
    })}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="180" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
  </svg></div>;
}

/** The largest expense accounts, each as a share of the month's expenses. */
export function ExpenseBars({ data, previous }: { data: OverviewData['expenses']; previous: string }) {
  const { active, mark, box } = useTip();
  const top = data.rows[0]?.amountCents ?? 0;
  if (data.rows.length === 0) return <p className="text-sm text-slate-500">No expenses recorded in this month.</p>;
  return <ul className="space-y-2.5 text-sm">{box}{data.rows.map((row) => <li key={row.code} {...mark(row.code, {
    title: row.name, rows: [
      { label: 'This month', value: peso(row.amountCents), strong: true }, { label: previous, value: peso(row.previousCents) },
      { label: 'Change', value: signed(row.amountCents - row.previousCents) }, { label: 'Of the month\'s expenses', value: shareOfSales(row.amountCents, data.totalCents) },
    ],
  })} className={`rounded-md outline-none ${active === row.code ? 'ring-2 ring-indigo-300' : ''}`}>
    <span className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-slate-700">{row.name}</span><span className="shrink-0 tabular-nums">{peso(row.amountCents)}</span></span>
    <span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-[#1f3bb3]" style={{ width: `${top ? Math.max(1, (row.amountCents / top) * 100) : 0}%` }} /></span>
  </li>)}</ul>;
}

function ProfitTable({ data, compared }: { data: OverviewData; compared: string }) {
  const { month: m, previous: p, yearToDate: y } = data.profit;
  const rows: { label: string; key: keyof Profit; total?: boolean }[] = [
    { label: 'Sales', key: 'salesCents' }, { label: 'Cost of sales', key: 'costOfSalesCents' }, { label: 'Gross profit', key: 'grossProfitCents', total: true },
    { label: 'Operating expenses', key: 'operatingCents' }, { label: 'Other income and expenses', key: 'otherCents' },
    { label: 'Income before tax', key: 'incomeBeforeTaxCents', total: true }, { label: 'Income tax', key: 'incomeTaxCents' }, { label: 'Net income', key: 'netIncomeCents', total: true },
  ];
  const shown = rows.filter((r) => r.total || r.key === 'salesCents' || m[r.key] || p[r.key] || y[r.key]);
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] whitespace-nowrap text-sm">
    <thead><tr className="text-xs text-slate-500"><th className="pb-2 text-left font-normal">Line</th>
      {[data.running ? 'So far' : 'This month', '% of sales', compared, 'Change', 'Year to date'].map((h) => <th key={h} style={right} className="pb-2 font-normal">{h}</th>)}</tr></thead>
    <tbody>{shown.map((r) => <tr key={r.key} className={`border-t border-slate-100 text-right tabular-nums ${r.total ? 'font-semibold text-slate-900' : ''}`}>
      <td className="py-2 text-left">{r.label}</td><td>{peso(m[r.key])}</td><td className="text-slate-500">{shareOfSales(m[r.key], m.salesCents)}</td>
      <td>{peso(p[r.key])}</td><td>{signed(m[r.key] - p[r.key])}</td><td>{peso(y[r.key])}</td>
    </tr>)}</tbody>
  </table></div>;
}

function CashMovement({ cash }: { cash: OverviewData['cash'] }) {
  const line = (label: string, cents: number, look = '') => <div key={label} className={`flex items-baseline justify-between gap-3 border-t border-slate-100 py-1.5 first:border-0 ${look}`}><span className="min-w-0">{label}</span><span className="shrink-0 tabular-nums">{peso(cents)}</span></div>;
  return <div className="text-sm">
    {line('Opening cash', cash.openingCents, 'font-semibold text-slate-900')}
    {cash.sections.filter((s) => s.lines.length > 0).flatMap((s) => [...s.lines.map((l) => line(l.name, l.amountCents, 'pl-3 text-slate-600')), line(s.title, s.totalCents, 'font-medium')])}
    {line('Closing cash', cash.closingCents, 'font-semibold text-slate-900')}
  </div>;
}

function Review({ items }: { items: OverviewData['review'] }) {
  return <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{items.map((i) => <li key={i.key}>
    <Link to={i.href} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm ring-1 ring-slate-100 hover:bg-slate-50">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full ${i.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}><Icon name={i.ok ? 'check' : 'alert'} className="size-4" /></span>
      <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{i.label}</span>
        <span className="block text-xs text-slate-500">{i.ok ? 'All clear' : [i.count !== null ? `${i.count} to review` : i.amountCents === null ? 'Does not tie' : '', i.amountCents !== null ? peso(i.amountCents) : ''].filter(Boolean).join(' · ')}</span></span>
    </Link>
  </li>)}</ul>;
}

export function OverviewFigures({ data, me, docTypes }: { data: OverviewData; me: Me; docTypes: DocTypeInfo[] }) {
  const compared = data.running ? 'Same days last month' : monthName(data.previousMonth);
  const was = (value: string) => `${data.running ? 'Same days last month' : 'Last month'} ${value}`;
  const reports = buildMenu(docTypes, new Set(me.permissions)).find((g) => g.group === 'Reports')?.items.filter((i) => i.path !== '/rpt/overview') ?? [];
  const asOf = `asOf=${data.to}`;
  return <div className="space-y-4">
    <FigureStrip label="The month at a glance" figures={[
      { label: 'Net income', value: peso(data.now.netIncomeCents), icon: 'trend', warn: data.now.netIncomeCents < 0, note: `${percent(data.now.netMarginBp)} of sales · ${was(peso(data.previous.netIncomeCents))}` },
      { label: 'Gross margin', value: percent(data.now.grossMarginBp), icon: 'chart', note: was(percent(data.previous.grossMarginBp)) },
      { label: 'Collected of sales', value: percent(data.now.collectionRateBp), icon: 'money', note: was(percent(data.previous.collectionRateBp)) },
      { label: 'Days to collect', value: data.now.daysToCollect === null ? '—' : `${data.now.daysToCollect} days`, icon: 'clock', note: was(data.previous.daysToCollect === null ? '—' : `${data.previous.daysToCollect} days`) },
      { label: 'Months of cash', value: data.cashMonths === null ? '—' : data.cashMonths.toFixed(1), icon: 'cash', warn: data.cashMonths !== null && data.cashMonths < 1, note: data.averagePaidCents ? `${peso(data.averagePaidCents)} paid out a month` : 'No payments yet' },
    ]} />
    <p className="text-xs text-slate-500">Days to collect: what customers owe over sales per day. Months of cash: closing cash over what operations paid out in an average month.
      {data.cancelledExpenses.length > 0 && <> This month's expenses take off {cancelNote(data.cancelledExpenses)}, recorded in an earlier month and cancelled in this one.</>}</p>
    <Card icon="chart" title="Profit and loss" href={`/rpt/income-statement?from=${data.from}&to=${data.to}`}><ProfitTable data={data} compared={compared} /></Card>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card grow icon="trend" title="Net income by month"><div className="overflow-x-auto"><ProfitBars data={data.trend} month={data.month} /></div></Card>
      <Card grow icon="cash" title="Cash movement" href={`/rpt/cash-flow?from=${data.from}&to=${data.to}`}><CashMovement cash={data.cash} /></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card grow icon="money" title="Collect first" note={`${peso(data.collect.overdueCents)} overdue`} href={`/rpt/ar-aging?${asOf}`}>
        {data.collect.rows.length === 0 ? <p className="text-sm text-slate-500">No customer owes anything.</p> : <ul className="divide-y divide-slate-100 text-sm">{data.collect.rows.map((c) => <li key={c.customerName} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0"><span className="block truncate font-medium">{c.customerName}</span><span className={`text-xs ${c.overdueCents > 0 ? 'font-medium text-red-700' : 'text-slate-500'}`}>{c.overdueCents > 0 ? `${peso(c.overdueCents)} overdue, ${c.daysOverdue} days` : 'Not yet due'}</span></span>
          <span className="shrink-0 tabular-nums">{peso(c.owedCents)}</span></li>)}</ul>}
        <p className="mt-auto text-xs text-slate-500">{data.collect.customers} {data.collect.customers === 1 ? 'customer owes' : 'customers owe'} {peso(data.collect.totalCents)} in all.</p>
      </Card>
      <Card grow icon="draft" title="Bills to pay" note={`${peso(data.bills.overdueCents)} overdue`} href={`/rpt/ap-aging?${asOf}`}>
        {data.bills.rows.length === 0 ? <p className="text-sm text-slate-500">No supplier bill is unpaid.</p> : <ul className="divide-y divide-slate-100 text-sm">{data.bills.rows.map((b) => <li key={b.number} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0"><Link to={b.documentPath} className="block truncate font-medium text-indigo-700 hover:underline">{b.supplierName}</Link><span className={`text-xs ${b.late ? 'font-medium text-red-700' : 'text-slate-500'}`}>{b.number} · {b.late ? 'was due' : 'due'} {showDate(b.dueDate)}</span></span>
          <span className="shrink-0 tabular-nums">{peso(b.balanceCents)}</span></li>)}</ul>}
        <p className="mt-auto text-xs text-slate-500">{data.bills.bills} unpaid {data.bills.bills === 1 ? 'bill' : 'bills'}, {peso(data.bills.totalCents)} in all.</p>
      </Card>
      <Card grow icon="sales" title="Top customers by sales" href={`/rpt/sales-by-period?from=${data.from}&to=${data.to}`}>
        {data.customers.rows.length === 0 ? <p className="text-sm text-slate-500">No sales recorded in this month.</p> : <ul className="divide-y divide-slate-100 text-sm">{data.customers.rows.map((c) => <li key={c.customerName} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0"><span className="block truncate font-medium">{c.customerName}</span><span className="text-xs text-slate-500">{percent(c.shareBp)} of sales</span></span>
          <span className="shrink-0 tabular-nums">{peso(c.salesCents)}</span></li>)}</ul>}
      </Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card grow icon="wallet" title="Where the money went" href="/rpt/overhead"><ExpenseBars data={data.expenses} previous={compared} /></Card>
      <Card grow icon="check" title="Before closing the month"><Review items={data.review} /></Card>
    </div>
    <details className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 print:hidden">
      <summary className="cursor-pointer font-bold text-slate-900">All reports ({reports.length})</summary>
      <div className="mt-4 grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">{sectionsOf('Reports', reports).map((s) => <section key={s.sub} aria-label={s.sub}>
        <h3 className="mb-1.5 text-sm font-semibold">{s.sub}</h3>
        <ul className="space-y-1 text-sm">{s.items.map((i) => <li key={i.path}><Link to={i.path} className="text-indigo-700 hover:underline">{i.label}</Link></li>)}</ul>
      </section>)}</div>
    </details>
  </div>;
}

/** The month before today's: the last one that is whole, which is the month a person reviews. */
export const lastWholeMonth = (today: string) => {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const back = year * 12 + month - 2;
  return `${Math.floor(back / 12)}-${String((back % 12) + 1).padStart(2, '0')}`;
};

export function ReportsOverview({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const today = useToday();
  const [month, setMonth] = useState(() => addressValue('month'));
  useEffect(() => { if (today && !month) setMonth(lastWholeMonth(today)); }, [today, month]);
  const allowed = me.permissions.includes('rpt.books.view');
  const { data, error } = useReport<OverviewData>(allowed && month ? `overview?month=${month}` : null);
  if (!allowed) return <Notice>Access denied.</Notice>;
  const choose = (value: string) => { if (!value) return; setMonth(value); navigate(`/rpt/overview?month=${value}`, { replace: true }); };
  return <article className="rpt-page space-y-4">
    <PageHead title="Reports overview" sub={month ? `Management summary for ${monthName(month)}${data?.running ? ` to ${showDate(data.to)}` : ''}.` : undefined} actions={<>
      <label className="flex items-center gap-2 text-sm text-slate-600">Month<input type="month" aria-label="Month" max={today.slice(0, 7)} className={`${inputClass} w-44`} value={month} onChange={(e) => choose(e.target.value)} /></label>
      <Button onClick={() => window.print()}>Print this page</Button></>} />
    {error && <Notice>{error}</Notice>}
    {!data && !error && <Loading label="Loading the month…" />}
    {data && <OverviewFigures data={data} me={me} docTypes={docTypes} />}
  </article>;
}
