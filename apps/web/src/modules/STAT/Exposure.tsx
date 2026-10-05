/**
 * The statutory exposure report (ACC-05): the past months since the cut-over date in which an employee was paid but no SSS,
 * PhilHealth or Pag-IBIG contribution was recorded, with the shares the rates of that month would have taken and the
 * penalty estimated today, for the accountant's catch-up decision. Every figure is the server's; this screen posts nothing.
 */
import { useEffect, useState } from 'react';
import { api, type Exposure } from '../../api.ts';
import { Button, Notice, Panel, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { exposureMonths } from './stat.ts';

export function StatExposure() {
  const [r, setR] = useState<Exposure | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.statExposure().then(setR, (e: Error) => setError(e.message)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!r) return <p className="text-slate-500">Loading…</p>;
  const grand = r.totals.reduce((s, t) => ({ total: s.total + t.totalCents, penalty: s.penalty + t.penaltyCents }), { total: 0, penalty: 0 });
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Missing past government contributions</h1>
        <Button tone="primary" onClick={() => window.print()}>Print</Button>
        <Link to="/stat" className="underline">Government remittances</Link>
      </div>
      <p className="text-sm text-slate-600">
        {r.from && r.to ? `Months ${r.from} to ${r.to}, as of ${r.asOf}.` : `As of ${r.asOf}.`} Government contributions that may be missing for past months: employees were paid but no SSS, PhilHealth or Pag-IBIG contribution was recorded. Ask the accountant to check these months and decide what needs paying. Nothing here is recorded or posted.
      </p>
      {!r.cutoverDate && <Notice tone="info">Set the cut-over date first so the accountant can check past months.</Notice>}
      <details className="text-sm text-slate-600"><summary className="cursor-pointer">Calculation limits and policy notes (statutory exposure)</summary>{r.notes.map((n) => <Notice key={n} tone="info">{n}</Notice>)}</details>
      {r.lines.length === 0 && r.cutoverDate && <p className="text-slate-500">No month since the cut-over date has pay without a contribution.</p>}
      {r.lines.length > 0 && (
        <>
          <Panel title="By scheme">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th>Scheme</th><th className="text-right">Employees</th><th className="text-right">Months</th><th className="text-right">Employee shares</th><th className="text-right">Company shares</th><th className="text-right">Shares in all</th><th className="text-right">Penalty (estimate)</th></tr></thead>
              <tbody>
                {r.totals.map((t) => (
                  <tr key={t.scheme} className="border-t border-slate-100">
                    <td className="py-1">{t.label}</td><td className="text-right tabular-nums">{t.employees}</td><td className="text-right tabular-nums">{t.months}</td>
                    <td className="text-right tabular-nums">{peso(t.eeCents)}</td><td className="text-right tabular-nums">{peso(t.erCents + t.ecCents)}</td><td className="text-right tabular-nums">{peso(t.totalCents)}</td><td className="text-right tabular-nums">{peso(t.penaltyCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-300 font-semibold"><td className="py-1" colSpan={5}>Total</td><td className="text-right tabular-nums">{peso(grand.total)}</td><td className="text-right tabular-nums">{peso(grand.penalty)}</td></tr></tfoot>
            </table>
            <p className="text-xs text-slate-600">Company shares include the SSS employees' compensation (EC). Penalty rates a month: {r.rates.map((x) => `${x.label} ${x.monthlyBp === null ? 'not set' : `${x.monthlyBp / 100}%`}`).join(', ')}.</p>
          </Panel>
          <Panel title="By employee">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th>Employee</th><th>Scheme</th><th>Months with pay and no contribution</th><th className="text-right">Employee share</th><th className="text-right">Company share</th><th className="text-right">Penalty (estimate)</th></tr></thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={`${l.employeeId}|${l.scheme}`} className="border-t border-slate-100 align-top">
                    <td className="py-1">{l.name} ({l.code}){l.switchedOff && <p className="text-xs text-amber-800">Switched off on the employee record.</p>}</td>
                    <td>{l.label}</td>
                    <td>
                      {exposureMonths(l)}
                      <ul className="text-xs text-slate-600">
                        {l.months.map((m) => <li key={m.month}>{m.month}: pay {peso(m.grossCents)}, shares {peso(m.totalCents)}, {m.monthsLate === 0 ? 'not yet late' : `${m.monthsLate} ${m.monthsLate === 1 ? 'month' : 'months'} late`}, penalty {peso(m.penaltyCents)}</li>)}
                      </ul>
                    </td>
                    <td className="text-right tabular-nums">{peso(l.eeCents)}</td><td className="text-right tabular-nums">{peso(l.erCents + l.ecCents)}</td><td className="text-right tabular-nums">{peso(l.penaltyCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
