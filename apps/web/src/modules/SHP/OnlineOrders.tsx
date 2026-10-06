/**
 * Sales › Online orders: orders placed on the website and paid by QR. Staff open one, check the bank for the payment
 * (reference and screenshot shown), then confirm it, which records a quick sale and its payment into the online payment
 * account (invoice and CR numbers from the booklets), or reject it with a reason. Then ready for pickup / sent, and done.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, manilaTime, peso, useAction } from '../../components/ui.tsx';
import { Link, useLocation } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { masterRequest } from '../CUS/http.ts';

type Status = 'awaiting_payment' | 'payment_sent' | 'confirmed' | 'rejected' | 'cancelled' | 'ready' | 'completed' | 'expired';
export const ORDER_STATUS: Record<Status, [string, string]> = {
  payment_sent: ['Check the payment', 'bg-amber-100 text-amber-900'], awaiting_payment: ['Waiting for payment', 'bg-slate-100 text-slate-700'],
  confirmed: ['Paid · to prepare', 'bg-emerald-100 text-emerald-800'], ready: ['Ready / sent', 'bg-sky-100 text-sky-800'], completed: ['Completed', 'bg-slate-100 text-slate-600'],
  rejected: ['Payment rejected', 'bg-red-100 text-red-800'], cancelled: ['Cancelled', 'bg-slate-100 text-slate-500'], expired: ['Expired (not paid)', 'bg-slate-100 text-slate-500'],
};
const Chip = ({ status, overdue }: { status: Status; overdue?: boolean }) => overdue
  ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Overdue: check the bank</span>
  : <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_STATUS[status][1]}`}>{ORDER_STATUS[status][0]}</span>;
interface Row { id: string; number: string; status: Status; name: string; phone: string; fulfilment: 'pickup' | 'delivery'; totalCents: number; createdAt: string; paymentReference: string | null; saleNumber: string | null; overdue?: boolean }
interface Detail extends Omit<Row, 'saleNumber'> {
  email: string; address: string | null; note: string | null; holdUntil: string; deliveryOption: string | null; deliveryFeeCents: number; lateButAvailable: boolean | null; paymentSentAt: string | null; saleId: string | null; saleNumber: string | null; version: number;
  lines: { lineNo: number; productName: string; size: string; colour: string; qty: number; unitPriceCents: number }[];
  proofs: { id: string; contentType: string; bytes: number; at: string }[];
  events: { status: string; note: string | null; at: string; userName: string | null }[];
  payment: { bankName: string; accountName: string } | null;
}
const FILTERS: (Status | 'all')[] = ['payment_sent', 'confirmed', 'ready', 'awaiting_payment', 'all'];

export function OnlineOrders({ me }: { me: Me }) {
  const [filter, setFilter] = useState<Status | 'all'>('payment_sent');
  const [list, setList] = useState<{ rows: Row[]; counts: Partial<Record<Status, number>> } | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const { error, run } = useAction();
  const opening = new URLSearchParams(useLocation().split('?')[1] ?? '').get('open');
  const load = useCallback(() => run(async () => setList(await masterRequest(me, `/api/shp/admin/orders?status=${filter}`))), [me, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const show = (id: string) => run(async () => setOpen(await masterRequest<Detail>(me, `/api/shp/admin/orders/${encodeURIComponent(id)}`)));
  useEffect(() => { if (opening) void show(opening); }, [opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = async () => { await load(); if (open) await show(open.id); };

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Online orders</h1>
        <p className="text-sm text-slate-600">Orders from the website, paid first by QR. Check the bank for each payment, then confirm it (this records the sale) or reject it.</p></div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map((s) => <Button key={s} tone={filter === s ? 'primary' : 'plain'} onClick={() => setFilter(s)}>
          {s === 'all' ? 'All' : ORDER_STATUS[s][0]}{s !== 'all' && list?.counts[s] ? ` (${list.counts[s]})` : ''}</Button>)}
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Order</th><th className="p-3">Placed</th><th className="p-3">Customer</th><th className="p-3">Gets it by</th><th className="p-3">Status</th><th className="p-3">Reference</th><th className="p-3 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list?.rows.length === 0 && <tr><td colSpan={7} className="p-4 text-slate-500">No orders here.</td></tr>}
            {list?.rows.map((o) => (
              <tr key={o.id} tabIndex={0} onClick={() => void show(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') void show(o.id); }} className="cursor-pointer outline-none hover:bg-indigo-50 focus-visible:bg-indigo-50">
                <td className="p-3 font-semibold">{o.number}</td><td className="p-3 whitespace-nowrap">{manilaTime(o.createdAt)}</td>
                <td className="p-3">{o.name}<span className="block text-xs text-slate-500">{o.phone}</span></td>
                <td className="p-3">{o.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</td><td className="p-3"><Chip status={o.status} overdue={o.overdue} /></td>
                <td className="p-3">{o.paymentReference ?? '—'}</td><td className="p-3 text-right tabular-nums">{peso(o.totalCents)}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      {open && <OrderDialog me={me} order={open} onClose={() => setOpen(null)} onChanged={changed} />}
    </div>
  );
}

function OrderDialog({ me, order: o, onClose, onChanged }: { me: Me; order: Detail; onClose: () => void; onChanged: () => Promise<void> }) {
  const [step, setStep] = useState<'view' | 'confirm' | 'reject'>('view');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState(''); const [found, setFound] = useState<{ id: string; display_name: string }[]>([]);
  const [invoiceNumber, setInvoice] = useState(''); const [crNumber, setCr] = useState(''); const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const canManage = me.permissions.includes('shp.orders.manage');
  // An expired order paid late can still be confirmed while its pieces are available (the server checks again).
  const waiting = o.status === 'payment_sent' || o.status === 'awaiting_payment' || (o.status === 'expired' && o.lateButAvailable === true);
  useEffect(() => {
    // Walk-in by default, as at the counter; a known customer can be picked instead.
    masterRequest<{ id: string; display_name: string; is_active: number }[]>(me, '/api/cus/customers?search=walk-in&limit=10').then((cs) => {
      const w = cs.find((c) => c.is_active === 1 && c.display_name.trim().toLowerCase() === 'walk-in');
      if (w) setCustomer((c) => c ?? { id: w.id, name: w.display_name });
    }, () => undefined);
  }, [me]);
  useEffect(() => {
    if (search.trim().length < 2) return setFound([]);
    const t = setTimeout(() => void masterRequest<{ id: string; display_name: string }[]>(me, `/api/cus/customers?search=${encodeURIComponent(search.trim())}&limit=8`).then(setFound, () => undefined), 250);
    return () => clearTimeout(t);
  }, [me, search]);
  const act = (fn: () => Promise<unknown>) => run(async () => { await fn(); setStep('view'); await onChanged(); });
  const confirm = () => act(() => masterRequest(me, `/api/shp/admin/orders/${o.id}/confirm`, 'POST', { customerId: customer!.id, invoiceNumber: invoiceNumber.trim(), crNumber: crNumber.trim(), version: o.version }));
  const reject = () => act(() => masterRequest(me, `/api/shp/admin/orders/${o.id}/reject`, 'POST', { reason: reason.trim(), version: o.version }));
  const move = (to: 'ready' | 'completed') => act(() => masterRequest(me, `/api/shp/admin/orders/${o.id}/move`, 'POST', { to, version: o.version }));

  return (
    <Dialog wide title={`${o.number} · ${o.name}`} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 text-sm"><Chip status={o.status} overdue={o.overdue} /><span className="text-slate-500">placed {manilaTime(o.createdAt)}</span>
        {o.saleNumber && o.saleId && <Link to={docPath('qs.sale', `/${o.saleId}`)} className="font-semibold text-indigo-700 hover:underline">Recorded on {o.saleNumber}</Link>}</div>
      {error && <Notice>{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Phone</dt><dd><a className="text-indigo-700 underline" href={`tel:${o.phone}`}>{o.phone}</a></dd></div>
            <div><dt className="text-slate-500">Email</dt><dd><a className="break-all text-indigo-700 underline" href={`mailto:${o.email}?subject=${encodeURIComponent(`Your order ${o.number}`)}`}>{o.email}</a></dd></div>
            <div><dt className="text-slate-500">Gets it by</dt><dd>{o.fulfilment === 'pickup' ? 'Pickup at the shop' : `Delivery (${o.deliveryOption ?? ''}): ${o.address}`}</dd></div>
            {o.note && <div className="sm:col-span-3"><dt className="text-slate-500">Note</dt><dd className="whitespace-pre-wrap">{o.note}</dd></div>}
          </dl>
          <table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="py-1">Item</th><th>Qty</th><th className="text-right">Price</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{o.lines.map((l) => <tr key={l.lineNo} className="border-t border-slate-100"><td className="py-1.5">{l.productName} · {l.colour}, {l.size}</td><td>{l.qty}</td><td className="text-right tabular-nums">{peso(l.unitPriceCents)}</td><td className="text-right tabular-nums">{peso(l.qty * l.unitPriceCents)}</td></tr>)}
              {o.deliveryFeeCents > 0 && <tr className="border-t border-slate-100"><td className="py-1.5">Delivery · {o.deliveryOption}</td><td>1</td><td className="text-right tabular-nums">{peso(o.deliveryFeeCents)}</td><td className="text-right tabular-nums">{peso(o.deliveryFeeCents)}</td></tr>}
              <tr className="border-t font-bold"><td className="py-1.5" colSpan={3}>Total to receive</td><td className="text-right tabular-nums">{peso(o.totalCents)}</td></tr></tbody></table>
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-semibold">Payment</p>
            {o.paymentReference ? <p>Reference <b>{o.paymentReference}</b>, sent {o.paymentSentAt ? manilaTime(o.paymentSentAt) : ''}{o.payment ? ` · into ${o.payment.bankName} (${o.payment.accountName})` : ''}.</p>
              : <p className="text-slate-600">No payment sent yet. {o.status === 'awaiting_payment' ? `Held until ${manilaTime(o.holdUntil)}.` : ''}</p>}
            {waiting && <p className="mt-1 text-amber-800">Look for exactly {peso(o.totalCents)} in the bank app before confirming.</p>}
            {o.status === 'expired' && <p className="mt-1 text-slate-700">{o.lateButAvailable ? 'This order expired, but its pieces are all still available: a late payment can still be confirmed.' : 'This order expired and some pieces have sold since. If the customer paid, reject it with a reason and refund them.'}</p>}
          </div>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">History</summary>
            <ul className="mt-1 space-y-0.5 text-slate-600">{o.events.map((e, i) => <li key={i}>{manilaTime(e.at)} · {e.userName ?? 'Customer'} · {ORDER_STATUS[e.status as Status]?.[0] ?? e.status}{e.note ? ` · ${e.note}` : ''}</li>)}</ul></details>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Proof of payment</p>
          {o.proofs.length === 0 ? <p className="text-sm text-slate-500">None sent.</p> : o.proofs.map((f) => {
            const url = `/api/shp/admin/orders/${o.id}/proofs/${f.id}`;
            return <a key={f.id} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Proof of payment" className="w-full rounded-md ring-1 ring-slate-200" /></a>;
          })}
        </div>
      </div>

      {step === 'view' && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {canManage && <>
            {(waiting || o.status === 'expired') && <>{waiting && <Button tone="primary" onClick={() => setStep('confirm')}>Payment found: confirm</Button>}<Button tone="danger" onClick={() => setStep('reject')}>Reject payment</Button></>}
            {o.status === 'confirmed' && <Button tone="primary" disabled={busy} onClick={() => void move('ready')}>{o.fulfilment === 'pickup' ? 'Ready for pickup' : 'Sent out'}</Button>}
            {(o.status === 'confirmed' || o.status === 'ready') && <Button disabled={busy} onClick={() => void move('completed')}>Handed over: completed</Button>}
          </>}
          <Button className="ml-auto" onClick={onClose}>Close</Button>
        </div>
      )}
      {step === 'confirm' && (
        <div className="space-y-3 rounded-md bg-emerald-50 p-4">
          <p className="text-sm">This records the sale and its {peso(o.totalCents)} payment into {o.payment?.bankName ?? 'the online payment account'}, and takes the pieces off the stock. Write the invoice and the CR from the booklets.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Customer" required hint={customer ? `Recording to ${customer.name}` : 'Walk-in, or search a customer'}>
              <input className={inputClass} value={search} placeholder={customer?.name ?? 'Search a customer'} onChange={(e) => setSearch(e.target.value)} />
              {found.length > 0 && <ul className="mt-1 max-h-40 overflow-y-auto rounded-md bg-white ring-1 ring-slate-200">{found.map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => { setCustomer({ id: c.id, name: c.display_name }); setSearch(''); setFound([]); }}>{c.display_name}</button></li>)}</ul>}
            </Field>
            <Field label="Invoice no." required><input className={inputClass} inputMode="numeric" value={invoiceNumber} onChange={(e) => setInvoice(e.target.value)} /></Field>
            <Field label="CR no." required><input className={inputClass} inputMode="numeric" value={crNumber} onChange={(e) => setCr(e.target.value)} /></Field>
          </div>
          <div className="flex gap-2"><Button tone="primary" disabled={busy || !customer || !/^\d+$/.test(invoiceNumber.trim()) || !/^\d+$/.test(crNumber.trim())} onClick={() => void confirm()}>{busy ? 'Recording…' : 'Confirm and record the sale'}</Button><Button onClick={() => setStep('view')}>Back</Button></div>
        </div>
      )}
      {step === 'reject' && (
        <div className="space-y-3 rounded-md bg-red-50 p-4">
          <Field label="Why (the customer sees this)" required hint="At least 10 characters, e.g. No transfer with this reference reached the account."><textarea className={inputClass} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><Button tone="danger" disabled={busy || reason.trim().length < 10} onClick={() => void reject()}>Reject the payment</Button><Button onClick={() => setStep('view')}>Back</Button></div>
        </div>
      )}
    </Dialog>
  );
}
