/**
 * The two things done from the fixed-asset screens: the month's depreciation run, and taking an asset off the books
 * (retired, or sold on a booklet invoice). Each shows the server's own preview and plain summary first, then records it
 * (PLAN H2 "Record"); a sale also shows the book value, the gain or loss and "write these on the booklet" (D4.4).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, newIdempotencyKey, type CashPlace, type DepreciationGaps, type Preview } from '../../api.ts';
import { Button, CashPlaceButtons, Dialog, Field, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';
import { CustomerPicker, Figures } from '../COL/parts.tsx';
import { monthLabel } from '../TAX/bir.ts';
import { defaultRunMonth, disposalInput, runDate } from './register.ts';
import { emptySale, gainOrLoss, saleBooklet, saleInput, type DisposalDoc, type SaleValues } from './sale.ts';

/** Previews `input` on the server as it changes, and records it with one idempotency key per confirmed input. */
function RecordDialog(p: {
  title: string; type: string; input: unknown; ready: boolean; businessDate?: string; confirmLabel: string; onDone: () => void; onClose: () => void; children: ReactNode;
  /** What the preview's figures add under the form (a sale's book value and booklet). */
  shown?: (doc: unknown) => ReactNode;
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
  const warnings = (preview?.issues ?? []).filter((i) => i.level === 'warning');
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      {p.children}
      {problem && <Notice>{problem}</Notice>}
      {errors.map((i, n) => <Notice key={n}>{i.message}</Notice>)}
      {preview && errors.length === 0 && p.shown?.(preview.doc)}
      {warnings.map((i, n) => <Notice key={n} tone="warning">{i.message}</Notice>)}
      {preview && errors.length === 0 && <Notice tone="info">{preview.summary}</Notice>}
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

/** The buyer, the booklet invoice and where the money went, for a sale. */
export function SaleFields({ v, set, places }: { v: SaleValues; set: (patch: Partial<SaleValues>) => void; places: CashPlace[] }) {
  return (
    <>
      <Field label="Invoice number (from the booklet)" required hint="The invoice written for this sale; a number is used once, ever.">
        <input inputMode="numeric" aria-label="Invoice number (from the booklet)" className={`${inputClass} max-w-40`} value={v.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} />
      </Field>
      <Field label="Price, VAT included" required hint="Paid in full now; a bank transfer counts.">
        <input inputMode="decimal" aria-label="Price, VAT included" placeholder="0.00" className={`${inputClass} max-w-48 text-right tabular-nums`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
      </Field>
      <CashPlaceButtons label="Where did the buyer's money go?" places={places} value={v.cashPlaceId} onChange={(id) => set({ cashPlaceId: id })} />
      <Field label="Buyer" required hint={v.customer ? undefined : 'Pick a customer, or type the buyer below.'}>
        <CustomerPicker value={v.customer} onChange={(c) => set({ customer: c })} />
      </Field>
      {!v.customer && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buyer's name"><input aria-label="Buyer's name" className={inputClass} value={v.buyerName} onChange={(e) => set({ buyerName: e.target.value })} /></Field>
          <Field label="Buyer's TIN"><input aria-label="Buyer's TIN" placeholder="123-456-789-000" className={inputClass} value={v.buyerTin} onChange={(e) => set({ buyerTin: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Buyer's address"><input aria-label="Buyer's address" className={inputClass} value={v.buyerAddress} onChange={(e) => set({ buyerAddress: e.target.value })} /></Field>
    </>
  );
}

/** A sale's figures before saving: book value and the gain or loss, and what to write on the booklet. */
export function SaleFigures({ doc }: { doc: DisposalDoc }) {
  const g = gainOrLoss(doc);
  return (
    <>
      <Panel title="Book value and gain or loss">
        <Figures items={g.figures} />
        <p className="text-sm text-slate-600">{g.words}</p>
      </Panel>
      <Panel title="Write these on the booklet"><Figures items={saleBooklet(doc)} /></Panel>
    </>
  );
}

/** Retired (nothing received: the book value left is a loss) or sold on a booklet invoice, paid in full now. */
export function DisposeAsset({ assetId, label, onDone, onClose, initialKind = 'retirement' }: {
  assetId: string; label: string; onDone: () => void; onClose: () => void; initialKind?: 'retirement' | 'sale';
}) {
  const [kind, setKind] = useState(initialKind);
  const [reason, setReason] = useState('');
  const [sale, setSale] = useState<SaleValues>(emptySale);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  useEffect(() => void api.cashPlaces().then(setPlaces, () => setPlaces([])), []);
  const { input, errors } = kind === 'sale' ? saleInput(assetId, reason, sale) : disposalInput(assetId, reason);
  return (
    <RecordDialog title={`Take ${label} off the books`} type="fa.disposal" input={input} ready={errors.length === 0} confirmLabel="Record the disposal" onDone={onDone} onClose={onClose}
      shown={(doc) => (kind === 'sale' && doc ? <SaleFigures doc={doc as DisposalDoc} /> : null)}>
      <div role="radiogroup" aria-label="What happened to it?" className="flex gap-2">
        {([['retirement', 'Retired'], ['sale', 'Sold']] as const).map(([k, words]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-lg px-3 py-2 text-sm ring-1 ${kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{words}</button>
        ))}
      </div>
      <p className="text-sm text-slate-700">
        {kind === 'sale' ? 'Record the sale from the invoice written for it. ' : 'Nothing is received for it: the book value left is charged as a loss. '}
        Run the month’s depreciation first, so the book value is up to date.
      </p>
      <Field label="Why is it being taken off?" required>
        <textarea autoFocus rows={2} aria-label="Why is it being taken off?" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {kind === 'sale' && <SaleFields v={sale} set={(patch) => setSale({ ...sale, ...patch })} places={places} />}
      {errors.length > 0 && (reason || kind === 'sale') && <p className="text-sm text-slate-500">{errors[0]}</p>}
    </RecordDialog>
  );
}
