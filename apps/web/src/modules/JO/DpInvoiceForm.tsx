/**
 * Downpayment invoice form (PLAN D3 "Downpayment VAT modes" mode C, D5 INV-DP): the downpayment is invoiced on the booklet
 * when it is received. Pick the job order by its number or customer, type the booklet invoice number and the amount
 * (starting at the downpayment asked less what is already invoiced); the preview says what to write on the booklet, the
 * money already held that it applies and what is left to collect. A job order that is not in mode C gets the server's own
 * words instead. Also its Edit (cancel and reissue with a new booklet number, NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type DocTypeInfo, type DpInfo, type JoPick, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, Figures, useLive } from '../COL/parts.tsx';
import { Booklet, JoPicker } from './parts.tsx';
import { dpBooklet, dpInvoiceInput, dpSplit, dpStartCents, modeText, type DpPreviewDoc } from './forms.ts';

type Stored = { jobOrderId: string; invoiceNumber: string; amountCents: number; note?: string };

export function DpInvoiceForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [info, setInfo] = useState<DpInfo | null>(null);
  const [amount, setAmount] = useState('');
  const [invoiceNumber, setInvoice] = useState('');
  const [note, setNote] = useState('');
  const [was, setWas] = useState(''); // the edited invoice's booklet number: used once, ever, so not prefilled
  const load = (id: string, typedAmount?: string) =>
    api.joDpInfo(id).then((i) => {
      setInfo(i);
      const start = dpStartCents(i);
      setAmount(typedAmount ?? (start > 0 ? formatPesos(start) : ''));
    }, rec.fail);
  const rec = useRecord(type, mode, (d) => {
    const input = d.input as unknown as Stored;
    setWas(input.invoiceNumber);
    setNote(input.note ?? '');
    void load(input.jobOrderId, formatPesos(input.amountCents));
  });

  useEffect(() => {
    if (mode.kind !== 'new') return;
    const jo = new URLSearchParams(location.search).get('jo');
    if (jo) void load(jo);
  }, []);

  const jo = info ? { id: info.jobOrder.id, label: `${info.jobOrder.number} · ${info.jobOrder.customerName}` } : null;
  const typed = dpInvoiceInput({ jobOrderId: info?.jobOrder.id ?? '', invoiceNumber, amount, note });
  const live = useLive<Preview | null>(JSON.stringify(typed.input), typed.errors.length === 0 && !info?.refusal, () => rec.preview(typed.input));
  const doc = live?.doc as DpPreviewDoc | undefined;
  const refusal = info?.refusal ?? '';
  const errors = [...typed.errors, ...(refusal ? [refusal] : [])];
  const record = () => rec.ask(typed.input, errors);
  // What the invoice applies: the money already held for the job order (the preview's own figure once it answers).
  const applied = doc?.depositAppliedCents ?? Math.min(info?.depositsHeldCents ?? 0, typed.input.amountCents);
  const split = dpSplit(typed.input.amountCents, applied);
  const choose = (x: JoPick | null) => (x ? void load(x.id) : (setInfo(null), setAmount('')));

  if (rec.gate) return rec.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{rec.title('New downpayment invoice')}</h1>
        {rec.top}
        <Panel title="Job order">
          <JoPicker value={jo} onChange={choose} />
          {info && <p className="text-sm text-slate-600">{modeText(info.depositVat)}{info.depositVat.mode !== info.depositVat.setting ? ` (the setting in force is mode ${info.depositVat.setting})` : ''}</p>}
          {refusal && <Notice tone="warning">{refusal}</Notice>}
          {info && !refusal && info.depositVat.kept && <Notice tone="info">{info.depositVat.kept}</Notice>}
        </Panel>
        <Panel title="Invoice">
          <Field label="Invoice number (from the booklet)" required
            hint={was ? `Invoice no. ${was} stays with the cancelled record (keep all its copies): write this downpayment on a new invoice.` : 'Type the number printed on the invoice you wrote.'}>
            <input inputMode="numeric" className={`${inputClass} max-w-40`} value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
          <Field label="Downpayment invoiced (VAT included)" required
            hint={info ? `Starts at the downpayment asked (${peso(info.requiredDownpaymentCents)}) less what is already invoiced (${peso(info.dpInvoicedCents)}).` : 'Pick the job order first.'}>
            <input inputMode="decimal" className={`${inputClass} max-w-40 text-right tabular-nums`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Note"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Panel>
        <Errors list={errors} show={rec.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !!refusal} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <div className="space-y-4">
        {info && (
          <Panel title="So far">
            <Figures items={[
              ['Downpayment asked', info.requiredDownpaymentCents],
              ['Already invoiced', info.dpInvoicedCents],
              ['Money held, applied to it', split.appliedCents],
              ['Left to collect', split.leftToCollectCents, 'font-semibold'],
            ]} />
            {info.dpInvoices.length > 0 && (
              <ul className="text-sm text-slate-600">
                {info.dpInvoices.map((i) => <li key={i.id}>Invoice no. {i.invoiceNumber} · {peso(i.amountCents)}{i.status === 'cancelled' ? ' (cancelled)' : ''}</li>)}
              </ul>
            )}
          </Panel>
        )}
        {doc ? <Booklet b={dpBooklet(doc)} depositAppliedCents={doc.depositAppliedCents} /> : <Panel title="Write these on the booklet"><p className="text-sm text-slate-500">Pick the job order, type the invoice number and the amount to see what to write on the booklet.</p></Panel>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.filter((i) => i.message !== refusal && i.message !== info?.depositVat.kept).map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </div>
      {rec.dialog}
    </form>
  );
}
