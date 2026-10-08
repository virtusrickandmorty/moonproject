/**
 * Quotation form (PLAN E3), laid out like the job order form: the customer (or a prospect) on one line with New customer
 * beside it, one item form (an item from the price list, quantity, a changed price or a discount with its reason) whose
 * items go into the breakdown on the right with Add to order and come back with Edit, then the terms. Prices, totals and
 * the valid-until date are the server's; the breakdown shows them from its preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Me, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, ReasonDialog } from '../../components/ui.tsx';
import { navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { CustomerPicker, Errors, Figures } from '../COL/parts.tsx';
import { ItemSearch } from '../JO/parts.tsx';
import { NewCustomerButton } from '../JO/JobOrderForm.tsx';
import { SalesActions } from '../JO/entry.tsx';
import { amount, blank, blankLine, cents, isReady, toInput, valuesOfInput, type Form, type Line, type QuotationDoc } from './quotation.ts';

function MoneyField({ value, onValue, placeholder, label }: { value: number | undefined; onValue: (n: number | undefined) => void; placeholder?: string; label: string }) {
  const [text, setText] = useState(amount(value));
  const sent = useRef<number | undefined>(value);
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(amount(value)); } }, [value]);
  return <input aria-label={label} inputMode="decimal" placeholder={placeholder} className={`${inputClass} text-right tabular-nums`} value={text} onChange={(e) => {
    const next = e.target.value;
    setText(next);
    if (!next) { sent.current = undefined; onValue(undefined); }
    else { const n = cents(next); if (n !== null) { sent.current = n; onValue(n); } }
  }} />;
}

/** Nothing picked or typed in the item form yet. */
const empty = (l: Line) => !l.itemId && !l.description.trim() && !l.discountCents && l.overrideUnitPriceCents === undefined;
/** The item form's own slips (the server checks every line again). */
export function itemSlips(l: Line): string[] {
  const out: string[] = [];
  if (!l.itemId) out.push('Pick the item from the price list.');
  if (!l.description.trim()) out.push('Type what the item is.');
  if (!Number.isInteger(l.qty) || l.qty < 1) out.push('The quantity must be a whole number, 1 or more.');
  if (l.overrideUnitPriceCents !== undefined && !l.overrideReason?.trim()) out.push('Say why the price is changed.');
  return out;
}

export function QuotationForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me?: Me }) {
  const [v, setV] = useState<Form>(() => ({ ...blank(), lines: [] })); // items join the breakdown from the item form
  const [item, setItem] = useState<Line>(blankLine);
  const [editing, setEditing] = useState<number | null>(null);
  const [itemTouched, setItemTouched] = useState(false);
  const [customerName, setCustomerName] = useState('Customer on file');
  const [original, setOriginal] = useState<DocHeader | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const itemForm = useRef<HTMLDivElement>(null);
  const input = useMemo(() => toInput(v), [v]);
  const ready = isReady(v);

  useEffect(() => {
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      setOriginal(d.header);
      setV(valuesOfInput(d.input));
      setCustomerName(String(d.doc?.customerName ?? 'Customer on file'));
    }, (e: Error) => setError(e.message));
    else if (mode.draftId) api.drafts(type.key).then((ds) => {
      const d = ds.find((x) => x.id === mode.draftId);
      if (d) {
        const form = d.payload.values as unknown as Form;
        setDraft({ id: d.id, version: d.version });
        setV({ ...form, lines: form.lines.filter((l) => !empty(l)) }); // a draft from the old layout may hold a blank line
      }
    }, (e: Error) => setError(e.message));
  }, [type.key, mode.kind, mode.kind === 'edit' ? mode.id : mode.draftId]);
  useEffect(() => {
    if (!v.customerId) return;
    let stale = false;
    api.customer(v.customerId).then((c) => { if (!stale) setCustomerName(c.display_name); }, () => undefined);
    return () => { stale = true; };
  }, [v.customerId]);
  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    let stale = false;
    const timer = setTimeout(() => api.preview(type.key, input).then((p) => { if (!stale) setPreview(p); }, () => { if (!stale) setPreview(null); }), 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [type.key, input, ready]);

  const patch = (p: Partial<Line>) => setItem((l) => ({ ...l, ...p }));
  const slips = itemSlips(item);
  const pending = !empty(item);
  const clearItem = () => { setItem(blankLine()); setEditing(null); setItemTouched(false); };
  const withItem = (f: Form): Form => ({ ...f, lines: editing === null ? [...f.lines, item] : f.lines.map((l, j) => (j === editing ? item : l)) });
  const putItem = () => {
    setItemTouched(true);
    if (slips.length > 0) return;
    setV(withItem);
    clearItem();
  };
  const editItem = (i: number) => {
    setItem(v.lines[i]!); setEditing(i); setItemTouched(false);
    itemForm.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const removeItem = (i: number) => {
    setV((old) => ({ ...old, lines: old.lines.filter((_, j) => j !== i) }));
    if (editing === i) clearItem(); else if (editing !== null && editing > i) setEditing(editing - 1);
  };

  /** Record takes a complete item still in the item form with it; an incomplete one stops it with what to finish. */
  const openConfirm = () => {
    let next = input;
    if (pending) {
      setItemTouched(true);
      if (slips.length > 0) return setError(editing === null ? 'The item in the form is not complete: finish it and press Add to order, or Clear it.' : 'The item being changed is not complete: finish it and press Update item, or Cancel the change.');
      const all = withItem(v);
      setV(all); clearItem();
      next = toInput(all);
    }
    setError('');
    void api.preview(type.key, next).then(setConfirm, (e: Error) => setError(e.message));
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key)
        : await api.post(type.key, input, confirm!.totalCents, key);
      if (draft) await api.discardDraft(draft.id).catch(() => undefined);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };
  const saveDraft = async () => {
    try {
      const payload = { values: v as unknown as Record<string, string> };
      const d = draft ? await api.saveDraft(draft.id, draft.version, payload) : await api.createDraft(type.key, payload);
      setDraft(d); setError(''); setSaved('Draft saved. It has no quotation number yet. Open it again from the quotation list.');
    } catch (e) { setError((e as Error).message); }
  };
  if (mode.kind === 'edit' && original && !reason) return <ReasonDialog title={`Edit ${original.number}`}
    explain="The old quotation will be cancelled and the replacement will get a new number when you record it."
    confirmLabel="Continue to edit" onConfirm={setReason} onClose={() => navigate(docPath(type.key, `/${original.id}`))} />;

  const priced = (preview?.doc as QuotationDoc | undefined)?.lines; // the server's prices, line for line, once it answers
  return (
    <div className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : 'New quotation'}</h1>
      {/* Two columns from a wide screen: the form on the left, the breakdown on the right. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        <div className="min-w-0 space-y-4">
          {error && <Notice>{error}</Notice>}{saved && <Notice tone="success">{saved}</Notice>}
          {original && <Notice tone="info">Recording will cancel {original.number} and issue a replacement. Reason: {reason}</Notice>}
          <Panel title="Customer or prospect">
            <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <CustomerPicker value={v.customerId ? { id: v.customerId, name: customerName } : null}
                onChange={(c) => { setCustomerName(c?.name ?? 'Customer on file'); setV({ ...v, customerId: c?.id ?? '', prospectName: '' }); }}
                beside={!v.customerId && me?.permissions.includes('cus.manage') && <NewCustomerButton me={me} onAdded={(c, lookalike) => {
                  setCustomerName(c.name); setV((old) => ({ ...old, customerId: c.id, prospectName: '' }));
                  setSaved(lookalike ? `Added ${c.name}. Another customer has a similar name: check the customer list later in case it is the same one.` : `Added ${c.name} as a new customer.`);
                }} />} />
              <Field label="Contact"><input className={inputClass} value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>
            </div>
            {!v.customerId && (
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Field label="Or a prospect's name" hint="Someone not on file yet; a quotation can be for them."><input className={inputClass} value={v.prospectName} onChange={(e) => setV({ ...v, prospectName: e.target.value })} /></Field>
              </div>
            )}
          </Panel>
          <div ref={itemForm} className="scroll-mt-4">
            <Panel title={editing === null ? 'Items: add an item' : `Items: change item ${editing + 1}`}>
              <div className="space-y-3">
                {item.itemId
                  ? <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-600">Price list item:</span><span className="font-medium">{item.description}</span><Button onClick={() => patch({ itemId: '' })}>Change item</Button></div>
                  : <ItemSearch label="Item price list item" onPick={(it) => patch({ itemId: it.id, description: it.name, unit: it.unit })} />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Description" required><input aria-label="Item description" className={inputClass} value={item.description} onChange={(e) => patch({ description: e.target.value })} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Quantity" required><input aria-label="Item quantity" type="number" min="1" className={`${inputClass} text-right`} value={item.qty} onChange={(e) => patch({ qty: Number(e.target.value) })} /></Field>
                    <Field label="Unit"><input aria-label="Item unit" className={inputClass} value={item.unit} readOnly /></Field>
                  </div>
                  <Field label="Price each (optional)" hint="Empty: the price list's price for this quantity.">
                    <MoneyField label="Item price each" value={item.overrideUnitPriceCents} placeholder="Price list" onValue={(n) => patch({ overrideUnitPriceCents: n })} />
                  </Field>
                  {item.overrideUnitPriceCents !== undefined
                    ? <Field label="Why the price is changed" required><input aria-label="Item price reason" className={inputClass} value={item.overrideReason ?? ''} onChange={(e) => patch({ overrideReason: e.target.value })} /></Field>
                    : <span className="hidden sm:block" />}
                  <Field label="Discount (optional)"><MoneyField label="Item discount" value={item.discountCents || undefined} placeholder="0.00" onValue={(n) => patch({ discountCents: n ?? 0 })} /></Field>
                  {item.discountCents > 0 && <Field label="Discount reason"><input aria-label="Item discount reason" className={inputClass} value={item.discountReason ?? ''} onChange={(e) => patch({ discountReason: e.target.value })} /></Field>}
                </div>
                <Errors list={slips} show={itemTouched} />
                <div className="flex flex-wrap gap-2">
                  <Button tone="primary" onClick={putItem} disabled={v.lines.length >= 50 && editing === null}>{editing === null ? '+ Add to order' : 'Update item'}</Button>
                  {(editing !== null || pending) && <Button onClick={clearItem}>{editing === null ? 'Clear' : 'Cancel the change'}</Button>}
                </div>
              </div>
            </Panel>
          </div>
          <Panel title="Terms">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Valid for days" required><input type="number" min="1" max="365" className={`${inputClass} text-right`} value={v.validForDays}
                onChange={(e) => setV({ ...v, validForDays: Number(e.target.value) })} /></Field>
              <Field label="Document discount"><MoneyField label="Document discount" value={v.documentDiscountCents || undefined} placeholder="0.00" onValue={(n) => setV({ ...v, documentDiscountCents: n ?? 0 })} /></Field>
              <Field label="Discount reason"><input className={inputClass} value={v.discountReason} onChange={(e) => setV({ ...v, discountReason: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Terms"><textarea rows={2} className={inputClass} value={v.termsText} onChange={(e) => setV({ ...v, termsText: e.target.value })} /></Field>
              <Field label="Notes"><textarea rows={2} className={inputClass} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
            </div>
          </Panel>
        </div>
        {/* The breakdown on the right (under the form on a phone), in view while the form scrolls. */}
        <aside className="space-y-4 lg:sticky lg:top-0">
          <Panel title="So far">
            {v.lines.length === 0 && <p className="text-sm text-slate-500">No item yet. Fill in the item on the left, then press Add to order.</p>}
            {v.lines.length > 0 && (
              <ol className="divide-y divide-slate-100" aria-label="Items in this quotation">
                {v.lines.map((l, i) => {
                  const p = priced?.[i];
                  return (
                    <li key={i} className={`flex gap-3 py-2 ${editing === i ? '-mx-2 rounded-md bg-indigo-50 px-2' : ''}`}>
                      <span className="w-5 shrink-0 text-sm text-slate-500">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={l.description}>{l.description || '(no description)'}</p>
                        <p className="text-xs text-slate-500">
                          {l.qty} {l.unit} × {p ? peso(p.unitPriceCents) : l.overrideUnitPriceCents !== undefined ? peso(l.overrideUnitPriceCents) : 'price list'}
                          {p && p.unitPriceCents !== p.listUnitPriceCents ? ` (list ${peso(p.listUnitPriceCents)})` : ''}{l.discountCents ? ` less ${peso(l.discountCents)}` : ''}
                        </p>
                        <div className="mt-1 flex gap-3 text-xs">
                          <button type="button" className="font-medium text-indigo-700 hover:underline" aria-label={`Edit item ${i + 1}`} onClick={() => editItem(i)}>Edit</button>
                          <button type="button" className="font-medium text-red-700 hover:underline" aria-label={`Remove item ${i + 1}`} onClick={() => removeItem(i)}>Remove</button>
                        </div>
                      </div>
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{p ? peso(p.lineTotalCents) : '—'}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {preview && (
              <div className="border-t border-slate-200 pt-3">
                <Figures items={[
                  ...(v.documentDiscountCents ? [['Document discount', -v.documentDiscountCents] as [string, number]] : []),
                  ['Total', preview.totalCents, 'text-lg font-semibold'],
                ]} />
              </div>
            )}
            {!preview && v.lines.length > 0 && <p className="text-sm text-slate-500">Pick the customer (or type a prospect) to see the prices and the total.</p>}
            {preview && <p className="text-sm">{preview.summary}</p>}
            {preview?.issues.map((x) => <Notice key={x.code + x.field} tone={x.level}>{x.message}</Notice>)}
            {pending && <Notice tone="warning">{editing === null ? 'The item in the form is not added yet: press Add to order (Record adds it too).' : `Item ${editing + 1} is being changed: press Update item (Record applies it too).`}</Notice>}
          </Panel>
          <SalesActions total={preview?.totalCents}>
            <Button tone="primary" disabled={!type.canPost || (!ready && !pending)} onClick={openConfirm}>Record</Button>
            {mode.kind === 'new' && <Button disabled={!type.canCreate} onClick={() => void saveDraft()}>Save draft</Button>}
            <Button onClick={() => navigate(docPath(type.key))}>Close</Button>
          </SalesActions>
        </aside>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} original={original ?? undefined} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </div>
  );
}
