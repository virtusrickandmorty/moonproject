/**
 * Opening job order form (PLAN D8 "Cut-over" step 2): a job order the shop took before the cut-over date and has not
 * finished or not been paid for. Laid out like the job order form (the owner's request, Oct 2026): the job order on the
 * left, then an item form for what is still to make or release (price list item, kind, pieces, price, discount and its
 * wearers) whose "+ Add to order" puts it in the breakdown on the right, where each item can be changed (Edit) or
 * removed; then the money at the cut-over. It is recorded on the cut-over date. Also its Edit (cancel + reissue, NR-4).
 */
import { useEffect, useRef, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CatItem, type CustomerWearers, type DocTypeInfo, type OpeningStatus } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, showDate, useCloseDialog } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { cents } from '../COL/money.ts';
import { CustomerPicker, Errors, Figures, useLive, type Picked } from '../COL/parts.tsx';
import { KINDS } from '../QS/lines.ts';
import { SalesActions } from './entry.tsx';
import { ItemSearch } from './parts.tsx';
import { RosterGrid, SIZES } from './JobOrderForm.tsx';
import { KIND_OF_CLASS, blankLine, emptyJo, emptyJoLine, joInput, lineQty, type JoLineRow, type RosterInput } from './forms.ts';
import { TERMS, emptyOpening, openingInput, openingValues, type OpeningInput, type OpeningLineRow, type OpeningValues } from './opening.ts';

const money = `${inputClass} text-right tabular-nums`;
const emptyLine = (l: OpeningLineRow) => !l.description.trim() && !l.price.trim() && !l.discount.trim();

/** An item typed in the item form -> a line still to make or release (its wearers as the server takes them). */
function toOpeningLine(item: JoLineRow): OpeningLineRow {
  const converted = joInput({ ...emptyJo(), customer: { id: '-', name: '' }, paymentTerms: 'dp50', lines: [item] }).input.lines[0];
  return { kind: item.kind, description: item.description.trim(), qty: lineQty(item), price: item.price, discount: item.discount, roster: converted?.roster ?? [] };
}
/** A line back into the item form, for Edit. */
function toItem(l: OpeningLineRow): JoLineRow {
  return {
    ...emptyJoLine(), kind: l.kind, description: l.description, qty: l.qty, price: l.price, discount: l.discount,
    roster: (l.roster as RosterInput[]).map((r) => ({
      personId: r.personId ?? '', name: r.name ?? '', sizeMode: r.sizeMode, size: r.size ?? '', jerseyName: r.jerseyName ?? '', jerseyNumber: r.jerseyNumber ?? '', qty: String(r.qty), garmentType: r.garmentType ?? '',
    })),
  };
}

export function OpeningJobOrderForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<OpeningValues>(() => ({ ...emptyOpening(), lines: [] }));
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [opening, setOpening] = useState<OpeningStatus | null>(null);
  const [item, setItem] = useState<JoLineRow>(emptyJoLine);
  const [editing, setEditing] = useState<number | null>(null);
  const [itemTouched, setItemTouched] = useState(false);
  const [noPrice, setNoPrice] = useState('');
  const [people, setPeople] = useState<CustomerWearers | null>(null);
  const [sizes, setSizes] = useState<string[]>(SIZES);
  const latestItem = useRef(item);
  latestItem.current = item;
  const itemForm = useRef<HTMLDivElement>(null);
  const closeDialog = useCloseDialog(); // opened over the list: the dialog shows the title, and Close instead of Back
  const r = useRecord(type, mode, (d) => {
    const back = openingValues(d.input as unknown as OpeningInput);
    setV({ ...back, lines: back.lines.filter((l) => !emptyLine(l)) });
    setCustomer({ id: (d.input as { customerId: string }).customerId, name: (d.doc as { customerName?: string } | undefined)?.customerName ?? 'Customer on file' });
  });
  useEffect(() => void api.opening().then(setOpening, r.fail), []);
  useEffect(() => { api.cusSizes().then((s) => { const active = s.filter((x) => x.is_active === 1).map((x) => x.label); if (active.length > 0) setSizes(active); }, () => undefined); }, []);
  useEffect(() => { setPeople(null); if (customer) api.joWearers(customer.id).then(setPeople, r.fail); }, [customer?.id]);

  const set = (patch: Partial<OpeningValues>) => setV((old) => ({ ...old, ...patch }));
  const setItemPatch = (patch: Partial<JoLineRow>) => setItem((l) => ({ ...l, ...patch }));
  /** The price list's tier price for the quantity fills the price (the old price can be typed over it). */
  const lookup = (itemId: string, qty: string) => {
    if (!itemId || !/^[1-9]\d*$/.test(qty)) return;
    api.catPrice(itemId, Number(qty)).then(
      (p) => { setNoPrice(''); setItem((l) => (l.itemId === itemId && !l.price.trim() ? { ...l, price: formatPesos(p.unitPriceCents), listCents: p.unitPriceCents } : l)); },
      () => setNoPrice(`The price list has no price for ${qty} of this item: type the old price.`),
    );
  };
  const pick = (it: CatItem) => { setItemPatch({ itemId: it.id, kind: KIND_OF_CLASS[it.class], description: it.name, price: '', listCents: null }); lookup(it.id, lineQty(latestItem.current)); };
  const itemErrors = joInput({ ...emptyJo(), customer: { id: '-', name: '' }, paymentTerms: 'dp50', lines: [item] }).errors
    .filter((e) => e.startsWith('Line 1') || e === 'Add at least one line.')
    .map((e) => (e === 'Add at least one line.' ? 'Pick an item from the price list or say what is still to make or release.' : e.replace(/^Line 1/, 'This item')));
  const clearItem = () => { setItem(emptyJoLine()); setEditing(null); setNoPrice(''); setItemTouched(false); };
  const putItem = () => {
    setItemTouched(true);
    if (itemErrors.length > 0) return;
    const line = toOpeningLine(item);
    set({ lines: editing === null ? [...v.lines, line] : v.lines.map((l, j) => (j === editing ? line : l)) });
    clearItem();
  };
  const editItem = (i: number) => { setItem(toItem(v.lines[i]!)); setEditing(i); setItemTouched(false); itemForm.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); };
  const removeItem = (i: number) => { set({ lines: v.lines.filter((_, j) => j !== i) }); if (editing === i) clearItem(); else if (editing !== null && editing > i) setEditing(editing - 1); };

  const pending = !blankLine(item);
  const withPending = pending && itemErrors.length === 0 ? (editing === null ? [...v.lines, toOpeningLine(item)] : v.lines.map((l, j) => (j === editing ? toOpeningLine(item) : l))) : v.lines;
  const typed = openingInput({ ...v, lines: withPending, customerId: customer?.id ?? '' });
  const date = opening?.cutoverDate ?? undefined;
  const closed = opening?.closed ? `The opening was closed on ${opening.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.` : '';
  const noDate = opening && !opening.cutoverDate ? 'Set the cut-over date on the opening balances screen first.' : '';
  const errors = [...typed.errors, ...(pending && itemErrors.length > 0 ? ['The item in the form is not complete: finish it and press Add to order, or Clear it.'] : []), ...[closed, noDate].filter(Boolean)];
  const live = useLive(JSON.stringify([typed.input, date]), typed.errors.length === 0 && !!date, () => r.preview(typed.input, date));
  /** Record takes a complete item still in the item form with it (added, or its change applied). */
  const record = () => {
    if (pending && itemErrors.length === 0) { set({ lines: withPending }); clearItem(); }
    if (pending) setItemTouched(true);
    r.ask(typed.input, errors, date);
  };

  const receivable = cents(v.receivable) ?? 0;
  const deposits = cents(v.deposits) ?? 0;
  const totalCents = typed.linesCents + receivable;

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        <div className="min-w-0 space-y-4">
          {!closeDialog && <h1 className="text-2xl font-semibold">{r.title('New opening job order')}</h1>}
          {r.top}
          {closed && <Notice>{closed}</Notice>}
          {noDate && <Notice tone="warning">{noDate}</Notice>}
          {date && !closed && <Notice tone="info">A job order taken before the cut-over and not finished or not paid for. It is recorded on the cut-over date, {showDate(date)}, and then works like any job order.</Notice>}
          <Panel title="The job order">
            <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Customer" required><CustomerPicker value={customer} onChange={(c) => { setCustomer(c); if (c?.id !== customer?.id) { set({ lines: v.lines.map((l) => ({ ...l, roster: [] })) }); setItemPatch({ roster: [] }); } }} /></Field>
              <Field label="Job order no. in the old records" required>
                <input className={inputClass} value={v.oldNumber} onChange={(e) => set({ oldNumber: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Due date" required hint="As promised to the customer">
                <input type="date" className={inputClass} value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              </Field>
              <Field label="Payment terms" required>
                <select className={inputClass} value={v.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value as OpeningValues['paymentTerms'] })}>
                  <option value="" />
                  {TERMS.map(([key, words]) => <option key={key} value={key}>{words}</option>)}
                </select>
              </Field>
              <Field label="Priority" required>
                <select className={inputClass} value={v.priority} onChange={(e) => set({ priority: e.target.value as OpeningValues['priority'] })}>
                  <option value="normal">Normal</option>
                  <option value="rush">Rush</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact person"><input className={inputClass} value={v.contact} onChange={(e) => set({ contact: e.target.value })} /></Field>
              <Field label="Notes"><input className={inputClass} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </div>
          </Panel>
          <div ref={itemForm} className="scroll-mt-4">
            <Panel title={editing === null ? 'Still to make or release: add an item' : `Still to make or release: change item ${editing + 1}`}>
              <p className="text-sm text-slate-600">Only what has not been released yet, at the old prices. Leave it empty when everything went out.</p>
              <div className="space-y-3">
                <ItemSearch label="Item price list item" onPick={pick} />
                <div role="radiogroup" aria-label="Kind of item" className="flex flex-wrap gap-2">
                  {KINDS.map(([k, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={item.kind === k} onClick={() => setItemPatch({ kind: k })}
                      className={`rounded-full px-3 py-1 text-sm ring-1 ${item.kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>{label}</button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Description"><input aria-label="Item description" placeholder="What, e.g. Team jersey set" className={inputClass} value={item.description} onChange={(e) => setItemPatch({ description: e.target.value })} /></Field>
                  <Field label="Pieces"><input aria-label="Item pieces" inputMode="numeric" className={money} value={lineQty(item)} readOnly={item.roster.length > 0}
                    title={item.roster.length > 0 ? 'Follows the wearers listed below' : undefined} onChange={(e) => { setItemPatch({ qty: e.target.value }); lookup(item.itemId, e.target.value); }} /></Field>
                  <Field label="Price each" hint="The price on the old job order"><input aria-label="Item price each" inputMode="decimal" placeholder="Price each" className={money} value={item.price} onChange={(e) => setItemPatch({ price: e.target.value })} /></Field>
                  <Field label="Discount (optional)"><input aria-label="Item discount" inputMode="decimal" placeholder="0.00" className={money} value={item.discount} onChange={(e) => setItemPatch({ discount: e.target.value })} /></Field>
                </div>
                {noPrice && <p className="text-xs text-amber-700">{noPrice}</p>}
                <details open={item.roster.length > 0}>
                  <summary className="cursor-pointer text-sm text-indigo-700">Wearers{item.roster.length > 0 ? ` (${item.roster.length})` : ''}</summary>
                  {customer ? <RosterGrid line={item} n="Item" people={people} sizes={sizes} onChange={(roster) => setItemPatch({ roster })} /> : <p className="text-sm text-slate-500">Pick the customer first.</p>}
                </details>
                <Errors list={itemErrors} show={itemTouched} />
                <div className="flex flex-wrap gap-2">
                  <Button tone="primary" onClick={putItem} disabled={v.lines.length >= 50 && editing === null}>{editing === null ? '+ Add to order' : 'Update item'}</Button>
                  {(editing !== null || pending) && <Button onClick={clearItem}>{editing === null ? 'Clear' : 'Cancel the change'}</Button>}
                </div>
              </div>
            </Panel>
          </div>
          <Panel title="Money at the cut-over">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Deposits held" hint="Paid on it and not yet applied to an invoice">
                <input inputMode="decimal" placeholder="0.00" className={money} value={v.deposits} onChange={(e) => set({ deposits: e.target.value })} />
              </Field>
              <Field label="Old receipt numbers"><input className={inputClass} value={v.depositsMemo} onChange={(e) => set({ depositsMemo: e.target.value })} /></Field>
              <Field label="Invoiced and not yet paid" hint="Released and invoiced before the cut-over">
                <input inputMode="decimal" placeholder="0.00" className={money} value={v.receivable} onChange={(e) => set({ receivable: e.target.value })} />
              </Field>
              <Field label="Old invoice numbers" required={receivable > 0}><input className={inputClass} value={v.oldInvoices} onChange={(e) => set({ oldInvoices: e.target.value })} /></Field>
            </div>
          </Panel>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-0">
          <Panel title="So far">
            {v.lines.length === 0 && <p className="text-sm text-slate-500">Nothing still to make or release yet. Fill in the item on the left, then press Add to order.</p>}
            {v.lines.length > 0 && (
              <ol className="divide-y divide-slate-100" aria-label="Still to make or release">
                {v.lines.map((l, i) => {
                  const each = cents(l.price);
                  const off = cents(l.discount) ?? 0;
                  const total = each === undefined ? undefined : Number(l.qty) * each - off;
                  return (
                    <li key={i} className={`flex gap-3 py-2 ${editing === i ? '-mx-2 rounded-md bg-indigo-50 px-2' : ''}`}>
                      <span className="w-5 shrink-0 text-sm text-slate-500">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={l.description}>{l.description}</p>
                        <p className="text-xs text-slate-500">{l.qty} pcs × {each === undefined ? '—' : peso(each)}{off ? ` less ${peso(off)}` : ''}{l.roster.length > 0 ? ` · ${l.roster.length} wearer${l.roster.length === 1 ? '' : 's'}` : ''}</p>
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
              <Figures items={[['Still to release', typed.linesCents], ['Invoiced, not yet paid', receivable], ['Total', totalCents], ['Deposits held', deposits], ['Balance due', totalCents - deposits, 'font-semibold']]} />
            </div>
            {live && <p className="text-sm">{live.summary}</p>}
            {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
            {pending && <Notice tone="warning">{editing === null ? 'The item in the form is not added yet: press Add to order (Record adds it too).' : `Item ${editing + 1} is being changed: press Update item (Record applies it too).`}</Notice>}
          </Panel>
          <Errors list={errors} show={r.touched} />
          <SalesActions total={totalCents - deposits} label="Balance due">
            <Button tone="primary" disabled={!type.canPost || !!closed} onClick={record} title="Ctrl+Enter">Record</Button>
            {closeDialog ? <Button onClick={closeDialog}>Close</Button> : <Button onClick={() => history.back()}>Back</Button>}
          </SalesActions>
        </aside>
      </div>
      {r.dialog}
    </form>
  );
}
