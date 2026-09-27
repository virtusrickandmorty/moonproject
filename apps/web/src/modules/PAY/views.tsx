/**
 * View parts for payroll runs, releases and cash advances (PLAN H2 "What this did"), and the printable payslips (F4,
 * H4 PAYSLIP, A4 2-up, internal: no legend).
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail, type Me, type Payslips as PayslipData } from '../../api.ts';
import { Button, Notice, peso } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { GROUP_LABEL, deductionsOf, qtyText } from './run.ts';
import type { PayRunDoc } from '../../api.ts';

/** D6: a recorded run whose month is already remitted (STAT): cancelling it leaves those payables below zero. */
function RemittedWarning({ runId }: { runId: string }) {
  const [r, setR] = useState<Awaited<ReturnType<typeof api.runRemitted>> | null>(null);
  useEffect(() => void api.runRemitted(runId).then(setR, () => undefined), [runId]);
  if (!r?.remitted.length) return null;
  return (
    <Notice tone="warning">
      {r.remitted.map((x) => `${x.label} (${x.numbers.join(', ')})`).join(', ')} for {r.month} {r.remitted.length === 1 ? 'is' : 'are'} already remitted. Cancelling this payroll
      leaves {r.month} remitted for more than the payrolls show, until the payroll is recorded again; the accountant sees it on the remittance check.
    </Notice>
  );
}

function RunParts({ d }: { d: DocDetail }) {
  const run = d.doc as PayRunDoc | undefined;
  if (!run) return null;
  return (
    <div className="space-y-2 pt-2">
      {d.header.status === 'posted' && <RemittedWarning runId={d.header.id} />}
      <p className="text-sm">{GROUP_LABEL[run.payGroup]} · {run.periodStart} to {run.periodEnd} · government shares for {run.contributionMonth}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th>Employee</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th></tr></thead>
        <tbody>
          {run.employees.map((e) => (
            <tr key={e.employeeId} className="border-t border-slate-100">
              <td className="py-1">{e.name}</td><td className="text-right tabular-nums">{peso(e.grossCents)}</td>
              <td className="text-right tabular-nums">{peso(e.grossCents - e.netCents)}</td><td className="text-right tabular-nums">{peso(e.netCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Link to={`/pay/runs/${d.header.id}/payslips`} className="rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">Payslips</Link>
        {d.header.status === 'posted' && <Link to={docPath('pay.release', `/new?run=${d.header.id}`)} className="rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">Release net pay</Link>}
      </div>
      <p className="text-xs text-slate-500">To correct a payroll, cancel it (its releases first) and work it out again.</p>
    </div>
  );
}

export const runView: ViewParts = { noEdit: true, extra: (d) => <RunParts d={d} />, cancelNote: (d) => <RemittedWarning runId={d.header.id} /> };

export const releaseView: ViewParts = {
  noEdit: true,
  extra: (d) => {
    const r = d.doc as { runId: string; runNumber: string; lines: { employeeId: string; name: string; amountCents: number }[] } | undefined;
    if (!r) return null;
    return (
      <div className="pt-2 text-sm">
        <p>Net pay from <Link to={docPath('pay.run', `/${r.runId}`)} className="underline">{r.runNumber}</Link>:</p>
        {r.lines.map((l) => <div key={l.employeeId} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{peso(l.amountCents)}</span></div>)}
      </div>
    );
  },
};

export const advanceView: ViewParts = {
  extra: (d) => {
    const a = d.doc as { employeeName: string; cashPlaceName: string; installmentCents: number } | undefined;
    return a ? <p className="pt-2 text-sm">Given to {a.employeeName} from {a.cashPlaceName}; {peso(a.installmentCents)} is deducted each payroll until repaid.</p> : null;
  },
};

/** Printable payslips, two to a page. */
export function Payslips({ params }: { me: Me; params?: Record<string, string> }) {
  const [p, setP] = useState<PayslipData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.payslips(params?.id ?? '').then(setP, (e: Error) => setError(e.message)), [params?.id]);
  if (error) return <Notice>{error}</Notice>;
  if (!p) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Payslips {p.number}</h1>
        <Button tone="primary" onClick={() => window.print()}>Print</Button>
        <Link to={docPath('pay.run', `/${params?.id}`)} className="underline">Back to the run</Link>
      </div>
      {p.status === 'cancelled' && <Notice tone="warning">{p.number} is cancelled.</Notice>}
      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-2">
        {p.employees.map((e) => (
          <section key={e.employeeId} className="break-inside-avoid space-y-2 rounded-lg bg-white p-4 text-sm ring-1 ring-slate-300">
            <div className="flex justify-between"><h2 className="font-semibold">PAYSLIP</h2><span>{p.number}</span></div>
            <p>{e.name} <span className="text-slate-500">{e.code}</span></p>
            <p className="text-slate-600">{GROUP_LABEL[p.payGroup]} · {p.periodStart} to {p.periodEnd} · dated {p.payDate}</p>
            <table className="w-full">
              <tbody>
                {e.lines.map((l) => <tr key={l.lineNo}><td>{l.description}</td><td className="text-right text-slate-500">{qtyText(l.kind, l.qty)}</td><td className="text-right tabular-nums">{peso(l.amountCents)}</td></tr>)}
                <tr className="border-t font-medium"><td colSpan={2}>Gross pay</td><td className="text-right tabular-nums">{peso(e.grossCents)}</td></tr>
                {deductionsOf(e).map(([label, c]) => <tr key={label}><td colSpan={2}>Less {label}</td><td className="text-right tabular-nums">{peso(-c)}</td></tr>)}
                <tr className="border-t text-base font-semibold"><td colSpan={2}>Net pay</td><td className="text-right tabular-nums">{peso(e.netCents)}</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-600">
              Cash advance still owed {peso(e.caBalanceAfterCents)} · Year to date: gross {peso(e.ytd.grossCents)}, tax {peso(e.ytd.wtaxCents)}
              {e.eeShortCents > 0 && ` · ${peso(e.eeShortCents)} of government shares carried to the next payroll`}
            </p>
            <p className="pt-4 text-xs">Received by: ______________________ Date: __________</p>
          </section>
        ))}
      </div>
    </div>
  );
}
