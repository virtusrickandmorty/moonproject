/** Pieces the money screens share (collection, refund, quick sale): customer search, split tenders, live preview, edit gate. */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type CashPlace, type CustomerRow, type DocHeader } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Notice, ReasonDialog, inputClass, peso } from '../../components/ui.tsx';
import { docPath } from '../../shell/menu.ts';
import { emptyTender, type TenderRow } from './money.ts';

export interface Picked { id: string; name: string }

/** Search customers by name or code (2+ letters); active ones only. */
export function CustomerPicker({ value, onChange }: { value: Picked | null; onChange: (c: Picked | null) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CustomerRow[]>([]);
  useEffect(() => {
    if (value || q.trim().length < 2) return setRows([]);
    let stale = false;
    const t = setTimeout(() => api.customers(q.trim()).then((r) => stale || setRows(r.filter((c) => c.is_active === 1)), () => stale || setRows([])), 250);
    return () => ((stale = true), clearTimeout(t));
  }, [q, value]);
  if (value) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-medium">{value.name}</span>
        <Button onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <input aria-label="Customer" className={inputClass} placeholder="Type 2 or more letters of the name or code" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.map((c) => (
        <button key={c.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-indigo-50" onClick={() => onChange({ id: c.id, name: c.display_name })}>
          {c.display_name} <span className="text-slate-500">{c.code}</span>
        </button>
      ))}
      {q.trim().length >= 2 && rows.length === 0 && <p className="text-sm text-slate-500">No active customer matches.</p>}
    </div>
  );
}

/** One row per tender: a big button per cash place (PLAN H2 "money questions"), the amount and a reference. */
export function TenderRows(p: { rows: TenderRow[]; onChange: (rows: TenderRow[]) => void; places: CashPlace[]; question: string; amountHint?: string }) {
  const set = (i: number, patch: Partial<TenderRow>) => p.onChange(p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {p.rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
          <div role="radiogroup" aria-label={p.rows.length > 1 ? `${p.question} (payment ${i + 1})` : p.question} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.places.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={r.cashPlaceId === String(c.id)} onClick={() => set(i, { cashPlaceId: String(c.id) })}
                className={`rounded-lg p-2 text-left text-sm ring-1 ${r.cashPlaceId === String(c.id) ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
                {c.name}
              </button>
            ))}
          </div>
          {p.places.find((c) => String(c.id) === r.cashPlaceId)?.kind === 'checks' && (
            <div className="grid gap-2 sm:grid-cols-3">
              <input aria-label="Check number" placeholder="Check no." className={inputClass} value={r.checkNumber ?? ''} onChange={(e) => set(i, { checkNumber: e.target.value })} />
              <input aria-label="Bank of the check" placeholder="Bank" className={inputClass} value={r.bank ?? ''} onChange={(e) => set(i, { bank: e.target.value })} />
              <input aria-label="Date on the check" type="date" className={inputClass} value={r.checkDate ?? ''} onChange={(e) => set(i, { checkDate: e.target.value })} />
            </div>
          )}
          <div className="flex gap-2">
            <input aria-label="Amount" inputMode="decimal" placeholder={(p.rows.length === 1 && p.amountHint) || '0.00'} className={`${inputClass} max-w-40 text-right tabular-nums`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            <input aria-label="Reference" placeholder="GCash or bank reference, or check no. and bank" className={inputClass} value={r.reference} onChange={(e) => set(i, { reference: e.target.value })} />
            {p.rows.length > 1 && <Button onClick={() => p.onChange(p.rows.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
        </div>
      ))}
      {p.rows.length < 5 && <Button onClick={() => p.onChange([...p.rows, emptyTender()])}>+ Split the payment</Button>}
    </div>
  );
}

/** The server's own calculator, a moment after typing stops (PLAN H2 "live totals"). Null while not ready or failing. */
export function useLive<T>(key: string, ready: boolean, run: () => Promise<T>): T | null {
  const [out, setOut] = useState<T | null>(null);
  useEffect(() => {
    if (!ready) return setOut(null);
    let stale = false;
    const t = setTimeout(() => run().then((r) => stale || setOut(r), () => stale || setOut(null)), 400);
    return () => ((stale = true), clearTimeout(t));
  }, [key, ready]);
  return out;
}

/** Edit of a recorded document: ask the reason first; nothing changes until the replacement is recorded (NR-4, H2). */
export function EditGate({ original, typeKey, onReason }: { original: DocHeader; typeKey: string; onReason: (reason: string) => void }) {
  if (original.status !== 'posted') return <Notice>{original.number} is already cancelled.</Notice>;
  const explain = `A recorded document is never changed. ${original.number} will be cancelled and a new one issued with a new number. Nothing changes until you record the replacement.`;
  return <ReasonDialog title={`Edit ${original.number}`} explain={explain} confirmLabel="Continue to edit" onConfirm={onReason} onClose={() => navigate(docPath(typeKey, `/${original.id}`))} />;
}

/** "Received ₱X · applied ₱Y" style figures. */
export function Figures({ items }: { items: [string, number, string?][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {items.map(([label, cents, tone]) => [
        <dt key={`${label}-t`} className={tone ?? 'text-slate-600'}>{label}</dt>,
        <dd key={label} className={`text-right tabular-nums ${tone ?? ''}`}>{peso(cents)}</dd>,
      ])}
    </dl>
  );
}

export const Errors = ({ list, show }: { list: string[]; show: boolean }): ReactNode => (show ? list.map((e) => <Notice key={e}>{e}</Notice>) : null);
