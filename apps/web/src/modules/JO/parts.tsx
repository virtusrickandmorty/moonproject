/** Pieces the release slip and invoice record forms share: pick a job order or a release by its number, and the booklet figures. */
import { useEffect, useState } from 'react';
import { api, type BookletFigures, type JoPick, type ReleasePick } from '../../api.ts';
import { Button, Panel, inputClass, peso } from '../../components/ui.tsx';
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
      <input aria-label="Job order" className={inputClass} placeholder="Job order number or customer" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.map((jo) => (
        <button key={jo.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-indigo-50" onClick={() => onChange(jo)}>
          {jo.number} · {jo.customerName} <span className="text-slate-500">· {jo.stageLabel} · {jo.leftPieces} pieces left · due {jo.dueDate}</span>
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
      <input aria-label="Release number" className={inputClass} placeholder="Release number, e.g. REL-000012" value={q} onChange={(e) => setQ(e.target.value)} />
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

/** "Write these on the booklet" (D4.4). */
export function Booklet({ b, depositAppliedCents }: { b: BookletFigures; depositAppliedCents?: number }) {
  return (
    <Panel title="Write these on the booklet">
      <Figures items={[
        ['VATable sales', b.vatableSalesCents],
        ['VAT', b.vatCents],
        ...(b.discountCents ? [['Discount', b.discountCents] as [string, number]] : []),
        ['Total', b.grossCents, 'font-semibold'],
      ]} />
      {!!depositAppliedCents && <p className="text-sm text-slate-600">Deposits applied: {peso(depositAppliedCents)}; left to collect: {peso(b.grossCents - depositAppliedCents)}.</p>}
    </Panel>
  );
}
