import { useEffect, useState } from 'react';
import { api, type Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Field, Notice, PAGE_ROWS, Pager, Panel, inputClass, peso, type PageInfo } from '../../components/ui.tsx';
import './books.css';

type Account = { id: number; code: string; name: string; normalSide: 'debit' | 'credit' };
type Line = { journalId: string; journalNumber: string; businessDate: string; sourceType: string; sourceId: string;
  documentType: string | null; documentNumber: string | null; postingKind: string; journalMemo: string;
  lineNo: number; accountId: number; accountCode: string; accountName: string;
  partyType: string | null; partyId: string | null; debitCents: number; creditCents: number; memo: string | null };
type Journal = Pick<Line, 'journalId' | 'journalNumber' | 'businessDate' | 'sourceType' | 'sourceId' | 'documentType' | 'documentNumber' | 'postingKind' | 'journalMemo'> & { lines: Line[]; runningDebitCents: number; runningCreditCents: number };
type JournalResult = { from: string; to: string; journals: Journal[]; totalDebitCents: number; totalCreditCents: number; page?: PageInfo };
type LedgerResult = { from: string; to: string; page?: PageInfo; accounts: (Account & { openingBalanceCents: number;
  lines: (Line & { runningBalanceCents: number })[]; closingBalanceCents: number })[] };
type TbResult = { asOf: string; compareTo: string | null; rows: { accountId: number; code: string; name: string;
  debitCents: number; creditCents: number; compareDebitCents: number; compareCreditCents: number }[];
  totalDebitCents: number; totalCreditCents: number; compareTotalDebitCents: number | null; compareTotalCreditCents: number | null };

export function useToday() {
  const [today, setToday] = useState('');
  useEffect(() => { void api.health().then((r) => setToday(r.serverTime.slice(0, 10))); }, []);
  return today;
}
export function useReport<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!path) return;
    let active = true;
    setData(null); setError('');
    void api.report<T>(path).then((r) => { if (active) setData(r); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path]);
  return { data, error };
}
/**
 * useReport for a long report, a page at a time: asks for `limit` and `offset` beside the report's own dates, starts again at the
 * first page when the report changes, and gives the `pager` to put under the list. The CSV and print links keep the whole report.
 */
export function usePagedReport<T extends { page?: PageInfo }>(path: string | null, size = PAGE_ROWS) {
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  useEffect(() => setOffsets({}), [path]);
  const paged = path ? `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams({ limit: String(size), offset: String(offsets.offset ?? 0),
    ...Object.fromEntries(Object.entries(offsets).filter(([k]) => k !== 'offset').map(([k, v]) => [k, String(v)])) })}` : null;
  const report = useReport<T>(paged);
  const pagerFor = (key: string, page: PageInfo | undefined, what = 'rows') => <Pager page={page} what={what} onOffset={(o) => setOffsets({ ...offsets, [key]: o })} />;
  return { ...report, pager: pagerFor('offset', report.data?.page), pagerFor };
}
function source(line: Pick<Line, 'documentType' | 'documentNumber' | 'sourceId' | 'journalNumber'>) {
  return line.documentType && line.documentNumber
    ? <Link className="text-indigo-700 underline print:text-black print:no-underline" to={`/docs/${encodeURIComponent(line.documentType)}/${encodeURIComponent(line.sourceId)}`}>{line.documentNumber}</Link>
    : line.journalNumber;
}
function party(line: Pick<Line, 'partyType' | 'partyId'>) { return line.partyType ? `${line.partyType}: ${line.partyId}` : ''; }
function balance(cents: number) { return cents === 0 ? peso(0) : `${peso(Math.abs(cents))} ${cents < 0 ? 'Cr' : 'Dr'}`; }
export function Tools({ path }: { path: string }) {
  return <div className="flex gap-2 print:hidden"><a className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" href={`/api/rpt/${path}${path.includes('?') ? '&' : '?'}format=csv`}>Export CSV</a>
    <Button onClick={() => window.print()}>Print</Button></div>;
}
export function BookTitle({ title, dates }: { title: string; dates: string }) {
  return <div className="rpt-heading"><h1 className="text-2xl font-semibold">{title}</h1><p>{dates}</p></div>;
}
export const th = 'border-b border-slate-300 px-2 py-2 text-left';
export const td = 'border-b border-slate-100 px-2 py-2 align-top';
export const money = `${td} whitespace-nowrap text-right tabular-nums`;

export function GeneralJournal({ me }: { me: Me }) {
  const today = useToday();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !from && !to) { setFrom(today.slice(0, 7) + '-01'); setTo(today); } }, [today, from, to]);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `journal?${applied}` : null;
  const { data, error, pager } = usePagedReport<JournalResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="General journal" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => setApplied(new URLSearchParams({ from, to }).toString())}>Show</Button>
      {path && <Tools path={path} />}</div>
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && <Panel title={`${(data.page?.total ?? data.journals.length).toLocaleString('en-PH')} journal entries`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Date / journal', 'Source document', 'Account / party', 'Memo', 'Debit', 'Credit'].map((x) => <th key={x} className={th}>{x}</th>)}</tr></thead>
      {data.journals.map((j) => <tbody key={j.journalId}>{j.lines.map((l, i) => <tr key={`${j.journalId}-${l.lineNo}`}>
        <td className={td}>{i === 0 && <>{j.businessDate}<br />{j.journalNumber}{j.postingKind === 'reversal' && ' (reversal)'}</>}</td>
        <td className={td}>{i === 0 && source({ ...j, journalNumber: j.journalNumber })}</td>
        <td className={td}>{l.accountCode} {l.accountName}{party(l) && <small className="block text-slate-500">{party(l)}</small>}</td>
        <td className={td}>{l.memo ?? j.journalMemo}</td><td className={money}>{l.debitCents ? peso(l.debitCents) : ''}</td><td className={money}>{l.creditCents ? peso(l.creditCents) : ''}</td></tr>)}
        <tr className="text-xs text-slate-600"><td className={td} colSpan={4}>Running total through {j.journalNumber}</td><td className={money}>{peso(j.runningDebitCents)}</td><td className={money}>{peso(j.runningCreditCents)}</td></tr></tbody>)}
      <tbody><tr className="font-semibold"><td className={td} colSpan={4}>Total</td><td className={money}>{peso(data.totalDebitCents)}</td><td className={money}>{peso(data.totalCreditCents)}</td></tr></tbody>
    </table></div>{pager}</Panel>}
  </article>;
}

export function GeneralLedger({ me }: { me: Me }) {
  const today = useToday();
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [accountId, setAccountId] = useState('');
  const [applied, setApplied] = useState(''); const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { if (today && !from && !to) { setFrom(today.slice(0, 7) + '-01'); setTo(today); } }, [today, from, to]);
  useEffect(() => { void api.report<Account[]>('accounts').then(setAccounts); }, []);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `ledger?${applied}` : null;
  const { data, error, pager } = usePagedReport<LedgerResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="General ledger" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Account"><select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => setApplied(new URLSearchParams({ from, to, ...(accountId ? { accountId } : {}) }).toString())}>Show</Button>
      {path && <Tools path={path} />}</div>
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data?.accounts.map((a) => <Panel key={a.id} title={`${a.code} ${a.name}`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Date', 'Journal', 'Source document', 'Party / memo', 'Debit', 'Credit', 'Balance'].map((x) => <th className={th} key={x}>{x}</th>)}</tr></thead><tbody>
      <tr><td className={td} colSpan={6}>Opening balance</td><td className={money}>{balance(a.openingBalanceCents)}</td></tr>
      {a.lines.map((l) => <tr key={`${l.journalId}-${l.lineNo}`}><td className={td}>{l.businessDate}</td><td className={td}>{l.journalNumber}</td><td className={td}>{source(l)}</td>
        <td className={td}>{party(l)}{party(l) && <br />}{l.memo ?? l.journalMemo}</td><td className={money}>{l.debitCents ? peso(l.debitCents) : ''}</td>
        <td className={money}>{l.creditCents ? peso(l.creditCents) : ''}</td><td className={money}>{balance(l.runningBalanceCents)}</td></tr>)}
      <tr className="font-semibold"><td className={td} colSpan={6}>Closing balance</td><td className={money}>{balance(a.closingBalanceCents)}</td></tr>
    </tbody></table></div></Panel>)}
    {data && pager}
  </article>;
}

export function TrialBalance({ me }: { me: Me }) {
  const today = useToday(); const [asOf, setAsOf] = useState(''); const [compareTo, setCompareTo] = useState(''); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !asOf) setAsOf(today); }, [today, asOf]);
  useEffect(() => { if (asOf && !applied) setApplied(new URLSearchParams({ asOf }).toString()); }, [asOf, applied]);
  const path = applied ? `trial-balance?${applied}` : null;
  const { data, error } = useReport<TbResult>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="Trial balance" dates={data ? `As of ${data.asOf}${data.compareTo ? ` compared with ${data.compareTo}` : ''}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="As of"><input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      <Field label="Compare with (optional)"><input type="date" className={inputClass} value={compareTo} onChange={(e) => setCompareTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!asOf} onClick={() => setApplied(new URLSearchParams({ asOf, ...(compareTo ? { compareTo } : {}) }).toString())}>Show</Button>
      {path && <Tools path={path} />}</div>
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && <Panel title="Account balances"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={th}>Account</th><th className={th}>Name</th><th className={th}>Debit {data.asOf}</th><th className={th}>Credit {data.asOf}</th>
      {data.compareTo && <><th className={th}>Debit {data.compareTo}</th><th className={th}>Credit {data.compareTo}</th></>}</tr></thead><tbody>
      {data.rows.map((a) => <tr key={a.accountId}><td className={td}>{a.code}</td><td className={td}>{a.name}</td><td className={money}>{a.debitCents ? peso(a.debitCents) : ''}</td><td className={money}>{a.creditCents ? peso(a.creditCents) : ''}</td>
        {data.compareTo && <><td className={money}>{a.compareDebitCents ? peso(a.compareDebitCents) : ''}</td><td className={money}>{a.compareCreditCents ? peso(a.compareCreditCents) : ''}</td></>}</tr>)}
      <tr className="font-semibold"><td className={td} colSpan={2}>Total</td><td className={money}>{peso(data.totalDebitCents)}</td><td className={money}>{peso(data.totalCreditCents)}</td>
        {data.compareTo && <><td className={money}>{peso(data.compareTotalDebitCents ?? 0)}</td><td className={money}>{peso(data.compareTotalCreditCents ?? 0)}</td></>}</tr>
    </tbody></table></div></Panel>}
  </article>;
}
