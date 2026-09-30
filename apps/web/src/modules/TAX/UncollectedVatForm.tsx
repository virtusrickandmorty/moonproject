/**
 * Output VAT on uncollected receivables (EOPT, RMC 65-2024; PLAN E12, K ACC-27), accountant only.
 *   Claim (tax.uncollected_vat): pick an invoice whose agreed time to pay ended in an earlier quarter, confirm the four
 *   requisites the books cannot check, and read the server's preview (the requisites it checks) before recording.
 *   Add-back (tax.uncollected_vat_recovery): pick a claim whose customer has paid since; the server works out the VAT.
 * Edit = cancel and record again (NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Preview, type UncollectedVat } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';

const CONFIRMS = [
  ['writtenAgreement', 'A written agreement sets the time to pay'],
  ['listedInSlsp', 'The sale is listed on its own in the SLSP'],
  ['declaredOnTime', 'Its output VAT was declared on time in a filed 2550Q'],
  ['notBadDebt', 'This VAT is not claimed as part of a bad debt deduction'],
] as const;
type Confirms = Record<(typeof CONFIRMS)[number][0], boolean>;
const none: Confirms = { writtenAgreement: false, listedInSlsp: false, declaredOnTime: false, notBadDebt: false };

/** Previews `input` a moment after it stops changing. */
function useLivePreview(r: ReturnType<typeof useRecord>, input: object | null) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const key = JSON.stringify(input);
  useEffect(() => {
    setPreview(null);
    if (!input) return;
    let stale = false;
    const t = setTimeout(() => r.preview(input).then((p) => stale || setPreview(p), (e: Error) => stale || r.fail(e)), 250);
    return () => ((stale = true), clearTimeout(t));
  }, [key]);
  return preview;
}

function PreviewPanel({ preview, waiting }: { preview: Preview | null; waiting: boolean }) {
  return (
    <Panel title="What will be recorded">
      {!preview && <p className="text-slate-500">{waiting ? 'Working it out…' : 'Pick one above.'}</p>}
      {preview && (
        <>
          <p>{preview.summary}</p>
          {preview.issues.map((i) => <Notice key={i.code + i.field + i.message} tone={i.level}>{i.message}</Notice>)}
          <p className="text-sm text-slate-500">Nothing is recorded until you press Record.</p>
        </>
      )}
    </Panel>
  );
}

export function UncollectedVatForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [list, setList] = useState<UncollectedVat | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [confirms, setConfirms] = useState<Confirms>(none);
  const [note, setNote] = useState('');
  const r = useRecord(type, mode, (d) => {
    const s = d.input as Confirms & { invoiceId: string; note?: string };
    setInvoiceId(s.invoiceId);
    setConfirms({ writtenAgreement: s.writtenAgreement, listedInSlsp: s.listedInSlsp, declaredOnTime: s.declaredOnTime, notBadDebt: s.notBadDebt });
    setNote(s.note ?? '');
  });
  useEffect(() => void api.uncollectedVat().then(setList, r.fail), []);
  const input = invoiceId ? { invoiceId, ...confirms, ...(note.trim() ? { note: note.trim() } : {}) } : null;
  const preview = useLivePreview(r, input);
  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title('Claim output VAT on an uncollected receivable')}</h1>
      {r.top}
      {list && !list.enabled && <Notice tone="warning">The claim is off. The accountant turns it on in the settings (ACC-27) after deciding Virtus claims it.</Notice>}
      <Panel title="Invoices whose agreed time to pay ended in an earlier quarter">
        {list && list.claimable.length === 0 && !invoiceId && <p className="text-slate-500">None still owes.</p>}
        {list?.claimable.map((i) => (
          <label key={i.invoiceId} className="flex items-center gap-2 py-1 text-sm">
            <input type="radio" checked={invoiceId === i.invoiceId} onChange={() => setInvoiceId(i.invoiceId)} />
            <span className="flex-1">Invoice no. {i.invoiceNumber} ({i.number}), {i.customerName}, due {i.dueDate}: owes {peso(i.owedCents)}</span>
            <span className="tabular-nums">VAT {peso(i.vatCents)}</span>
          </label>
        ))}
      </Panel>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">The accountant confirms (the books cannot tell)</legend>
        {CONFIRMS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={confirms[k]} onChange={(e) => setConfirms({ ...confirms, [k]: e.target.checked })} /> {label}</label>
        ))}
      </fieldset>
      <Field label="Note" hint="Optional"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <PreviewPanel preview={preview} waiting={!!input} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost || !input} onClick={() => r.ask(input, [])}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}

export function UncollectedVatRecoveryForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [list, setList] = useState<UncollectedVat | null>(null);
  const [claimId, setClaimId] = useState('');
  const [note, setNote] = useState('');
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { claimId: string; note?: string };
    setClaimId(s.claimId);
    setNote(s.note ?? '');
  });
  useEffect(() => void api.uncollectedVat().then(setList, r.fail), []);
  const input = claimId ? { claimId, ...(note.trim() ? { note: note.trim() } : {}) } : null;
  const preview = useLivePreview(r, input);
  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title('Add back output VAT: the customer paid')}</h1>
      {r.top}
      <Panel title="Claims whose customer has paid since">
        {list && list.addBacksDue.length === 0 && !claimId && <p className="text-slate-500">No add-back is due.</p>}
        {list?.addBacksDue.map((a) => (
          <label key={a.claimId} className="flex items-center gap-2 py-1 text-sm">
            <input type="radio" checked={claimId === a.claimId} onChange={() => setClaimId(a.claimId)} />
            <span className="flex-1">{a.claimNumber}: invoice no. {a.invoiceNumber}, {a.customerName}, paid {peso(a.paidCents)}</span>
            <span className="tabular-nums">VAT {peso(a.vatCents)}</span>
          </label>
        ))}
      </Panel>
      <Field label="Note" hint="Optional"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <PreviewPanel preview={preview} waiting={!!input} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost || !input} onClick={() => r.ask(input, [])}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}
