/**
 * Pieces the money-out forms share (supplier bill and payment, expense voucher, owner and officer money): the form frame
 * with the edit gate, the server's live figures and Record; the supplier and cash place pickers; today's EWT rates.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type CashPlace, type DocDetail, type DocHeader, type DocTypeInfo, type Preview, type SupplierRow } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { EditGate, Errors, Figures, useLive } from '../COL/parts.tsx';
import { ewtRates } from './payables.ts';

/** The state around a form's own fields; on an edit, `load` fills the fields from the recorded document. */
export function useMoneyForm(type: DocTypeInfo, mode: FormMode, load: (d: DocDetail) => void) {
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);
  useEffect(() => {
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => (load(d), setOriginal(d.header)), fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);
  return { original, reason, setReason, confirm, setConfirm, touched, setTouched, error, fail };
}
export type MoneyFormState = ReturnType<typeof useMoneyForm>;

/**
 * Title, the edit gate (reason first, NR-4), the form's fields, Record with the server's confirm dialog, and "So far":
 * the total, `figures` from the document the server worked out, the summary and the checks. `adjust` drops the checks
 * an edit's original causes (see forReplacement). The client sends only the input and the total the user confirmed.
 */
export function MoneyForm(p: {
  type: DocTypeInfo; f: MoneyFormState; title: string; input: unknown; errors: string[]; children: ReactNode;
  figures?: (doc: never) => [string, number, string?][]; adjust?: (preview: Preview, originalNumber: string) => Preview;
}) {
  const { type, f, input, errors } = p;
  const adjust = (r: Preview) => (f.original && p.adjust ? p.adjust(r, f.original.number) : r);
  const preview = () => api.preview(type.key, input).then(adjust);
  const live = useLive(JSON.stringify([input, f.original?.id]), errors.length === 0, preview);
  if (f.original && !f.reason) return <EditGate original={f.original} typeKey={type.key} onReason={f.setReason} />;

  const openConfirm = () => {
    f.setTouched(true);
    if (errors.length === 0) preview().then(f.setConfirm, f.fail);
  };
  const record = async (key: string) => {
    try {
      const r = f.original ? await api.reissue(type.key, f.original.id, input, f.confirm!.totalCents, f.reason, key) : await api.post(type.key, input, f.confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      // The server's total differs from what the user confirmed: show the new preview and ask again.
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') f.setConfirm(await preview());
      throw e;
    }
  };
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{f.original ? `Edit ${f.original.number}` : p.title}</h1>
        {f.original && <Notice tone="info">When you record, {f.original.number} is cancelled and the replacement gets a new number. Reason: {f.reason}</Notice>}
        {f.error && <Notice>{f.error}</Notice>}
        {p.children}
        <Errors list={errors} show={f.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-2xl font-semibold tabular-nums">{peso(live.totalCents)}</p> : <p className="text-sm text-slate-500">Fill in the required fields to see the total.</p>}
        {live && p.figures && <Figures items={p.figures(live.doc as never)} />}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {f.confirm && <RecordDialog type={type} preview={f.confirm} original={f.original} reason={f.reason} onRecord={record} onClose={() => f.setConfirm(null)} />}
    </form>
  );
}

/** Loads once: [] until the server answers (a picker then shows nothing to pick rather than failing the form). */
export function useList<T>(load: () => Promise<T[]>): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => void load().then(setRows, () => undefined), []);
  return rows;
}

/** Today's EWT rate of each class, for the pickers' words (null until loaded). */
export function useEwtRates(): Record<string, number> | null {
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  useEffect(() => void api.settings().then((s) => setRates(ewtRates(s)), () => undefined), []);
  return rates;
}

/** Active suppliers on file (PUR), by name, with what the bill or voucher takes from the record. */
export function SupplierSelect({ suppliers, value, onChange, label = 'Supplier' }: { suppliers: SupplierRow[]; value: string; onChange: (id: string) => void; label?: string }) {
  const s = suppliers.find((x) => x.id === value);
  return (
    <div className="space-y-1">
      <select aria-label={label} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick the supplier</option>
        {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      {s && (
        <p className="text-sm text-slate-600">
          {s.is_vat_registered ? 'VAT-registered' : 'Not VAT-registered'} · {s.tin ? `TIN ${s.tin}` : 'no TIN on file'}
          {s.payment_terms_days ? ` · pays in ${s.payment_terms_days} days` : ''}
        </p>
      )}
    </div>
  );
}

/** One big button per cash place (PLAN H2 "money questions"). */
export function PlacePicker({ places, value, onChange, question }: { places: CashPlace[]; value: string; onChange: (id: string) => void; question: string }) {
  return (
    <div role="radiogroup" aria-label={question} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {places.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === String(c.id)} onClick={() => onChange(String(c.id))}
          className={`rounded-lg p-2 text-left text-sm ring-1 ${value === String(c.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
          {c.name}
          {c.balanceCents !== null && <span className="block text-xs opacity-75">{peso(c.balanceCents)}</span>}
        </button>
      ))}
    </div>
  );
}
