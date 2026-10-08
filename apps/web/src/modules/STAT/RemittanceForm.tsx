/**
 * Remittance form (PLAN D5 STAT-REM, E11): what is paid (SSS, PhilHealth, Pag-IBIG or the 1601-C tax), for which
 * month, from where, how much and the PRN or reference. The screen shows what the month's payrolls left payable, and
 * the server's variance check (less is a partial payment; more is refused). A late-payment penalty is paid on top and
 * never counts toward the payable. Opened from the remittance check with the scheme, month and amount filled in.
 * Someone who may backdate (acc.backdate) also gives the date paid, when the payment is recorded days later (STAT-1).
 * The withholding tax is paid net of year-end tax refunds (K23): the screen says so, and what is left is the net.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type CashPlace, type DocTypeInfo, type Me, type Preview, type SchemeCheck } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { Errors, useLive } from '../COL/parts.tsx';
import { SCHEME_LABEL, SCHEME_LIST, isMonth, paidOn, remittanceInput, type RemittanceValues } from './stat.ts';

export function RemittanceForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const q = new URLSearchParams(location.search);
  const [v, setV] = useState<RemittanceValues>({ scheme: q.get('scheme') ?? '', month: q.get('month') ?? '', cashPlaceId: '', amount: q.get('amount') ?? '', penalty: '', reference: '', note: '' });
  const [paidOnText, setPaidOnText] = useState('');
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [check, setCheck] = useState<SchemeCheck | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);
  useEffect(() => void api.cashPlaces().then(setPlaces, fail), []);
  useEffect(() => {
    setCheck(null);
    if (isMonth(v.month) && v.scheme) api.statMonth(v.month).then((m) => setCheck(m.check.find((c) => c.scheme === v.scheme) ?? null), () => undefined);
  }, [v.month, v.scheme]);

  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const date = mayBackdate ? paidOn(paidOnText) : {};
  const typed = remittanceInput(v);
  const { input } = typed;
  const errors = date.error ? [...typed.errors, date.error] : typed.errors;
  const live = useLive(JSON.stringify([input, date.businessDate]), errors.length === 0, () => api.preview(type.key, input, date.businessDate));
  if (mode.kind === 'edit') {
    return <Notice tone="info">A remittance is corrected by cancelling it and recording it again. <Link to={docPath(type.key, `/${mode.id}`)} className="underline">Back to the remittance</Link></Notice>;
  }
  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input, date.businessDate).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = await api.post(type.key, input, confirm!.totalCents, key, date.businessDate);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input, date.businessDate));
      throw e;
    }
  };
  const set = (patch: Partial<RemittanceValues>) => setV({ ...v, ...patch });

  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">New remittance</h1>
      {error && <Notice>{error}</Notice>}
      <Panel title="What is paid?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paid to" required>
            <select className={inputClass} value={v.scheme} onChange={(e) => set({ scheme: e.target.value })}>
              <option value="">Pick one</option>
              {SCHEME_LIST.map((s) => <option key={s} value={s}>{SCHEME_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="For the month" required hint="The payroll month, like 2026-09">
            <input className={inputClass} placeholder="2026-09" value={v.month} onChange={(e) => set({ month: e.target.value.trim() })} />
          </Field>
        </div>
        {check && (
          <p className="text-sm text-slate-600">
            The payrolls of {v.month} recorded {peso(check.recordedCents)}{check.refundCents > 0 && `, after ${peso(check.refundCents)} of year-end tax refunds`}; {peso(check.remittedCents)} is remitted
            {check.carriedInCents > 0 && `, and ${peso(check.carriedInCents)} of year-end tax refunds of ${check.carriedFrom.join(', ')} come off this payment`}, so {peso(check.dueCents)} is left to pay.
            {check.carriedOutCents > 0 && ` The refunds are ${peso(check.carriedOutCents)} more than the month's tax: that comes off the next month's payment.`}
            {check.dueCents > 0 && v.amount === '' && <> <button type="button" className="underline" onClick={() => set({ amount: (check.dueCents / 100).toFixed(2) })}>Pay all of it</button></>}
          </p>
        )}
      </Panel>
      <Panel title="Where did the money come from?">
        <div role="radiogroup" aria-label="Where did the money come from?" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {places.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={v.cashPlaceId === String(c.id)} onClick={() => set({ cashPlaceId: String(c.id) })}
              className={`rounded-lg p-2 text-left text-sm ring-1 ${v.cashPlaceId === String(c.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{c.name}</button>
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount paid" required hint="For the month's contributions or tax"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Late-payment penalty" hint="Paid on top, if any"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.penalty} onChange={(e) => set({ penalty: e.target.value })} /></Field>
        <Field label="PRN, reference or receipt no." required><input className={inputClass} value={v.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
      </div>
      {mayBackdate && (
        <Field label="Date paid" hint="Leave empty for today. If the payment is recorded later, give the day the money left.">
          <input type="date" className={inputClass} value={paidOnText} onChange={(e) => setPaidOnText(e.target.value)} />
        </Field>
      )}
      <Field label="Note"><input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      {live && <p className="text-sm">{live.summary}{date.businessDate && ` Dated ${showDate(date.businessDate)}, the day paid.`}</p>}
      {live?.issues.map((i) => <Notice key={i.code} tone={i.level}>{i.message}</Notice>)}
      <Errors list={errors} show={touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} reason="" onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
