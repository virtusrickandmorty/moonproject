/**
 * Payroll run form (PLAN E11, F3, H5 "weekly piece payroll for 8 workers ≤ 5 min"): pick the pay group and the period,
 * and the server works out every line from attendance, pay, piece work, holidays, government shares and cash advances.
 * Staff may add manual lines, change this run's cash-advance deduction, change or skip a government loan deduction with a
 * note, or leave someone out, with a reason. On a period ending in December the accountant may tick the year-end tax
 * adjustment: the preview then shows each employee's refund or deficiency, and "Pay unused leave" (SIL days left, in
 * cash). An employee separated within the period gets their final pay, marked with a badge.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type DocTypeInfo, type Me, type PayGroup, type PayPeriod, type PayRunDoc, type Preview } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { Errors, useLive } from '../COL/parts.tsx';
import { GROUP_LABEL, emptyManual, endsInDecember, finalPayText, loanLabel, qtyText, runInput, yearEndText, type LoanRow, type ManualRow } from './run.ts';
import { FinalBadge } from './views.tsx';
import { PayDetails, PayTotal } from './entry.tsx';

/** The period the run opens on: the newest one not yet recorded that has people in it, else the newest not yet recorded. */
const firstToPay = (periods: PayPeriod[]) => periods.find((x) => !x.recorded && x.employees > 0) ?? periods.find((x) => !x.recorded);

export function RunForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me?: Me }) {
  const [payGroup, setPayGroup] = useState<PayGroup>('SEMI_DAILY');
  const [periods, setPeriods] = useState<PayPeriod[] | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [advances, setAdvances] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, string>>({});
  const [loanRows, setLoanRows] = useState<Record<string, LoanRow>>({});
  const [yearEnd, setYearEnd] = useState(false);
  const [unusedLeave, setUnusedLeave] = useState(false);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');

  const chosenByUser = useRef(false);
  useEffect(() => {
    setPeriods(null);
    api.payPeriods(payGroup).then((p) => (setPeriods(p), setPeriodStart(firstToPay(p)?.periodStart ?? '')), (e: Error) => setError(e.message));
  }, [payGroup]);
  // Opens on a pay group that has someone to pay, not on one the shop does not use (a made-up empty period says "nobody in service").
  useEffect(() => {
    const groups = Object.keys(GROUP_LABEL) as PayGroup[];
    Promise.all(groups.map((g) => api.payPeriods(g).then((p) => [g, p] as const))).then((all) => {
      const found = all.find(([, p]) => p.some((x) => !x.recorded && x.employees > 0));
      if (found && !chosenByUser.current) setPayGroup(found[0]);
    }, () => undefined);
  }, []);

  const period = periods?.find((p) => p.periodStart === periodStart);
  const oldest = periods?.reduce((m, p) => (p.periodStart < m ? p.periodStart : m), periods[0]?.periodStart ?? '') || undefined;
  const newest = periods?.reduce((m, p) => (p.periodEnd > m ? p.periodEnd : m), '') || undefined;
  const pickDay = (day: string) => {
    const hit = periods?.find((p) => p.periodStart <= day && day <= p.periodEnd) ?? null;
    setPicked(hit);
    setDayNote(!day || hit ? '' : `No ${GROUP_LABEL[payGroup]} period that has ended holds ${showDate(day)}.`);
    setPeriodStart(hit && !hit.recorded ? hit.periodStart : '');
  };
  const canYearEnd = endsInDecember(period?.periodEnd) && !!me?.permissions.includes('pay.yearend.run');
  const { input, errors } = runInput(payGroup, periodStart, rows, advances, skip, loanRows, yearEnd && canYearEnd, unusedLeave && canYearEnd);
  // PAY-1: dated the period's last day when that has passed and the user may backdate, so its pay is booked in that month.
  const bookOn = period?.bookOn ?? undefined;
  const live = useLive(JSON.stringify([input, bookOn]), !!periodStart && errors.length === 0, () => api.preview(type.key, input, bookOn));
  const [last, setLast] = useState<PayRunDoc | null>(null); // kept while a reason is being typed
  const [names, setNames] = useState<Record<string, string>>({});
  // The day picked on Date from or Date to, and the period holding it (a recorded one is shown, not chosen). Kept last:
  // the form tests set the earlier ones by position.
  const [picked, setPicked] = useState<PayPeriod | null>(null);
  const [dayNote, setDayNote] = useState('');
  const shown = picked ?? period ?? null;
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
      <PayTotal total={live ? run?.netCents : undefined}>{people.length} employees{!live && run && ' · Updating calculation…'}</PayTotal>
      {error && <Notice>{error}</Notice>}
      <Panel title="Which payroll?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pay group" required>
            <select className={inputClass} value={payGroup} onChange={(e) => (chosenByUser.current = true, setPayGroup(e.target.value as PayGroup), setAdvances({}), setSkip({}), setRows([]), setLoanRows({}))}>
              {Object.entries(GROUP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {/* Date from and Date to (the owner's request, Oct 2026): picking either day takes the pay group's period that holds
              it (weekly, or the 1st–15th and 16th–end of the month), so the pay rules keep their periods. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date from" required>
              <input type="date" aria-label="Date from" className={inputClass} value={periodStart} min={oldest} max={newest} disabled={!periods}
                onChange={(e) => pickDay(e.target.value)} />
            </Field>
            <Field label="Date to" required>
              <input type="date" aria-label="Date to" className={inputClass} value={period?.periodEnd ?? ''} min={oldest} max={newest} disabled={!periods}
                onChange={(e) => pickDay(e.target.value)} />
            </Field>
          </div>
        </div>
        <p className={`mt-2 text-sm ${shown?.recorded ? 'text-amber-800' : 'text-slate-600'}`}>
          {!periods ? 'Loading the periods…'
            : dayNote ? dayNote
            : shown ? `${showDate(shown.periodStart)} to ${showDate(shown.periodEnd)} · ${shown.recorded ? `already recorded as ${shown.recorded.number}: cancel it to redo it` : `${shown.employees} ${shown.employees === 1 ? 'person' : 'people'}`}`
            : 'Pick the first or last day of the period. Only periods that have ended can be paid.'}
        </p>
        {bookOn && <p className="mt-2 text-sm text-slate-600">Dated {bookOn}, the period's last day, so its pay is booked in that month.</p>}
        {canYearEnd && (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={yearEnd} onChange={(e) => setYearEnd(e.target.checked)} />
            <span>
              <b>Year-end tax adjustment</b> on this payroll: each employee's tax is the year's tax less what was withheld this year (pay before Virtus and a
              previous employer's included). An excess is refunded with net pay; a deficiency is withheld as far as the pay allows. Tick it on each employee's last payroll of the year.
            </span>
          </label>
        )}
        {canYearEnd && (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={unusedLeave} onChange={(e) => setUnusedLeave(e.target.checked)} />
            <span>
              <b>Pay unused leave</b> on this payroll: each employee's service incentive leave (SIL) days left this year are paid in cash at the daily rate, up to 10 days a year
              tax-free (de minimis). Paid days are used up. Someone who left gets theirs on their final pay without this.
            </span>
          </label>
        )}
      </Panel>

      <Panel title="Calculated pay">
        <p className="text-sm text-slate-600">Includes recorded attendance, salary or piece work, paid leave, holiday pay and premiums where applicable, plus the allowances and adjustments below. Open an employee's earnings to see the included items.</p>
        {!run && <p className="text-sm text-slate-500">{periodStart ? 'Working it out…' : 'Pick a period.'}</p>}
        {run && people.map((e) => (
          <section key={e.employeeId} aria-label={e.name} className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]">
              <h3 className="font-medium">{e.name}{e.final && <FinalBadge />}</h3>
              <div className="text-sm sm:text-right">Gross <b className="block tabular-nums">{peso(e.grossCents)}</b></div>
              <div className="text-sm sm:text-right">Deductions <b className="block tabular-nums">{peso(e.grossCents - e.netCents + (e.wtaxRefundCents ?? 0))}</b></div>
              <div className="text-sm sm:text-right">Net pay <b className="block tabular-nums">{peso(e.netCents)}</b></div>
            </div>
            {(e.wtaxRefundCents ?? 0) > 0 && <p className="text-sm">Includes tax refund: {peso(e.wtaxRefundCents!)}</p>}
            <PayDetails title="Earnings included">
              {e.lines.map((l) => <div key={l.lineNo} className="flex justify-between gap-3 text-sm"><span>{l.description} {qtyText(l.kind, l.qty)}</span><span className="tabular-nums">{peso(l.amountCents)}</span></div>)}
              {e.lines.length === 0 && <p className="text-sm">No earnings in this period.</p>}
              <p className="text-xs text-slate-600">Company shares: SSS {peso(e.sssErCents + e.sssEcCents)}, PhilHealth {peso(e.phicErCents)}, Pag-IBIG {peso(e.hdmfErCents)} · 13th month {peso(e.thirteenthCents)}</p>
            </PayDetails>
            <PayDetails title="Deductions and changes" active={!!advances[e.employeeId]?.trim() || (e.loans ?? []).some((l) => !!loanRows[l.loanId]?.amount.trim() || !!loanRows[l.loanId]?.reason.trim())}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm [&>dd]:text-right [&>dd]:tabular-nums">
                <dt>SSS employee share</dt><dd>{peso(e.sssEeCents)}</dd><dt>PhilHealth employee share</dt><dd>{peso(e.phicEeCents)}</dd><dt>Pag-IBIG employee share</dt><dd>{peso(e.hdmfEeCents)}</dd>
                <dt>Tax</dt><dd>{peso(e.wtaxCents)}</dd><dt>Government loans</dt><dd>{peso(e.loanCents ?? 0)}</dd><dt>Cash advance</dt><dd>{peso(e.caCents)}</dd>
              </dl>
              {e.yearEnd && <p className="text-sm">Year-end tax: {yearEndText(e)}</p>}
              <Field label="Cash-advance deduction" hint="Leave blank for the planned deduction; 0 skips it for this run.">
                <input aria-label={e.name + ' cash-advance deduction'} inputMode="decimal" placeholder={(e.caCents / 100).toFixed(2)} className={inputClass + ' text-right'}
                  value={advances[e.employeeId] ?? ''} onChange={(x) => setAdvances({ ...advances, [e.employeeId]: x.target.value })} />
              </Field>
              {(e.loans ?? []).map((l) => (
                <div key={l.loanId} className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{loanLabel(l)}: {peso(l.amountCents)}{l.amountCents < l.dueCents ? ` of ${peso(l.dueCents)} (the pay allows no more)` : ''}, {peso(l.balanceAfterCents)} left</span>
                  <input aria-label={`${loanLabel(l)} deduction`} inputMode="decimal" placeholder="Change (0 skips)" className="w-32 rounded border border-slate-300 px-1 text-right"
                    value={loanRows[l.loanId]?.amount ?? ''} onChange={(x) => setLoanRows({ ...loanRows, [l.loanId]: { reason: loanRows[l.loanId]?.reason ?? '', amount: x.target.value } })} />
                  <input aria-label={`${loanLabel(l)} note`} placeholder="Why" className="w-64 rounded border border-slate-300 px-1"
                    value={loanRows[l.loanId]?.reason ?? ''} onChange={(x) => setLoanRows({ ...loanRows, [l.loanId]: { amount: loanRows[l.loanId]?.amount ?? '', reason: x.target.value } })} />
                </div>
              ))}
            </PayDetails>
            {e.final && <p className="text-sm">{finalPayText(e)}. The whole cash advance is deducted as far as the pay allows.</p>}
            <Button onClick={() => setSkip({ ...skip, [e.employeeId]: '' })}>Leave out</Button>
          </section>
        ))}
        {live?.issues.map((i) => <Notice key={i.code + i.message} tone={i.level}>{i.message}</Notice>)}
      </Panel>

      {Object.keys(skip).length > 0 && (
        <Panel title="Left out of this run">
          {Object.entries(skip).map(([id, reason]) => (
            <div key={id} className="flex flex-wrap items-center gap-2">
              <span className="w-48 text-sm">{names[id] ?? 'Employee'}</span>
              <input aria-label="Why left out" placeholder="Why (their piece work stays for a later run)" className={inputClass} value={reason} onChange={(e) => setSkip({ ...skip, [id]: e.target.value })} />
              <Button onClick={() => setSkip(Object.fromEntries(Object.entries(skip).filter(([k]) => k !== id)))}>Put back</Button>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Allowances and adjustments">
        <PayDetails title="Add allowances or adjustments" active={rows.length > 0}>
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
              <Field label="Employee">
                <select aria-label="Employee" className={inputClass} value={r.employeeId} onChange={(e) => setRow(i, { employeeId: e.target.value })}>
                  <option value="">Employee</option>{Object.entries(names).filter(([id]) => !(id in skip)).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </Field>
              <Field label="Kind">
                <select aria-label="Kind" className={inputClass} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as ManualRow['kind'] })}><option value="allowance">Allowance</option><option value="adjustment">Adjustment</option></select>
              </Field>
              <Field label="Amount">
                <input aria-label="Amount" inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
              </Field>
              <Field label="What for">
                <input aria-label="What for" placeholder="What for" className={inputClass} value={r.reason} onChange={(e) => setRow(i, { reason: e.target.value })} />
              </Field>
              <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button onClick={() => setRows([...rows, emptyManual()])}>+ Add a line</Button>
        </PayDetails>
      </Panel>
      <Panel title="Review pay">
        <p className="text-sm">Allowances and adjustments included: <b className="tabular-nums">{peso((run?.employees ?? []).flatMap((e) => e.lines).filter((l) => l.kind === 'allowance' || l.kind === 'adjustment').reduce((sum, l) => sum + l.amountCents, 0))}</b></p>
        <p className="text-sm">Gross pay: {run ? peso(run.grossCents) : '—'} · Net pay: {run ? peso(run.netCents) : '—'}{!live && run && ' (previous calculation; updating…)'}</p>
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
