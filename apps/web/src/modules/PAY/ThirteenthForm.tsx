/**
 * 13th-month pay form (PLAN D5 TH13-PAY, E11): pick the pay group and the year, and the server works out one twelfth of
 * each employee's basic pay from the recorded payroll runs, beside what the runs accrued. Staff may change an amount or
 * leave someone out, with a reason. Its net pay is then released like a payroll (POUT-). On separation it may be for one
 * separated employee alone, after their final pay.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type DocTypeInfo, type PayGroup, type PayThirteenthDoc, type Preview, type ThirteenthYears } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { Errors, useLive } from '../COL/parts.tsx';
import { GROUP_LABEL, thirteenthInput, type ChangedAmount } from './run.ts';
import { PayDetails, PayTotal, ThirteenthCalculation } from './entry.tsx';

export function ThirteenthForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [payGroup, setPayGroup] = useState<PayGroup>('SEMI_MONTHLY');
  const [years, setYears] = useState<ThirteenthYears | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<string, ChangedAmount>>({});
  const [skip, setSkip] = useState<Record<string, string>>({});
  const [one, setOne] = useState(''); // one separated employee alone
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => void api.thirteenthYears().then((y) => (setYears(y), setYear(y.years[0] ?? null)), (e: Error) => setError(e.message)), []);
  const recorded = one ? undefined : years?.recorded.find((r) => r.payGroup === payGroup && r.year === year);
  const { input, errors } = thirteenthInput(payGroup, year, amounts, skip, one);
  const live = useLive(JSON.stringify(input), !!year && !recorded && errors.length === 0, () => api.preview(type.key, input));
  const [last, setLast] = useState<PayThirteenthDoc | null>(null); // kept while a reason is being typed
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const doc = live?.doc as PayThirteenthDoc | undefined;
    if (!doc) return;
    setLast(doc);
    setNames((n) => ({ ...n, ...Object.fromEntries(doc.employees.map((e) => [e.employeeId, e.name])) }));
  }, [live]);
  useEffect(() => (setLast(null), setAmounts({}), setSkip({})), [payGroup, year, one]);
  useEffect(() => setOne(''), [payGroup, year]);

  if (mode.kind === 'edit') {
    return (
      <Notice tone="info">
        13th-month pay is corrected by cancelling it (its releases first) and working it out again. <Link to={docPath(type.key, `/${mode.id}`)} className="underline">Back to it</Link>
      </Notice>
    );
  }
  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input).then(setConfirm, (e: Error) => setError(e.message));
  };
  const record = async (key: string) => {
    try {
      const r = await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };
  const setAmount = (id: string, patch: Partial<ChangedAmount>) => setAmounts({ ...amounts, [id]: { amount: '', reason: '', ...amounts[id], ...patch } });
  const changed = Object.entries(amounts).filter(([id, a]) => a.amount.trim() && !(id in skip));

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
      <h1 className="text-2xl font-semibold">New 13th-month pay</h1>
      <PayTotal label="To pay now" total={!recorded && live ? last?.netCents : undefined}>{!recorded && last ? `${last.employees.length} employees${!live ? ' · Updating calculation…' : ''}` : ''}</PayTotal>
      {error && <Notice>{error}</Notice>}
      <Panel title="Which pay group and year?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pay group" required>
            <select className={inputClass} value={payGroup} onChange={(e) => setPayGroup(e.target.value as PayGroup)}>
              {Object.entries(GROUP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Year" required hint="Last year only early in January, for pay not made by 24 December.">
            <select className={inputClass} value={year ?? ''} onChange={(e) => setYear(Number(e.target.value) || null)}>
              {!years && <option value="">Loading…</option>}
              {years?.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
        </div>
        <Field label="For" hint="On separation, after the final pay: one employee who left, alone.">
          <select className={inputClass} value={one} onChange={(e) => setOne(e.target.value)}>
            <option value="">The whole pay group</option>
            {Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name} alone (separated)</option>)}
          </select>
        </Field>
        {recorded && (
          <Notice tone="info">
            <Link to={docPath(type.key, `/${recorded.id}`)} className="underline">{recorded.number}</Link> already pays this group's {year} 13th month. Cancel it first to redo it.
          </Notice>
        )}
      </Panel>

      <Panel title="To pay now">
        {!last && <p className="text-sm text-slate-500">{recorded ? 'Already recorded.' : 'Working it out…'}</p>}
        {last && !recorded && (
          <div className="space-y-3">
            {last.employees.map((e) => (
              <section key={e.employeeId} aria-label={e.name} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap justify-between gap-3"><h3 className="font-medium">{e.name}</h3><p className="font-semibold tabular-nums">To pay now: {peso(e.netCents)}</p></div>
                <p className="text-sm text-slate-600">Amount {peso(e.amountCents)} − tax {peso(e.wtaxCents)} = {peso(e.netCents)}</p>
                <ThirteenthCalculation employee={e} />
                <PayDetails title="Change this amount" active={!!amounts[e.employeeId]?.amount.trim() || !!amounts[e.employeeId]?.reason.trim()}>
                  <Field label="13th-month amount" hint="Leave blank for one twelfth of basic pay. A changed amount needs a reason below.">
                    <input aria-label={e.name + ' 13th-month amount'} inputMode="decimal" placeholder={(e.dueCents / 100).toFixed(2)} className={inputClass + ' text-right'}
                      value={amounts[e.employeeId]?.amount ?? ''} onChange={(x) => setAmount(e.employeeId, { amount: x.target.value })} />
                  </Field>
                </PayDetails>
                <Button onClick={() => setSkip({ ...skip, [e.employeeId]: '' })}>Leave out</Button>
              </section>
            ))}
            <p className="mt-2 text-xs text-slate-600">
              Basic pay counts days worked, paid leave, salary less absences and piece work; not holiday pay, premiums, overtime or allowances. Tax is withheld only on the part of the year's
              13th-month pay above ₱90,000. The difference between what is paid and what was accrued goes to 13th month and benefits.
            </p>
          </div>
        )}
        {!recorded && live?.issues.map((i) => <Notice key={i.code + i.message} tone={i.level}>{i.message}</Notice>)}
      </Panel>

      {changed.length > 0 && (
        <Panel title="Changed amounts">
          {changed.map(([id, a]) => (
            <div key={id} className="flex flex-wrap items-center gap-2">
              <span className="w-48 text-sm">{names[id] ?? 'Employee'} · {a.amount}</span>
              <input aria-label="Why changed" placeholder="Why the amount is changed" className={inputClass} value={a.reason} onChange={(e) => setAmount(id, { reason: e.target.value })} />
              <Button onClick={() => setAmounts(Object.fromEntries(Object.entries(amounts).filter(([k]) => k !== id)))}>Use one twelfth</Button>
            </div>
          ))}
        </Panel>
      )}

      {Object.keys(skip).length > 0 && (
        <Panel title="Left out">
          {Object.entries(skip).map(([id, reason]) => (
            <div key={id} className="flex flex-wrap items-center gap-2">
              <span className="w-48 text-sm">{names[id] ?? 'Employee'}</span>
              <input aria-label="Why left out" placeholder="Why (their runs stay for a later 13th-month pay)" className={inputClass} value={reason} onChange={(e) => setSkip({ ...skip, [id]: e.target.value })} />
              <Button onClick={() => setSkip(Object.fromEntries(Object.entries(skip).filter(([k]) => k !== id)))}>Put back</Button>
            </div>
          ))}
        </Panel>
      )}

      <Errors list={errors} show={touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost || !!recorded} onClick={openConfirm}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} reason="" onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
