/**
 * TPL services (the owner's request, 11 Oct 2026): the clients Virtus makes and holds stock for, with their stock and what
 * they owe at a glance. A new stock program opens in a dialog; a client opens its program page (/tpl/<id>).
 */
import { useEffect, useState } from 'react';
import { api, type Me } from '../../api.ts';
import { Button, Dialog, Field, Loading, Notice, inputClass, peso, useAction } from '../../components/ui.tsx';
import { navigate } from '../../router.tsx';
import { CustomerPicker, type Picked } from '../COL/parts.tsx';
import { toCents, type TplProgram, type TplProgramRow } from './types.ts';

export function TplClients({ me }: { me: Me }) {
  const [rows, setRows] = useState<TplProgramRow[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => void api.tplPrograms<{ rows: TplProgramRow[] }>().then((r) => setRows(r.rows), (e: Error) => setError(e.message)), []);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">TPL services</h1>
        {me.permissions.includes('tpl.program.manage') && <Button tone="primary" onClick={() => setAdding(true)}>+ New stock program</Button>}
      </div>
      <p className="text-sm text-slate-600">Clients we make items for ahead and keep in stock. A restock goes through production; each delivery is invoiced on the client&apos;s terms and collected later.</p>
      {error && <Notice>{error}</Notice>}
      {!rows ? <Loading /> : rows.length === 0 ? <p className="text-sm text-slate-500">No stock programs yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200/70">
            <thead><tr><th>Client</th><th className="text-right">Items</th><th className="text-right">Pieces on hand</th><th className="text-right">To restock</th><th>Terms</th><th className="text-right">Owed</th><th className="text-right">Past due</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.isActive ? '' : 'text-slate-500'}>
                  <td><a href={`/tpl/${r.id}`} onClick={(e) => { e.preventDefault(); navigate(`/tpl/${r.id}`); }} className="font-medium text-indigo-700">{r.customerName}</a>{!r.isActive && ' (off)'}</td>
                  <td className="text-right tabular-nums">{r.items}</td>
                  <td className="text-right tabular-nums">{r.onHand.toLocaleString('en-PH')}</td>
                  <td className="text-right tabular-nums">{r.belowReorder > 0 ? <span className="font-semibold text-amber-700">{r.belowReorder}</span> : '—'}</td>
                  <td>{r.termsDays} days</td>
                  <td className="text-right tabular-nums">{peso(r.openCents)}</td>
                  <td className="text-right tabular-nums">{r.overdueCents > 0 ? <span className="font-semibold text-red-700">{peso(r.overdueCents)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <NewProgram onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewProgram({ onClose }: { onClose: () => void }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [terms, setTerms] = useState('30');
  const [limit, setLimit] = useState('0');
  const [note, setNote] = useState('');
  const a = useAction();
  const limitCents = toCents(limit);
  const save = () => a.run(async () => {
    if (!customer) throw new Error('Pick the client.');
    if (limitCents === undefined) throw new Error('Type the credit limit like 50,000.00 (0 for no limit).');
    const p = await api.tplCreateProgram<TplProgram>({ customerId: customer.id, termsDays: Number(terms), creditLimitCents: limitCents, ...(note.trim() ? { note: note.trim() } : {}) });
    navigate(`/tpl/${p.id}`);
  });
  return (
    <Dialog title="New stock program" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Client" required><CustomerPicker value={customer} onChange={setCustomer} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Terms (days to pay)" required hint="Each delivery's invoice is due this many days after it">
            <input inputMode="numeric" className={inputClass} value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Credit limit" hint="0 = no limit. Over it, a delivery needs the owner's say-so">
            <input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
        <Field label="Note"><input className={inputClass} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivery to the school's supply office" /></Field>
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Back</Button><Button tone="primary" disabled={a.busy} onClick={() => void save()}>Create</Button></div>
      </div>
    </Dialog>
  );
}
