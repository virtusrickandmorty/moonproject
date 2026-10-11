/**
 * Buying online (ready-stock pieces only), payment first:
 *   /checkout            the customer's details; placing the order holds its pieces for 24 hours
 *   /order/WEB-000123    (with ?t=<secret>) how to pay (the shop's QR, the exact amount), the reference and screenshot,
 *                        then the order's progress while staff check the payment by hand. Only that link opens the order.
 */
import { formatPeso } from '@moonproject/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, navigate } from '../router.tsx';
import { ProductPicture } from './GarmentArt.tsx';
import { SHOP_CONTACT } from './products.ts';
import { useShop } from './store.tsx';
import { StarPicker } from './Stars.tsx';
import { base64, prepare } from './Support.tsx';
import { Loading } from '../components/ui.tsx';

const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?(?:[\s()-]*\d){7,15}[\s()-]*$/;
/** This browser's order links and saved-on timestamps, kept for at most 30 days. */
const MINE_KEY = 'moonproject.shop.orders';
interface SavedOrder { number: string; token: string; savedOn: number }
const ORDER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export function rememberedOrders(): SavedOrder[] {
  try {
    const mine: unknown = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]');
    const now = Date.now();
    if (!Array.isArray(mine)) return [];
    return mine.filter((m): m is SavedOrder => typeof m?.number === 'string' && typeof m.token === 'string'
      && typeof m.savedOn === 'number' && Number.isFinite(m.savedOn) && m.savedOn <= now && now - m.savedOn <= ORDER_LIFETIME_MS).slice(0, 10);
  } catch { return []; }
}
function remember(number: string, token: string) {
  try {
    const mine = rememberedOrders();
    const savedOn = mine.find((m) => m.number === number && m.token === token)?.savedOn ?? Date.now();
    localStorage.setItem(MINE_KEY, JSON.stringify([{ number, token, savedOn }, ...mine.filter((m) => m.number !== number)].slice(0, 10)));
  } catch { /* this page keeps the token in memory when browser storage is unavailable */ }
}

export function Checkout() {
  const shop = useShop();
  const lines = shop.cart.filter(shop.orderable);
  const items = lines.reduce((n, l) => n + l.qty * (shop.productById(l.productId)?.priceCents ?? 0), 0);
  const areas = shop.payment?.deliveryOptions ?? [];
  const [v, setV] = useState({ name: '', email: '', phone: '', fulfilment: 'pickup' as 'pickup' | 'delivery', address: '', city: '', province: '', note: '', consent: false, website: '' });
  // The delivery fee follows the address: the shop finds the area for the city or province (and works it out again on placing).
  const [quote, setQuote] = useState<{ delivers: true; area: string; feeCents: number } | { delivers: false } | null>(null);
  useEffect(() => {
    if (v.fulfilment !== 'delivery' || !v.city.trim() || !v.province.trim()) return setQuote(null);
    const t = setTimeout(() => {
      fetch(`/api/shp/delivery-fee?${new URLSearchParams({ city: v.city.trim(), province: v.province.trim() })}`, { credentials: 'same-origin' })
        .then((r) => r.json()).then(setQuote, () => setQuote(null));
    }, 300);
    return () => clearTimeout(t);
  }, [v.fulfilment, v.city, v.province]);
  const fee = v.fulfilment === 'delivery' && quote?.delivers ? quote.feeCents : 0;
  const total = items + fee;
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!v.name.trim()) return setError('Please give your name.');
    if (!EMAIL.test(v.email.trim())) return setError('Please give a valid email address so we can reach you about your order.');
    if (!PHONE.test(v.phone.trim())) return setError('Please give your mobile number, like 0917 123 4567.');
    if (v.fulfilment === 'delivery' && (!v.address.trim() || !v.city.trim() || !v.province.trim())) return setError('Please give the full delivery address: house, street and barangay, city or municipality, and province.');
    if (v.fulfilment === 'delivery' && quote && !quote.delivers) return setError(`We do not deliver to ${v.city.trim()}, ${v.province.trim()} yet. Pick pickup at the shop, or call us.`);
    if (!v.consent) return setError('Please tick the box to let us keep your details for this order.');
    setBusy(true);
    try {
      const res = await fetch('/api/shp/orders', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ name: v.name, email: v.email, phone: v.phone, fulfilment: v.fulfilment, ...(v.fulfilment === 'delivery' ? { address: v.address, city: v.city, province: v.province } : {}),
          ...(v.note.trim() ? { note: v.note } : {}), consent: true, website: v.website, lines: lines.map(({ productId, size, colour, qty }) => ({ productId, size, colour, qty })) }),
      });
      const data = await res.json().catch(() => null) as { number?: string; token?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? 'Your order could not be placed. Please try again or call us.');
      remember(data!.number!, data!.token!);
      for (const l of lines) shop.remove(l);
      navigate(`/order/${data!.number}?t=${encodeURIComponent(data!.token!)}`);
    } catch (err) {
      setError(err instanceof TypeError ? 'Cannot reach us right now. Check your connection and try again.' : (err as Error).message);
    } finally { setBusy(false); }
  };

  if (!shop.ready) return <Loading />;
  if (!lines.length) return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <h1 className="text-3xl font-extrabold">Nothing to check out</h1>
      <p className="mt-3 text-slate-600">{shop.payment ? 'Add ready-stock pieces to your cart to order and pay online.' : 'Online ordering is not open yet. Request a quotation, or visit or call the shop.'}</p>
      <Link to="/" className="mt-6 inline-block rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-indigo-700">Browse garments</Link>
    </section>
  );
  return (
    <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1fr_24rem]">
      <form onSubmit={(e) => void submit(e)} noValidate className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight">Check out</h1>
        <ol className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
          {['Place your order: we hold the pieces for 24 hours.', `Pay ${formatPeso(total)} online by scanning our QR, and send us the reference.`, 'We confirm your payment, then prepare your order.'].map((t, i) =>
            <li key={t} className="flex gap-2 rounded-xl bg-slate-50 p-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>{t}</li>)}
        </ol>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold sm:col-span-2">Full name <span className="text-rose-600">*</span><input className={input} maxLength={100} autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="text-sm font-semibold">Email <span className="text-rose-600">*</span><input type="email" className={input} maxLength={200} autoComplete="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></label>
          <label className="text-sm font-semibold">Mobile number <span className="text-rose-600">*</span><input type="tel" className={input} maxLength={40} autoComplete="tel" placeholder="0917 123 4567" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">How will you get it?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{([['pickup', 'Pick up at the shop'], ['delivery', areas.length ? 'Deliver to my address' : 'Delivery (not offered yet)']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={v.fulfilment === k} disabled={k === 'delivery' && !areas.length} onClick={() => set('fulfilment', k)}
                className={`rounded-xl border px-4 py-3 text-left text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${v.fulfilment === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}>{l}</button>))}</div>
          </fieldset>
          {v.fulfilment === 'delivery' && <>
            <label className="text-sm font-semibold sm:col-span-2">House no., street and barangay <span className="text-rose-600">*</span><input className={input} maxLength={200} autoComplete="street-address" value={v.address} onChange={(e) => set('address', e.target.value)} placeholder="e.g. 12 Sampaguita St., Brgy. San Isidro" /></label>
            <label className="text-sm font-semibold">City or municipality <span className="text-rose-600">*</span><input className={input} maxLength={60} autoComplete="address-level2" value={v.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Quezon City" /></label>
            <label className="text-sm font-semibold">Province <span className="text-rose-600">*</span><input className={input} maxLength={60} autoComplete="address-level1" value={v.province} onChange={(e) => set('province', e.target.value)} placeholder="e.g. Metro Manila" /></label>
            <p className={`rounded-xl px-4 py-3 text-sm sm:col-span-2 ${quote && !quote.delivers ? 'bg-rose-50 font-semibold text-rose-800' : 'bg-slate-50 text-slate-700'}`} aria-live="polite">
              {!quote ? 'Type your city and province to see the delivery fee.'
                : quote.delivers ? <>Delivery to <b>{quote.area}</b>: <b>{quote.feeCents ? formatPeso(quote.feeCents) : 'free'}</b>, added to your total.</>
                : `We do not deliver to ${v.city.trim()}, ${v.province.trim()} yet. Pick pickup at the shop, or call us.`}
            </p>
          </>}
          <label className="text-sm font-semibold sm:col-span-2">Note (optional)<textarea className={input} rows={2} maxLength={500} value={v.note} onChange={(e) => set('note', e.target.value)} placeholder="Anything we should know" /></label>
          <label className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set('website', e.target.value)} /></label>
        </div>
        <label className="mt-5 flex items-start gap-3 text-sm text-slate-600">
          <input type="checkbox" checked={v.consent} onChange={(e) => set('consent', e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-indigo-600" />
          <span>I agree that Virtus Garments keeps my name, contact details, address and payment proof to process this order, as the Data Privacy Act of 2012 allows.</span>
        </label>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
        <button type="submit" disabled={busy} className="mt-6 w-full rounded-full bg-indigo-600 px-6 py-3.5 font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400 sm:w-auto">{busy ? 'Placing your order…' : `Place order · ${formatPeso(total)}`}</button>
      </form>
      <aside className="space-y-3 self-start rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
        <p className="font-extrabold">Your order</p>
        <ul className="divide-y divide-slate-100">{lines.map((l) => { const p = shop.productById(l.productId)!; return (
          <li key={`${l.productId}-${l.size}-${l.colour}`} className="flex items-center gap-3 py-3 text-sm">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-50"><ProductPicture product={p} colour={p.colours.find((c) => c.name === l.colour)?.hex ?? '#ccc'} className={p.photoUrl ? '' : 'w-10'} /></div>
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.name}</p><p className="text-slate-500">{l.colour} · {l.size} · {l.qty} × {formatPeso(p.priceCents)}</p></div>
            <p className="font-semibold tabular-nums">{formatPeso(l.qty * p.priceCents)}</p>
          </li>); })}</ul>
        {v.fulfilment === 'delivery' && quote?.delivers && <div className="flex justify-between text-sm"><span>Delivery · {quote.area}</span><span className="tabular-nums">{fee ? formatPeso(fee) : 'Free'}</span></div>}
        <div className="flex justify-between border-t pt-3 text-lg font-bold"><span>Total</span><span className="tabular-nums">{formatPeso(total)}</span></div>
        <p className="text-xs text-slate-500">Prices include VAT. Your receipt from the shop comes with your order.</p>
      </aside>
    </section>
  );
}

type Status = 'awaiting_payment' | 'payment_sent' | 'confirmed' | 'rejected' | 'cancelled' | 'ready' | 'completed' | 'expired' | 'returned';
interface CustomerOrder {
  number: string; status: Status; name: string; fulfilment: 'pickup' | 'delivery'; address: string | null; totalCents: number; holdUntil: string; deliveryOption: string | null; deliveryFeeCents: number;
  paymentReference: string | null; saleNumber: string | null;
  lines: { lineNo: number; productId: string; productName: string; size: string; colour: string; qty: number; unitPriceCents: number }[];
  events: { status: string; note: string | null; at: string }[];
  payment: { bankName: string; accountName: string; accountHint: string | null; instructions: string | null; qrUrl: string } | null;
  /** The items the buyer has rated already. */
  reviewed: string[];
}
const STEPS: [Status[], string][] = [[['awaiting_payment'], 'Order placed'], [['payment_sent'], 'Payment sent'], [['confirmed'], 'Payment confirmed'], [['ready'], 'Ready / sent'], [['completed'], 'Completed']];
const ORDER_OF: Status[] = ['awaiting_payment', 'payment_sent', 'confirmed', 'ready', 'completed'];
const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

export function OrderStatus({ number, query }: { number: string; query: string }) {
  const linkToken = new URLSearchParams(query).get('t');
  const access = useRef({ number, token: linkToken ?? rememberedOrders().find((m) => m.number === number)?.token ?? '' });
  if (access.current.number !== number || (linkToken && linkToken !== access.current.token)) {
    access.current = { number, token: linkToken ?? rememberedOrders().find((m) => m.number === number)?.token ?? '' };
  }
  const token = access.current.token;
  const [o, setO] = useState<CustomerOrder | null>(null);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<{ name: string; blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shp/orders/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 404 ? 'We cannot find this order. Open the link we gave you when you placed it.' : 'Cannot load your order right now.');
    setO(await res.json() as CustomerOrder);
  }, [number, token]);
  useEffect(() => {
    let active = true;
    load().then(() => {
      if (!active) return;
      if (token) remember(number, token);
      const url = new URL(window.location.href);
      if (url.pathname === `/order/${encodeURIComponent(number)}` && url.searchParams.get('t') === token) {
        url.searchParams.delete('t');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      }
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [load, number, token]);
  // While staff are working on it, the page follows by itself.
  useEffect(() => {
    if (!o || !['awaiting_payment', 'payment_sent', 'confirmed', 'ready'].includes(o.status)) return;
    const t = setInterval(() => void load().catch(() => undefined), 15_000);
    return () => clearInterval(t);
  }, [o, load]);

  const post = async (path: string, body: object) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/shp/orders/${encodeURIComponent(number)}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token, ...body }) });
      const data = await res.json().catch(() => null) as (CustomerOrder & { message?: string }) | null;
      if (!res.ok) throw new Error(data?.message ?? 'That did not go through. Please try again.');
      setO(data); window.scrollTo(0, 0);
    } catch (err) { setError(err instanceof TypeError ? 'Cannot reach us right now. Check your connection and try again.' : (err as Error).message); }
    finally { setBusy(false); }
  };
  const sendPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (reference.trim().length < 4) return setError('Type the reference number from your payment receipt.');
    if (!proof) return setError('Add the screenshot of your payment.');
    await post('payment', { reference: reference.trim(), proof: { name: proof.name, data: await base64(proof.blob) } });
  };
  const pick = async (file: File) => {
    setError('');
    try { const p = await prepare(file); urls.current.push(p.url); setProof(p); } catch (err) { setError((err as Error).message); }
  };

  if (!o) return <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">{error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 font-semibold text-rose-800">{error}</p> : <Loading label="Loading your order…" />}</section>;
  const at = ORDER_OF.indexOf(o.status);
  const banner: Partial<Record<Status, [string, string, string]>> = {
    awaiting_payment: ['Pay to confirm your order', `Your pieces are held until ${when(o.holdUntil)}. Pay the exact amount, then send us the reference and a screenshot.`, 'bg-indigo-50 text-indigo-900'],
    payment_sent: ['We are checking your payment', 'This usually takes a few hours during shop hours. This page updates by itself, so you can leave it open or come back to the link later.', 'bg-amber-50 text-amber-900'],
    confirmed: ['Payment confirmed: thank you!', `Your order is being prepared${o.saleNumber ? ` (recorded as ${o.saleNumber})` : ''}. We will tell you when it is ${o.fulfilment === 'pickup' ? 'ready for pickup' : 'sent out'}.`, 'bg-emerald-50 text-emerald-900'],
    ready: [o.fulfilment === 'pickup' ? 'Ready for pickup' : 'On its way', o.fulfilment === 'pickup' ? `Bring your order number ${o.number}. ${SHOP_CONTACT.hours}.` : 'Your order has been sent out.', 'bg-sky-50 text-sky-900'],
    completed: ['Completed', 'Thank you for buying from us!', 'bg-slate-100 text-slate-800'],
    rejected: ['We could not confirm your payment', `${o.events.filter((e) => e.status === 'rejected').at(-1)?.note ?? ''} If you did pay, call or message us with your reference number.`, 'bg-rose-50 text-rose-900'],
    expired: ['This order expired', 'No payment reached us within 24 hours, so the pieces went back on sale. If they are still available you can still pay below; otherwise place a new order.', 'bg-slate-100 text-slate-800'],
    // A cancelled order with a sale was paid and confirmed first: the shop returns the payment.
    cancelled: ['This order was cancelled', o.saleNumber ? 'The shop will return your payment. Call or message us with your order number if you have questions.' : 'Nothing was charged.', 'bg-slate-100 text-slate-800'],
    returned: ['This order was returned', 'The shop will return your payment. Call or message us with your order number if you have questions.', 'bg-slate-100 text-slate-800'],
  };
  const [title, text, tone] = banner[o.status]!;

  return (
    <section className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Order {o.number}</p>
      <div className={`mt-3 rounded-3xl p-6 ${tone}`} role="status"><h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1><p className="mt-2">{text}</p></div>
      {at >= 0 && <ol className="mt-6 grid grid-cols-5 gap-1 text-center text-[11px] font-semibold sm:text-xs">{STEPS.map(([s, label], i) => (
        <li key={label} className={i <= at ? 'text-indigo-700' : 'text-slate-400'}><span className={`mx-auto mb-1 block h-1.5 rounded-full ${i <= at ? 'bg-indigo-600' : 'bg-slate-200'}`} aria-hidden="true" />{label}<span className="sr-only">{s.includes(o.status) ? ' (now)' : ''}</span></li>))}</ol>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
      {o.status === 'completed' && <RateItems order={o} token={token} onRated={(reviewed) => setO({ ...o, reviewed })} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        {(o.status === 'awaiting_payment' || o.status === 'expired') && o.payment ? (
          <div className="grid gap-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5 md:grid-cols-[14rem_1fr]">
            <div className="text-center">
              <img src={o.payment.qrUrl} alt={`QR code to pay ${o.payment.accountName}`} className="mx-auto w-full max-w-[14rem] rounded-xl ring-1 ring-slate-200" />
              <p className="mt-2 text-sm font-bold">{o.payment.accountName}</p>
              <p className="text-xs text-slate-500">{o.payment.bankName}{o.payment.accountHint ? ` · ${o.payment.accountHint}` : ''}</p>
            </div>
            <form onSubmit={(e) => void sendPayment(e)} className="space-y-4">
              <div><p className="text-sm text-slate-600">Pay exactly</p><p className="text-4xl font-extrabold tabular-nums">{formatPeso(o.totalCents)}</p>
                {o.payment.instructions && <p className="mt-1 text-xs text-slate-500">{o.payment.instructions}</p>}</div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700"><li>Scan the QR with your bank or e-wallet app.</li><li>Pay the exact amount above.</li><li>Type the reference number and add a screenshot of the receipt.</li></ol>
              <label className="block text-sm font-semibold">Reference number <span className="text-rose-600">*</span><input className={input} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From your payment receipt" /></label>
              <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-4 py-5 text-center hover:border-slate-400">
                {proof ? <img src={proof.url} alt="Your payment screenshot" className="max-h-48 rounded-lg" /> : <><span className="text-sm font-bold">Add the screenshot</span><span className="text-xs text-slate-500">JPEG, PNG or WebP</span></>}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
              </label>
              <button type="submit" disabled={busy} className="w-full rounded-full bg-indigo-600 px-6 py-3.5 font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">{busy ? 'Sending…' : 'I have paid: send my payment'}</button>
              {o.status === 'awaiting_payment' && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Cancel this order? The pieces go back on sale.')) void post('cancel', {}); }} className="w-full text-sm text-slate-500 hover:text-rose-700">Cancel this order</button>}
            </form>
          </div>
        ) : (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
            <p className="font-extrabold">What happened</p>
            <ul className="mt-3 space-y-2 text-sm">{o.events.map((e, i) => <li key={i} className="flex gap-3"><span className="w-36 shrink-0 text-slate-500">{when(e.at)}</span><span>{({ awaiting_payment: 'Order placed', payment_sent: 'Payment sent', confirmed: 'Payment confirmed', rejected: 'Payment not confirmed', cancelled: 'Cancelled', returned: 'Returned', ready: o.fulfilment === 'pickup' ? 'Ready for pickup' : 'Sent out', completed: 'Completed' } as Record<string, string>)[e.status] ?? e.status}{e.note && e.status !== 'confirmed' ? ` · ${e.note}` : ''}</span></li>)}</ul>
            {(o.status === 'expired' || o.status === 'cancelled' || o.status === 'returned' || o.status === 'rejected') && <Link to="/" className="mt-5 inline-block rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-indigo-700">Back to the shop</Link>}
          </div>
        )}
        <aside className="space-y-3 self-start rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
          <p className="font-extrabold">Order {o.number}</p>
          <ul className="divide-y divide-slate-100 text-sm">{o.lines.map((l) => <li key={l.lineNo} className="flex justify-between gap-3 py-2"><span>{l.qty} × {l.productName}<span className="block text-xs text-slate-500">{l.colour} · {l.size}</span></span><span className="tabular-nums">{formatPeso(l.qty * l.unitPriceCents)}</span></li>)}</ul>
          {o.deliveryFeeCents > 0 && <div className="flex justify-between text-sm"><span>Delivery · {o.deliveryOption}</span><span className="tabular-nums">{formatPeso(o.deliveryFeeCents)}</span></div>}
          <div className="flex justify-between border-t pt-2 font-bold"><span>Total</span><span className="tabular-nums">{formatPeso(o.totalCents)}</span></div>
          <p className="text-sm text-slate-600">{o.fulfilment === 'pickup' ? 'Pickup at the shop' : `Delivery to ${o.address}`}</p>
          {o.paymentReference && <p className="text-sm text-slate-600">Your reference: <b>{o.paymentReference}</b></p>}
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Your order is saved on this device for 30 days. On another device, open the link in your order email. Questions? Call or text {SHOP_CONTACT.phone}.</p>
        </aside>
      </div>
    </section>
  );
}

/** /orders: the orders placed from this browser, newest first, with where each one is. */
/** Once an order is completed its buyer rates each item on it, once: stars, a title and a few words, shown on the website. */
function RateItems({ order, token, onRated }: { order: CustomerOrder; token: string; onRated: (reviewed: string[]) => void }) {
  const { reloadReviews } = useShop();
  const items = [...new Map(order.lines.map((l) => [l.productId, l.productName])).entries()];
  const left = items.filter(([id]) => !order.reviewed.includes(id));
  const [open, setOpen] = useState(left[0]?.[0] ?? '');
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) return setError('Pick 1 to 5 stars.');
    if (body.trim().length < 10) return setError('Write a few words about it (at least 10 letters).');
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/shp/orders/${encodeURIComponent(order.number)}/reviews`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ token, productId: open, rating, ...(title.trim() ? { title: title.trim() } : {}), body: body.trim() }) });
      const data = await res.json().catch(() => null) as { reviewed?: string[]; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? 'That did not go through. Please try again.');
      onRated(data!.reviewed!); reloadReviews();
      setOpen(left.find(([id]) => id !== open)?.[0] ?? ''); setRating(0); setTitle(''); setBody('');
    } catch (err) { setError(err instanceof TypeError ? 'Cannot reach us right now. Check your connection and try again.' : (err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-6 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5">
      <h2 className="text-xl font-extrabold">{left.length ? 'How did we do? Rate your items' : 'Thank you for your reviews!'}</h2>
      <p className="mt-1 text-sm text-slate-500">Your rating shows on the item in our shop under your first name and initial ({shownNameOf(order.name)}).</p>
      <ul className="mt-4 flex flex-wrap gap-2">{items.map(([id, name]) => {
        const done = order.reviewed.includes(id);
        return <li key={id}><button type="button" disabled={done} onClick={() => setOpen(id)}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${done ? 'bg-emerald-50 text-emerald-800' : open === id ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>{done ? '✓ ' : ''}{name}</button></li>; })}</ul>
      {open && !order.reviewed.includes(open) && (
        <form onSubmit={(e) => void send(e)} className="mt-5 space-y-4">
          <StarPicker value={rating} onChange={setRating} name={`rating-${open}`} />
          <label className="block text-sm font-semibold">Title <span className="font-normal text-slate-500">(optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 font-normal outline-none focus:border-indigo-500" placeholder="Great fit, soft cloth" /></label>
          <label className="block text-sm font-semibold">Your review
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4} required className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 font-normal outline-none focus:border-indigo-500" placeholder="How is the fit, the cloth, the print?" /></label>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300">{busy ? 'Sending…' : 'Post my review'}</button>
        </form>)}
    </div>
  );
}
/** "Juan dela Cruz" → "Juan C.", as the server shows it. */
const shownNameOf = (name: string) => { const p = name.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]![0]!.toUpperCase()}.` : p[0]!; };

export function MyOrders() {
  const [mine, setMine] = useState(rememberedOrders);
  const forgotten = useRef(false);
  const [rows, setRows] = useState<(CustomerOrder & { token: string })[] | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all(mine.map(async (m) => {
      const res = await fetch(`/api/shp/orders/${encodeURIComponent(m.number)}?t=${encodeURIComponent(m.token)}`, { credentials: 'same-origin' }).catch(() => null);
      return res?.ok ? { ...(await res.json() as CustomerOrder), token: m.token } : null;
    })).then((r) => { if (active && !forgotten.current) setRows(r.filter((x): x is CustomerOrder & { token: string } => x !== null)); });
    return () => { active = false; };
  }, [mine]);
  const forget = () => {
    forgotten.current = true;
    try { localStorage.removeItem(MINE_KEY); } catch { /* still clear the displayed orders */ }
    setMine([]); setRows([]);
  };
  const words: Record<Status, string> = { awaiting_payment: 'Waiting for your payment', payment_sent: 'We are checking your payment', confirmed: 'Paid · being prepared', ready: 'Ready / sent',
    completed: 'Completed', rejected: 'Payment not confirmed', cancelled: 'Cancelled', returned: 'Returned', expired: 'Expired' };
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16 pt-12 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight">My orders</h1>
      <p className="mt-2 text-slate-600">Orders saved on this phone or computer in the last 30 days. On another device, open the link in your order email.</p>
      <button type="button" onClick={forget} className="mt-4 rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold hover:bg-slate-100">Forget these orders on this device</button>
      {rows === null ? <Loading /> : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><p className="font-semibold">No orders from this browser yet.</p>
          <Link to="/" className="mt-4 inline-block rounded-full bg-slate-900 px-6 py-3 font-bold text-white hover:bg-indigo-700">Shop ready-to-wear</Link></div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-100 rounded-3xl bg-white shadow-sm ring-1 ring-slate-900/5">{rows.map((o) => (
          <li key={o.number}><Link to={`/order/${o.number}?t=${encodeURIComponent(o.token)}`} className="flex items-center justify-between gap-4 p-5 hover:bg-slate-50">
            <div><p className="font-bold">{o.number}</p><p className="text-sm text-slate-500">{o.lines.reduce((n, l) => n + l.qty, 0)} piece(s) · {formatPeso(o.totalCents)}</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{words[o.status]}</span>
          </Link></li>))}</ul>
      )}
    </section>
  );
}
