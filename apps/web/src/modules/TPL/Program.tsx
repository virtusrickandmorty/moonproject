/**
 * One client's stock program (TPL): its items with the pieces on hand, the restocks being made, and its deliveries.
 * Deliver, Restock, Count and the stock card open as dialogs over the page; putting finished pieces into stock is one
 * button per restock. A delivery is checked first (what it delivers and the invoice it records), then recorded.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, newIdempotencyKey, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, Dialog, Field, Loading, Notice, Panel, ReasonDialog, StatusChip, inputClass, peso, showDate, useAction } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { fromCents, itemLabel, toCents, type Issue, type TplCardRow, type TplDeliveryPreview, type TplItem, type TplProgram, type TplProgramPage } from './types.ts';
import { useLiveReload } from '../../live.ts';
import { usePages } from '../../components/RowPages.tsx';

const STAGE_WORDS: Record<string, string> = { open: 'Not started', in_production: 'In production', ready: 'Finished', partially_released: 'Partly in stock', released: 'All in stock', closed: 'Closed' };
const pieces = (n: number) => `${n.toLocaleString('en-PH')} ${n === 1 ? 'piece' : 'pieces'}`;
/** The checks behind a refused request, as sentences. */
const reasons = (e: unknown): string[] => (e instanceof ApiError && Array.isArray(e.details) ? (e.details as Issue[]).map((i) => i.message) : [e instanceof Error ? e.message : String(e)]);

export function TplProgramPage({ me, params }: { me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const can = (p: string) => me.permissions.includes(p);
  const [page, setPage] = useState<TplProgramPage | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<null | 'deliver' | 'restock' | 'terms' | 'item' | 'items' | 'edit-items' | 'counts' | { item: TplItem } | { count: TplItem } | { card: TplItem } | { cancel: string }>(null);
  const load = useCallback(() => api.tplProgram<TplProgramPage>(id).then((p) => (setPage(p), setError('')), (e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);
  useLiveReload(load);
  const done = () => { setOpen(null); void load(); };
  const put = useAction();
  // The stock and the deliveries, 20 a page (the owner's request, Oct 2026).
  const itemPages = usePages(page?.items);
  const deliveryPages = usePages(page?.deliveries);

  if (!page) return error ? <Notice>{error}</Notice> : <Loading />;
  const { program: p, items, restocks, deliveries, money } = page;
  const active = items.filter((i) => i.isActive);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500"><Link to="/tpl" className="hover:text-indigo-700">TPL services</Link></p>
          <h1 className="text-2xl font-semibold">{p.customerName}{!p.isActive && <span className="ml-2 text-base font-normal text-slate-500">(switched off)</span>}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Terms {p.termsDays} days · Credit limit {p.creditLimitCents > 0 ? peso(p.creditLimitCents) : 'none'} · Owed {peso(money.openCents)}
            {money.overdueCents > 0 && <span className="font-semibold text-red-700"> · Past due {peso(money.overdueCents)}</span>}
          </p>
          {p.note && <p className="text-sm text-slate-500">{p.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can('tpl.program.manage') && <Button onClick={() => setOpen('terms')}>Terms and limit</Button>}
          {can('jo.post') && p.isActive && active.length > 0 && <Button onClick={() => setOpen('restock')}>Restock</Button>}
          {can('tpl.deliver') && p.isActive && <Button tone="primary" disabled={!active.some((i) => i.onHand > 0)} onClick={() => setOpen('deliver')}>Deliver</Button>}
        </div>
      </div>
      {error && <Notice>{error}</Notice>}

      <Panel title="Stock">
        {items.length === 0 ? <p className="text-sm text-slate-500">No items yet. Add what you make and hold for this client.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th>Item</th><th className="text-right">Price a piece</th><th className="text-right">On hand</th><th className="text-right">Restock at</th><th /></tr></thead>
              <tbody>{itemPages.shown.map((i) => {
                const low = i.isActive && i.onHand <= i.reorderLevel;
                return (
                  <tr key={i.id} className={i.isActive ? '' : 'text-slate-500'} data-row-link="off">
                    <td>{itemLabel(i)}{!i.isActive && ' (off)'}<span className="ml-2 text-xs text-slate-500">{i.kind === 'ready_made' ? 'ready-made' : 'made to order'}</span></td>
                    <td className="text-right tabular-nums">{peso(i.priceCents)}</td>
                    <td className={`text-right tabular-nums ${low ? 'font-semibold text-amber-700' : ''}`}>{i.onHand.toLocaleString('en-PH')}</td>
                    <td className="text-right tabular-nums">{i.reorderLevel.toLocaleString('en-PH')}</td>
                    <td className="whitespace-nowrap text-right">
                      <button type="button" className="px-2 text-indigo-700 hover:underline" onClick={() => setOpen({ card: i })}>Stock card</button>
                      {can('tpl.count') && <button type="button" className="px-2 text-indigo-700 hover:underline" onClick={() => setOpen({ count: i })}>Count</button>}
                      {can('tpl.program.manage') && <button type="button" className="px-2 text-indigo-700 hover:underline" onClick={() => setOpen({ item: i })}>Change</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
            {itemPages.buttons}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {can('tpl.program.manage') && <Button onClick={() => setOpen('item')}>+ Add item</Button>}
          {can('tpl.program.manage') && <Button onClick={() => setOpen('items')}>+ Add many items</Button>}
          {can('tpl.program.manage') && items.length > 1 && <Button onClick={() => setOpen('edit-items')}>Change many items</Button>}
          {can('tpl.count') && active.length > 0 && <Button onClick={() => setOpen('counts')}>Count many</Button>}
        </div>
      </Panel>

      {restocks.length > 0 && (
        <Panel title="Being made">
          {put.error && <Notice>{put.error}</Notice>}
          {restocks.map((r) => {
            const ready = r.lines.filter((l) => l.ready > 0 && l.itemId);
            return (
              <div key={r.id} className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm"><Link to={`/docs/jo.job_order/${r.id}`} className="font-semibold text-indigo-700">{r.number}</Link> · due {showDate(r.dueDate)} · <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{STAGE_WORDS[r.stage] ?? r.stage}</span></p>
                  {can('tpl.stock') && (
                    <Button tone="primary" disabled={put.busy || ready.length === 0} title={ready.length === 0 ? 'Nothing finished on the production board yet' : undefined}
                      onClick={() => void put.run(async () => { await api.tplPutIn({ jobOrderId: r.id, lines: ready.map((l) => ({ lineNo: l.lineNo, qty: l.ready })) }); await load(); })}>
                      Put {ready.length > 0 ? pieces(ready.reduce((s, l) => s + l.ready, 0)) : 'pieces'} into stock
                    </Button>
                  )}
                </div>
                <ul className="text-sm text-slate-700">{r.lines.map((l) => (
                  <li key={l.lineNo}>{l.description}: {l.inStock} of {l.qty} in stock{l.ready > 0 && <span className="text-emerald-700"> · {l.ready} finished, ready to put in</span>}</li>
                ))}</ul>
              </div>
            );
          })}
        </Panel>
      )}

      <Panel title="Deliveries">
        {deliveries.length === 0 ? <p className="text-sm text-slate-500">No deliveries yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th>Delivery</th><th>Date</th><th>Invoice no.</th><th className="text-right">Pieces</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>{deliveryPages.shown.map((d) => (
                <tr key={d.id} className={d.status === 'cancelled' ? 'text-slate-500' : ''}>
                  <td><Link to={`/docs/tpl.delivery/${d.id}`} className="font-medium text-indigo-700">{d.number}</Link></td>
                  <td>{showDate(d.date)}</td>
                  <td>{d.invoiceId ? <Link to={`/docs/qs.sale/${d.invoiceId}`} className="text-indigo-700">{d.invoiceNumber}</Link> : d.invoiceNumber}</td>
                  <td className="text-right tabular-nums">{d.pieces}</td>
                  <td className="text-right tabular-nums">{peso(d.totalCents)}</td>
                  <td>{showDate(d.dueDate)}</td>
                  <td><StatusChip status={d.status} /></td>
                  <td className="text-right">{d.status === 'posted' && can('qs.cancel') && <button type="button" className="px-2 text-red-700 hover:underline" onClick={() => setOpen({ cancel: d.id })}>Cancel</button>}</td>
                </tr>
              ))}</tbody>
            </table>
            {deliveryPages.buttons}
          </div>
        )}
      </Panel>

      {open === 'terms' && <TermsDialog program={p} onClose={() => setOpen(null)} onSaved={done} />}
      {(open === 'item' || (open && typeof open === 'object' && 'item' in open)) && <ItemDialog programId={p.id} item={typeof open === 'object' && 'item' in open ? open.item : undefined} onClose={() => setOpen(null)} onSaved={done} />}
      {open && typeof open === 'object' && 'count' in open && <CountDialog item={open.count} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'items' && <ItemsDialog programId={p.id} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'edit-items' && <EditItemsDialog programId={p.id} items={items} onClose={() => setOpen(null)} onSaved={done} />}
      {open === 'counts' && <CountsDialog programId={p.id} items={active} onClose={() => setOpen(null)} onSaved={done} />}
      {open && typeof open === 'object' && 'card' in open && <CardDialog item={open.card} onClose={() => setOpen(null)} />}
      {open === 'restock' && <RestockDialog items={active} onClose={() => setOpen(null)} onSaved={done} programId={p.id} />}
      {open === 'deliver' && <Dialog title={`Deliver to ${p.customerName}`} wide onClose={() => setOpen(null)}><DeliveryEditor page={page} canOverride={can('tpl.override')} onRecorded={done} /></Dialog>}
      {open && typeof open === 'object' && 'cancel' in open && (
        <ReasonDialog title="Cancel this delivery" danger confirmLabel="Cancel delivery and invoice" onClose={() => setOpen(null)}
          explain="The delivery and its invoice are cancelled together (both kept, marked cancelled), and its pieces are back in stock. Refused while a payment stands on the invoice: cancel that collection first."
          onConfirm={async (reason) => { await api.tplCancelDelivery(open.cancel, reason, newIdempotencyKey()); done(); }} />
      )}
    </div>
  );
}

function TermsDialog({ program: p, onClose, onSaved }: { program: TplProgram; onClose: () => void; onSaved: () => void }) {
  const [terms, setTerms] = useState(String(p.termsDays));
  const [limit, setLimit] = useState(fromCents(p.creditLimitCents));
  const [note, setNote] = useState(p.note ?? '');
  const [on, setOn] = useState(p.isActive);
  const a = useAction();
  const save = () => a.run(async () => {
    const cents = toCents(limit);
    if (cents === undefined) throw new Error('Type the credit limit like 50,000.00 (0 for no limit).');
    await api.tplChangeProgram(p.id, { termsDays: Number(terms), creditLimitCents: cents, ...(note.trim() ? { note: note.trim() } : {}), isActive: on, version: p.version });
    onSaved();
  });
  return (
    <Dialog title="Terms and credit limit" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Terms (days to pay)" hint="For deliveries from now on"><input inputMode="numeric" className={inputClass} value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Credit limit" hint="0 = no limit"><input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
        </div>
        <Field label="Note"><input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Program in use</label>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button><Button tone="primary" disabled={a.busy} onClick={() => void save()}>Save</Button></div>
      </div>
    </Dialog>
  );
}

function ItemDialog({ programId, item, onClose, onSaved }: { programId: string; item?: TplItem | undefined; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: item?.kind ?? 'made_to_order', description: item?.description ?? '', size: item?.size ?? '', price: item ? fromCents(item.priceCents) : '', reorder: String(item?.reorderLevel ?? 0), on: item?.isActive ?? true });
  const a = useAction();
  const save = () => a.run(async () => {
    const priceCents = toCents(f.price);
    if (priceCents === undefined || !f.price.trim()) throw new Error('Type the price a piece like 500.00.');
    const body = { kind: f.kind, description: f.description.trim(), size: f.size.trim(), priceCents, reorderLevel: Number(f.reorder || '0') };
    if (item) await api.tplChangeItem(item.id, { ...body, isActive: f.on, version: item.version });
    else await api.tplAddItem(programId, body);
    onSaved();
  });
  return (
    <Dialog title={item ? `Change ${itemLabel(item)}` : 'Add an item'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label="Item" required><input className={inputClass} maxLength={200} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. School polo, white" /></Field>
          <Field label="Size"><input className={inputClass} maxLength={20} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="e.g. M" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Kind">
            <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TplItem['kind'] })}>
              <option value="made_to_order">Made to order</option><option value="ready_made">Ready-made</option>
            </select>
          </Field>
          <Field label="Price a piece" required hint="VAT included"><input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0.00" /></Field>
          <Field label="Restock at" hint="Pieces on hand that call for a restock"><input inputMode="numeric" className={`${inputClass} text-right`} value={f.reorder} onChange={(e) => setF({ ...f, reorder: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} /> Item in use</label>}
        {item && <p className="text-xs text-slate-500">A new price applies to deliveries from now on; past invoices keep theirs.</p>}
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button><Button tone="primary" disabled={a.busy} onClick={() => void save()}>{item ? 'Save' : 'Add'}</Button></div>
      </div>
    </Dialog>
  );
}

function CountDialog({ item, onClose, onSaved }: { item: TplItem; onClose: () => void; onSaved: () => void }) {
  const [counted, setCounted] = useState(String(item.onHand));
  const [reason, setReason] = useState('');
  const a = useAction();
  const diff = Number(counted || '0') - item.onHand;
  return (
    <Dialog title={`Count ${itemLabel(item)}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">On hand by the records: <b>{pieces(item.onHand)}</b>. Type what you counted; the difference is recorded with the reason.</p>
        <Field label="Pieces counted" required><input inputMode="numeric" className={`${inputClass} max-w-40 text-right`} value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} /></Field>
        {diff !== 0 && <p className={`text-sm font-medium ${diff < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{diff > 0 ? `${diff} more` : `${-diff} fewer`} than the records</p>}
        <Field label="Reason" required hint="At least 10 characters"><input className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Count on Oct 31: 3 stained, set aside" /></Field>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button>
          <Button tone="primary" disabled={a.busy || diff === 0} onClick={() => void a.run(async () => { await api.tplCount(item.id, { countedQty: Number(counted || '0'), reason: reason.trim() }); onSaved(); })}>Record the count</Button></div>
      </div>
    </Dialog>
  );
}

/** One row of the add-many grid, as typed. */
type ItemRow = { description: string; size: string; price: string; reorder: string; kind: TplItem['kind'] };
const blankRow = (): ItemRow => ({ description: '', size: '', price: '', reorder: '0', kind: 'made_to_order' });
/**
 * Pasted from Excel: item, size, price a piece, restock at, kind (one item a row, tab-separated; a header row is
 * skipped). Kind is "ready" or "ready-made" for ready-made; anything else is made to order.
 */
export function parseItemPaste(text: string): ItemRow[] {
  return text.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((c, i) => c.some(Boolean) && !(i === 0 && /^(item|description|name)$/i.test(c[0] ?? '')))
    .map(([description = '', size = '', price = '', reorder = '', kind = '']) => ({ description, size, price: price.replace(/[₱\s]/g, ''), reorder: reorder.replace(/\D/g, '') || '0', kind: /^ready/i.test(kind) ? 'ready_made' : 'made_to_order' }));
}

/** Add many items at once (the owner's request, Oct 2026): rows typed or pasted from Excel; all or none. */
function ItemsDialog({ programId, onClose, onSaved }: { programId: string; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<ItemRow[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [paste, setPaste] = useState<string | null>(null);
  const a = useAction();
  const set = (i: number, patch: Partial<ItemRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.description.trim() || r.price.trim());
  const save = () => a.run(async () => {
    if (!filled.length) throw new Error('Type at least one item.');
    const items = filled.map((r, i) => {
      const priceCents = toCents(r.price);
      if (!r.description.trim()) throw new Error(`Row ${i + 1}: type the item.`);
      if (priceCents === undefined || !r.price.trim()) throw new Error(`Row ${i + 1}: type the price a piece like 500.00.`);
      return { kind: r.kind, description: r.description.trim(), size: r.size.trim(), priceCents, reorderLevel: Number(r.reorder || '0') };
    });
    await api.tplAddItems(programId, { items });
    onSaved();
  });
  return (
    <Dialog title="Add many items" wide onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">One item a row. Empty rows are left out. All are added together, or none if a row has a problem.</p>
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Item</th><th className="w-24">Size</th><th className="w-32 text-right">Price a piece</th><th className="w-24 text-right">Restock at</th><th className="w-36">Kind</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td><input aria-label={`Row ${i + 1} item`} className={inputClass} maxLength={200} value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="e.g. School polo, white" /></td>
                <td><input aria-label={`Row ${i + 1} size`} className={inputClass} maxLength={20} value={r.size} onChange={(e) => set(i, { size: e.target.value })} /></td>
                <td><input aria-label={`Row ${i + 1} price`} inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={r.price} onChange={(e) => set(i, { price: e.target.value })} placeholder="0.00" /></td>
                <td><input aria-label={`Row ${i + 1} restock at`} inputMode="numeric" className={`${inputClass} text-right`} value={r.reorder} onChange={(e) => set(i, { reorder: e.target.value.replace(/\D/g, '') })} /></td>
                <td><select aria-label={`Row ${i + 1} kind`} className={inputClass} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as TplItem['kind'] })}><option value="made_to_order">Made to order</option><option value="ready_made">Ready-made</option></select></td>
                <td><button type="button" aria-label={`Remove row ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, k) => k !== i))} className="px-2 text-slate-500 hover:text-red-600 disabled:opacity-30">✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setRows([...rows, blankRow()])}>+ Add a row</Button>
          <Button onClick={() => setPaste(paste === null ? '' : null)}>Paste from Excel</Button>
        </div>
        {paste !== null && (
          <div className="space-y-2">
            <Field label="Pasted rows" hint="Columns: item, size, price a piece, restock at, kind (ready-made or made to order)">
              <textarea rows={4} className={inputClass} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'School polo, white\tM\t450.00\t20\tmade to order'} />
            </Field>
            <Button onClick={() => { const got = parseItemPaste(paste); setRows([...rows.filter((r) => r.description.trim() || r.price.trim()), ...got]); setPaste(null); }}>Add these rows</Button>
          </div>
        )}
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button><Button tone="primary" disabled={a.busy || !filled.length} onClick={() => void save()}>Add {filled.length || ''} {filled.length === 1 ? 'item' : 'items'}</Button></div>
      </div>
    </Dialog>
  );
}

/** One item's row in the change-many grid, as typed. */
export type EditRow = ItemRow & { on: boolean };
export const editRowOf = (i: TplItem): EditRow => ({ description: i.description, size: i.size, price: fromCents(i.priceCents), reorder: String(i.reorderLevel), kind: i.kind, on: i.isActive });

/** The rows to save: only the items changed, each with the version it was read at. Throws naming the item when one is not right. */
export function changedItems(items: TplItem[], rows: Record<string, EditRow>) {
  return items.flatMap((i) => {
    const r = rows[i.id];
    if (!r) return [];
    const priceCents = toCents(r.price);
    if (!r.description.trim()) throw new Error(`${itemLabel(i)}: type the item.`);
    if (priceCents === undefined || !r.price.trim()) throw new Error(`${itemLabel(i)}: type the price a piece like 500.00.`);
    const v = { kind: r.kind, description: r.description.trim(), size: r.size.trim(), priceCents, reorderLevel: Number(r.reorder || '0'), isActive: r.on };
    const same = v.kind === i.kind && v.description === i.description && v.size === i.size && v.priceCents === i.priceCents && v.reorderLevel === i.reorderLevel && v.isActive === i.isActive;
    return same ? [] : [{ id: i.id, ...v, version: i.version }];
  });
}

/**
 * Change many items at once (the owner's request, Oct 28, 2026): every item in one grid to change in place, and a bar
 * that sets the same price, restock level, kind or in use for the ticked ones. Only the items changed are saved, all
 * together or none if one has a problem.
 */
function EditItemsDialog({ programId, items, onClose, onSaved }: { programId: string; items: TplItem[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Record<string, EditRow>>(() => Object.fromEntries(items.map((i) => [i.id, editRowOf(i)])));
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [find, setFind] = useState('');
  const [all, setAll] = useState({ price: '', reorder: '', kind: '', on: '' });
  const a = useAction();
  const set = (id: string, patch: Partial<EditRow>) => setRows((rs) => ({ ...rs, [id]: { ...rs[id]!, ...patch } }));
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((i) => words.every((w) => itemLabel(i).toLowerCase().includes(w)));
  let changes: ReturnType<typeof changedItems> = [];
  let problem = '';
  try { changes = changedItems(items, rows); } catch (e) { problem = (e as Error).message; }
  const tick = (ids: string[], on: boolean) => setTicked((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  const apply = () => setRows((rs) => {
    const n = { ...rs };
    for (const id of ticked) n[id] = { ...n[id]!, ...(all.price.trim() ? { price: all.price.trim() } : {}), ...(all.reorder ? { reorder: all.reorder } : {}),
      ...(all.kind ? { kind: all.kind as TplItem['kind'] } : {}), ...(all.on ? { on: all.on === 'on' } : {}) };
    return n;
  });
  const save = () => a.run(async () => {
    if (problem) throw new Error(problem);
    await api.tplChangeItems(programId, { items: changes });
    onSaved();
  });
  return (
    <Dialog title="Change many items" wide onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Change any item in place, or tick items and set the same value for all of them below. Only the items you change are saved, all together or none if one has a problem. A new price applies to deliveries from now on.</p>
        <input type="search" aria-label="Find an item" placeholder="Find: polo, M, cap…" className={`${inputClass} max-w-xs`} value={find} onChange={(e) => setFind(e.target.value)} />
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="w-8"><input type="checkbox" aria-label="Tick every item shown" checked={shown.length > 0 && shown.every((i) => ticked.has(i.id))} onChange={(e) => tick(shown.map((i) => i.id), e.target.checked)} /></th>
              <th>Item</th><th className="w-20">Size</th><th className="w-32 text-right">Price a piece</th><th className="w-24 text-right">Restock at</th><th className="w-44">Kind</th><th className="w-16">In use</th>
            </tr></thead>
            <tbody>{shown.map((i) => {
              const r = rows[i.id]!;
              const label = itemLabel(i);
              const changed = changes.some((c) => c.id === i.id);
              return (
                <tr key={i.id} className={changed ? 'bg-amber-50' : ''}>
                  <td><input type="checkbox" aria-label={`Tick ${label}`} checked={ticked.has(i.id)} onChange={(e) => tick([i.id], e.target.checked)} /></td>
                  <td><input aria-label={`${label} item`} className={inputClass} maxLength={200} value={r.description} onChange={(e) => set(i.id, { description: e.target.value })} /></td>
                  <td><input aria-label={`${label} size`} className={inputClass} maxLength={20} value={r.size} onChange={(e) => set(i.id, { size: e.target.value })} /></td>
                  <td><input aria-label={`${label} price`} inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={r.price} onChange={(e) => set(i.id, { price: e.target.value })} /></td>
                  <td><input aria-label={`${label} restock at`} inputMode="numeric" className={`${inputClass} text-right`} value={r.reorder} onChange={(e) => set(i.id, { reorder: e.target.value.replace(/\D/g, '') })} /></td>
                  <td><select aria-label={`${label} kind`} className={inputClass} value={r.kind} onChange={(e) => set(i.id, { kind: e.target.value as TplItem['kind'] })}><option value="made_to_order">Made to order</option><option value="ready_made">Ready-made</option></select></td>
                  <td className="text-center"><input type="checkbox" aria-label={`${label} in use`} checked={r.on} onChange={(e) => set(i.id, { on: e.target.checked })} title={i.onHand !== 0 ? `${i.onHand} on hand: deliver or count them out before switching it off` : undefined} /></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={7} className="text-slate-500">No item matches “{find}”.</td></tr>}</tbody>
          </table>
        </div>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium">For the {ticked.size} ticked {ticked.size === 1 ? 'item' : 'items'}: set</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Price a piece"><input aria-label="Price for the ticked" inputMode="decimal" className={`${inputClass} w-32 text-right tabular-nums`} value={all.price} onChange={(e) => setAll({ ...all, price: e.target.value })} placeholder="keep" /></Field>
            <Field label="Restock at"><input aria-label="Restock at for the ticked" inputMode="numeric" className={`${inputClass} w-24 text-right`} value={all.reorder} onChange={(e) => setAll({ ...all, reorder: e.target.value.replace(/\D/g, '') })} placeholder="keep" /></Field>
            <Field label="Kind"><select aria-label="Kind for the ticked" className={`${inputClass} w-40`} value={all.kind} onChange={(e) => setAll({ ...all, kind: e.target.value })}><option value="">Keep</option><option value="made_to_order">Made to order</option><option value="ready_made">Ready-made</option></select></Field>
            <Field label="In use"><select aria-label="In use for the ticked" className={`${inputClass} w-28`} value={all.on} onChange={(e) => setAll({ ...all, on: e.target.value })}><option value="">Keep</option><option value="on">In use</option><option value="off">Off</option></select></Field>
            <Button disabled={ticked.size === 0 || !(all.price.trim() || all.reorder || all.kind || all.on)} onClick={apply}>Set for the ticked</Button>
          </div>
        </div>
        {(a.error || problem) && <Notice>{a.error || problem}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button>
          <Button tone="primary" disabled={a.busy || changes.length === 0 || !!problem} onClick={() => void save()}>{changes.length ? `Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}` : 'Nothing changed yet'}</Button></div>
      </div>
    </Dialog>
  );
}

/** Count many items at once with one reason (the owner's request, Oct 2026): only those typed and different are recorded. */
function CountsDialog({ programId, items, onClose, onSaved }: { programId: string; items: TplItem[]; onClose: () => void; onSaved: () => void }) {
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const a = useAction();
  const pages = usePages(items);
  const lines = items.filter((i) => (counted[i.id] ?? '') !== '').map((i) => ({ itemId: i.id, countedQty: Number(counted[i.id]) }));
  const changed = lines.filter((l) => l.countedQty !== items.find((i) => i.id === l.itemId)!.onHand);
  const save = () => a.run(async () => {
    if (reason.trim().length < 10) throw new Error('Say why, in at least 10 characters.');
    await api.tplCountMany(programId, { reason: reason.trim(), lines: changed });
    onSaved();
  });
  return (
    <Dialog title="Count many items" wide onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Type what you counted for each item; leave an item empty to skip it. Only those that differ from the records are recorded, all with the reason below.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Item</th><th className="text-right">On hand (records)</th><th className="w-32 text-right">Counted</th><th className="w-24 text-right">Difference</th></tr></thead>
            <tbody>{pages.shown.map((i) => {
              const typed = counted[i.id] ?? '';
              const diff = typed === '' ? null : Number(typed) - i.onHand;
              return (
                <tr key={i.id}>
                  <td>{itemLabel(i)}</td>
                  <td className="text-right tabular-nums">{i.onHand.toLocaleString('en-PH')}</td>
                  <td><input aria-label={`Counted ${itemLabel(i)}`} inputMode="numeric" className={`${inputClass} text-right`} value={typed} onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value.replace(/\D/g, '') })} /></td>
                  <td className={`text-right tabular-nums ${diff ? (diff < 0 ? 'text-red-700' : 'text-emerald-700') : 'text-slate-400'}`}>{diff === null ? '' : diff > 0 ? `+${diff}` : diff}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {pages.buttons}
        </div>
        <Field label="Reason" required hint="At least 10 characters, kept on each item's stock card"><input className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Month-end count on Oct 31" /></Field>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button><Button tone="primary" disabled={a.busy || changed.length === 0} onClick={() => void save()}>Record {changed.length || ''} {changed.length === 1 ? 'count' : 'counts'}</Button></div>
      </div>
    </Dialog>
  );
}

const MOVE_WORDS: Record<TplCardRow['kind'], string> = { in: 'Put into stock', count: 'Count', out: 'Delivered', back: 'Back (delivery cancelled)' };
function CardDialog({ item, onClose }: { item: TplItem; onClose: () => void }) {
  const [rows, setRows] = useState<TplCardRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.tplStockCard<{ rows: TplCardRow[] }>(item.id).then((r) => setRows(r.rows), (e: Error) => setError(e.message)), [item.id]);
  const cardPages = usePages(rows);
  return (
    <Dialog title={`Stock card: ${itemLabel(item)}`} wide onClose={onClose}>
      {error && <Notice>{error}</Notice>}
      {!rows ? <Loading /> : rows.length === 0 ? <p className="text-sm text-slate-500">No movements yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Date</th><th>What</th><th>Document</th><th className="text-right">Pieces</th><th className="text-right">Balance</th><th>By</th></tr></thead>
            <tbody>{cardPages.shown.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap">{showDate(r.date)}</td>
                <td>{MOVE_WORDS[r.kind]}{r.reason && <span className="block text-xs text-slate-500">{r.reason}</span>}</td>
                <td>{r.documentId && r.docType ? <Link to={`/docs/${r.docType}/${r.documentId}`} className="text-indigo-700">{r.number}</Link> : '—'}</td>
                <td className={`text-right tabular-nums ${r.qty < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{r.qty > 0 ? `+${r.qty}` : r.qty}</td>
                <td className="text-right tabular-nums font-medium">{r.balance}</td>
                <td>{r.byName}</td>
              </tr>
            ))}</tbody>
          </table>
          {cardPages.buttons}
        </div>
      )}
    </Dialog>
  );
}

function RestockDialog({ programId, items, onClose, onSaved }: { programId: string; items: TplItem[]; onClose: () => void; onSaved: () => void }) {
  // Start from what is at or below its restock level: enough to get back to twice that level.
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.onHand <= i.reorderLevel ? String(Math.max(1, i.reorderLevel * 2 - i.onHand)) : ''])));
  const [days, setDays] = useState('10');
  const [rush, setRush] = useState(false);
  const [notes, setNotes] = useState('');
  const a = useAction();
  const lines = items.filter((i) => Number(qty[i.id] || '0') > 0).map((i) => ({ itemId: i.id, qty: Number(qty[i.id]) }));
  const save = () => a.run(async () => {
    await api.tplRestock({ programId, dueInDays: Number(days || '0'), priority: rush ? 'rush' : 'normal', lines, ...(notes.trim() ? { notes: notes.trim() } : {}) });
    onSaved();
  });
  return (
    <Dialog title="Restock" wide onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Records a job order for the client&apos;s stock at ₱0 (the pieces are billed when delivered). It goes to the production board like any job order.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th>Item</th><th className="text-right">On hand</th><th className="text-right">Restock at</th><th className="w-32 text-right">Make</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} data-row-link="off">
                <td>{itemLabel(i)}</td>
                <td className={`text-right tabular-nums ${i.onHand <= i.reorderLevel ? 'font-semibold text-amber-700' : ''}`}>{i.onHand}</td>
                <td className="text-right tabular-nums">{i.reorderLevel}</td>
                <td><input aria-label={`Make ${itemLabel(i)}`} inputMode="numeric" className={`${inputClass} text-right`} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.replace(/\D/g, '') })} placeholder="0" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Due in (days)"><input inputMode="numeric" className={inputClass} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Notes for production"><input className={inputClass} maxLength={900} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} /> Rush</label>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm text-slate-600">{pieces(lines.reduce((s, l) => s + l.qty, 0))} to make</span>
          <Button onClick={onClose}>Back</Button><Button tone="primary" disabled={a.busy || lines.length === 0} onClick={() => void save()}>Record the restock</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The delivery: pieces per item from stock, the fee and the booklet invoice; checked, then recorded with its invoice. */
export function DeliveryEditor({ page, canOverride, onRecorded }: { page: TplProgramPage; canOverride: boolean; onRecorded: (r: { delivery: { id: string; number: string } }) => void }) {
  const items = page.items.filter((i) => i.isActive && i.onHand > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [f, setF] = useState({ invoiceNumber: '', fee: '', deliveredBy: '', receivedBy: '', tracking: '', overrideReason: '', note: '' });
  const [checked, setChecked] = useState<TplDeliveryPreview | null>(null);
  const [key] = useState(newIdempotencyKey);
  const a = useAction();
  const feeCents = toCents(f.fee);
  const body = () => ({
    programId: page.program.id, invoiceNumber: f.invoiceNumber.trim(), feeCents: feeCents ?? 0, deliveredBy: f.deliveredBy.trim(),
    lines: items.filter((i) => Number(qty[i.id] || '0') > 0).map((i) => ({ itemId: i.id, qty: Number(qty[i.id]) })),
    ...(f.receivedBy.trim() ? { receivedBy: f.receivedBy.trim() } : {}), ...(f.tracking.trim() ? { tracking: f.tracking.trim() } : {}),
    ...(f.overrideReason.trim() ? { overrideReason: f.overrideReason.trim() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}),
  });
  const edit = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setChecked(null); };
  const issues = [...(checked?.delivery.issues ?? []), ...(checked?.invoice?.issues ?? [])];
  const errors = issues.filter((i) => i.level === 'error');
  const hold = issues.some((i) => i.code === 'CREDIT_HOLD' || i.code === 'CREDIT_OVERRIDE') || !!f.overrideReason;
  const goodsCents = items.reduce((s, i) => s + Number(qty[i.id] || '0') * i.priceCents, 0);

  const check = () => a.run(async () => {
    if (feeCents === undefined) throw new Error('Type the delivery fee like 150.00 (or leave it empty).');
    setChecked(await api.tplDeliveryPreview<TplDeliveryPreview>(body()));
  });
  const record = () => a.run(async () => {
    try { onRecorded(await api.tplDeliver(body(), checked!.totalCents, key)); } catch (e) { throw new Error(reasons(e).join(' ')); }
  });

  if (items.length === 0) return <p className="text-sm text-slate-500">Nothing on hand to deliver. Restock first.</p>;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th>Item</th><th className="text-right">On hand</th><th className="text-right">Price a piece</th><th className="w-32 text-right">Deliver</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{items.map((i) => {
            const n = Number(qty[i.id] || '0');
            return (
              <tr key={i.id} data-row-link="off">
                <td>{itemLabel(i)}</td>
                <td className="text-right tabular-nums">{i.onHand}</td>
                <td className="text-right tabular-nums">{peso(i.priceCents)}</td>
                <td><input aria-label={`Deliver ${itemLabel(i)}`} inputMode="numeric" className={`${inputClass} text-right ${n > i.onHand ? 'border-red-400' : ''}`} value={qty[i.id] ?? ''} placeholder="0"
                  onChange={(e) => { setQty({ ...qty, [i.id]: e.target.value.replace(/\D/g, '') }); setChecked(null); }} /></td>
                <td className="text-right tabular-nums">{n > 0 ? peso(n * i.priceCents) : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Invoice no. (from the booklet)" required><input inputMode="numeric" className={inputClass} value={f.invoiceNumber} onChange={(e) => edit({ invoiceNumber: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Delivery fee" hint="Empty = none"><input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={f.fee} onChange={(e) => edit({ fee: e.target.value })} placeholder="0.00" /></Field>
        <Field label="Delivered by" required hint="Our rider, or the courier"><input className={inputClass} maxLength={120} value={f.deliveredBy} onChange={(e) => edit({ deliveredBy: e.target.value })} /></Field>
        <Field label="Received by"><input className={inputClass} maxLength={120} value={f.receivedBy} onChange={(e) => edit({ receivedBy: e.target.value })} /></Field>
        <Field label="Tracking no."><input className={inputClass} maxLength={60} value={f.tracking} onChange={(e) => edit({ tracking: e.target.value })} /></Field>
        <Field label="Note"><input className={inputClass} maxLength={500} value={f.note} onChange={(e) => edit({ note: e.target.value })} /></Field>
      </div>
      {hold && (
        <Field label="Why deliver anyway?" hint={canOverride ? 'Over the credit limit or with an invoice past due: give the reason (kept in the audit)' : 'Only the owner (or someone allowed to override) can deliver now'}>
          <input className={inputClass} maxLength={500} disabled={!canOverride} value={f.overrideReason} onChange={(e) => edit({ overrideReason: e.target.value })} />
        </Field>
      )}
      {checked && (
        <div className="space-y-2">
          {errors.map((i, n) => <Notice key={n}>{i.message}</Notice>)}
          {issues.filter((i) => i.level === 'warning').map((i, n) => <Notice key={n} tone="info">{i.message}</Notice>)}
          {errors.length === 0 && <Notice tone="success">{checked.delivery.summary}</Notice>}
        </div>
      )}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm font-semibold tabular-nums">Total: {peso(goodsCents + (feeCents ?? 0))} · due in {page.program.termsDays} days</span>
        {!checked || errors.length > 0
          ? <Button tone="primary" disabled={a.busy} onClick={() => void check()}>Check</Button>
          : <Button tone="primary" disabled={a.busy} onClick={() => void record()}>Record delivery and invoice</Button>}
      </div>
    </div>
  );
}

/** /docs/tpl.delivery/new: pick the client, then the delivery. */
export function TplDeliveryForm({ me }: { me: Me }) {
  const [programs, setPrograms] = useState<{ id: string; customerName: string; isActive: boolean }[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [page, setPage] = useState<TplProgramPage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.tplPrograms<{ rows: { id: string; customerName: string; isActive: boolean }[] }>().then((r) => setPrograms(r.rows.filter((p) => p.isActive)), (e: Error) => setError(e.message)), []);
  useEffect(() => { setPage(null); if (chosen) void api.tplProgram<TplProgramPage>(chosen).then(setPage, (e: Error) => setError(e.message)); }, [chosen]);
  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">New delivery</h1>
      {error && <Notice>{error}</Notice>}
      {!programs ? <Loading /> : programs.length === 0 ? <p role="status" className="text-sm text-slate-500">No stock programs yet. Set one up in <Link to="/tpl" className="text-indigo-700 underline">TPL services</Link>.</p> : (
        <Field label="Client">
          <select className={`${inputClass} max-w-md`} value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Pick the client</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.customerName}</option>)}
          </select>
        </Field>
      )}
      {chosen && !page && <Loading />}
      {page && <Panel title="What goes out"><DeliveryEditor page={page} canOverride={me.permissions.includes('tpl.override')} onRecorded={() => navigate(`/tpl/${page.program.id}`)} /></Panel>}
    </div>
  );
}
