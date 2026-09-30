/** Parts the tax report screens share: a date range or a quarter that opens on the server's today, the register table and the Excel link. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type TaxJournalRef, type TaxRegisterRow, type TaxSupplierRow } from '../../api.ts';
import { Button, Field, Notice, PAGE_ROWS, inputClass } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { QUARTERS, cancelMark, excelUrl, rangeError, yearChoices, type Quarter } from './reports.ts';

type Range = { from: string; to: string };

/** A report over a range of dates: opens on `initial` of the server's today and loads it; `show` asks again. */
export function useRangeReport<T>(allowed: boolean, initial: (today: string) => Range, load: (from: string, to: string, page: { limit: number; offset: number }) => Promise<T>) {
  const [range, setRange] = useState<Range>({ from: '', to: '' });
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);
  // `offset`: the row a long register starts at. Reports that are not paged ignore the page they are given.
  const show = async (r: Range, offset = 0) => {
    if (rangeError(r.from, r.to)) return;
    const n = ++asked.current; // only the last answer is shown
    setBusy(true);
    setError('');
    setData(null);
    await load(r.from, r.to, { limit: PAGE_ROWS, offset }).then((d) => n === asked.current && setData(d), (e: Error) => n === asked.current && setError(e.message));
    if (n === asked.current) setBusy(false);
  };
  useEffect(() => {
    if (!allowed) return;
    api.health().then((h) => {
      const r = initial(h.serverTime.slice(0, 10));
      setRange(r);
      void show(r);
    }, (e: Error) => setError(e.message));
  }, [allowed]); // once, on the server's today
  const set = (part: Partial<Range>) => (setRange({ ...range, ...part }), setData(null));
  return { ...range, data, error, busy, set, show: () => show(range), goto: (offset: number) => show(range, offset) };
}

export function RangeForm({ r }: { r: ReturnType<typeof useRangeReport<unknown>> }) {
  const problem = rangeError(r.from, r.to);
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <Field label="First date" required><input type="date" className={inputClass} value={r.from} onChange={(e) => r.set({ from: e.target.value })} /></Field>
      <Field label="Last date" required><input type="date" className={inputClass} value={r.to} onChange={(e) => r.set({ to: e.target.value })} /></Field>
      <Button tone="primary" disabled={!!problem || r.busy} onClick={() => void r.show()}>{r.busy ? 'Loading…' : 'Show'}</Button>
      {problem && (r.from || r.to) && <div className="w-full"><Notice>{problem}</Notice></div>}
    </div>
  );
}

type QuarterPick = { year: number; quarter: Quarter };

/** A report of one quarter: opens on `initial` of the server's today, and loads again each time the year or quarter changes. */
export function useQuarterReport<T>(allowed: boolean, initial: (today: string) => QuarterPick, load: (year: number, quarter: Quarter) => Promise<T>) {
  const [today, setToday] = useState('');
  const [pick, setPick] = useState<QuarterPick | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!allowed) return;
    api.health().then((h) => {
      const t = h.serverTime.slice(0, 10);
      setToday(t);
      setPick(initial(t));
    }, (e: Error) => setError(e.message));
  }, [allowed]); // once, on the server's today
  useEffect(() => {
    if (!pick) return;
    let current = true; // only the last answer is shown
    setData(null);
    setError('');
    load(pick.year, pick.quarter).then((d) => current && setData(d), (e: Error) => current && setError(e.message));
    return () => void (current = false);
  }, [pick]);
  return { today, pick, setPick, data, error };
}

export function QuarterForm({ q, quarters = QUARTERS }: { q: ReturnType<typeof useQuarterReport<unknown>>; quarters?: Quarter[] }) {
  const pick = q.pick;
  if (!pick) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <Field label="Year">
        <select className={inputClass} value={pick.year} onChange={(e) => q.setPick({ ...pick, year: Number(e.target.value) })}>
          {yearChoices(q.today).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </Field>
      <Field label="Quarter">
        <select className={inputClass} value={pick.quarter} onChange={(e) => q.setPick({ ...pick, quarter: Number(e.target.value) as Quarter })}>
          {quarters.map((n) => <option key={n} value={n}>Q{n}</option>)}
        </select>
      </Field>
    </div>
  );
}

/** The "Download for Excel" link: the report's own URL with &format=csv. */
export const Excel = ({ url }: { url: string }) => <a href={excelUrl(url)} className="text-sm underline print:hidden">Download for Excel</a>;

/** The document a row comes from, linked; a journal with no document shows its journal number. */
function DocumentCell({ row }: { row: TaxJournalRef }) {
  const mark = cancelMark(row);
  return (
    <>
      {row.documentId && row.docType
        ? <Link to={docPath(row.docType, `/${row.documentId}`)} className="underline print:no-underline">{row.docTitle} {row.documentNumber}</Link>
        : `${row.docTitle} ${row.journalNumber}`}
      {mark && <span title={mark.hint} className="ml-2 whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">{mark.text}</span>}
    </>
  );
}

export const pesos = (cents: number) => formatPesos(cents);
export interface Column<R> { head: string; cell: (row: R) => ReactNode; total?: ReactNode; amount?: boolean }

/** Who a sales-side register row is for: the booklet number, the customer and their TIN. */
export const customerColumns: Column<TaxRegisterRow>[] = [
  { head: 'Booklet no.', cell: (r) => r.formNumber ?? '—' },
  { head: 'Customer', cell: (r) => r.customerName || '—' },
  { head: 'TIN', cell: (r) => r.tin ?? '—' },
];
/** Who a purchases-side register row is from: the supplier (or one-off payee) and their TIN. */
export const supplierColumns: Column<TaxSupplierRow>[] = [
  { head: 'Supplier', cell: (r) => r.supplierName || '—' },
  { head: 'TIN', cell: (r) => r.tin ?? '—' },
];

/** Date and document, then who (`lead`), then the register's own columns, and a totals row. */
export function RegisterTable<R extends TaxJournalRef>({ rows, lead, columns }: { rows: R[]; lead: Column<R>[]; columns: Column<R>[] }) {
  const all: Column<R>[] = [{ head: 'Date', cell: (r) => r.date }, { head: 'Document', cell: (r) => <DocumentCell row={r} /> }, ...lead, ...columns];
  const cls = (c: Column<R>) => (c.amount ? 'whitespace-nowrap py-1 pl-3 text-right tabular-nums' : 'py-1 pr-3');
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing in these dates.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr>{all.map((c) => <th key={c.head} className={c.amount ? 'pl-3 text-right' : 'pr-3'}>{c.head}</th>)}</tr></thead>
        <tbody>
          {/* A bill with lines of two classes gives two rows of one journal. */}
          {rows.map((r, i) => (
            <tr key={`${r.journalId}:${i}`} className={`border-t border-slate-100 align-top ${r.posting === 'reversal' ? 'text-slate-600' : ''}`}>
              {all.map((c) => <td key={c.head} className={cls(c)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-300 font-semibold">
            <td className="py-1" colSpan={all.length - columns.length}>Total</td>
            {columns.map((c) => <td key={c.head} className={cls(c)}>{c.total}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
