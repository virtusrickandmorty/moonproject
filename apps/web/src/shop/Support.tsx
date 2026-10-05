/**
 * The support page: a customer sends an inquiry, complaint, suggestion or quotation request, with pictures, straight to
 * the staff inbox (POST /api/sup/messages, no sign-in). Pictures are shrunk here first so a phone photo fits the limit.
 */
import { formatPeso } from '@moonproject/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { cartText } from './Panels.tsx';
import { SCHOOL_TPL, SERVICES } from './Services.tsx';
import { SHOP_CONTACT } from './products.ts';
import { useShop } from './store.tsx';
import { PageHero } from './Home.tsx';

type Kind = 'inquiry' | 'complaint' | 'suggestion' | 'quotation';
const KINDS: { kind: Kind; label: string; hint: string; subject: string }[] = [
  { kind: 'quotation', label: 'Request a quotation', hint: 'Tell us the garment, quantity and sizes, and add pictures of your design.', subject: 'Quotation request' },
  { kind: 'inquiry', label: 'Inquiry', hint: 'Ask us anything about our garments, services, schedules or your order.', subject: 'Question' },
  { kind: 'complaint', label: 'Complaint', hint: 'We are sorry something went wrong. Give your order number and pictures of the problem so we can fix it fast.', subject: 'Problem with my order' },
  { kind: 'suggestion', label: 'Suggestion', hint: 'Ideas on how we can serve you better are always welcome.', subject: 'Suggestion' },
];
const MAX_FILES = 5;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 2000;
interface Picture { name: string; blob: Blob; url: string }

/** A picture the server will take: JPEG, PNG or WebP, at most 2000 px on a side and under 4 MB (re-saved as JPEG when not). */
export async function prepare(file: File): Promise<Picture> {
  const fits = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 1.5 * 1024 * 1024;
  let bitmap: ImageBitmap | null = null;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error(`${file.name} is not a picture we can open. Send a JPEG, PNG or WebP.`); }
  if (fits && Math.max(bitmap.width, bitmap.height) <= MAX_SIDE) { bitmap.close(); return { name: file.name, blob: file, url: URL.createObjectURL(file) }; }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
  if (!blob || blob.size > MAX_BYTES) throw new Error(`${file.name} is too big even after shrinking. Send a smaller picture.`);
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', blob, url: URL.createObjectURL(blob) };
}
export const base64 = (blob: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => fail(new Error('Could not read a picture. Add it again.'));
  r.readAsDataURL(blob);
});

const input = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

export function Support({ query }: { query: string }) {
  const shop = useShop();
  const params = new URLSearchParams(query);
  const service = [SCHOOL_TPL, ...SERVICES].find((s) => s.id === params.get('service'));
  // From the cart: the lines for a quotation (ready-stock pieces are ordered online instead, when that is open).
  const quotedLines = shop.cart.filter((l) => !shop.orderable(l));
  const fromCart = params.get('from') === 'cart' && quotedLines.length > 0;
  const startKind = (KINDS.find((k) => k.kind === params.get('type'))?.kind ?? 'quotation');
  const [kind, setKind] = useState<Kind>(startKind);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState(service ? `Quotation: ${service.name}` : fromCart ? 'Quotation for the garments in my cart' : KINDS.find((k) => k.kind === startKind)!.subject);
  const [message, setMessage] = useState(fromCart ? `${cartText(quotedLines, shop.productById)}\n\nEstimate: ${formatPeso(quotedLines.reduce((n, l) => n + l.qty * (shop.productById(l.productId)?.priceCents ?? 0), 0))}\n\nDesign notes and deadline: ` : '');
  const [orderRef, setOrderRef] = useState(''); const [consent, setConsent] = useState(false); const [website, setWebsite] = useState('');
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [subjectEdited, setSubjectEdited] = useState(false);
  const urls = useRef<string[]>([]);
  urls.current = pictures.map((p) => p.url);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const current = KINDS.find((k) => k.kind === kind)!;

  const pickKind = (k: Kind) => {
    // The subject follows the type until the customer writes their own.
    if (!subjectEdited) setSubject(KINDS.find((x) => x.kind === k)!.subject);
    setKind(k);
  };
  const add = async (files: FileList | File[]) => {
    setError('');
    const room = MAX_FILES - pictures.length;
    const list = [...files].slice(0, room);
    if (files.length > room) setError(`You can send up to ${MAX_FILES} pictures.`);
    for (const f of list) {
      try { const p = await prepare(f); setPictures((ps) => (ps.length < MAX_FILES ? [...ps, p] : (URL.revokeObjectURL(p.url), ps))); }
      catch (e) { setError((e as Error).message); }
    }
  };
  const removePicture = (i: number) => setPictures((ps) => { URL.revokeObjectURL(ps[i]!.url); return ps.filter((_, k) => k !== i); });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    // The same checks as the server, so the customer hears about a missing field before anything is sent.
    if (!name.trim()) return setError('Please give your name or organisation.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Please give a valid email address so we can answer you.');
    if (!/^\+?(?:[\s()-]*\d){7,15}[\s()-]*$/.test(phone.trim())) return setError('Please give your mobile number, like 0917 123 4567.');
    if (!consent) return setError('Please tick the box to let us keep your message so we can answer it.');
    setBusy(true);
    try {
      const files = await Promise.all(pictures.map(async (p) => ({ name: p.name, data: await base64(p.blob) })));
      const res = await fetch('/api/sup/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ kind, name, email, phone, subject, message, orderRef: kind === 'complaint' ? orderRef : '', consent, website, files }),
      });
      const data = await res.json().catch(() => null) as { number?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? 'Your message could not be sent. Please try again or call us.');
      setSent(data!.number!);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err instanceof TypeError ? 'Cannot reach us right now. Check your connection and try again.' : (err as Error).message);
    } finally { setBusy(false); }
  };

  if (sent) return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</span>
      <h1 className="mt-6 text-3xl font-extrabold">Thank you, we got your message</h1>
      <p className="mt-3 text-slate-600">Your reference number is <b className="text-slate-900">{sent}</b>. Mention it when you call or message us. We usually reply within one working day.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {fromCart && kind === 'quotation' && <button type="button" onClick={shop.clearCart} className="rounded-full border border-slate-300 px-5 py-3 font-bold hover:border-slate-900">Empty my cart</button>}
        <button type="button" onClick={() => { setSent(null); setMessage(''); setPictures([]); setOrderRef(''); }} className="rounded-full bg-slate-900 px-5 py-3 font-bold text-white hover:bg-indigo-700">Send another message</button>
      </div>
    </section>
  );

  return (
    <>
      <PageHero eyebrow="Customer support" title={<>How can we <span className="text-indigo-300">help?</span></>}
        text="Send us a question, a concern, an idea, or your design for a quotation. A person at the shop reads every message.">
        <div className="mt-8 flex flex-wrap gap-2">{KINDS.map((k) => <button key={k.kind} type="button" onClick={() => { pickKind(k.kind); document.getElementById('message')?.scrollIntoView({ behavior: 'smooth' }); }}
          className={`rounded-full px-4 py-2 text-sm font-bold ring-1 transition ${kind === k.kind ? 'bg-white text-slate-900 ring-white' : 'bg-white/10 text-white ring-white/15 hover:bg-white/20'}`}>{k.label}</button>)}</div>
      </PageHero>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-6 pt-10 sm:px-6 lg:grid-cols-[1fr_22rem]">
        <form id="message" onSubmit={submit} className="scroll-mt-24 rounded-[2rem] bg-white p-5 ring-1 ring-slate-900/5 sm:p-8" noValidate>
          <fieldset>
            <legend className="text-sm font-bold">What is this about?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KINDS.map((k) => <button key={k.kind} type="button" onClick={() => pickKind(k.kind)} aria-pressed={kind === k.kind}
                className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${kind === k.kind ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:border-slate-400'}`}>{k.label}</button>)}
            </div>
            <p className="mt-3 text-sm text-slate-600">{current.hint}</p>
          </fieldset>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">Your name or organisation <span className="text-rose-600" aria-hidden="true">*</span><input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="name" /></label>
            <label className="text-sm font-semibold">Email <span className="text-rose-600" aria-hidden="true">*</span><input type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" /></label>
            <label className="text-sm font-semibold">Mobile number <span className="text-rose-600" aria-hidden="true">*</span><input type="tel" required maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} className={input} autoComplete="tel" placeholder="0917 123 4567" /></label>
            <p className="-mt-2 text-xs text-slate-500 sm:col-span-2"><span className="text-rose-600">*</span> Required, so we can answer you by email or by phone.</p>
            {kind === 'complaint' && <label className="text-sm font-semibold sm:col-span-2">Order or job order number (if you have it)<input maxLength={40} value={orderRef} onChange={(e) => setOrderRef(e.target.value)} className={input} placeholder="e.g. JO-000123" /></label>}
            <label className="text-sm font-semibold sm:col-span-2">Subject<input required maxLength={150} value={subject} onChange={(e) => { setSubject(e.target.value); setSubjectEdited(true); }} className={input} /></label>
            <label className="text-sm font-semibold sm:col-span-2">Message<textarea required maxLength={5000} rows={7} value={message} onChange={(e) => setMessage(e.target.value)} className={input}
              placeholder={kind === 'quotation' ? 'Garment, quantity per size, colours, print or embroidery positions, deadline…' : ''} /></label>
            {/* A field people never see: robots fill it in, and the server then refuses the message. */}
            <label className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold">Pictures <span className="font-normal text-slate-500">({kind === 'quotation' ? 'your design, logo or a sample' : kind === 'complaint' ? 'the problem you see' : 'optional'}; up to {MAX_FILES})</span></p>
            <label onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void add(e.dataTransfer.files); }}
              className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400'} ${pictures.length >= MAX_FILES ? 'pointer-events-none opacity-50' : ''}`}>
              <svg viewBox="0 0 24 24" className="size-8 text-slate-400" aria-hidden="true"><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3M12 4v12M7 9l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="mt-2 text-sm font-bold">Add pictures</span><span className="text-xs text-slate-500">Drop them here or tap to choose · JPEG, PNG or WebP</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple className="sr-only" disabled={pictures.length >= MAX_FILES}
                onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />
            </label>
            {pictures.length > 0 && <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">{pictures.map((p, i) => (
              <li key={p.url} className="relative">
                <img src={p.url} alt={p.name} className="aspect-square w-full rounded-xl object-cover ring-1 ring-slate-200" />
                <button type="button" onClick={() => removePicture(i)} aria-label={`Remove ${p.name}`} className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-slate-900 text-sm text-white shadow">×</button>
              </li>))}</ul>}
          </div>

          <label className="mt-6 flex items-start gap-3 text-sm text-slate-600">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-indigo-600" />
            <span>I agree that Virtus Garments keeps my name, contact details, message and pictures to answer me and to prepare my order, as the Data Privacy Act of 2012 allows. They are not shared with anyone else.</span>
          </label>
          {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
          <button type="submit" disabled={busy} className="mt-6 w-full rounded-full bg-slate-900 px-6 py-3.5 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400 sm:w-auto">
            {busy ? 'Sending…' : kind === 'quotation' ? 'Send my quotation request' : 'Send my message'}
          </button>
        </form>

        <aside className="space-y-5">
          <div className="rounded-[2rem] bg-slate-900 p-6 text-white">
            <p className="font-extrabold">Prefer to talk?</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-white/60">Call or text</dt><dd className="font-semibold"><a href={`tel:${SHOP_CONTACT.phone.replace(/\s/g, '')}`} className="hover:underline">{SHOP_CONTACT.phone}</a></dd></div>
              <div><dt className="text-white/60">Email</dt><dd className="font-semibold break-all"><a href={`mailto:${SHOP_CONTACT.email}`} className="hover:underline">{SHOP_CONTACT.email}</a></dd></div>
              <div><dt className="text-white/60">Hours</dt><dd className="font-semibold">{SHOP_CONTACT.hours}</dd></div>
            </dl>
          </div>
          <div className="rounded-[2rem] bg-white p-6 ring-1 ring-slate-900/5">
            <p className="font-extrabold">Common questions</p>
            <div className="mt-2 divide-y divide-slate-100">
              {[['How does ordering work?', 'Send a quotation request. We reply with the price, a design proof and a delivery date. Production starts once you approve and pay the downpayment.'],
                ['Is there a minimum order?', 'It depends on the service; each one shows its minimum. Ready-stock items can be ordered one at a time.'],
                ['Can we mix sizes?', 'Yes. List the quantity per size, or ask us to take each person’s name, number and measurements.'],
                ['Can we see the sizes first?', 'Yes. We can lend a sizing set so your group can try them on.'],
                ['What if something is wrong with my order?', 'Send a complaint here with your order number and pictures. We will make it right.'],
              ].map(([q, a]) => <details key={q} className="group py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">{q}<span className="text-lg text-slate-400 transition group-open:rotate-45">+</span></summary><p className="mt-2 text-sm text-slate-600">{a}</p></details>)}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
