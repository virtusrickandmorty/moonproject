import { useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';
import './books.css';
import { addressValue, PendingPeriod, ResultSummary } from './ReportParts.tsx';

type Result = { from: string; to: string; openingCashCents: number; netChangeCents: number; closingCashCents: number;
  balanceSheetCashCents: number; checkDifferenceCents: number; balanced: boolean;
  sections: { key: string; title: string; lines: { key: string; name: string; amountCents: number }[]; totalCents: number }[] };
const amount = (n: number) => n < 0 ? `(${peso(-n)})` : peso(n);
const Row = ({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) => <tr className={strong ? 'font-semibold' : ''}>
  <td className={td}>{label}</td><td className={`${money} ${strong ? 'border-t-2 border-slate-400' : ''}`}>{amount(cents)}</td></tr>;

export function CashFlow({ me }: { me: Me }) {
  const today = useToday(); const [from, setFrom] = useState(() => addressValue('from')); const [to, setTo] = useState(() => addressValue('to')); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !applied) { if (!from) setFrom(`${today.slice(0, 7)}-01`); if (!to) setTo(today); } }, [today, from]);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `cash-flow?${applied}` : null; const { data, error } = useReport<Result>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="Statement of cash flows" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => setApplied(new URLSearchParams({ from, to }).toString())}>Show</Button>{path && <Tools path={path} />}</div>
    <PendingPeriod applied={applied} values={{ from, to }} />
    {error && <Notice>{error}</Notice>}{!data && !error && <Loading />}
    {data && <Panel title="Direct method — from the posted journals"><ResultSummary count={data.sections.reduce((n, s) => n + s.lines.length, 0)} summary={`Net change ${amount(data.netChangeCents)} · Closing cash ${amount(data.closingCashCents)}.`} /><div className="overflow-x-auto"><table className="w-full max-w-3xl text-sm"><thead><tr><th className={th}>Cash flow</th><th className={`${th} text-right`}>Amount</th></tr></thead><tbody>
      <Row label="Opening cash" cents={data.openingCashCents} strong />
      {data.sections.flatMap((section) => [<tr key={`${section.key}-head`}><td className={`${td} pt-4 font-semibold`} colSpan={2}>{section.title}</td></tr>,
        ...section.lines.map((line) => <Row key={`${section.key}-${line.key}`} label={line.name} cents={line.amountCents} />),
        <Row key={`${section.key}-total`} label={`Net cash from ${section.title.toLowerCase()}`} cents={section.totalCents} strong />])}
      <Row label="Net change in cash" cents={data.netChangeCents} strong /><Row label="Closing cash" cents={data.closingCashCents} strong />
      <Row label="Cash accounts on balance sheet" cents={data.balanceSheetCashCents} /><Row label="Check difference" cents={data.checkDifferenceCents} />
    </tbody></table></div>{!data.balanced && <Notice>Closing cash does not equal the cash accounts on the balance sheet. Tell the accountant.</Notice>}
      {data.balanced && <p className="text-xs text-slate-600">Closing cash equals the cash accounts on the balance sheet at {data.to}.</p>}</Panel>}
  </article>;
}
