/**
 * Sales › Alterations & replacements (the owner's request, Oct 2026): items customers bring back. Staff receive them (from
 * a released job order, a sale or online order, or by hand) and say what is wrong; the owner or the accountant decides,
 * line by line, free or a fee per piece, or declines; accepted, a job order for the customer goes on the production board,
 * and the items go back on its release slip (with its invoice record when there is a fee).
 */
import { parsePesos } from '@moonproject/shared';
import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Dialog, Field, Loading, Notice, inputClass, peso, showDate, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { masterRequest } from '../CUS/http.ts';
import { CustomerPicker, type Picked } from '../COL/parts.tsx';
import { useLiveReload } from '../../live.ts';

type Status = 'awaiting_decision' | 'declined' | 'in_production' | 'ready' | 'released' | 'cancelled';
interface ReturnLine {
  lineNo: number; action: 'alteration' | 'replacement'; source: 'job_order' | 'sale' | 'other'; sourceNumber: string | null; sourceLineNo: number | null; description: string; qty: number;
  problem: string; oldPiece: string | null; oldPieceNote: string | null; feeEachCents: number | null;
  wearers: { rowNo: number; name: string; size: string | null; jerseyName: string | null; jerseyNumber: string | null; qty: number }[];
}
interface Return {
  id: string; number: string; customerName: string; receivedOn: string; contact: string | null; notes: string | null; receivedBy: string; status: Status; feeCents: number; lines: ReturnLine[];
  decision: { outcome: 'accepted' | 'declined'; reason: string; jobOrderId: string | null; jobOrderNumber: string | null; shopWorkId: string | null; shopWorkNumber: string | null; at: string; decidedBy: string } | null;
}
const STATUS: Record<Status, [string, string]> = {
  awaiting_decision: ['Awaiting decision', 'bg-amber-100 text-amber-900'], declined: ['Declined', 'bg-slate-200 text-slate-700'], in_production: ['In production', 'bg-indigo-100 text-indigo-800'],
  ready: ['Ready to give back', 'bg-emerald-100 text-emerald-800'], released: ['Given back', 'bg-slate-100 text-slate-600'], cancelled: ['Job order cancelled', 'bg-red-100 text-red-800'],
};
const ACTION = { alteration: 'Alteration', replacement: 'Replacement' } as const;
const OLD_PIECE: Record<string, string> = { kept: 'Kept', scrapped: 'Scrapped', parts: 'Used for parts', shop_rework: 'Fixed in Shop work and sold again' };
const Badge = ({ s }: { s: Status }) => <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS[s][1]}`}>{STATUS[s][0]}</span>;

export function Returns({ me }: { me: Me }) {
  const [rows, setRows] = useState<Return[] | null>(null);
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [receiving, setReceiving] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const { error, run } = useAction();
  const load = useCallback(() => masterRequest<Return[]>(me, `/api/alt/returns?show=${show}`).then(setRows), [me, show]);
  useEffect(() => { void run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveReload(load);
  const can = (p: string) => me.permissions.includes(p);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Alterations &amp; replacements</h1>
          <p className="max-w-3xl text-sm text-slate-600">Items customers bring back. Receive them and say what is wrong; the owner or the accountant decides free, a fee, or declined. Accepted, it goes on the production board as a job order and goes back to the customer on its release slip.</p>
        </div>
        {can('alt.receive') && <Button tone="primary" onClick={() => setReceiving(true)}>+ Receive items</Button>}
      </div>
      <div className="flex gap-2" role="tablist">
        {(['open', 'all'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${show === k ? 'bg-indigo-600 text-white' : 'bg-white ring-1 ring-slate-300 hover:bg-indigo-50'}`}>{k === 'open' ? 'Open' : 'All'}</button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {!rows ? <Loading /> : rows.length === 0 ? <p className="rounded-lg bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">{show === 'open' ? 'Nothing brought back is open.' : 'Nothing has been brought back yet.'}</p> : (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
          <table>
            <thead><tr><th>Return</th><th>Customer</th><th>Received</th><th>Items</th><th>Status</th><th className="text-right">Fee</th><th>Job order</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpened(r.id)} className="cursor-pointer">
                  <td><button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => setOpened(r.id)}>{r.number}</button></td>
                  <td>{r.customerName}</td>
                  <td className="whitespace-nowrap">{showDate(r.receivedOn)}</td>
                  <td>{r.lines.map((l) => `${ACTION[l.action]}: ${l.description} ×${l.qty}${l.wearers.length ? ` (${l.wearers.map((w) => w.name).join(', ')})` : ''}`).join('; ')}</td>
                  <td><Badge s={r.status} /></td>
                  <td className="text-right tabular-nums">{r.decision?.outcome === 'accepted' ? (r.feeCents ? peso(r.feeCents) : 'Free') : '—'}</td>
                  <td>{r.decision?.jobOrderId ? <Link to={`/docs/jo.job_order/${r.decision.jobOrderId}`} onClick={(e) => e.stopPropagation()}>{r.decision.jobOrderNumber}</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {receiving && <ReceiveDialog me={me} onClose={() => setReceiving(false)} onSaved={(r) => { setReceiving(false); setDone(`${r.number} received. It waits for the owner or the accountant to decide.`); setOpened(r.id); void load(); }} />}
      {opened && <ReturnDialog me={me} id={opened} onClose={() => setOpened(null)} onChanged={(msg) => { setDone(msg); void load(); }} />}
    </div>
  );
}

interface Wearer { rowNo: number; name: string; size: string | null; jerseyName: string | null; jerseyNumber: string | null; qty: number }
interface SourceLookup { id: string; number: string; status: string; customerId: string; customerName: string; lines: { lineNo: number; description: string; qty: number; website: boolean; wearers: Wearer[] }[] }
interface Row {
  action: 'alteration' | 'replacement'; source: 'job_order' | 'sale' | 'other'; number: string; lookup: SourceLookup | null; lineNo: string; description: string; qty: string; problem: string;
  oldPiece: string; oldPieceNote: string; wearers: number[];
}
const emptyRow = (): Row => ({ action: 'alteration', source: 'job_order', number: '', lookup: null, lineNo: '', description: '', qty: '1', problem: '', oldPiece: 'kept', oldPieceNote: '', wearers: [] });
/** A wearer as the job order lists them: name, size and jersey. */
const wearerText = (w: Wearer) => [w.name, w.size && (w.size === 'measured' ? 'measured' : `size ${w.size}`), (w.jerseyName || w.jerseyNumber) && `#${[w.jerseyNumber, w.jerseyName].filter(Boolean).join(' ')}`].filter(Boolean).join(' · ');

function ReceiveDialog({ me, onClose, onSaved }: { me: Me; onClose: () => void; onSaved: (r: Return) => void }) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const find = (i: number) => run(async () => {
    const r = rows[i]!;
    if (!r.number.trim()) throw new Error(`Line ${i + 1}: type the ${r.source === 'job_order' ? 'job order' : 'sale or online order'} number.`);
    const lookup = await masterRequest<SourceLookup>(me, `/api/alt/source?kind=${r.source}&number=${encodeURIComponent(r.number.trim())}`);
    set(i, { lookup, lineNo: lookup.lines.length === 1 ? '1' : '', wearers: [] });
  });
  const byHand = rows.every((r) => r.source === 'other');

  const save = () => run(async () => {
    const lines = rows.map((r, i) => {
      const n = `Line ${i + 1}`;
      if (!/^\d+$/.test(r.qty.trim()) || Number(r.qty) < 1) throw new Error(`${n}: type how many pieces.`);
      if (r.problem.trim().length < 3) throw new Error(`${n}: say what is wrong or what to change.`);
      const base = { action: r.action, source: r.source, qty: Number(r.qty), problem: r.problem.trim(), ...(r.action === 'replacement' ? { oldPiece: r.oldPiece, ...(r.oldPieceNote.trim() ? { oldPieceNote: r.oldPieceNote.trim() } : {}) } : {}) };
      if (r.source === 'other') {
        if (!r.description.trim()) throw new Error(`${n}: describe the item.`);
        return { ...base, description: r.description.trim() };
      }
      if (!r.lookup) throw new Error(`${n}: find the ${r.source === 'job_order' ? 'job order' : 'sale or online order'} first.`);
      if (!r.lineNo) throw new Error(`${n}: pick which item came back.`);
      const roster = r.lookup.lines.find((l) => String(l.lineNo) === r.lineNo)?.wearers ?? [];
      if (roster.length && !r.wearers.length) throw new Error(`${n}: tick whose pieces came back.`);
      return { ...base, sourceNumber: r.lookup.number, sourceLineNo: Number(r.lineNo), ...(r.wearers.length ? { wearers: r.wearers } : {}) };
    });
    if (byHand && !customer) throw new Error('Pick the customer who brought the items.');
    const saved = await masterRequest<Return>(me, '/api/alt/returns', 'POST', { ...(customer ? { customerId: customer.id } : {}), ...(contact.trim() ? { contact: contact.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), lines });
    onSaved(saved);
  });

  return (
    <Dialog wide title="Receive items brought back" onClose={onClose}>
      {error && <Notice>{error}</Notice>}
      {rows.map((r, i) => {
        const picked = r.lookup?.lines.find((l) => String(l.lineNo) === r.lineNo);
        return (
          <fieldset key={i} className="space-y-2 rounded-md p-3 ring-1 ring-slate-200">
            <legend className="px-1 text-xs font-semibold text-slate-500">Line {i + 1}</legend>
            <div className="flex flex-wrap gap-2">
              <div role="radiogroup" aria-label={`Line ${i + 1}: what to do`} className="flex gap-1 rounded-lg bg-slate-100 p-1">
                {(['alteration', 'replacement'] as const).map((a) => <button key={a} type="button" role="radio" aria-checked={r.action === a} onClick={() => set(i, { action: a })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${r.action === a ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}>{ACTION[a]}</button>)}
              </div>
              <div role="radiogroup" aria-label={`Line ${i + 1}: where it is from`} className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                {([['job_order', 'Job order'], ['sale', 'Website / POS sale'], ['other', 'Other (by hand)']] as const).map(([s, l]) => <button key={s} type="button" role="radio" aria-checked={r.source === s}
                  onClick={() => set(i, { source: s, lookup: null, lineNo: '', ...(s !== 'sale' && r.oldPiece === 'shop_rework' ? { oldPiece: 'kept' } : {}) })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${r.source === s ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}>{l}</button>)}
              </div>
            </div>
            {r.source === 'other' ? (
              <Field label="Item"><input className={inputClass} maxLength={200} value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="e.g. Varsity jacket, navy, size L" /></Field>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[14rem_auto_1fr] sm:items-end">
                <Field label={r.source === 'job_order' ? 'Job order number' : 'Sale or online order number'}>
                  <input className={inputClass} value={r.number} onChange={(e) => set(i, { number: e.target.value, lookup: null, lineNo: '' })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(i); } }}
                    placeholder={r.source === 'job_order' ? 'e.g. JO-000123' : 'e.g. the sale or online order no.'} />
                </Field>
                <Button disabled={busy} onClick={() => void find(i)}>Find</Button>
                {r.lookup && (
                  <Field label={`Which item (${r.lookup.customerName})`}>
                    <select className={inputClass} value={r.lineNo} onChange={(e) => set(i, { lineNo: e.target.value, wearers: [] })}>
                      <option value="">Pick the item…</option>
                      {r.lookup.lines.map((l) => <option key={l.lineNo} value={l.lineNo} disabled={l.qty === 0}>{l.lineNo}. {l.description} · {l.qty} {r.source === 'job_order' ? 'released' : 'sold'}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}
            {picked && picked.wearers.length > 0 && (
              // Whose pieces came back (the owner's request, Oct 2026): the pieces are theirs, and the job order carries them.
              <fieldset className="rounded-md bg-slate-50 p-2">
                <legend className="px-1 text-xs font-semibold text-slate-600">Whose pieces came back? ({picked.wearers.length} wearers)</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={r.wearers.length === picked.wearers.length}
                      onChange={(e) => { const all = e.target.checked ? picked.wearers : []; set(i, { wearers: all.map((w) => w.rowNo), qty: String(all.reduce((t, w) => t + w.qty, 0) || 1) }); }} /> All
                  </label>
                  {picked.wearers.map((w) => (
                    <label key={w.rowNo} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={r.wearers.includes(w.rowNo)} onChange={(e) => {
                        const next = e.target.checked ? [...r.wearers, w.rowNo].sort((a, b) => a - b) : r.wearers.filter((x) => x !== w.rowNo);
                        set(i, { wearers: next, qty: String(picked.wearers.filter((x) => next.includes(x.rowNo)).reduce((t, x) => t + x.qty, 0) || 1) });
                      }} />
                      {wearerText(w)}{w.qty > 1 ? ` (${w.qty} pcs)` : ''}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
              <Field label="Pieces"><input className={`${inputClass} text-right`} inputMode="numeric" value={r.qty} readOnly={r.wearers.length > 0}
                title={r.wearers.length > 0 ? 'The pieces of the wearers ticked' : undefined} onChange={(e) => set(i, { qty: e.target.value })} /></Field>
              <Field label={r.action === 'alteration' ? 'What to change' : 'What is wrong'}><input className={inputClass} maxLength={500} value={r.problem} onChange={(e) => set(i, { problem: e.target.value })}
                placeholder={r.action === 'alteration' ? 'e.g. Shorten the sleeves by 2 inches' : 'e.g. Seam opened after the first wash'} /></Field>
            </div>
            {r.action === 'replacement' && (
              <div className="grid gap-2 sm:grid-cols-[16rem_1fr]">
                <Field label="The returned piece">
                  <select className={inputClass} value={r.oldPiece} onChange={(e) => set(i, { oldPiece: e.target.value })}>
                    {Object.entries(OLD_PIECE).filter(([k]) => k !== 'shop_rework' || (r.source === 'sale' && picked?.website)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Note (optional)"><input className={inputClass} maxLength={300} value={r.oldPieceNote} onChange={(e) => set(i, { oldPieceNote: e.target.value })} placeholder="e.g. In the rework bin" /></Field>
              </div>
            )}
            {rows.length > 1 && <Button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove line</Button>}
          </fieldset>
        );
      })}
      <Button onClick={() => setRows([...rows, emptyRow()])}>+ Another item</Button>
      {byHand && <CustomerPicker value={customer} onChange={setCustomer} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Contact (optional)"><input className={inputClass} maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Who brought it, phone" /></Field>
        <Field label="Notes (optional)"><input className={inputClass} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy} onClick={() => void save()}>Receive</Button>
      </div>
    </Dialog>
  );
}

function ReturnDialog({ me, id, onClose, onChanged }: { me: Me; id: string; onClose: () => void; onChanged: (message: string) => void }) {
  const [r, setR] = useState<Return | null>(null);
  const [fees, setFees] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('7');
  const [rush, setRush] = useState(false);
  const { busy, error, run } = useAction();
  const load = useCallback(() => masterRequest<Return>(me, `/api/alt/returns/${id}`).then(setR), [me, id]);
  useEffect(() => { void run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const canDecide = me.permissions.includes('alt.decide') && r?.status === 'awaiting_decision';
  const typedFees = r?.lines.map((l) => { try { return parsePesos((fees[l.lineNo] ?? '').trim() || '0'); } catch { return NaN; } }) ?? [];
  const total = r?.lines.reduce((n, l, i) => n + (Number.isNaN(typedFees[i]!) ? 0 : typedFees[i]! * l.qty), 0) ?? 0;

  const decide = (outcome: 'accepted' | 'declined') => run(async () => {
    if (reason.trim().length < 5) throw new Error(outcome === 'declined' ? 'Say why it is declined.' : 'Say why: free (our fault, warranty) or why there is a fee.');
    if (outcome === 'accepted' && typedFees.some(Number.isNaN)) throw new Error('Type each fee in pesos, like 150 or 150.00 (0 when free).');
    if (outcome === 'accepted' && (!/^\d+$/.test(due.trim()) || Number(due) < 1)) throw new Error('Type the days until it is due.');
    const body = outcome === 'declined' ? { outcome, reason: reason.trim() }
      : { outcome, reason: reason.trim(), dueInDays: Number(due), priority: rush ? 'rush' : 'normal', fees: r!.lines.map((l, i) => ({ lineNo: l.lineNo, feeEachCents: typedFees[i]! })) };
    const after = await masterRequest<Return>(me, `/api/alt/returns/${id}/decision`, 'POST', body);
    setR(after);
    onChanged(outcome === 'declined' ? `${after.number} declined.` : `${after.number} accepted: ${after.decision?.jobOrderNumber} is on the production board${after.feeCents ? ` (fee ${peso(after.feeCents)})` : ' (free)'}.`);
  });

  return (
    <Dialog wide title={r ? `${r.number} · ${r.customerName}` : 'Return'} onClose={onClose}>
      {error && <Notice>{error}</Notice>}
      {!r ? <Loading /> : <>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <Badge s={r.status} />
          <span>Received {showDate(r.receivedOn)} by {r.receivedBy}{r.contact ? ` · ${r.contact}` : ''}</span>
        </div>
        {r.notes && <p className="text-sm text-slate-600">{r.notes}</p>}
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>#</th><th>Item</th><th className="text-right">Pieces</th><th>{canDecide ? 'Fee per piece' : 'Fee'}</th></tr></thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.lineNo} className="align-top">
                  <td>{l.lineNo}</td>
                  <td>
                    <p className="font-medium">{ACTION[l.action]}: {l.description}</p>
                    <p className="text-xs text-slate-600">{l.sourceNumber ? `From ${l.sourceNumber} line ${l.sourceLineNo}` : 'Described by hand'} · {l.problem}</p>
                    {l.wearers.length > 0 && <p className="text-xs text-slate-600">Wearers: {l.wearers.map((w) => `${wearerText(w)}${w.qty > 1 ? ` (${w.qty})` : ''}`).join('; ')}</p>}
                    {l.oldPiece && <p className="text-xs text-slate-600">Returned piece: {OLD_PIECE[l.oldPiece]}{l.oldPieceNote ? ` (${l.oldPieceNote})` : ''}</p>}
                  </td>
                  <td className="text-right tabular-nums">{l.qty}</td>
                  <td>
                    {canDecide ? <input className={`${inputClass} w-28 text-right`} inputMode="decimal" aria-label={`Fee per piece, line ${l.lineNo}`} placeholder="0.00 (free)"
                      value={fees[l.lineNo] ?? ''} onChange={(e) => setFees({ ...fees, [l.lineNo]: e.target.value })} />
                      : l.feeEachCents === null ? '—' : l.feeEachCents === 0 ? 'Free' : `${peso(l.feeEachCents)} each`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.decision && (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <p><strong>{r.decision.outcome === 'declined' ? 'Declined' : r.feeCents ? `Accepted with a fee of ${peso(r.feeCents)}` : 'Accepted, free'}</strong> by {r.decision.decidedBy}: {r.decision.reason}</p>
            {r.decision.jobOrderId && <p>Job order <Link to={`/docs/jo.job_order/${r.decision.jobOrderId}`}>{r.decision.jobOrderNumber}</Link> on the production board; it goes back to the customer on its release slip{r.feeCents ? ' with its invoice' : ''}.</p>}
            {r.decision.shopWorkId && <p>The returned website pieces: <Link to={`/docs/jo.job_order/${r.decision.shopWorkId}`}>{r.decision.shopWorkNumber}</Link> in Shop work, to be fixed and sold again.</p>}
          </div>
        )}
        {canDecide && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-sm font-semibold">Decision</h3>
            <p className="text-xs text-slate-500">Type a fee per piece for each line (leave it empty or 0 when it is free), and why. Accepting puts it on the production board as a job order for {r.customerName}.</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
              <Field label="Reason"><input className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Our sewing fault: free / Customer's change of size: ₱150 a piece" /></Field>
              <Field label="Due in (days)"><input className={inputClass} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} /> Rush</label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-sm">Fee: <strong className="tabular-nums">{total ? peso(total) : 'Free'}</strong></span>
              <Button tone="danger" disabled={busy} onClick={() => void decide('declined')}>Decline</Button>
              <Button tone="primary" disabled={busy} onClick={() => void decide('accepted')}>Accept and send to production</Button>
            </div>
          </div>
        )}
        {r.status === 'awaiting_decision' && !me.permissions.includes('alt.decide') && <Notice tone="info">The owner or the accountant decides: free, a fee, or declined.</Notice>}
        <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
      </>}
    </Dialog>
  );
}
