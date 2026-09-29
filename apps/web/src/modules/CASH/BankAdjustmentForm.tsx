/**
 * Bank adjustment form (PLAN D5 BANK-ADJ, E10): a bank charge or interest the bank did that the books do not have yet.
 * Opened from a bank reconciliation with the bank filled in (?bank=&recon=&date=), it goes back there once recorded.
 * Someone who may backdate (acc.backdate) also gives the date on the statement (CASH-1).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, type CashAccount, type DocHeader, type DocTypeInfo, type Me, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, CashPlaceButtons, inputClass } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { EditGate, Errors, useLive } from '../COL/parts.tsx';
import { KIND_HELP, KIND_LABEL, adjustmentInput, emptyAdjustment, isKind, statementDay, type AdjustmentValues } from './adjustment.ts';

type Stored = { cashPlaceId: number; kind: string; amountCents: number; description: string; note?: string };

export function BankAdjustmentForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const q = new URLSearchParams(location.search);
  const recon = mode.kind === 'new' ? q.get('recon') : null;
  const [v, setV] = useState<AdjustmentValues>({ ...emptyAdjustment(), placeId: mode.kind === 'new' ? q.get('bank') ?? '' : '' });
  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const [dayText, setDayText] = useState(mode.kind === 'new' ? q.get('date') ?? '' : '');
  const [banks, setBanks] = useState<CashAccount[]>([]);
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);
  const set = (patch: Partial<AdjustmentValues>) => setV((old) => ({ ...old, ...patch }));

  useEffect(() => {
    api.cashAccounts().then((all) => setBanks(all.filter((p) => p.kind === 'bank' && p.isActive)), fail);
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      const saved = d.input as Stored;
      setOriginal(d.header);
      setV({ placeId: String(saved.cashPlaceId), kind: saved.kind, amount: formatPesos(saved.amountCents), description: saved.description, note: saved.note ?? '' });
    }, fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  // Only someone who may backdate gives a date; an edit is dated today, like any reissue.
  const day = mayBackdate && mode.kind === 'new' ? statementDay(dayText) : {};
  const typed = adjustmentInput(v);
  const errors = day.error ? [...typed.errors, day.error] : typed.errors;
  const { input } = typed;
  const live = useLive(JSON.stringify([input, day.businessDate]), errors.length === 0, () => api.preview(type.key, input, day.businessDate));

  const back = (r: { id: string; number: string }) => navigate(recon ? `/cash/recon/${recon}?recorded=${encodeURIComponent(r.number)}` : docPath(type.key, `/${r.id}?recorded=1`));
  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input, day.businessDate).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      back(original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key) : await api.post(type.key, input, confirm!.totalCents, key, day.businessDate));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input, day.businessDate));
      throw e;
    }
  };
  if (original && !reason) return <EditGate original={original} typeKey={type.key} onReason={setReason} />;

  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : `New ${type.title}`}</h1>
      {original && <Notice tone="info">{original.number} will be cancelled when you record its replacement. Reason: {reason}</Notice>}
      {error && <Notice>{error}</Notice>}
      <Panel title="Which bank account?">
        <CashPlaceButtons label="Bank account" places={banks} value={v.placeId} onChange={(placeId) => set({ placeId })} />
        {banks.length === 0 && <Notice tone="info">No bank account is set up. Add one under Cash Accounts.</Notice>}
      </Panel>
      <Panel title="What did the bank do?">
        <div role="radiogroup" aria-label="What did the bank do?" className="grid gap-2 sm:grid-cols-2">
          {(['charge', 'interest'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={v.kind === k} onClick={() => set({ kind: k })}
              className={`rounded-lg p-3 text-left text-sm ring-1 ${v.kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
              {KIND_LABEL[k]}<span className="block text-xs opacity-75">{KIND_HELP[k]}</span>
            </button>
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={isKind(v.kind) && v.kind === 'interest' ? 'Interest before final tax' : 'Amount'} required hint="As the statement shows it">
          <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
        </Field>
        <Field label="What the bank called it" required><input className={inputClass} placeholder="Service charge" value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      </div>
      {mayBackdate && mode.kind === 'new' && (
        <Field label="Date on the statement" hint="Leave empty for today. A charge or interest seen only on next month's statement is dated the day on its own statement.">
          <input type="date" className={inputClass} value={dayText} onChange={(e) => setDayText(e.target.value)} />
        </Field>
      )}
      <Field label="Note"><textarea className={inputClass} rows={2} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      {live && <p className="text-sm">{live.summary}{day.businessDate && ` Dated ${day.businessDate}.`}</p>}
      {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      <Errors list={errors} show={touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
        <Button onClick={() => (recon ? navigate(`/cash/recon/${recon}`) : history.back())}>Back</Button>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
