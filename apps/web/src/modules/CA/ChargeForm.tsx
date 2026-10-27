/**
 * Damage or loss charge form (the owner's request, Oct 2026; CA ca.charge): who is charged, for what (and the job order),
 * the amount and the deduction per payroll, and the employee's side, heard before charging (Labor Code Art. 113-114).
 * Payroll takes it back after tax and contributions, never more than 20% of the pay of a payroll. Also its Edit.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type ActiveEmployee, type DocHeader, type DocTypeInfo, type Preview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { cents } from '../COL/money.ts';
import { EditGate, Errors, useLive } from '../COL/parts.tsx';
import { SearchSelect } from '../../components/SearchSelect.tsx';

type Stored = { employeeId: string; what: string; jobOrderId?: string; amountCents: number; installmentCents: number; explanation: string; note?: string };
const text = (c: number) => (c / 100).toFixed(2);

export function ChargeForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [people, setPeople] = useState<ActiveEmployee[]>([]);
  const [jobs, setJobs] = useState<DocHeader[]>([]);
  const [v, setV] = useState({ employeeId: '', what: '', jobOrderId: '', amount: '', installment: '', explanation: '', note: '' });
  const [original, setOriginal] = useState<DocHeader>();
  const [editReason, setEditReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  useEffect(() => {
    api.activeEmployees().then(setPeople, fail);
    api.list('jo.job_order', { status: 'posted', limit: 50 }).then(setJobs, () => undefined);
    if (mode.kind !== 'edit') return;
    api.get(type.key, mode.id).then((d) => {
      const s = d.input as Stored;
      setOriginal(d.header);
      setV({ employeeId: s.employeeId, what: s.what, jobOrderId: s.jobOrderId ?? '', amount: text(s.amountCents), installment: text(s.installmentCents), explanation: s.explanation, note: s.note ?? '' });
    }, fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  const amount = cents(v.amount);
  const installment = cents(v.installment);
  const errors = [
    ...(v.employeeId ? [] : ['Pick who is charged.']),
    ...(v.what.trim().length >= 3 ? [] : ['Say what was damaged or lost.']),
    ...(amount && amount > 0 ? [] : ['Type the amount, no more than the actual loss, like 1,500.00']),
    ...(installment && installment > 0 ? [] : ['Type the deduction per payroll, like 500.00']),
    ...(v.explanation.trim().length >= 10 ? [] : ["Write the employee's side (at least 10 characters): they are heard before being charged."]),
  ];
  const input = {
    employeeId: v.employeeId, what: v.what.trim(), ...(v.jobOrderId ? { jobOrderId: v.jobOrderId } : {}), amountCents: amount ?? 0, installmentCents: installment ?? 0,
    explanation: v.explanation.trim(), ...(v.note.trim() ? { note: v.note.trim() } : {}),
  };
  const live = useLive(JSON.stringify(input), errors.length === 0, () => api.preview(type.key, input));
  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, editReason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };

  if (original && !editReason) return <EditGate original={original} typeKey={type.key} onReason={setEditReason} />;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'New damage or loss charge'}</h1>
      {error && <Notice>{error}</Notice>}
      <Notice tone="info">Charge an employee only when they are clearly responsible, after hearing their side, and for no more than the actual loss. Each payroll takes back the amount below, but never more than 20% of that payroll&apos;s pay; the rest waits for the next one.</Notice>
      <Panel title="Who is charged, and for what?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" required>
            <SearchSelect aria-label="Employee" value={v.employeeId} onChange={(id) => setV({ ...v, employeeId: id })} placeholder="Pick the employee" choices={people.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} />
          </Field>
          <Field label="Job order" hint="The job it happened on, if any">
            <SearchSelect aria-label="Job order" value={v.jobOrderId} onChange={(id) => setV({ ...v, jobOrderId: id })} emptyLabel="None" choices={jobs.map((j) => ({ value: j.id, label: j.number }))} />
          </Field>
        </div>
        <Field label="What was damaged or lost" required><input className={inputClass} maxLength={200} value={v.what} onChange={(e) => setV({ ...v, what: e.target.value })} placeholder="e.g. 3 yards of jersey cloth cut on the wrong side" /></Field>
        <Field label="The employee's side" required hint="What they said when asked; kept with the charge">
          <textarea rows={3} className={inputClass} maxLength={1000} value={v.explanation} onChange={(e) => setV({ ...v, explanation: e.target.value })} />
        </Field>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount charged" required hint="No more than the actual loss"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Deducted each payroll" required hint="At most 20% of a payroll's pay is taken"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.installment} onChange={(e) => setV({ ...v, installment: e.target.value })} /></Field>
      </div>
      <Field label="Note"><input className={inputClass} maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      {live && <p className="text-sm">{live.summary}</p>}
      {live?.issues.filter((i) => i.code !== 'FAIR_AMOUNT').map((i) => <Notice key={i.code} tone={i.level}>{i.message}</Notice>)}
      <Errors list={errors} show={touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={editReason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
