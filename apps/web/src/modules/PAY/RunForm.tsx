/**
 * Payroll run form (PLAN E11, F3, H5 "weekly piece payroll for 8 workers ≤ 5 min"): pick the pay group and the period,
 * and the server works out every line from attendance, pay, piece work, holidays, government shares and cash advances.
 * Staff may add manual lines, change this run's cash-advance deduction, change or skip a government loan deduction with a
 * note, or leave someone out, with a reason. On a period ending in December the accountant may tick the year-end tax
 * adjustment: the preview then shows each employee's refund or deficiency.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type DocTypeInfo, type Me, type PayGroup, type PayPeriod, type PayRunDoc, type Preview } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { Errors, useLive } from '../COL/parts.tsx';
import { GROUP_LABEL, emptyManual, endsInDecember, loanLabel, qtyText, runInput, yearEndText, type LoanRow, type ManualRow } from './run.ts';

export function RunForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me?: Me }) {
  const [payGroup, setPayGroup] = useState<PayGroup>('SEMI_DAILY');
  const [periods, setPeriods] = useState<PayPeriod[] | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [advances, setAdvances] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, string>>({});
  const [loanRows, setLoanRows] = useState<Record<string, LoanRow>>({});
  const [yearEnd, setYearEnd] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPeriods(null);
    api.payPeriods(payGroup).then((p) => (setPeriods(p), setPeriodStart(p.find((x) => !x.recorded)?.periodStart ?? '')), (e: Error) => setError(e.message));
  }, [payGroup]);

  const period = periods?.find((p) => p.periodStart === periodStart);
  const canYearEnd = endsInDecember(period?.periodEnd) && !!me?.permissions.includes('pay.yearend.run');
  const { input, errors } = runInput(payGroup, periodStart, rows, advances, skip, loanRows, yearEnd && canYearEnd);
  // PAY-1: dated the period's last day when that has passed and the user may backdate, so its pay is booked in that month.
  const bookOn = period?.bookOn ?? undefined;
  const live = useLive(JSON.stringify([input, bookOn]), !!periodStart && errors.length === 0, () => api.preview(type.key, input, bookOn));
  const [last, setLast] = useState<PayRunDoc | null>(null); // kept while a reason is being typed
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const doc = live?.doc as PayRunDoc | undefined;
    if (!doc) return;
    setLast(doc);
    setNames((n) => ({ ...n, ...Object.fromEntries(doc.employees.map((e) => [e.employeeId, e.name])) }));
  }, [live]);
  useEffect(() => setLast(null), [payGroup, periodStart]);
  useEffect(() => setNames({}), [payGroup]);
  const run = last;

  if (mode.kind === 'edit') {
    return (
      <Notice tone="info">
        A payroll run is corrected by cancelling it and working it out again: its government shares and piece work depend on what was recorded before it.{' '}
        <Link to={docPath(type.key, `/${mode.id}`)} className="underline">Back to the run</Link>
      </Notice>
    );
  }
  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input, bookOn).then(setConfirm, (e: Error) => setError(e.message));
  };
  const record = async (key: string) => {
    try {
      const r = await api.post(type.key, input, confirm!.totalCents, key, bookOn);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input, bookOn));
      throw e;
    }
  };
  const people = run?.employees ?? [];
  const setRow = (i: number, patch: Partial<ManualRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
      <h1 className="text-2xl font-semibold">New payroll run</h1>
      {error && <Notice>{error}</Notice>}
      <Panel title="Which payroll?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pay group" required>
            <select className={inputClass} value={payGroup} onChange={(e) => (setPayGroup(e.target.value as PayGroup), setAdvances({}), setSkip({}), setRows([]), setLoanRows({}))}>
              {Object.entries(GROUP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Period" required hint="Periods that have ended. A recorded one must be cancelled to redo it.">
            <select className={inputClass} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}>
              <option value="">{periods ? 'Pick the period' : 'Loading…'}</option>
              {periods?.map((p) => (
                <option key={p.periodStart} value={p.periodStart} disabled={!!p.recorded}>
                  {p.periodStart} to {p.periodEnd} · {p.recorded ? `recorded as ${p.recorded.number}` : `${p.employees} ${p.employees === 1 ? 'person' : 'people'}`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {bookOn && <p className="mt-2 text-sm text-slate-600">Dated {bookOn}, the period's last day, so its pay is booked in that month.</p>}
        {canYearEnd && (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={yearEnd} onChange={(e) => setYearEnd(e.target.checked)} />
            <span>
              <b>Year-end tax adjustment</b> on this payroll: each employee's tax is the year's tax less what was withheld this year (pay before Moonproject and a
              previous employer's included). An excess is refunded with net pay; a deficiency is withheld as far as the pay allows. Tick it on each employee's last payroll of the year.
            </span>
          </label>
        )}
      </Panel>

      <Panel title="Pay worked out by the server">
        {!run && <p className="text-sm text-slate-500">{periodStart ? 'Working it out…' : 'Pick a period.'}</p>}
        {run && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Employee</th><th className="text-right">Gross</th><th className="text-right">SSS</th><th className="text-right">PhilHealth</th><th className="text-right">Pag-IBIG</th><th className="text-right">Tax</th><th className="text-right">Gov't loans</th><th className="text-right">Cash advance</th><th className="text-right">Net</th><th /></tr>
              </thead>
              <tbody>
                {people.map((e) => [
                  <tr key={e.employeeId} className="border-t border-slate-100">
                    <td className="py-1"><button type="button" className="text-left underline" onClick={() => setOpen(open === e.employeeId ? null : e.employeeId)}>{e.name}</button></td>
                    <td className="text-right tabular-nums">{peso(e.grossCents)}</td>
                    <td className="text-right tabular-nums">{peso(e.sssEeCents)}</td>
                    <td className="text-right tabular-nums">{peso(e.phicEeCents)}</td>
                    <td className="text-right tabular-nums">{peso(e.hdmfEeCents)}</td>
                    <td className="text-right tabular-nums">{peso(e.wtaxCents)}{e.yearEnd && <span className="block text-xs text-slate-600">{yearEndText(e)}</span>}</td>
                    <td className="text-right tabular-nums">{peso(e.loanCents ?? 0)}</td>
                    <td className="text-right">
                      <input aria-label={`${e.name} cash-advance deduction`} inputMode="decimal" placeholder={(e.caCents / 100).toFixed(2)} className="w-24 rounded border border-slate-300 px-1 text-right"
                        value={advances[e.employeeId] ?? ''} onChange={(x) => setAdvances({ ...advances, [e.employeeId]: x.target.value })} />
                    </td>
                    <td className="text-right font-medium tabular-nums">{peso(e.netCents)}</td>
                    <td className="pl-2"><Button onClick={() => setSkip({ ...skip, [e.employeeId]: '' })}>Leave out</Button></td>
                  </tr>,
                  open === e.employeeId && (
                    <tr key={`${e.employeeId}-lines`}>
                      <td colSpan={10} className="bg-slate-50 px-3 py-2 text-xs">
                        {e.lines.map((l) => <div key={l.lineNo} className="flex justify-between"><span>{l.description} {qtyText(l.kind, l.qty)}</span><span className="tabular-nums">{peso(l.amountCents)}</span></div>)}
                        {e.lines.length === 0 && 'No earnings in this period.'}
                        {(e.loans ?? []).map((l) => (
                          <div key={l.loanId} className="mt-1 flex flex-wrap items-center gap-2">
                            <span>{loanLabel(l)}: {peso(l.amountCents)}{l.amountCents < l.dueCents ? ` of ${peso(l.dueCents)} (the pay allows no more)` : ''}, {peso(l.balanceAfterCents)} left</span>
                            <input aria-label={`${loanLabel(l)} deduction`} inputMode="decimal" placeholder="Change (0 skips)" className="w-32 rounded border border-slate-300 px-1 text-right"
                              value={loanRows[l.loanId]?.amount ?? ''} onChange={(x) => setLoanRows({ ...loanRows, [l.loanId]: { reason: loanRows[l.loanId]?.reason ?? '', amount: x.target.value } })} />
                            <input aria-label={`${loanLabel(l)} note`} placeholder="Why" className="w-64 rounded border border-slate-300 px-1"
                              value={loanRows[l.loanId]?.reason ?? ''} onChange={(x) => setLoanRows({ ...loanRows, [l.loanId]: { amount: loanRows[l.loanId]?.amount ?? '', reason: x.target.value } })} />
                          </div>
                        ))}
                        <div className="mt-1 text-slate-600">Employer shares: SSS {peso(e.sssErCents + e.sssEcCents)}, PhilHealth {peso(e.phicErCents)}, Pag-IBIG {peso(e.hdmfErCents)} · 13th month {peso(e.thirteenthCents)}</div>
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
              <tfoot><tr className="border-t border-slate-300 font-semibold"><td className="py-1">Total</td><td className="text-right tabular-nums">{peso(run.grossCents)}</td><td colSpan={6} /><td className="text-right tabular-nums">{peso(run.netCents)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        {live?.issues.map((i) => <Notice key={i.code + i.message} tone={i.level}>{i.message}</Notice>)}
      </Panel>

      {Object.keys(skip).length > 0 && (
        <Panel title="Left out of this run">
          {Object.entries(skip).map(([id, reason]) => (
            <div key={id} className="flex items-center gap-2">
              <span className="w-48 text-sm">{names[id] ?? 'Employee'}</span>
              <input aria-label="Why left out" placeholder="Why (their piece work stays for a later run)" className={inputClass} value={reason} onChange={(e) => setSkip({ ...skip, [id]: e.target.value })} />
              <Button onClick={() => setSkip(Object.fromEntries(Object.entries(skip).filter(([k]) => k !== id)))}>Put back</Button>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Manual lines (allowance, adjustment)">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_2fr_auto]">
            <select aria-label="Employee" className={inputClass} value={r.employeeId} onChange={(e) => setRow(i, { employeeId: e.target.value })}>
              <option value="">Employee</option>{Object.entries(names).filter(([id]) => !(id in skip)).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select aria-label="Kind" className={inputClass} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as ManualRow['kind'] })}><option value="allowance">Allowance</option><option value="adjustment">Adjustment</option></select>
            <input aria-label="Amount" inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
            <input aria-label="What for" placeholder="What for" className={inputClass} value={r.reason} onChange={(e) => setRow(i, { reason: e.target.value })} />
            <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <Button onClick={() => setRows([...rows, emptyManual()])}>+ Add a line</Button>
      </Panel>

      <Errors list={errors} show={touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} reason="" onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
