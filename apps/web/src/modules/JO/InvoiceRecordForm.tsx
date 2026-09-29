/**
 * Invoice record form (PLAN D3 release gate, D4.4): the booklet invoice written for a release whose invoice was to follow.
 * Pick the release by its number, see what to write on the booklet, type the invoice number. It says plainly when the
 * release already has its invoice. Also its Edit (cancel and reissue with a new booklet number, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type BookletShown, type DocTypeInfo, type Preview, type ReleaseInvoiceInfo, type ReleasePick } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { Booklet, ReleasePicker } from './parts.tsx';
import { invoiceBooklet, invoiceInput } from './forms.ts';

type Stored = { releaseId: string; invoiceNumber: string; note?: string };

export function InvoiceRecordForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [info, setInfo] = useState<ReleaseInvoiceInfo | null>(null);
  const [preset, setPreset] = useState('');
  const [invoiceNumber, setInvoice] = useState('');
  const [note, setNote] = useState('');
  const [was, setWas] = useState(''); // the edited record's booklet number: used once, ever, so not prefilled
  const choose = (r: ReleasePick | null) => (r ? api.joReleaseInfo(r.id).then(setInfo, rec.fail) : (setInfo(null), undefined));
  const rec = useRecord(type, mode, (d) => {
    const input = d.input as unknown as Stored;
    setWas(input.invoiceNumber);
    setNote(input.note ?? '');
    api.joReleaseInfo(input.releaseId).then(setInfo, rec.fail);
  });

  useEffect(() => {
    if (mode.kind !== 'new') return;
    const q = new URLSearchParams(location.search);
    const release = q.get('release');
    const jo = q.get('jo');
    if (release) api.joReleaseInfo(release).then(setInfo, rec.fail);
    else if (jo) api.joStatus(jo).then((s) => setPreset(s.jobOrder.number), rec.fail);
  }, []);

  const r = info?.release ?? null;
  const typed = invoiceInput({ releaseId: r?.id ?? '', invoiceNumber, note });
  const live = useLive<Preview | null>(JSON.stringify(typed.input), typed.errors.length === 0, () => rec.preview(typed.input));
  // The preview's own figures once it answers; until then the release's. In mode C both show the sale less the downpayments invoiced.
  const doc = live?.doc as Parameters<typeof invoiceBooklet>[0] & { depositAppliedCents: number } | undefined;
  const figures: (BookletShown & { depositAppliedCents: number }) | null = doc ? { ...invoiceBooklet(doc), depositAppliedCents: doc.depositAppliedCents } : info ? { ...info.booklet, depositAppliedCents: info.depositAppliedCents } : null;
  const ownInvoice = r?.invoice && rec.original && r.invoice.id === rec.original.id; // the record being edited
  const blocked = r?.status === 'cancelled'
    ? `${r.number} is cancelled. Record the invoice for the release that replaced it.`
    : r?.invoice && !ownInvoice ? `${r.number} already has its invoice: no. ${r.invoice.invoiceNumber} (${r.invoice.number}). Cancel that one first to record another.` : '';
  const errors = [...typed.errors, ...(blocked ? [blocked] : [])];
  const record = () => rec.ask(typed.input, errors);

  if (rec.gate) return rec.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{rec.title('New invoice record')}</h1>
        {rec.top}
        <Panel title="Release">
          <ReleasePicker value={r} preset={preset} onChange={(x) => void choose(x)} />
          {blocked && <Notice tone="warning">{blocked}</Notice>}
          {info && !blocked && (
            <ul className="text-sm text-slate-600">
              {info.lines.map((l) => <li key={l.lineNo}>{l.qty} × {l.description}</li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Invoice">
          <Field label="Invoice number (from the booklet)" required
            hint={was ? `Invoice no. ${was} stays with the cancelled record (keep all its copies): write this sale on a new invoice.` : 'Type the number printed on the invoice you wrote.'}>
            <input inputMode="numeric" className={`${inputClass} max-w-40`} value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
          <Field label="Note"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Panel>
        <Errors list={errors} show={rec.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !!blocked} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <div className="space-y-4">
        {figures ? <Booklet b={figures} depositAppliedCents={figures.depositAppliedCents} /> : <Panel title="So far"><p className="text-sm text-slate-500">Pick the release to see what to write on the booklet.</p></Panel>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </div>
      {rec.dialog}
    </form>
  );
}
