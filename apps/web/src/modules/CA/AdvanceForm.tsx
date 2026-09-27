/**
 * Cash advance form (PLAN D5 CA-GIVE, E11): who gets the advance ("bale"), what they already owe, where the money came
 * from, the amount and the deduction per payroll. Also its Edit (cancel and reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type ActiveEmployee, type CaStatus, type CashPlace, type DocHeader, type DocTypeInfo, type Preview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { cents } from '../COL/money.ts';
import { EditGate, Errors, useLive } from '../COL/parts.tsx';

type Stored = { employeeId: string; cashPlaceId: number; amountCents: number; installmentCents: number; note?: string };
const text = (c: number) => (c / 100).toFixed(2);

export function AdvanceForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [people, setPeople] = useState<ActiveEmployee[]>([]);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [v, setV] = useState({ employeeId: '', cashPlaceId: '', amount: '', installment: '', note: '' });
  const [owed, setOwed] = useState<CaStatus | null>(null);
  const [original, setOriginal] = useState<DocHeader>();
  const [editReason, setEditReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  useEffect(() => {
    api.activeEmployees().then(setPeople, fail);
    api.cashPlaces().then(setPlaces, fail);
    if (mode.kind !== 'edit') return;
    api.get(type.key, mode.id).then((d) => {
      const s = d.input as Stored;
      setOriginal(d.header);
      setV({ employeeId: s.employeeId, cashPlaceId: String(s.cashPlaceId), amount: text(s.amountCents), installment: text(s.installmentCents), note: s.note ?? '' });
    }, fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);
  useEffect(() => {
    setOwed(null);
    if (v.employeeId) api.caStatus(v.employeeId).then(setOwed, () => undefined);
  }, [v.employeeId]);

  const amount = cents(v.amount);
  const installment = cents(v.installment);
  const errors = [
    ...(v.employeeId ? [] : ['Pick who gets the advance.']),
    ...(v.cashPlaceId ? [] : ['Pick where the money came from.']),
    ...(amount && amount > 0 ? [] : ['Type the amount, like 2,000.00']),
    ...(installment && installment > 0 ? [] : ['Type the deduction per payroll, like 500.00']),
  ];
  const input = { employeeId: v.employeeId, cashPlaceId: Number(v.cashPlaceId), amountCents: amount ?? 0, installmentCents: installment ?? 0, ...(v.note.trim() ? { note: v.note.trim() } : {}) };
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
      <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'New cash advance'}</h1>
      {error && <Notice>{error}</Notice>}
      <Panel title="Who gets it?">
        <select aria-label="Employee" className={inputClass} value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })}>
          <option value="">Pick the employee</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
        </select>
        {owed && <p className="text-sm text-slate-600">Owes {peso(owed.outstandingCents)} now{owed.installmentCents ? `, ${peso(owed.installmentCents)} deducted each payroll` : ''}.</p>}
      </Panel>
      <Panel title="Where did the money come from?">
        <div role="radiogroup" aria-label="Where did the money come from?" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {places.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={v.cashPlaceId === String(c.id)} onClick={() => setV({ ...v, cashPlaceId: String(c.id) })}
              className={`rounded-lg p-2 text-left text-sm ring-1 ${v.cashPlaceId === String(c.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{c.name}</button>
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Deducted each payroll" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.installment} onChange={(e) => setV({ ...v, installment: e.target.value })} /></Field>
      </div>
      <Field label="Note"><input className={inputClass} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      {live && <p className="text-sm">{live.summary}</p>}
      {live?.issues.map((i) => <Notice key={i.code} tone={i.level}>{i.message}</Notice>)}
      <Errors list={errors} show={touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={editReason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
