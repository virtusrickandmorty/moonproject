import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';
import './books.css';

type Line = { accountId: number | null; code: string | null; name: string; amountCents: number; computed: boolean };
type Group = { code: string | null; name: string | null; lines: Line[]; totalCents: number };
type Section = { key: string; title: string; side: 'debit' | 'credit'; groups: Group[]; totalCents: number };
type IncomeStatementResult = { from: string; to: string; sections: Section[]; grossProfitCents: number; incomeBeforeTaxCents: number; netIncomeCents: number };
type BalanceSheetResult = { asOf: string; yearStart: string; sections: Section[]; currentYearEarningsCents: number; earlierYearsEarningsCents: number;
  totalAssetsCents: number; totalLiabilitiesCents: number; totalEquityCents: number; totalLiabilitiesAndEquityCents: number; differenceCents: number; balanced: boolean };

/** Statement style: a negative amount (a contra account, a loss) in brackets. */
const amount = (cents: number) => (cents < 0 ? `(${peso(-cents)})` : peso(cents));
const pad = (n: number) => String(n).padStart(2, '0');
/** The income statement's quick ranges (PLAN G: month, quarter, year to date), each ending today. */
function presets(today: string): [string, string][] {
  const [year, month] = [today.slice(0, 4), Number(today.slice(5, 7))];
  return [['This month', `${today.slice(0, 7)}-01`], ['This quarter', `${year}-${pad(month - ((month - 1) % 3))}-01`], ['Year to date', `${year}-01-01`]];
}

function Total({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return <tr className={strong ? 'font-semibold' : 'font-medium'}><td className={td}>{label}</td><td className={`${money} ${strong ? 'border-t-2 border-slate-400' : ''}`}>{amount(cents)}</td></tr>;
}
function SectionRows({ section }: { section: Section }) {
  return <tbody>
    <tr><td className={`${td} pt-4 font-semibold`} colSpan={2}>{section.title}</td></tr>
    {section.groups.length === 0 && <tr><td className={`${td} pl-6 text-slate-500`} colSpan={2}>None</td></tr>}
    {section.groups.map((g) => <GroupRows key={g.code ?? ''} group={g} />)}
    <Total label={`Total ${section.title.toLowerCase()}`} cents={section.totalCents} />
  </tbody>;
}
function GroupRows({ group }: { group: Group }) {
  const indent = group.code ? 'pl-10' : 'pl-6';
  return <>
    {group.code && <tr><td className={`${td} pl-6`} colSpan={2}>{group.code} {group.name}</td></tr>}
    {group.lines.map((l) => <tr key={l.accountId ?? l.name} className={l.computed ? 'italic' : ''}>
      <td className={`${td} ${indent}`}>{l.code ? `${l.code} ` : ''}{l.name}</td><td className={money}>{amount(l.amountCents)}</td></tr>)}
    {group.code && <tr className="text-slate-700"><td className={`${td} pl-6`}>Total {group.name}</td><td className={money}>{amount(group.totalCents)}</td></tr>}
  </>;
}
function Statement({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full max-w-3xl text-sm"><thead><tr><th className={th}>Account</th><th className={`${th} text-right`}>Amount</th></tr></thead>{children}</table></div>;
}

export function IncomeStatement({ me }: { me: Me }) {
  const today = useToday();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !from && !to) { setFrom(`${today.slice(0, 4)}-01-01`); setTo(today); } }, [today, from, to]);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `income-statement?${applied}` : null;
  const { data, error } = useReport<IncomeStatementResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const show = (f: string, t: string) => { setFrom(f); setTo(t); setApplied(new URLSearchParams({ from: f, to: t }).toString()); };
  const [revenue, costOfSales, operatingExpenses, other, incomeTax] = data?.sections ?? [];
  return <article className="rpt-page space-y-4"><BookTitle title="Income statement" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => show(from, to)}>Show</Button>
      {today && presets(today).map(([label, start]) => <Button key={label} onClick={() => show(start, today)}>{label}</Button>)}
      {path && <Tools path={path} />}</div>
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && revenue && costOfSales && operatingExpenses && other && incomeTax && <Panel title="From the posted journals"><Statement>
      <SectionRows section={revenue} /><SectionRows section={costOfSales} />
      <tbody><Total label="Gross profit" cents={data.grossProfitCents} strong /></tbody>
      <SectionRows section={operatingExpenses} /><SectionRows section={other} />
      <tbody><Total label="Income before tax" cents={data.incomeBeforeTaxCents} strong /></tbody>
      <SectionRows section={incomeTax} />
      <tbody><Total label={data.netIncomeCents < 0 ? 'Net loss' : 'Net income'} cents={data.netIncomeCents} strong /></tbody>
    </Statement></Panel>}
  </article>;
}

export function BalanceSheet({ me }: { me: Me }) {
  const today = useToday(); const [asOf, setAsOf] = useState(''); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !asOf) setAsOf(today); }, [today, asOf]);
  useEffect(() => { if (asOf && !applied) setApplied(new URLSearchParams({ asOf }).toString()); }, [asOf, applied]);
  const path = applied ? `balance-sheet?${applied}` : null;
  const { data, error } = useReport<BalanceSheetResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const [assets, liabilities, equity] = data?.sections ?? [];
  return <article className="rpt-page space-y-4"><BookTitle title="Balance sheet" dates={data ? `As of ${data.asOf}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="As of"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      <Button tone="primary" disabled={!asOf} onClick={() => setApplied(new URLSearchParams({ asOf }).toString())}>Show</Button>
      {path && <Tools path={path} />}</div>
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && !data.balanced && <Notice>Total assets differ from total liabilities and equity by {amount(data.differenceCents)}. Run the integrity check and tell the accountant.</Notice>}
    {data && assets && liabilities && equity && <Panel title="From the posted journals"><Statement>
      <SectionRows section={assets} />
      <SectionRows section={liabilities} /><SectionRows section={equity} />
      <tbody><Total label="Total liabilities and equity" cents={data.totalLiabilitiesAndEquityCents} strong /></tbody>
    </Statement>
    <p className="text-xs text-slate-600">Current-year earnings are the net income from {data.yearStart} to {data.asOf}; earlier years’ earnings are every income and expense before {data.yearStart}. Both are computed, never posted.
      {data.balanced && ' Total assets equal total liabilities and equity.'}</p></Panel>}
  </article>;
}
