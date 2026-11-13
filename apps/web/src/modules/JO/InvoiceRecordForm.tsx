/**
 * Invoice record form (PLAN D3 release gate, D4.4): the booklet invoice written for a release whose invoice was to follow.
 * Pick the release by its number, see what to write on the booklet, type the invoice number. It says plainly when the
 * release already has its invoice. Also its Edit (cancel and reissue with a new booklet number, NR-4). The job order's other
 * releases with no invoice yet are ticked to go on the same invoice (the owner's request, Nov 2026).
 * Opened with ?again=<id> from a cancelled invoice record: records it again with its invoice number and releases (cancelled
 * by mistake, the owner's request, Nov 2026).
 */
import { useEffect, useState } from 'react';
import { api, type BookletShown, type DocTypeInfo, type Preview, type ReleaseInvoiceInfo, type ReleasePick } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { SalesActions } from './entry.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { PrintedDateField, usePrintedDate } from '../../generic/PrintedDate.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { AlsoOnInvoice, Booklet, ReleasePicker } from './parts.tsx';
import { invoiceBooklet, invoiceInput } from './forms.ts';

type Stored = { releaseId: string; alsoReleaseIds?: string[]; invoiceNumber: string; note?: string };
type Again = { id: string; number: string; invoiceNumber: string };

export function InvoiceRecordForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [info, setInfo] = useState<ReleaseInvoiceInfo | null>(null);
  const [preset, setPreset] = useState('');
  const [invoiceNumber, setInvoice] = useState('');
  const [note, setNote] = useState('');
  const [was, setWas] = useState(''); // the edited record's booklet number: used once, ever, so not prefilled
  const [picked, setPicked] = useState<string[] | null>(null); // the other releases ticked; null: all of them
  const choose = (r: ReleasePick | null) => { setPicked(null); return r ? api.joReleaseInfo(r.id).then(setInfo, rec.fail) : (setInfo(null), undefined); };
  const rec = useRecord(type, mode, (d) => {
    const input = d.input as unknown as Stored;
    setWas(input.invoiceNumber);
    setNote(input.note ?? '');
    setPicked(input.alsoReleaseIds ?? []);
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

  const printed = usePrintedDate(rec.original);
  const [again, setAgain] = useState<Again | null>(null); // the cancelled record recorded again, from ?again=
  useEffect(() => {
    const id = mode.kind === 'new' ? new URLSearchParams(location.search).get('again') : null;
    if (!id) return;
    api.get('jo.invoice_record', id).then((d) => {
      const input = d.input as unknown as Stored;
      setAgain({ id, number: d.header.number, invoiceNumber: input.invoiceNumber });
      setInvoice(input.invoiceNumber);
      setPicked(input.alsoReleaseIds ?? []);
      printed.setText(d.header.businessDate);
      return api.joReleaseInfo(input.releaseId, input.alsoReleaseIds).then(setInfo);
    }).catch(rec.fail);
  }, []);
  const r = info?.release ?? null;
  const others = info?.others ?? [];
  const also = others.filter((o) => (picked ?? others.map((x) => x.id)).includes(o.id)).map((o) => o.id);
  // The lines and booklet figures follow the releases ticked.
  const alsoKey = also.join(',');
  useEffect(() => { if (r) api.joReleaseInfo(r.id, also).then((i) => { if (JSON.stringify(i) !== JSON.stringify(info)) setInfo(i); }, rec.fail); }, [r?.id, alsoKey]);
  const typed = invoiceInput({ releaseId: r?.id ?? '', invoiceNumber, note, also, ...(again ? { againOf: again.id } : {}) });
  const live = useLive<Preview | null>(JSON.stringify([typed.input, printed.businessDate]), typed.errors.length === 0 && !printed.error, () => rec.preview(typed.input, printed.businessDate));
  // The preview's own figures once it answers; until then the release's. In mode C both show the sale less the downpayments invoiced.
  const doc = live?.doc as Parameters<typeof invoiceBooklet>[0] & { depositAppliedCents: number } | undefined;
  const figures: (BookletShown & { depositAppliedCents: number }) | null = doc ? { ...invoiceBooklet(doc), depositAppliedCents: doc.depositAppliedCents } : info ? { ...info.booklet, depositAppliedCents: info.depositAppliedCents } : null;
  const ownInvoice = r?.invoice && rec.original && r.invoice.id === rec.original.id; // the record being edited
  const blocked = r?.status === 'cancelled'
    ? `${r.number} is cancelled. Record the invoice for the release that replaced it.`
    : r?.invoice && !ownInvoice ? `${r.number} already has its invoice: no. ${r.invoice.invoiceNumber} (${r.invoice.number}). Cancel that one first to record another.` : '';
  const errors = [...typed.errors, ...(printed.error ? [printed.error] : []), ...(blocked ? [blocked] : [])];
  const record = () => rec.ask(typed.input, errors, printed.businessDate);

  if (rec.gate) return rec.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{rec.title('New invoice record')}</h1>
        {rec.top}
        {again && <Notice tone="note">Recording {again.number} again, cancelled by mistake: the same invoice no. {again.invoiceNumber} and the same releases. Use this only when the paper invoice still stands.</Notice>}
        <Panel title="Release">
          <ReleasePicker value={r} preset={preset} onChange={(x) => void choose(x)} />
          {blocked && <Notice tone="warning">{blocked}</Notice>}
          {info && !blocked && (
            <ul className="text-sm text-slate-600">
              {info.lines.map((l, i) => <li key={i}>{l.qty} × {l.description}</li>)}
            </ul>
          )}
          {info && !blocked && <AlsoOnInvoice list={others} ticked={also} onChange={setPicked} />}
        </Panel>
        <Panel title="Invoice">
          <Field label="Invoice number (from the booklet)" required
            hint={again ? `The number of ${again.number}, kept.` : was ? `Invoice no. ${was} stays with the cancelled record (keep all its copies): write this sale on a new invoice.` : 'Type the number printed on the invoice you wrote.'}>
            <input inputMode="numeric" className={`${inputClass} max-w-40`} value={invoiceNumber} readOnly={!!again} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
          <PrintedDateField label="Date on the invoice" value={printed.text} onChange={printed.setText} />
          <Field label="Note" required={!!again} hint={again ? 'Why it is recorded again, like "cancelled by mistake".' : undefined}><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Panel>
        <Errors list={errors} show={rec.touched} />
        <div className="space-y-4">
          {figures ? <Booklet b={figures} depositAppliedCents={figures.depositAppliedCents} /> : <Panel title="So far"><p className="text-sm text-slate-500">Pick the release to see what to write on the booklet.</p></Panel>}
          {live && <p className="text-sm">{live.summary}</p>}
          {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
        </div>
        <SalesActions total={figures?.grossCents} label="Total">
          <Button tone="primary" disabled={!type.canPost || !!blocked} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </SalesActions>
      </div>
      {rec.dialog}
    </form>
  );
}
