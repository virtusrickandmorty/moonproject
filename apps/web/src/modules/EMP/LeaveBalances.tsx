/** Yearly SIL balances for everyone who was in service during the selected year. No pay figures are shown. */
import { useEffect, useState } from 'react';
import { api, type LeaveBalances as LeaveBalancesData } from '../../api.ts';
import { Button, Notice, inputClass, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';

export function LeaveBalances() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<LeaveBalancesData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    void api.leaveBalances(year).then(setData, (e: Error) => setError(e.message));
  }, [year]);
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Leave balances</h1><p className="text-sm text-slate-600">Service incentive leave (SIL) for employees in service during the year.</p></div>
        <div className="flex items-center gap-2 print:hidden">
          <label className="text-sm">Year <input aria-label="Year" type="number" min="2000" max="2100" className={`${inputClass} ml-1 w-24`} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" href={`/api/emp/leave-balances?year=${year}&format=csv`}>Download CSV</a>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {data && <table className="w-full rounded-lg bg-white text-sm shadow-sm ring-1 ring-slate-200">
        <thead className="text-left text-slate-500"><tr><th className="p-2">Code</th><th>Employee</th><th>In service</th><th className="text-right">SIL earned</th><th className="text-right">Days used</th><th className="text-right">Paid in cash</th><th className="pr-2 text-right">Left</th></tr></thead>
        <tbody>{data.rows.map((r) => <tr key={r.employeeId} className="border-t border-slate-100">
          <td className="p-2"><Link className="text-indigo-700 underline" to={`/emp/employees/${r.employeeId}`}>{r.code}</Link></td><td>{r.fullName}</td>
          <td>{showDate(r.hireDate)}{r.separatedOn ? ` to ${showDate(r.separatedOn)}` : ' onward'}</td><td className="text-right">{r.earned}</td><td className="text-right">{r.used}</td><td className="text-right">{r.paid}</td><td className="pr-2 text-right font-medium">{r.left}</td>
        </tr>)}</tbody>
        <tfoot className="border-t-2 border-slate-300 font-semibold"><tr><td className="p-2" colSpan={3}>Total</td><td className="text-right">{data.totals.earned}</td><td className="text-right">{data.totals.used}</td><td className="text-right">{data.totals.paid}</td><td className="pr-2 text-right">{data.totals.left}</td></tr></tfoot>
      </table>}
      {data?.rows.length === 0 && <p className="text-sm text-slate-500">Nobody was in service during {year}.</p>}
    </div>
  );
}
