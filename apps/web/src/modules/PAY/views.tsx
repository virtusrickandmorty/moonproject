/**
 * View parts for payroll runs, 13th-month pay, releases and cash advances (PLAN H2 "What this did"), and the printable
 * payslips (F4, H4 PAYSLIP, A4 2-up, internal: no legend), which show the 13th month too.
 */
import { useEffect, useState } from 'react';
import { api, type CompanyProfile, type DocDetail, type Me, type Payslips as PayslipData } from '../../api.ts';
import { Loading, Button, Notice, peso, showDate } from '../../components/ui.tsx';
import { TickBar } from '../../components/charts.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { GROUP_LABEL, deductionsOf, finalPayText, loansLeft, qtyText, thirteenthText, yearEndDetail, yearEndText } from './run.ts';
import type { PayRunDoc, PayThirteenthDoc } from '../../api.ts';
import { PayDetails, PayTotal, ThirteenthCalculation } from './entry.tsx';

/** The "Final pay" badge of an employee separated within the run's period. */
export const FinalBadge = () => <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Final pay</span>;

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
      <p className="text-sm">
        {GROUP_LABEL[run.payGroup]} · {showDate(run.periodStart)} to {showDate(run.periodEnd)} · government shares for {run.contributionMonth}
        {run.yearEnd && ` · with the ${run.periodEnd.slice(0, 4)} year-end tax adjustment`}
        {run.unusedLeave && ' · unused leave paid in cash'}
      </p>
      <PayTotal total={run.netCents}>{run.employees.length} employees</PayTotal>
      {run.employees.map((e) => (
        <section key={e.employeeId} aria-label={e.name} className="space-y-3 rounded-xl p-4 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap justify-between gap-3"><h3 className="font-medium">{e.name}{e.final && <FinalBadge />}</h3><p className="font-semibold tabular-nums">Net pay: {peso(e.netCents)}</p></div>
          <TickBar parts={[{ share: e.grossCents > 0 ? Math.max(0, e.netCents) / e.grossCents : 0, tone: 'bg-indigo-600' }]} ticks={120} height="h-4" stretch label={`Net pay ${e.grossCents > 0 ? Math.round((Math.max(0, e.netCents) / e.grossCents) * 100) : 0}% of gross`} />
          <p className="text-sm">Gross {peso(e.grossCents)} − deductions {peso(e.grossCents - e.netCents + (e.wtaxRefundCents ?? 0))}{(e.wtaxRefundCents ?? 0) > 0 && <> + tax refund {peso(e.wtaxRefundCents!)}</>}</p>
          <PayDetails title="Earnings and deductions">
            {e.lines.map((l) => <div key={l.lineNo} className="flex justify-between gap-3 text-sm"><span>{l.description} {qtyText(l.kind, l.qty)}</span><span className="tabular-nums">{peso(l.amountCents)}</span></div>)}
            {deductionsOf(e).map(([label, amount]) => <div key={label} className="flex justify-between gap-3 text-sm"><span>Less {label}</span><span className="tabular-nums">{peso(amount)}</span></div>)}
            {e.yearEnd && <p className="text-sm">Year-end tax: {yearEndText(e)}</p>}
          </PayDetails>
          {e.final && <p className="text-xs text-slate-600">{finalPayText(e)}{e.yearEnd && ' · year-end tax: ' + yearEndText(e)}</p>}
        </section>
      ))}
      <p className="text-sm">Allowances and adjustments included: <b className="tabular-nums">{peso(run.employees.flatMap((e) => e.lines).filter((l) => l.kind === 'allowance' || l.kind === 'adjustment').reduce((sum, l) => sum + l.amountCents, 0))}</b></p>
      <div className="flex gap-2">
        <Link to={`/pay/runs/${d.header.id}/payslips`} className="rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">Payslips</Link>
        {d.header.status === 'posted' && <Link to={docPath('pay.release', `/new?run=${d.header.id}`)} className="rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">Release net pay</Link>}
      </div>
      <p className="text-xs text-slate-500">To correct a payroll, cancel it (its releases first) and work it out again.</p>
    </div>
  );
}

export const runView: ViewParts = { noEdit: true, extra: (d) => <RunParts d={d} />, cancelNote: (d) => <RemittedWarning runId={d.header.id} /> };

function ThirteenthParts({ d }: { d: DocDetail }) {
  const t = d.doc as PayThirteenthDoc | undefined;
  if (!t) return null;
  return (
    <div className="space-y-2 pt-2">
      <PayTotal label="To pay now" total={t.netCents}>{t.employees.length} employees</PayTotal>
      <p className="text-xs text-slate-600">Recorded net pay for this run; check its releases for what is still unpaid.</p>
      <p className="text-sm">{GROUP_LABEL[t.payGroup]} · 13th month {t.year}: one twelfth of the basic pay of the recorded payroll runs, beside what they accrued</p>
      {t.employees.map((e) => (
        <section key={e.employeeId} aria-label={e.name} className="space-y-3 rounded-xl p-4 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap justify-between gap-3"><h3 className="font-medium">{e.name}</h3><p className="font-semibold tabular-nums">To pay now: {peso(e.netCents)}</p></div>
          <p className="text-sm">Amount {peso(e.amountCents)} − tax {peso(e.wtaxCents)} = {peso(e.netCents)}</p>
          {e.reason && <p className="text-sm text-slate-600">Changed: {e.reason}</p>}
          <ThirteenthCalculation employee={e} />
        </section>
      ))}
      {t.skip?.map((s) => <p key={s.employeeId} className="text-xs text-slate-600">Left out: {s.reason}</p>)}
      {d.header.status === 'posted' && (
        <Link to={docPath('pay.release', `/new?run=${d.header.id}`)} className="inline-block rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100">Release net pay</Link>
      )}
      <p className="text-xs text-slate-500">To correct it, cancel it (its releases first) and work it out again.</p>
    </div>
  );
}

export const thirteenthView: ViewParts = { noEdit: true, extra: (d) => <ThirteenthParts d={d} /> };

export const releaseView: ViewParts = {
  noEdit: true,
  extra: (d) => {
    const r = d.doc as { runId: string; runNumber: string; lines: { employeeId: string; name: string; amountCents: number }[] } | undefined;
    if (!r) return null;
    return (
      <div className="pt-2 text-sm">
        <p>Net pay from <Link to={docPath(r.runNumber.startsWith('TH13-') ? 'pay.thirteenth' : 'pay.run', `/${r.runId}`)} className="underline">{r.runNumber}</Link>:</p>
        {r.lines.map((l) => <div key={l.employeeId} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{peso(l.amountCents)}</span></div>)}
      </div>
    );
  },
};

export const advanceView: ViewParts = {
  extra: (d) => {
    const a = d.doc as { employeeId: string; employeeName: string; cashPlaceName: string; installmentCents: number } | undefined;
    return a ? (
      <p className="pt-2 text-sm">
        Given to {a.employeeName} from {a.cashPlaceName}; {peso(a.installmentCents)} is deducted each payroll until repaid.{' '}
        <Link to={`/ca/employees/${a.employeeId}`} className="underline">What {a.employeeName} owes</Link>
      </p>
    ) : null;
  },
};

/** The company on a payslip's head (the Company Profile, when it is set and the person may read it). */
export type PayslipCompany = Pick<CompanyProfile, 'registeredName' | 'tradeName' | 'tin' | 'registeredAddress'> | null;

/**
 * One employee's payslip of a run: the printable payslips, and the release of one person at a time. Laid out like a paper
 * payslip (the owner's request, Oct 2026): the company and the period on top, earnings beside deductions, the net pay in a
 * band, then balances and the signature lines. Two fit an A4 page when printed (cut on the dashed line).
 */
export function PayslipCard({ p, e, company = null }: { p: PayslipData; e: PayslipData['employees'][number]; company?: PayslipCompany }) {
  const deductions = deductionsOf(e);
  const totalDeductions = deductions.reduce((n, [, c]) => n + c, 0);
  const refund = e.wtaxRefundCents ?? 0;
  const cell = 'py-1 align-top';
  const amount = `${cell} whitespace-nowrap pl-3 text-right tabular-nums`;
  const notes = [
    `Cash advance still owed ${peso(e.caBalanceAfterCents)}`,
    ...loansLeft(e).map(([label, c]) => `${label}: ${peso(c)} left`),
    ...(e.charges ?? []).map((c) => `Damage charge ${c.number}: ${peso(c.leftAfterCents)} left`),
    ...(e.eeShortCents > 0 ? [`${peso(e.eeShortCents)} of government shares carried to the next payroll`] : []),
  ];
  return (
    <section aria-label={`Payslip of ${e.name}`} className="payslip @container break-inside-avoid space-y-3 rounded-lg bg-white p-5 text-sm text-slate-900 ring-1 ring-slate-300 print:space-y-2 print:rounded-none print:p-0 print:text-[9.5pt] print:ring-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-2">
        <div className="min-w-0">
          {company ? <>
            <p className="text-base font-bold uppercase leading-tight tracking-wide">{company.tradeName || company.registeredName}</p>
            {company.tradeName && company.registeredName && company.tradeName !== company.registeredName && <p className="text-xs text-slate-600">{company.registeredName}</p>}
            <p className="text-xs text-slate-600">{[company.registeredAddress, company.tin && `TIN ${company.tin}`].filter(Boolean).join(' · ')}</p>
          </> : null}
        </div>
        <div className="shrink-0 text-right">
          <h2 className="text-base font-bold tracking-widest">PAYSLIP</h2>
          <p className="text-xs text-slate-600">{p.number}{e.final && <FinalBadge />}</p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs @lg:grid-cols-[1.3fr_0.8fr_1.6fr_1fr] print:grid-cols-[1.3fr_0.8fr_1.6fr_1fr]">
        <div><dt className="text-slate-500">Employee</dt><dd className="font-semibold text-slate-900">{e.name}</dd></div>
        <div><dt className="text-slate-500">Employee no.</dt><dd>{e.code}</dd></div>
        <div><dt className="text-slate-500">Pay period</dt><dd>{showDate(p.periodStart)} – {showDate(p.periodEnd)}</dd></div>
        <div><dt className="text-slate-500">{GROUP_LABEL[p.payGroup]}</dt><dd>Paid {showDate(p.payDate)}</dd></div>
      </dl>
      <div className="grid gap-4 @lg:grid-cols-2 print:grid-cols-2 print:gap-6">
        <table className="w-full self-start text-sm print:text-[9.5pt]">
          <thead><tr><th colSpan={3} className="border-b border-slate-300 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Earnings</th></tr></thead>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className={cell}>{l.description}</td>
                <td className={`${cell} whitespace-nowrap pl-2 text-right text-slate-500`}>{qtyText(l.kind, l.qty)}</td>
                <td className={amount}>{peso(l.amountCents)}</td>
              </tr>
            ))}
            {refund > 0 && <tr><td className={cell} colSpan={2}>Year-end tax refund</td><td className={amount}>{peso(refund)}</td></tr>}
          </tbody>
          <tfoot><tr className="border-t border-slate-300 font-semibold"><td className={cell} colSpan={2}>Gross pay{refund > 0 ? ' and refund' : ''}</td><td className={amount}>{peso(e.grossCents + refund)}</td></tr></tfoot>
        </table>
        <table className="w-full self-start text-sm print:text-[9.5pt]">
          <thead><tr><th colSpan={2} className="border-b border-slate-300 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Deductions</th></tr></thead>
          <tbody>
            {deductions.length === 0 && <tr><td className={`${cell} text-slate-500`} colSpan={2}>None</td></tr>}
            {deductions.map(([label, c]) => <tr key={label}><td className={cell}>{label}</td><td className={amount}>{peso(c)}</td></tr>)}
          </tbody>
          <tfoot><tr className="border-t border-slate-300 font-semibold"><td className={cell}>Total deductions</td><td className={amount}>{peso(totalDeductions)}</td></tr></tfoot>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-md bg-slate-900 px-4 py-2 text-white print:rounded-none print:border-2 print:border-slate-900 print:bg-white print:text-slate-900">
        <span className="font-semibold uppercase tracking-wide">Net pay</span>
        <span className="text-lg font-bold tabular-nums">{peso(e.netCents)}</span>
      </div>
      <div className="space-y-0.5 text-xs text-slate-600">
        <p>{notes.join(' · ')}</p>
        <p>Year to date: gross {peso(e.ytd.grossCents)}, tax withheld {peso(e.ytd.wtaxCents)}. {thirteenthText(e)}</p>
        {e.yearEnd && <p>{yearEndDetail(e)}</p>}
        {e.final && <p className="font-medium text-slate-700">{finalPayText(e)}. The 13th month on separation is paid on its own (13th-month pay for this employee).</p>}
      </div>
      <div className="grid grid-cols-2 gap-8 pt-6 text-xs text-slate-600 print:pt-8">
        <p className="border-t border-slate-400 pt-1">Received by (signature over printed name)</p>
        <p className="border-t border-slate-400 pt-1">Date received</p>
      </div>
    </section>
  );
}

/**
 * Printable payslips: on screen, two across; printed, two to an A4 page (the owner's request, Oct 2026), each the width
 * of the page with a dashed line to cut between them.
 */
export function Payslips({ params }: { me: Me; params?: Record<string, string> }) {
  const [p, setP] = useState<PayslipData | null>(null);
  const [company, setCompany] = useState<PayslipCompany>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.payslips(params?.id ?? '').then(setP, (e: Error) => setError(e.message)), [params?.id]);
  // Without the Company Profile (not set, or not the person's to read) the payslips print without the company head.
  useEffect(() => void api.companyProfile().then((c) => setCompany(c.registeredName || c.tradeName ? c : null), () => setCompany(null)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!p) return <Loading />;
  return (
    <div className="space-y-3 print:space-y-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Payslips {p.number}</h1>
        <Button tone="primary" onClick={() => window.print()}>Print</Button>
        <Link to={docPath('pay.run', `/${params?.id}`)} className="underline">Back to the run</Link>
        <span className="text-sm text-slate-500">{p.employees.length} {p.employees.length === 1 ? 'payslip' : 'payslips'} · two to an A4 page</span>
      </div>
      {p.status === 'cancelled' && <Notice tone="warning">{p.number} is cancelled.</Notice>}
      <div className="payslips grid gap-4 xl:grid-cols-2 print:block">
        {p.employees.map((e, i) => (
          <div key={e.employeeId} className={i % 2 === 0 ? 'print:border-b print:border-dashed print:border-slate-400 print:pb-[8mm] print:mb-[8mm]' : 'print:break-after-page'}>
            <PayslipCard p={p} e={e} company={company} />
          </div>
        ))}
      </div>
    </div>
  );
}
