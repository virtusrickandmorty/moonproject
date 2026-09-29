/**
 * The two things done from the fixed-asset screens: the month's depreciation run, and taking an asset off the books
 * (retired, or sold on a booklet invoice). Each shows the server's own preview and plain summary first, then records
 * it (PLAN H2 "Record").
 */
import { useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey, type CashPlace, type DepreciationGaps, type Preview } from '../../api.ts';
import { Button, CashPlaceButtons, Dialog, Field, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';
import { CustomerPicker, Figures } from '../COL/parts.tsx';
import { monthLabel } from '../TAX/bir.ts';
import { defaultRunMonth, disposalFigures, disposalInput, emptySale, runDate, saleInput, type DisposalFigures, type SaleValues } from './register.ts';

/** Previews `input` on the server as it changes, and records it with one idempotency key per confirmed input. */
function RecordDialog(p: {
  title: string; type: string; input: unknown; ready: boolean; businessDate?: string; confirmLabel: string; onDone: () => void; onClose: () => void; children: React.ReactNode;
  /** What to show of the preview above its summary (the disposal's book value and booklet figures). */
  shown?: (preview: Preview) => React.ReactNode;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState('');
  const a = useAction();
  const json = JSON.stringify([p.input, p.businessDate]);
  const key = useMemo(() => newIdempotencyKey(), [json]);
  useEffect(() => {
    setPreview(null);
    setProblem('');
    if (!p.ready) return;
    let stale = false;
    void api.preview(p.type, p.input, p.businessDate).then((r) => stale || setPreview(r), (e: Error) => stale || setProblem(e.message));
    return () => void (stale = true);
  }, [json, p.ready]);
  const errors = (preview?.issues ?? []).filter((i) => i.level === 'error');
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      {p.children}
      {problem && <Notice>{problem}</Notice>}
      {errors.map((i, n) => <Notice key={n}>{i.message}</Notice>)}
      {preview && errors.length === 0 && p.shown?.(preview)}
      {preview && errors.length === 0 && <Notice tone="info">{preview.summary}</Notice>}
      {(preview?.issues ?? []).filter((i) => i.level === 'warning').map((i, n) => <Notice key={`w${n}`} tone="warning">{i.message}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={p.onClose}>Go back</Button>
        <Button tone="primary" disabled={!preview || errors.length > 0 || a.busy} onClick={() => a.run(async () => { await api.post(p.type, p.input, preview!.totalCents, key, p.businessDate); p.onDone(); })}>{p.confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

/** The depreciation run for one month: offers the first month still to run and any month up to this one. */
export function DepreciationRun({ gaps, onDone, onClose }: { gaps: DepreciationGaps; onDone: () => void; onClose: () => void }) {
  const [month, setMonth] = useState(defaultRunMonth(gaps));
  const choices = [...new Set([...gaps.months, gaps.thisMonth])].sort();
  return (
    <RecordDialog title="Run depreciation" type="fa.depreciation" input={{ month }} ready={/^\d{4}-\d{2}$/.test(month)} businessDate={runDate(month, gaps.thisMonth)} confirmLabel="Record the run" onDone={onDone} onClose={onClose}>
      <Field label="Month to depreciate" hint={gaps.lastRunMonth ? `The latest run so far is ${monthLabel(gaps.lastRunMonth)}. Runs go month by month.` : 'No run has been recorded yet.'}>
        <select aria-label="Month to depreciate" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)}>
          {choices.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === gaps.thisMonth ? ' (this month)' : ''}</option>)}
        </select>
      </Field>
    </RecordDialog>
  );
}

/** Book value, gain or loss, and for a sale "write these on the booklet", from the server's figures. */
export function DisposalShown({ doc }: { doc: DisposalFigures }) {
  const f = disposalFigures(doc);
  return (
    <>
      <Figures items={f.result} />
      {f.booklet && <Panel title="Write these on the booklet"><Figures items={f.booklet.map(([l, c], i): [string, number, string?] => [l, c, i === 2 ? 'font-semibold' : undefined])} /></Panel>}
    </>
  );
}

/** The sale's fields: the buyer (a customer, or typed), the booklet invoice number, the price and where it was paid. */
export function SaleFields({ v, set, places }: { v: SaleValues; set: (patch: Partial<SaleValues>) => void; places: CashPlace[] }) {
  const typed = (k: 'buyerName' | 'buyerAddress' | 'buyerTin', label: string, hint?: string) => (
    <Field label={label} required hint={hint}><input aria-label={label} className={inputClass} value={v[k]} onChange={(e) => set({ [k]: e.target.value })} /></Field>
  );
  return (
    <>
      <div role="radiogroup" aria-label="Who bought it?" className="flex gap-2">
        {([['customer', 'A customer on file'], ['typed', 'Type the buyer']] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={v.buyer === k} onClick={() => set({ buyer: k })}
            className={`rounded-full px-3 py-1 text-sm ring-1 ${v.buyer === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>{label}</button>
        ))}
      </div>
      {v.buyer === 'customer' ? <Field label="Buyer" required><CustomerPicker value={v.customer} onChange={(customer) => set({ customer })} /></Field> : (
        <>
          {typed('buyerName', 'Buyer’s name', 'As it goes on the invoice')}
          {typed('buyerAddress', 'Buyer’s address')}
          {typed('buyerTin', 'Buyer’s TIN', 'e.g. 123-456-789-000')}
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number (from the booklet)" required hint="Write the sale on the next invoice of the booklet.">
          <input aria-label="Invoice number (from the booklet)" inputMode="numeric" className={inputClass} value={v.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} />
        </Field>
        <Field label="Price (VAT included)" required>
          <input aria-label="Price (VAT included)" inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.price} onChange={(e) => set({ price: e.target.value })} />
        </Field>
      </div>
      <CashPlaceButtons label="Where did the buyer pay? (paid in full; a bank transfer counts)" places={places} value={v.cashPlaceId} onChange={(cashPlaceId) => set({ cashPlaceId })} />
    </>
  );
}

/**
 * Taking an asset off the books: retired (nothing received, the book value is a loss) or sold (the booklet invoice,
 * paid in full on the spot). The dialog shows the book value and the gain or loss before saving; a sale also shows what
 * to write on the booklet.
 */
export function DisposeAsset({ assetId, label, onDone, onClose, initial }: { assetId: string; label: string; onDone: () => void; onClose: () => void; initial?: { kind: 'retirement' | 'sale'; sale?: SaleValues } }) {
  const [kind, setKind] = useState<'retirement' | 'sale'>(initial?.kind ?? 'retirement');
  const [reason, setReason] = useState(initial?.sale?.reason ?? '');
  const [v, setV] = useState<SaleValues>(initial?.sale ?? emptySale());
  const [places, setPlaces] = useState<CashPlace[]>([]);
  useEffect(() => void api.cashPlaces().then(setPlaces, () => undefined), []);
  const { input, errors } = kind === 'sale' ? saleInput(assetId, { ...v, reason }) : disposalInput(assetId, reason);
  return (
    <RecordDialog title={`Take ${label} off the books`} type="fa.disposal" input={input} ready={errors.length === 0} confirmLabel={kind === 'sale' ? 'Record the sale' : 'Record the disposal'}
      onDone={onDone} onClose={onClose} shown={(p) => (p.doc ? <DisposalShown doc={p.doc as DisposalFigures} /> : null)}>
      <div role="radiogroup" aria-label="What happened to it?" className="flex gap-2">
        {([['retirement', 'Retired'], ['sale', 'Sold']] as const).map(([k, word]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-sm ring-1 ${kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>{word}</button>
        ))}
      </div>
      <p className="text-sm text-slate-700">
        {kind === 'sale'
          ? 'Run the month’s depreciation first: the gain or loss is the price less its VAT, less the book value on the day.'
          : 'Retired means nothing was received for it. Run the month’s depreciation first: the book value left is charged as a loss.'}
      </p>
      <Field label={kind === 'sale' ? 'Why was it sold?' : 'Why is it being taken off?'} required>
        <textarea autoFocus rows={2} aria-label="Why is it being taken off?" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {kind === 'sale' && <SaleFields v={v} set={(patch) => setV({ ...v, ...patch })} places={places} />}
      {errors.length > 0 && <ul className="list-disc pl-5 text-sm text-slate-600">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </RecordDialog>
  );
}
