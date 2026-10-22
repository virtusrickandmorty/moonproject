/**
 * Quick sale (PLAN E6): one screen for walk-ins. Customer (Walk-in by default), what was sold, the manual invoice number,
 * and how it was paid. Records the invoice record and its payment in one transaction (QS-SALE); the confirm dialog shows
 * "write these on the booklet" (D4.4). Target: under 45 seconds. Also the Edit of a recorded quick sale.
 * Laid out like the job order form (the owner's request, Oct 2026): the form on the left (customer, an item added from the
 * price list or typed, the payment, the invoice), the breakdown on the right with Record, in view while the form scrolls.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, newIdempotencyKey, type CashPlace, type CatItem, type DocHeader, type DocTypeInfo, type Me, type QsBody, type QsPreview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Dialog, Field, JournalTable, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { SalesActions } from '../JO/entry.tsx';
import { NewCustomerButton } from '../JO/JobOrderForm.tsx';
import { KIND_OF_CLASS } from '../JO/forms.ts';
import { ItemSearch } from '../JO/parts.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { cents, checkPlaceIds, emptyTender, tendersToInput, tendersToRows, type TenderInput, type TenderRow } from '../COL/money.ts';
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

/** `inDialog`: over the quick sales list (its title on the dialog, Close instead of Back, the recorded sale shown there). */
export function QuickSaleForm({ type, mode, me, inDialog }: { type: DocTypeInfo; mode: FormMode; me?: Me; inDialog?: { close: () => void; setDirty: (dirty: boolean) => void; show: (id: string) => void } }) {
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [invoiceNumber, setInvoice] = useState('');
  const [rows, setRows] = useState<LineRow[]>([]);
  const [item, setItem] = useState<LineRow>(emptyLine());
  const [editing, setEditing] = useState<number | null>(null);
  const [itemTouched, setItemTouched] = useState(false);
  const [added, setAdded] = useState('');
  const [tenders, setTenders] = useState<TenderRow[]>([emptyTender()]);
  const [crNumber, setCr] = useState('');
  const [note, setNote] = useState('');
  const [original, setOriginal] = useState<DocHeader>();
  const [was, setWas] = useState({ invoice: '', cr: '' }); // the edited sale's booklet numbers: used once, ever, so not prefilled
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<QsPreview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

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

  // The item form: Add to sale puts it in the breakdown (or Update item replaces the one picked there). The price list's
  // tier price for its quantity fills the price unless one was typed.
  const setItemPatch = (patch: Partial<LineRow>) => setItem((l) => ({ ...l, ...patch }));
  const priceFor = (itemId: string, qty: string) => {
    if (!itemId || !/^[1-9]\d*$/.test(qty)) return;
    api.catPrice(itemId, Number(qty)).then((p) => setItem((l) => (l.price.trim() ? l : { ...l, price: formatPesos(p.unitPriceCents) })), () => undefined);
  };
  const [picked, setPicked] = useState('');
  const pick = (it: CatItem) => { setPicked(it.id); setItemPatch({ kind: KIND_OF_CLASS[it.class], description: it.name, price: '' }); priceFor(it.id, item.qty); };
  const blank = !item.description.trim() && !item.price.trim() && !item.discount.trim();
  const itemErrors = blank ? ['Pick an item from the price list or say what was sold.'] : linesToInput([item]).errors.map((e) => e.replace(/^Line 1/, 'This item'));
  const clearItem = () => { setItem(emptyLine(item.kind)); setEditing(null); setItemTouched(false); setPicked(''); };
  const withItem = (all: LineRow[]) => (editing === null ? [...all, item] : all.map((l, j) => (j === editing ? item : l)));
  const putItem = () => {
    setItemTouched(true);
    if (itemErrors.length > 0) return;
    setRows(withItem(rows));
    setAdded(editing === null ? `Added ${item.description.trim()}.` : `Item ${editing + 1} updated.`);
    clearItem();
  };
  const editItem = (i: number) => { setItem(rows[i]!); setEditing(i); setItemTouched(false); setAdded(''); };
  const removeItem = (i: number) => { setRows(rows.filter((_, j) => j !== i)); if (editing === i) clearItem(); else if (editing !== null && editing > i) setEditing(editing - 1); };

  /** The sale and payment from these items: what is sent, and what is still missing. */
  const build = (list: LineRow[]) => {
    const sold = linesToInput(list);
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
    return { sold, errors, body };
  };
  const { sold, errors, body } = build(rows);
  const setDirty = inDialog?.setDirty;
  useEffect(() => { setDirty?.(rows.length > 0 || !blank); }, [rows.length, blank, setDirty]);
  const live = useLive(JSON.stringify(body), errors.length === 0, () => api.qsPreview(body));

  /** Record takes a complete item still in the item form with it (added, or its change applied); an incomplete one stops it. */
  const openConfirm = () => {
    setTouched(true);
    let ready = { errors, body };
    if (!blank) {
      setItemTouched(true);
      if (itemErrors.length > 0) return setError(editing === null ? 'The item in the form is not complete: finish it and press Add to sale, or Clear it.' : 'The item being changed is not complete: finish it and press Update item, or Cancel the change.');
      const next = withItem(rows);
      setRows(next);
      clearItem();
      ready = build(next);
    }
    if (ready.errors.length === 0) api.qsPreview(ready.body).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.qsReissue(original.id, body, confirm!.totalCents, reason, key) : await api.qsRecord(body, confirm!.totalCents, key);
      if (inDialog) inDialog.show(r.sale.id); else navigate(docPath(type.key, `/${r.sale.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.qsPreview(body));
      throw e;
    }
  };

  if (original && !reason) return <EditGate original={original} typeKey={type.key} onReason={setReason} />;
  const pending = !blank;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      {/* Two columns from a wide screen, as on the job order: the form on the left, the breakdown on the right. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        <div className="min-w-0 space-y-4">
          {(!inDialog || original) && <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'Quick sale'}</h1>}
          {original && <Notice tone="info">When you record, {original.number} and its payment are cancelled and the replacement gets a new number. Reason: {reason}</Notice>}
          {error && <Notice>{error}</Notice>}
          <Panel title="Customer">
            <CustomerPicker value={customer} onChange={setCustomer}
              beside={!customer && me?.permissions.includes('cus.manage') && <NewCustomerButton me={me} onAdded={(c) => setCustomer(c)} />} />
          </Panel>
          <Panel title={editing === null ? 'What was sold: add an item' : `What was sold: change item ${editing + 1}`}>
            <div className="space-y-3">
              <ItemSearch label="Item price list item" onPick={pick} />
              <div role="radiogroup" aria-label="Kind of item" className="flex flex-wrap gap-2">
                {KINDS.map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={item.kind === k} onClick={() => setItemPatch({ kind: k })}
                    className={`rounded-full px-3 py-1 text-sm ring-1 ${item.kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Description"><input aria-label="What" placeholder="What, e.g. Shorten sleeves" className={inputClass} value={item.description} onChange={(e) => setItemPatch({ description: e.target.value })} /></Field>
                <Field label="Pieces"><input aria-label="Qty" inputMode="numeric" className={`${inputClass} text-right tabular-nums`} value={item.qty} onChange={(e) => { setItemPatch({ qty: e.target.value }); priceFor(picked, e.target.value); }} /></Field>
                <Field label="Price each"><input aria-label="Price each" inputMode="decimal" placeholder="Price each" className={`${inputClass} text-right tabular-nums`} value={item.price} onChange={(e) => setItemPatch({ price: e.target.value })} /></Field>
                <Field label="Discount (optional)"><input aria-label="Discount" inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={item.discount} onChange={(e) => setItemPatch({ discount: e.target.value })} /></Field>
              </div>
              <Errors list={itemErrors} show={itemTouched} />
              {added && !pending && <p className="text-sm text-emerald-700">{added}</p>}
              <div className="flex flex-wrap gap-2">
                <Button tone="primary" onClick={putItem} disabled={rows.length >= 30 && editing === null}>{editing === null ? '+ Add to sale' : 'Update item'}</Button>
                {(editing !== null || pending) && <Button onClick={clearItem}>{editing === null ? 'Clear' : 'Cancel the change'}</Button>}
              </div>
            </div>
          </Panel>
          <Panel title="Payment: where did the money go?">
            <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money go?" amountHint={sold.totalCents > 0 ? formatPesos(sold.totalCents) : undefined} received />
            <Field label="CR number (from the booklet)" required hint={was.cr ? `CR ${was.cr} stays with the cancelled payment: write this payment on a new CR.` : undefined}>
              <input inputMode="numeric" className={`${inputClass} max-w-40`} value={crNumber} onChange={(e) => setCr(e.target.value)} />
            </Field>
          </Panel>
          <Panel title="Invoice">
            <div className="grid gap-3 sm:grid-cols-[17rem_minmax(0,1fr)]">
              <Field label="Invoice number (from the booklet)" required
                hint={was.invoice ? `Invoice no. ${was.invoice} stays with the cancelled sale (keep all its copies): write this sale on a new invoice.` : 'VAT sellers write an invoice for every sale, however small.'}>
                <input inputMode="numeric" className={inputClass} value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} />
              </Field>
              <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>
          </Panel>
        </div>
        {/* The breakdown on the right (under the form on a phone), in view while the form scrolls. */}
        <aside className="space-y-4 lg:sticky lg:top-0">
          <Panel title="So far">
            {rows.length === 0 && <p className="text-sm text-slate-500">No item yet. Fill in the item on the left, then press Add to sale.</p>}
            {rows.length > 0 && (
              <ol className="divide-y divide-slate-100" aria-label="Items in this quick sale">
                {rows.map((l, i) => {
                  const each = cents(l.price);
                  const off = cents(l.discount) ?? 0;
                  const total = each === undefined ? undefined : Number(l.qty) * each - off;
                  return (
                    <li key={i} className={`flex gap-3 py-2 ${editing === i ? '-mx-2 rounded-md bg-indigo-50 px-2' : ''}`}>
                      <span className="w-5 shrink-0 text-sm text-slate-500">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={l.description}>{l.description || '(no description)'}</p>
                        <p className="text-xs text-slate-500">{l.qty} pcs × {each === undefined ? '—' : peso(each)}{off ? ` less ${peso(off)}` : ''} · {KINDS.find(([k]) => k === l.kind)?.[1]}</p>
                        <div className="mt-1 flex gap-3 text-xs">
                          <button type="button" className="font-medium text-indigo-700 hover:underline" aria-label={`Edit item ${i + 1}`} onClick={() => editItem(i)}>Edit</button>
                          <button type="button" className="font-medium text-red-700 hover:underline" aria-label={`Remove item ${i + 1}`} onClick={() => removeItem(i)}>Remove</button>
                        </div>
                      </div>
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{total === undefined ? '—' : peso(total)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="border-t border-slate-200 pt-3">
              <Figures items={[
                ['Total', live?.totalCents ?? sold.totalCents, 'text-lg font-semibold'],
                ...(live ? [['VATable sales', live.booklet.vatableSalesCents] as [string, number], ['VAT', live.booklet.vatCents] as [string, number]] : []),
              ]} />
            </div>
            {live && [live.sale, ...(live.payment ? [live.payment] : [])].flatMap((c) => c.issues).map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
            {pending && <Notice tone="warning">{editing === null ? 'The item in the form is not added yet: press Add to sale (Record adds it too).' : `Item ${editing + 1} is being changed: press Update item (Record applies it too).`}</Notice>}
          </Panel>
          <Errors list={pending ? errors.filter((e) => e !== 'Add what was sold.') : errors} show={touched} />
          <SalesActions total={live?.totalCents ?? sold.totalCents} label="Total">
            <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
            {inDialog ? <Button onClick={inDialog.close}>Close</Button> : <Button onClick={() => history.back()}>Back</Button>}
          </SalesActions>
        </aside>
      </div>
      {confirm && <ConfirmDialog preview={confirm} original={original} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
