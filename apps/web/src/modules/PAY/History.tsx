/**
 * The Payroll history panel of an employee's page (the owner's request, Nov 2026): each recorded payroll they are on, with what
 * was earned, what came off, the net pay and how much of it was released. Each line opens the payroll itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PayHistoryRow } from '../../api.ts';
import { Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import { Paged } from '../../components/RowPages.tsx';
import { useLiveReload } from '../../live.ts';
import { Link } from '../../router.tsx';

const right = { textAlign: 'right' } as const; // the app's table headings lean left; a figure's heading stands over its figure

/** What is left of the net pay, in words. */
export const releaseWords = (r: Pick<PayHistoryRow, 'netCents' | 'paidCents' | 'leftCents'>) =>
  r.netCents === 0 ? 'Nothing to release' : r.leftCents === 0 ? 'Released' : r.paidCents > 0 ? 'Partly released' : 'Not released';

/** The rows of a year (all of them when none is picked), and their totals. */
export function historyOf(rows: PayHistoryRow[], year: string) {
  const shown = year ? rows.filter((r) => r.periodEnd.startsWith(year)) : rows;
  const sum = (key: 'grossCents' | 'netCents' | 'paidCents' | 'leftCents') => shown.reduce((n, r) => n + r[key], 0);
  return { shown, totals: { grossCents: sum('grossCents'), netCents: sum('netCents'), paidCents: sum('paidCents'), leftCents: sum('leftCents') } };
}

export function HistoryTable({ rows, canSeeReleases }: { rows: PayHistoryRow[]; canSeeReleases: boolean }) {
  return <table className="w-full min-w-[680px] text-sm">
    <thead><tr><th className="text-left">Payroll</th><th style={right}>Gross</th><th style={right}>Deductions</th><th style={right}>Net pay</th><th style={right}>Released</th><th style={right}>Left</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100 align-top">
      <td className="py-2">
        <Link to={`/docs/${r.kind === 'run' ? 'pay.run' : 'pay.thirteenth'}/${r.id}`} className="font-medium text-indigo-700 hover:underline">{r.number}</Link>
        {r.kind === 'run' && <Link to={`/pay/runs/${r.id}/payslips`} className="ml-2 text-xs text-indigo-700 hover:underline">Payslip</Link>}
        <span className="block text-xs text-slate-500">{r.kind === 'run' ? `${showDate(r.periodStart)} to ${showDate(r.periodEnd)}` : `13th-month pay ${r.periodEnd.slice(0, 4)}`}</span>
      </td>
      <td className="py-2 text-right tabular-nums">{peso(r.grossCents)}</td>
      <td className="py-2 text-right tabular-nums">{peso(r.grossCents - r.netCents)}</td>
      <td className="py-2 text-right font-medium tabular-nums">{peso(r.netCents)}</td>
      <td className="py-2 text-right tabular-nums">{peso(r.paidCents)}
        {r.releases.map((x) => <span key={x.id} className="block text-xs text-slate-500">{canSeeReleases ? <Link to={`/docs/pay.release/${x.id}`} className="text-indigo-700 hover:underline">{x.number}</Link> : x.number} {showDate(x.date)}{r.releases.length > 1 ? `: ${peso(x.amountCents)}` : ''}</span>)}
      </td>
      <td className="py-2 text-right tabular-nums">{peso(r.leftCents)}<span className={`block text-xs ${r.leftCents > 0 ? 'font-medium text-amber-800' : 'text-slate-500'}`}>{releaseWords(r)}</span></td>
    </tr>)}</tbody>
  </table>;
}

export function EmployeePayHistory({ me, employeeId }: { me: Me; employeeId: string }) {
  const [rows, setRows] = useState<PayHistoryRow[] | null>(null);
  const [year, setYear] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => api.payHistory(employeeId).then(setRows, (e: Error) => setError(e.message)), [employeeId]);
  useEffect(() => void load(), [load]);
  useLiveReload(load);
  const years = [...new Set((rows ?? []).map((r) => r.periodEnd.slice(0, 4)))];
  const { shown, totals } = historyOf(rows ?? [], year);
  return <Panel title="Payroll history">
    {error && <Notice>{error}</Notice>}
    {rows && rows.length === 0 && <p className="text-sm text-slate-500">Not on any recorded payroll yet.</p>}
    {rows && rows.length > 0 && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{shown.length} {shown.length === 1 ? 'payroll' : 'payrolls'}: net pay <b className="tabular-nums">{peso(totals.netCents)}</b>, released <b className="tabular-nums">{peso(totals.paidCents)}</b>{totals.leftCents > 0 && <>, <b className="tabular-nums text-amber-800">{peso(totals.leftCents)}</b> left</>}.</p>
        {years.length > 1 && <select aria-label="Year" className={`${inputClass} w-36`} value={year} onChange={(e) => setYear(e.target.value)}><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>}
      </div>
      <div className="overflow-x-auto"><Paged rows={shown}>{(page) => <HistoryTable rows={page} canSeeReleases={me.permissions.includes('pay.release.view')} />}</Paged></div>
    </>}
  </Panel>;
}
