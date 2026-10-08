/** Pieces the release slip and invoice record forms share: pick a job order or a release by its number, and the booklet figures. */
import { useEffect, useState } from 'react';
import { api, type BookletShown, type CatItem, type JoPick, type ReleasePick } from '../../api.ts';
import { Button, Field, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import { Figures } from '../COL/parts.tsx';

/** What matches the search, a moment after typing stops; nothing while one is already picked. */
function usePick<T>(q: string, searching: boolean, run: (q: string) => Promise<T[]>): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!searching) return setRows([]);
    let stale = false;
    const t = setTimeout(() => run(q.trim()).then((r) => stale || setRows(r), () => stale || setRows([])), 250);
    return () => ((stale = true), clearTimeout(t));
  }, [q, searching]);
  return rows;
}

/** Search job orders by number or customer; with nothing typed, the ones with pieces left to release. */
export function JoPicker({ value, onChange }: { value: { id: string; label: string } | null; onChange: (jo: JoPick | null) => void }) {
  const [q, setQ] = useState('');
  const rows = usePick(q, !value, api.joPickOrders);
  if (value) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-medium">{value.label}</span>
        <Button onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Field label="Job order"><input aria-label="Job order" className={inputClass} placeholder="Job order number or customer" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      {rows.map((jo) => (
        <button key={jo.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-indigo-50" onClick={() => onChange(jo)}>
          {jo.number} · {jo.customerName} <span className="text-slate-500">· {jo.stageLabel} · {jo.leftPieces} pieces left · due {showDate(jo.dueDate)}</span>
        </button>
      ))}
      {rows.length === 0 && <p className="text-sm text-slate-500">{q.trim() ? 'No job order matches.' : 'No job order has pieces left to release.'}</p>}
    </div>
  );
}

/** Search releases by their number (or the job order or customer); with nothing typed, the ones still waiting for their invoice. */
export function ReleasePicker({ value, onChange, preset = '' }: { value: ReleasePick | null; onChange: (r: ReleasePick | null) => void; preset?: string }) {
  const [q, setQ] = useState(preset);
  useEffect(() => setQ(preset), [preset]);
  const rows = usePick(q, !value, api.joPickReleases);
  if (value) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-medium">{value.number} · {value.jobOrderNumber} · {value.customerName}</span>
        <Button onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Field label="Release number"><input aria-label="Release number" className={inputClass} placeholder="Release number, e.g. REL-000012" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      {rows.map((r) => (
        <button key={r.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-indigo-50" onClick={() => onChange(r)}>
          {r.number} · {r.jobOrderNumber} · {r.customerName} · {peso(r.totalCents)}
          <span className="text-slate-500">{r.status === 'cancelled' ? ' · cancelled' : r.invoice ? ` · has invoice no. ${r.invoice.invoiceNumber}` : ' · waiting for its invoice'}</span>
        </button>
      ))}
      {rows.length === 0 && <p className="text-sm text-slate-500">{q.trim() ? 'No release matches.' : 'No release is waiting for its invoice.'}</p>}
    </div>
  );
}

/**
 * "Write these on the booklet" (D4.4). In mode C, when downpayments were invoiced, the sale less "Less downpayments invoiced" is
 * what the balance invoice shows (the server sends those figures); in mode B, the VAT already booked on the deposits is said.
 */
export function Booklet({ b, depositAppliedCents }: { b: BookletShown; depositAppliedCents?: number }) {
  const dp = b.downpaymentsInvoicedCents ?? 0;
  return (
    <Panel title="Write these on the booklet">
      {dp > 0 && (
        <>
          <Figures items={[['Sale', b.grossCents + dp], ['Less downpayments invoiced', dp]]} />
          <p className="text-sm text-slate-600">Downpayment VAT mode C: the downpayments were invoiced when they were received, so this invoice shows the sale less them.</p>
        </>
      )}
      <Figures items={[
        ['VATable sales', b.vatableSalesCents],
        ['VAT', b.vatCents],
        ...(b.discountCents ? [['Discount', b.discountCents] as [string, number]] : []),
        ['Total', b.grossCents, 'font-semibold'],
      ]} />
      {b.depositVatMode === 'B' && !!b.depositVatCents && b.depositVatCents > 0 && (
        <p className="text-sm text-slate-600">Downpayment VAT mode B: {peso(b.depositVatCents)} of this VAT was already booked as output VAT on the deposits.</p>
      )}
      {!!depositAppliedCents && <p className="text-sm text-slate-600">Deposits applied: {peso(depositAppliedCents)}; left to collect: {peso(b.grossCents - depositAppliedCents)}.</p>}
    </Panel>
  );
}

/** Search the price list (2+ letters); picking an item fills the line and asks for its tier price. */
export function ItemSearch({ onPick, n }: { onPick: (item: CatItem) => void; n: number }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CatItem[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRows([]);
    let stale = false;
    const t = setTimeout(() => api.catItems(q.trim()).then((r) => stale || setRows(r), () => stale || setRows([])), 250);
    return () => ((stale = true), clearTimeout(t));
  }, [q]);
  return (
    <div className="space-y-1">
      <Field label="Price list item"><input aria-label={`Line ${n} price list item`} placeholder="Search the price list, e.g. jersey" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      {rows.map((it) => (
        <button key={it.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-indigo-50" onClick={() => (onPick(it), setQ(''))}>
          {it.name} <span className="text-slate-500">{it.code}</span>
        </button>
      ))}
    </div>
  );
}
