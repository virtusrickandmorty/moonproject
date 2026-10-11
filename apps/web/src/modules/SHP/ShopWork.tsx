/**
 * Sales › Website shop › Shop work (the owner's request, Oct 2026): the shop's own items going through production. A
 * restock or rework is sent from a product's stock window; a change (pieces made into a website item) is added here. Each
 * is a job order on the production board; when the board shows pieces finished, they are put into the shop's stock here,
 * and only then are they for sale. Pieces taken off sale and not worked on can be given back.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, showDate, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { masterRequest } from '../CUS/http.ts';

interface Item { productId: string; name: string; size: string; colour: string }
interface WorkLine { lineNo: number; description: string; qty: number; putIn: number; ready: number; canGiveBack: number; item: Item | null; from: Item | null; source: string | null; sourceNote: string | null }
interface Work { id: string; number: string; dueDate: string; priority: 'normal' | 'rush'; stage: string; kind: 'make' | 'rework' | 'change'; lines: WorkLine[] }
interface ProductRow { id: string; name: string; madeToOrder: boolean; isActive: boolean; sizes: string[]; colours: { name: string }[]; stock: { size: string; colour: string; available: number }[] | null }

export const KIND_LABEL = { make: 'Restock', rework: 'Rework', change: 'Change' } as const;
const STAGE_LABEL: Record<string, string> = { open: 'Open', in_production: 'In production', ready: 'Ready', partially_released: 'Partly in stock', released: 'In stock' };

export function ShopWork({ me }: { me: Me }) {
  const [rows, setRows] = useState<Work[] | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState('');
  const { busy, error, run } = useAction();
  const canStock = me.permissions.includes('shp.stock');
  const canWork = me.permissions.includes('shp.work');
  const load = useCallback(() => masterRequest<Work[]>(me, '/api/shp/work').then(setRows), [me]);
  useEffect(() => { void run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = (w: Work, l: WorkLine, what: string) => `${w.id}|${l.lineNo}|${what}`;
  const send = (w: Work, what: 'put-in' | 'give-back') => run(async () => {
    setDone('');
    const lines = w.lines.flatMap((l) => {
      const v = (typed[k(w, l, what)] ?? '').trim();
      if (!v) return [];
      if (!/^\d+$/.test(v) || Number(v) < 1) throw new Error(`Line ${l.lineNo}: type whole pieces.`);
      return [{ lineNo: l.lineNo, qty: Number(v) }];
    });
    if (!lines.length) throw new Error(what === 'put-in' ? 'Type how many finished pieces go into the stock.' : 'Type how many pieces go back on sale.');
    const r = await masterRequest<{ complete?: boolean }>(me, `/api/shp/work/${w.id}/${what}`, 'POST', { lines });
    setTyped({});
    setDone(what === 'put-in' ? (r.complete ? `${w.number}: every piece is in the shop's stock.` : `${w.number}: pieces put into the shop's stock.`) : `${w.number}: pieces back on sale.`);
    await load();
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          The shop's items going through production. Send a restock or rework from a product's <strong>Stock</strong> window; add a change here. When the
          production board shows pieces finished, put them into the shop's stock: only then are they for sale.
        </p>
        {canWork && <Button tone="primary" onClick={() => setChanging(true)}>+ Change items</Button>}
      </div>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {rows?.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">No shop work in production.</p>}
      {rows?.map((w) => (
        <section key={w.id} aria-label={w.number} className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/docs/jo.job_order/${w.id}`} className="font-semibold text-indigo-700 underline">{w.number}</Link>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{KIND_LABEL[w.kind]}</span>
            {w.priority === 'rush' && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">RUSH</span>}
            <span className="text-sm text-slate-600">{STAGE_LABEL[w.stage] ?? w.stage} · due {showDate(w.dueDate)}</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Item</th><th className="text-right">Pieces</th><th className="text-right">In stock</th><th className="text-right">Finished, waiting</th>{canStock && <th />}</tr></thead>
            <tbody>
              {w.lines.map((l) => (
                <tr key={l.lineNo} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-2">{l.description}</td>
                  <td className="text-right tabular-nums">{l.qty}</td>
                  <td className="text-right tabular-nums">{l.putIn}</td>
                  <td className={`text-right tabular-nums ${l.ready ? 'font-semibold text-emerald-700' : ''}`}>{l.ready}</td>
                  {canStock && (
                    <td className="space-y-1 py-1 pl-3 text-right">
                      {l.ready > 0 && <input className={`${inputClass} w-24 text-right`} inputMode="numeric" aria-label={`Put into stock: ${w.number} line ${l.lineNo}`} placeholder={`up to ${l.ready}`}
                        value={typed[k(w, l, 'put-in')] ?? ''} onChange={(e) => setTyped({ ...typed, [k(w, l, 'put-in')]: e.target.value })} />}
                      {l.canGiveBack > 0 && <input className={`${inputClass} w-24 text-right`} inputMode="numeric" aria-label={`Back on sale: ${w.number} line ${l.lineNo}`} placeholder={`back ≤ ${l.canGiveBack}`}
                        value={typed[k(w, l, 'give-back')] ?? ''} onChange={(e) => setTyped({ ...typed, [k(w, l, 'give-back')]: e.target.value })} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {canStock && (
            <div className="flex flex-wrap justify-end gap-2">
              {w.lines.some((l) => l.canGiveBack > 0) && <Button disabled={busy} onClick={() => void send(w, 'give-back')}>Put back on sale (not worked on)</Button>}
              {w.lines.some((l) => l.ready > 0) ? <Button tone="primary" disabled={busy} onClick={() => void send(w, 'put-in')}>Put into the shop's stock</Button>
                : <span className="text-xs text-slate-500">Nothing finished yet: the production board moves it along.</span>}
            </div>
          )}
        </section>
      ))}
      {changing && <ChangeDialog me={me} onClose={() => setChanging(false)} onSaved={(n) => { setChanging(false); setDone(`${n} is on the production board.`); void load(); }} />}
    </div>
  );
}

interface ChangeRow { to: string; qty: string; source: 'shop_stock' | 'job_order' | 'other'; from: string; note: string }
const emptyRow = (): ChangeRow => ({ to: '', qty: '', source: 'shop_stock', from: '', note: '' });
const itemKey = (p: string, size: string, colour: string) => `${p}|${size}|${colour}`;

/** Pieces made into a website item: from the shop's own stock (taken off sale), a job order's leftovers, or other pieces. */
function ChangeDialog({ me, onClose, onSaved }: { me: Me; onClose: () => void; onSaved: (number: string) => void }) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [rows, setRows] = useState<ChangeRow[]>([emptyRow()]);
  const [due, setDue] = useState('7');
  const [rush, setRush] = useState(false);
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => { void run(() => masterRequest<ProductRow[]>(me, '/api/shp/admin/products').then(setProducts)); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  const stockItems = products.filter((p) => p.isActive && !p.madeToOrder);
  const options = stockItems.flatMap((p) => p.colours.flatMap((c) => p.sizes.map((s) => ({ key: itemKey(p.id, s, c.name), label: `${p.name} (${c.name}, ${s})`, available: p.stock?.find((x) => x.size === s && x.colour === c.name)?.available ?? 0 }))));
  const set = (i: number, patch: Partial<ChangeRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const asItem = (key: string) => { const [productId, size, colour] = key.split('|') as [string, string, string]; return { productId, size, colour }; };

  const save = () => run(async () => {
    const lines = rows.map((r, i) => {
      if (!r.to) throw new Error(`Line ${i + 1}: pick the website item the pieces become.`);
      if (!/^\d+$/.test(r.qty.trim()) || Number(r.qty) < 1) throw new Error(`Line ${i + 1}: type how many pieces.`);
      if (r.source === 'shop_stock' && !r.from) throw new Error(`Line ${i + 1}: pick the website item the pieces are taken from.`);
      if (r.source !== 'shop_stock' && r.note.trim().length < 3) throw new Error(r.source === 'job_order' ? `Line ${i + 1}: type the job order the leftovers are from (e.g. JO-000123).` : `Line ${i + 1}: say where the pieces come from.`);
      return { to: asItem(r.to), qty: Number(r.qty), source: r.source, ...(r.source === 'shop_stock' ? { from: asItem(r.from) } : { sourceNote: r.note.trim() }) };
    });
    if (!/^\d+$/.test(due.trim()) || Number(due) < 1) throw new Error('Type the days until it is due.');
    const r = await masterRequest<{ number: string }>(me, '/api/shp/work', 'POST', { kind: 'change', dueInDays: Number(due), priority: rush ? 'rush' : 'normal', lines, ...(notes.trim() ? { notes: notes.trim() } : {}) });
    onSaved(r.number);
  });

  return (
    <Dialog wide title="Change items into a website item" onClose={onClose}>
      <p className="text-sm text-slate-600">Pieces altered or finished in production to become a website item. Pieces taken from the shop's stock come off sale now; the new item goes on sale when production finishes it.</p>
      {error && <Notice>{error}</Notice>}
      {rows.map((r, i) => (
        <fieldset key={i} className="grid gap-2 rounded-md p-3 ring-1 ring-slate-200 md:grid-cols-[1fr_6rem]">
          <legend className="px-1 text-xs font-semibold text-slate-500">Line {i + 1}</legend>
          <Field label="Becomes (website item)">
            <select className={inputClass} value={r.to} onChange={(e) => set(i, { to: e.target.value })}>
              <option value="">Pick an item…</option>
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Pieces"><input className={`${inputClass} text-right`} inputMode="numeric" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
          <div role="radiogroup" aria-label={`Line ${i + 1}: the pieces come from`} className="flex flex-wrap gap-2 md:col-span-2">
            {([['shop_stock', 'Website stock'], ['job_order', 'Leftovers of a job order'], ['other', 'Other pieces']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={r.source === v} onClick={() => set(i, { source: v })}
                className={`rounded-md px-3 py-1.5 text-sm ring-1 ${r.source === v ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{l}</button>
            ))}
          </div>
          {r.source === 'shop_stock' ? (
            <Field label="Taken from (website item; comes off sale)">
              <select className={inputClass} value={r.from} onChange={(e) => set(i, { from: e.target.value })}>
                <option value="">Pick an item…</option>
                {options.filter((o) => o.key !== r.to).map((o) => <option key={o.key} value={o.key} disabled={o.available === 0}>{o.label} · {o.available} available</option>)}
              </select>
            </Field>
          ) : (
            <Field label={r.source === 'job_order' ? 'Which job order' : 'Where from'}>
              <input className={inputClass} maxLength={200} value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder={r.source === 'job_order' ? 'e.g. JO-000123, 5 unclaimed polos' : 'e.g. Samples from the trade fair'} />
            </Field>
          )}
          {rows.length > 1 && <div className="md:col-span-2"><Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove line</Button></div>}
        </fieldset>
      ))}
      <Button onClick={() => setRows([...rows, emptyRow()])}>+ Another item</Button>
      <div className="grid gap-2 sm:grid-cols-[8rem_auto_1fr] sm:items-end">
        <Field label="Due in (days)"><input className={inputClass} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} /> Rush</label>
        <Field label="Note for production (optional)"><input className={inputClass} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Add the Virtus print on the back" /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy} onClick={() => void save()}>Send to production</Button>
      </div>
    </Dialog>
  );
}
