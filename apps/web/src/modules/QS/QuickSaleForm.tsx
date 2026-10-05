/**
 * Quick sale (PLAN E6): one screen for walk-ins. Customer (Walk-in by default), what was sold, the manual invoice number,
 * and how it was paid. Records the invoice record and its payment in one transaction (QS-SALE); the confirm dialog shows
 * "write these on the booklet" (D4.4). Target: under 45 seconds. Also the Edit of a recorded quick sale.
 */
import { useEffect, useMemo, useState } from 'react';
import { schemaFields, useBoxes, issueFields, rowFields, usedTenderRows, boxRefusals } from '../JO/boxes.ts';
import { tenderFields } from '../COL/typing.ts';
import { collectionInput } from '../COL/validation.ts';
import { saleFields } from './typing.ts';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, newIdempotencyKey, type CashPlace, type DocHeader, type DocTypeInfo, type QsBody, type QsPreview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Dialog, Field, JournalTable, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { SalesActions, Exception } from '../JO/entry.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { checkPlaceIds, emptyTender, tendersToInput, tendersToRows, type TenderInput, type TenderRow } from '../COL/money.ts';
import { CustomerPicker, EditGate, Errors, Figures, TenderRows, useLive, type Picked } from '../COL/parts.tsx';
import { KINDS, emptyLine, linesToInput, linesToRows, type LineInput, type LineRow } from './lines.ts';

function ConfirmDialog(p: { preview: QsPreview; original?: DocHeader; onRecord: (key: string) => Promise<unknown>; onClose: () => void }) {
  const key = useMemo(newIdempotencyKey, [p.preview]); // same key when a click is retried, a new one after a new preview (N-02)
  const a = useAction();
  const issues = [...p.preview.sale.issues, ...(p.preview.payment?.issues ?? [])];
  const b = p.preview.booklet;
  return (
    <Dialog title={p.original ? `Cancel ${p.original.number} and record the replacement?` : 'Record this quick sale?'} onClose={p.onClose}>
      <Panel title="Write these on the booklet">
        <Figures items={[['VATable sales', b.vatableSalesCents], ['VAT', b.vatCents], ...(b.discountCents ? [['Discount', b.discountCents] as [string, number]] : []), ['Total', b.totalCents, 'font-semibold']]} />
      </Panel>
      <p>{p.preview.sale.summary}</p>
      {p.preview.payment && <p>{p.preview.payment.summary}</p>}
      {p.original && <Notice tone="info">{p.original.number} and its payment will be cancelled (reversed with today's date); the replacement gets a new number.</Notice>}
      {issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      {p.preview.sale.journal && (
        <Panel title="Behind the scenes">
          <JournalTable lines={p.preview.sale.journal} />
          {p.preview.payment?.journal && <JournalTable lines={p.preview.payment.journal} />}
        </Panel>
      )}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={p.onClose}>Go back</Button>
        <Button tone="primary" autoFocus disabled={a.busy || issues.some((i) => i.level === 'error') || !p.preview.payment} onClick={() => a.run(() => p.onRecord(key))}>
          {a.busy ? 'Recording…' : 'Record'}
        </Button>
      </div>
    </Dialog>
  );
}

export function QuickSaleForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [invoiceNumber, setInvoice] = useState('');
  const [rows, setRows] = useState<LineRow[]>([emptyLine()]);
  const [tenders, setTenders] = useState<TenderRow[]>([emptyTender()]);
  const [crNumber, setCr] = useState('');
  const [note, setNote] = useState('');
  const [original, setOriginal] = useState<DocHeader>();
  const [was, setWas] = useState({ invoice: '', cr: '' }); // the edited sale's booklet numbers: used once, ever, so not prefilled
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<QsPreview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(boxes.refuse(e));

  useEffect(() => {
    api.cashPlaces().then(setPlaces, fail);
    if (mode.kind === 'edit') {
      (async () => {
        const d = await api.get(type.key, mode.id);
        const input = d.input as { customerId: string; invoiceNumber: string; lines: LineInput[]; note?: string };
        setOriginal(d.header);
        setCustomer({ id: input.customerId, name: String(d.doc?.customerName ?? '') });
        setWas((w) => ({ ...w, invoice: input.invoiceNumber }));
        setRows(linesToRows(input.lines));
        setNote(input.note ?? '');
        const paid = (await api.qsPayments(mode.id)).find((p) => p.status === 'posted');
        if (paid) {
          const c = (await api.get('col.collection', paid.id)).input as { crNumber: string; tenders: TenderInput[] };
          setWas((w) => ({ ...w, cr: c.crNumber }));
          setTenders(tendersToRows(c.tenders));
        }
      })().catch(fail);
    } else {
      // "Walk-in" by default (E6), when the shop has that customer.
      api.customers('walk-in').then((cs) => {
        const w = cs.find((c) => c.is_active === 1 && c.display_name.trim().toLowerCase() === 'walk-in');
        if (w) setCustomer((c) => c ?? { id: w.id, name: w.display_name });
      }, () => undefined);
    }
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  const sold = linesToInput(rows);
  // One payment with no amount typed pays the exact total: pick where the money went and record.
  const exact = tenders.length === 1 && !tenders[0]!.amount.trim() && sold.totalCents > 0 ? [{ ...tenders[0]!, amount: formatPesos(sold.totalCents) }] : tenders;
  const pay = tendersToInput(exact, undefined, checkPlaceIds(places));
  const errors = [
    ...(customer ? [] : ['Pick the customer (or Walk-in).']),
    ...sold.errors,
    ...(/^\d+$/.test(invoiceNumber.trim()) ? [] : ['Type the invoice number from the booklet (digits only).']),
    ...pay.errors,
    ...(/^\d+$/.test(crNumber.trim()) ? [] : ['Type the CR number from the booklet (digits only).']),
  ];
  const body: QsBody = {
    sale: { customerId: customer?.id ?? '', invoiceNumber: invoiceNumber.trim(), lines: sold.lines, ...(note.trim() ? { note: note.trim() } : {}) },
    payment: { crNumber: crNumber.trim(), tenders: pay.tenders },
  };
  const live = useLive(JSON.stringify(body), errors.length === 0, () => api.qsPreview(body), (e) => boxes.capture(e));

  const remap = (fields: Record<string, string>) => rowFields(rowFields(fields, 'lines', rows.flatMap((r, i) => r.description.trim() || r.price.trim() || r.discount.trim() ? [i] : [])), 'tenders', usedTenderRows(tenders));
  const boxes = useBoxes({ ...remap(issueFields(live?.sale.issues)), ...remap(issueFields(live?.payment?.issues)), ...saleFields(rows, body.sale), ...schemaFields(collectionInput.pick({ crNumber: true }), body.payment), ...tenderFields(exact, checkPlaceIds(places)) }, JSON.stringify(body), {}, false, remap);
  const openConfirm = () => {
    setTouched(true); boxes.submit();
    if (errors.length === 0) api.qsPreview(body).then((p) => { if (boxes.review(p)) setConfirm(p); }, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.qsReissue(original.id, body, confirm!.totalCents, reason, key) : await api.qsRecord(body, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.sale.id}?recorded=1`));
    } catch (e) {
      fail(e as Error);
      if (Object.keys(boxRefusals(e)).length) setConfirm(null);
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.qsPreview(body));
      throw e;
    }
  };

  if (original && !reason) return <EditGate original={original} typeKey={type.key} onReason={setReason} />;
  const set = (i: number, patch: Partial<LineRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'Quick sale'}</h1>
        {original && <Notice tone="info">When you record, {original.number} and its payment are cancelled and the replacement gets a new number. Reason: {reason}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Panel title="Customer">
          <CustomerPicker boxes={boxes} value={customer} onChange={setCustomer} />
        </Panel>
        <Panel title="What was sold">
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
              <div role="radiogroup" aria-label={`Kind of line ${i + 1}`} className="flex flex-wrap gap-2">
                {KINDS.map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={r.kind === k} onClick={() => set(i, { kind: k })}
                    className={`rounded-full px-3 py-1 text-sm ring-1 ${r.kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_6rem_9rem]">
                <Field label="What" error={boxes.error(`lines.${i}.description`, ...(i === 0 ? ['lines'] : []))}><input {...boxes.box(`lines.${i}.description`)} aria-label="What" placeholder="e.g. Shorten sleeves" className={inputClass} value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></Field>
                <Field label="Qty" error={boxes.error(`lines.${i}.qty`)}><input {...boxes.box(`lines.${i}.qty`)} aria-label="Qty" inputMode="numeric" className={`${inputClass} text-right`} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
                <Field label="Price each" error={boxes.error(`lines.${i}.unitPriceCents`)}><input {...boxes.box(`lines.${i}.unitPriceCents`)} aria-label="Price each" inputMode="decimal" placeholder="Price" className={`${inputClass} text-right tabular-nums`} value={r.price} onChange={(e) => set(i, { price: e.target.value })} /></Field>
              </div>
              <Exception title="Add a line discount" active={!!r.discount.trim() && Number(r.discount.replaceAll(',', '')) !== 0}>
                <div className="max-w-xs"><Field label="Discount" error={boxes.error(`lines.${i}.discountCents`)}><input {...boxes.box(`lines.${i}.discountCents`)} aria-label="Discount" inputMode="decimal" placeholder="Discount" className={`${inputClass} text-right tabular-nums`} value={r.discount} onChange={(e) => set(i, { discount: e.target.value })} /></Field></div>
              </Exception>
              {rows.length > 1 && <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          {rows.length < 30 && <Button onClick={() => setRows([...rows, emptyLine(rows.at(-1)?.kind)])}>+ Add a line</Button>}
        </Panel>
        <Panel title="Where did the money go?">
          <TenderRows boxes={boxes} rows={tenders} onChange={setTenders} places={places} question="Where did the money go?" amountHint={sold.totalCents > 0 ? formatPesos(sold.totalCents) : undefined} />
          <Field label="CR number (from the booklet)" error={boxes.error('crNumber')} required hint={was.cr ? `CR ${was.cr} stays with the cancelled payment: write this payment on a new CR.` : undefined}>
            <input {...boxes.box('crNumber')} inputMode="numeric" className={`${inputClass} max-w-40`} value={crNumber} onChange={(e) => setCr(e.target.value)} />
          </Field>
        </Panel>
        <Panel title="Invoice">
          <Field label="Invoice number (from the booklet)" error={boxes.error('invoiceNumber')} required
            hint={was.invoice ? `Invoice no. ${was.invoice} stays with the cancelled sale (keep all its copies): write this sale on a new invoice.` : 'VAT sellers write an invoice for every sale, however small.'}>
            <input {...boxes.box('invoiceNumber')} inputMode="numeric" className={`${inputClass} max-w-40`} value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
        </Panel>
        <Field label="Note" error={boxes.error('note')}><textarea {...boxes.box('note')} rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>

        <Panel title="So far">
          <p className="text-2xl font-semibold tabular-nums">{peso(live?.totalCents ?? sold.totalCents)}</p>
          {live && <Figures items={[['VATable sales', live.booklet.vatableSalesCents], ['VAT', live.booklet.vatCents]]} />}
          {live && [live.sale, ...(live.payment ? [live.payment] : [])].flatMap((c) => c.issues).filter((i) => i.level !== 'error' || !i.field).map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
        </Panel>
        <SalesActions total={live?.totalCents ?? sold.totalCents} label="Total">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </SalesActions>
      </div>
      {confirm && <ConfirmDialog preview={confirm} original={original} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
