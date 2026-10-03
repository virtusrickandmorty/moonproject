import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';
import './books.css';
import { addressValue, PendingPeriod, ResultSummary } from './ReportParts.tsx';

type Compared = { compareAmountCents?: number; differenceCents?: number; percentChange?: number | null };
type Line = Compared & { accountId: number | null; code: string | null; name: string; amountCents: number; computed: boolean };
type Group = Compared & { code: string | null; name: string | null; lines: Line[]; totalCents: number };
type Section = Compared & { key: string; title: string; side: 'debit' | 'credit'; groups: Group[]; totalCents: number };
type ComparedTotal = { amountCents: number; compareAmountCents: number; differenceCents: number; percentChange: number | null };
type IncomeStatementResult = { from: string; to: string; sections: Section[]; grossProfitCents: number; incomeBeforeTaxCents: number; netIncomeCents: number;
  comparison?: { kind: string; from: string; to: string }; grossProfit?: ComparedTotal; incomeBeforeTax?: ComparedTotal; netIncome?: ComparedTotal };
type BalanceSheetResult = { asOf: string; yearStart: string; sections: Section[]; currentYearEarningsCents: number; earlierYearsEarningsCents: number;
  receivables: { tradeCents: number; allowanceCents: number; netCents: number };
  totalAssetsCents: number; totalLiabilitiesCents: number; totalEquityCents: number; totalLiabilitiesAndEquityCents: number; differenceCents: number; balanced: boolean;
  comparison?: { kind: string; asOf: string }; totalLiabilitiesAndEquity?: ComparedTotal; comparisonBalanced?: boolean };
type EquityColumn = { key: string; code: string | null; name: string; startCents: number; endCents: number };
type EquityRow = { key: string; label: string; amountsCents: Record<string, number>; totalCents: number };
type EquityResult = { from: string; to: string; openingAsOf: string; columns: EquityColumn[]; rows: EquityRow[];
  openingTotalCents: number; endingTotalCents: number; balanceSheetTotalEquityCents: number };

/** Statement style: a negative amount (a contra account, a loss) in brackets. */
const amount = (cents: number) => (cents < 0 ? `(${peso(-cents)})` : peso(cents));
const pad = (n: number) => String(n).padStart(2, '0');
/** The income statement's quick ranges (PLAN G: month, quarter, year to date), each ending today. */
function presets(today: string): [string, string][] {
  const [year, month] = [today.slice(0, 4), Number(today.slice(5, 7))];
  return [['This month', `${today.slice(0, 7)}-01`], ['This quarter', `${year}-${pad(month - ((month - 1) % 3))}-01`], ['Year to date', `${year}-01-01`]];
}

const percent = (value?: number | null) => value === null ? '' : value === undefined ? '' : `${value.toFixed(2)}%`;
function Amounts({ cents, compared }: { cents: number; compared?: Compared }) {
  return <><td className={money}>{amount(cents)}</td>{compared?.compareAmountCents !== undefined && <><td className={money}>{amount(compared.compareAmountCents)}</td>
    <td className={money}>{amount(compared.differenceCents ?? 0)}</td><td className={money}>{percent(compared.percentChange)}</td></>}</>;
}
function Total({ label, cents, strong = false, compared }: { label: string; cents: number; strong?: boolean; compared?: Compared }) {
  return <tr className={strong ? 'font-semibold' : 'font-medium'}><td className={td}>{label}</td><Amounts cents={cents} compared={compared} /></tr>;
}
function SectionRows({ section }: { section: Section }) {
  return <tbody>
    <tr><td className={`${td} pt-4 font-semibold`} colSpan={section.compareAmountCents === undefined ? 2 : 5}>{section.title}</td></tr>
    {section.groups.length === 0 && <tr><td className={`${td} pl-6 text-slate-500`} colSpan={section.compareAmountCents === undefined ? 2 : 5}>None</td></tr>}
    {section.groups.map((g) => <GroupRows key={g.code ?? ''} group={g} />)}
    <Total label={`Total ${section.title.toLowerCase()}`} cents={section.totalCents} compared={section} />
  </tbody>;
}
function GroupRows({ group }: { group: Group }) {
  const indent = group.code ? 'pl-10' : 'pl-6';
  return <>
    {group.code && <tr><td className={`${td} pl-6`} colSpan={group.compareAmountCents === undefined ? 2 : 5}>{group.code} {group.name}</td></tr>}
    {group.lines.map((l) => <tr key={l.accountId ?? l.name} className={l.computed ? 'italic' : ''}>
      <td className={`${td} ${indent}`}>{l.code ? `${l.code} ` : ''}{l.name}</td><Amounts cents={l.amountCents} compared={l} /></tr>)}
    {group.code && <tr className="text-slate-700"><td className={`${td} pl-6`}>Total {group.name}</td><Amounts cents={group.totalCents} compared={group} /></tr>}
  </>;
}
function Statement({ children, headings }: { children: ReactNode; headings?: [string, string] }) {
  return <div className="overflow-x-auto"><table className={`w-full text-sm ${headings ? '' : 'max-w-3xl'}`}><thead><tr><th className={th}>Account</th><th className={`${th} text-right`}>{headings?.[0] ?? 'Amount'}</th>
    {headings && <><th className={`${th} text-right`}>{headings[1]}</th><th className={`${th} text-right`}>Difference</th><th className={`${th} text-right`}>Difference %</th></>}</tr></thead>{children}</table></div>;
}

type Compare = 'none' | 'previous_month' | 'last_year';
const CompareField = ({ value, onChange }: { value: Compare; onChange: (value: Compare) => void }) => <Field label="Compare with"><select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Compare)}>
  <option value="none">None</option><option value="previous_month">Previous month</option><option value="last_year">Same period last year</option></select></Field>;

export function IncomeStatement({ me }: { me: Me }) {
  const today = useToday();
  const [from, setFrom] = useState(() => addressValue('from')); const [to, setTo] = useState(() => addressValue('to'));
  const [compare, setCompare] = useState<Compare>('none'); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !applied) { if (!from) setFrom(`${today.slice(0, 4)}-01-01`); if (!to) setTo(today); } }, [today, from, to]);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `income-statement?${applied}` : null;
  const { data, error } = useReport<IncomeStatementResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const show = (f: string, t: string) => { setFrom(f); setTo(t); setApplied(new URLSearchParams({ from: f, to: t, ...(compare === 'none' ? {} : { compare }) }).toString()); };
  const [revenue, costOfSales, operatingExpenses, other, incomeTax] = data?.sections ?? [];
  return <article className="rpt-page space-y-4"><BookTitle title="Income statement" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <CompareField value={compare} onChange={setCompare} />
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => show(from, to)}>Show</Button>
      {today && presets(today).map(([label, start]) => <Button key={label} onClick={() => show(start, today)}>{label}</Button>)}
      {path && <Tools path={path} />}</div>
    <PendingPeriod applied={applied} values={{ from, to, compare: compare === 'none' ? '' : compare }} />
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && revenue && costOfSales && operatingExpenses && other && incomeTax && <Panel title="From the posted journals"><ResultSummary count={data.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.lines.length, 0), 0)} summary={`Net income ${amount(data.netIncomeCents)}.`} /><Statement headings={data.comparison ? [`${data.from} to ${data.to}`, `${data.comparison.from} to ${data.comparison.to}`] : undefined}>
      <SectionRows section={revenue} /><SectionRows section={costOfSales} />
      <tbody><Total label="Gross profit" cents={data.grossProfitCents} compared={data.grossProfit} strong /></tbody>
      <SectionRows section={operatingExpenses} /><SectionRows section={other} />
      <tbody><Total label="Income before tax" cents={data.incomeBeforeTaxCents} compared={data.incomeBeforeTax} strong /></tbody>
      <SectionRows section={incomeTax} />
      <tbody><Total label={data.netIncomeCents < 0 ? 'Net loss' : 'Net income'} cents={data.netIncomeCents} compared={data.netIncome} strong /></tbody>
    </Statement></Panel>}
  </article>;
}

export function BalanceSheet({ me }: { me: Me }) {
  const today = useToday(); const [asOf, setAsOf] = useState(() => addressValue('asOf')); const [compare, setCompare] = useState<Compare>('none'); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !applied && !asOf) setAsOf(today); }, [today, asOf]);
  useEffect(() => { if (asOf && !applied) setApplied(new URLSearchParams({ asOf }).toString()); }, [asOf, applied]);
  const path = applied ? `balance-sheet?${applied}` : null;
  const { data, error } = useReport<BalanceSheetResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const [assets, liabilities, equity] = data?.sections ?? [];
  return <article className="rpt-page space-y-4"><BookTitle title="Balance sheet" dates={data ? `As of ${data.asOf}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="As of"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      <CompareField value={compare} onChange={setCompare} />
      <Button tone="primary" disabled={!asOf} onClick={() => setApplied(new URLSearchParams({ asOf, ...(compare === 'none' ? {} : { compare }) }).toString())}>Show</Button>
      {path && <Tools path={path} />}</div>
    <PendingPeriod applied={applied} values={{ asOf, compare: compare === 'none' ? '' : compare }} />
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && !data.balanced && <Notice>Total assets differ from total liabilities and equity by {amount(data.differenceCents)}. Run the integrity check and tell the accountant.</Notice>}
    {data && assets && liabilities && equity && <Panel title="From the posted journals"><ResultSummary count={data.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.lines.length, 0), 0)} summary={`Assets ${amount(data.totalAssetsCents)} · Equity ${amount(data.totalEquityCents)}.`} /><Statement headings={data.comparison ? [data.asOf, data.comparison.asOf] : undefined}>
      <SectionRows section={assets} />
      <SectionRows section={liabilities} /><SectionRows section={equity} />
      <tbody><Total label="Total liabilities and equity" cents={data.totalLiabilitiesAndEquityCents} compared={data.totalLiabilitiesAndEquity} strong /></tbody>
    </Statement>
    <p className="text-xs text-slate-600">Current-year earnings are the net income from {data.yearStart} to {data.asOf}; earlier years’ earnings are every income and expense before {data.yearStart}. Both are computed, never posted.
      {data.balanced && ' Total assets equal total liabilities and equity.'}
      {data.receivables.allowanceCents !== 0 && ` Trade receivables of ${peso(data.receivables.tradeCents)} less the allowance for credit losses of ${peso(data.receivables.allowanceCents)}: ${peso(data.receivables.netCents)} expected to be collected.`}</p></Panel>}
  </article>;
}

export function ChangesInEquity({ me }: { me: Me }) {
  const today = useToday(); const [from, setFrom] = useState(() => addressValue('from')); const [to, setTo] = useState(() => addressValue('to')); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !applied) { if (!from) setFrom(`${today.slice(0, 4)}-01-01`); if (!to) setTo(today); } }, [today, from, to]);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `changes-in-equity?${applied}` : null; const { data, error } = useReport<EquityResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const show = (f: string, t: string) => { setFrom(f); setTo(t); setApplied(new URLSearchParams({ from: f, to: t }).toString()); };
  const cells = (values: Record<string, number>) => <>{data?.columns.map((column) => <td key={column.key} className={money}>{amount(values[column.key] ?? 0)}</td>)}</>;
  return <article className="rpt-page space-y-4"><BookTitle title="Statement of changes in equity" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => show(from, to)}>Show</Button>
      {today && presets(today).map(([label, start]) => <Button key={label} onClick={() => show(start, today)}>{label}</Button>)}
      {path && <Tools path={path} />}</div>
    <PendingPeriod applied={applied} values={{ from, to }} />
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && <Panel title="From the posted journals"><ResultSummary count={data.rows.length} summary={`Closing equity ${amount(data.endingTotalCents)}.`} /><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={th}>Movement</th>
      {data.columns.map((column) => <th key={column.key} className={`${th} min-w-36 text-right`}>{column.code && `${column.code} `}{column.name}</th>)}
      <th className={`${th} min-w-32 text-right`}>Total equity</th></tr></thead><tbody>
      <tr className="font-semibold"><td className={td}>Balance at {data.openingAsOf}</td>{cells(Object.fromEntries(data.columns.map((c) => [c.key, c.startCents])))}<td className={money}>{amount(data.openingTotalCents)}</td></tr>
      {data.rows.map((row) => <tr key={row.key}><td className={td}>{row.label}</td>{cells(row.amountsCents)}<td className={money}>{amount(row.totalCents)}</td></tr>)}
      <tr className="font-semibold"><td className={td}>Balance at {data.to}</td>{cells(Object.fromEntries(data.columns.map((c) => [c.key, c.endCents])))}<td className={money}>{amount(data.endingTotalCents)}</td></tr>
    </tbody></table></div><p className="text-xs text-slate-600">The ending balance agrees with total equity on the balance sheet at {data.to}.</p></Panel>}
  </article>;
}
