/**
 * /p/<link>: the customer's design page (the owner's request, Nov 2026), without signing in. It shows the job order's design
 * (pictures, or a PDF to open), the shop's note, the items and the due date; the customer types their name and taps Approve,
 * or Ask for a change with what to change. Once answered it shows the answer; an older design points to the newest one.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { SHOP_CONTACT } from '../../shop/products.ts';

export interface PublicProof {
  jobOrderNumber: string; version: number; latestVersion: number; note: string | null; sentAt: string;
  state: 'open' | 'answered' | 'replaced' | 'cancelled';
  files: { fileNo: number; fileName: string; contentType: string }[];
  dueDate?: string; lines?: { description: string; qty: number }[]; latestToken?: string;
  answer: { answer: 'approved' | 'changes'; name: string; comment?: string; at: string } | null;
}

const box = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'long', day: 'numeric' });

async function send<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch { throw new Error('Cannot reach us right now. Check your connection and try again.'); }
  const data = await res.json().catch(() => null) as (T & { message?: string }) | null;
  if (!res.ok) throw Object.assign(new Error(data?.message ?? 'That did not go through. Please try again.'), { status: res.status });
  return data as T;
}

function Frame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 px-4 pb-8 pt-6 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-emerald-300">Virtus Garments · Your design</p>
          {title && <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{title}</h1>}
        </div>
      </header>
      <main className="mx-auto -mt-4 max-w-2xl space-y-4 px-4 pb-12">{children}</main>
      <footer className="pb-8 text-center text-xs text-slate-500">Questions? Call or text {SHOP_CONTACT.phone} · {SHOP_CONTACT.email}</footer>
    </div>
  );
}

/** What was answered, in words. */
export function AnswerCard({ a, fresh }: { a: NonNullable<PublicProof['answer']>; fresh: boolean }) {
  const first = a.name.split(' ')[0];
  return a.answer === 'approved'
    ? <section className="space-y-2 rounded-3xl bg-emerald-50 p-6 ring-1 ring-emerald-200" aria-live="polite">
        <p className="text-2xl font-extrabold text-emerald-800">{fresh ? `Thank you, ${first}!` : 'Design approved'}</p>
        <p className="text-emerald-900">Approved by {a.name} on {day(a.at)}. {fresh ? 'We start making your order once the downpayment is in.' : ''}</p>
      </section>
    : <section className="space-y-2 rounded-3xl bg-amber-50 p-6 ring-1 ring-amber-200" aria-live="polite">
        <p className="text-2xl font-extrabold text-amber-900">{fresh ? `Got it, ${first}!` : 'A change was asked for'}</p>
        <p className="text-amber-900">{a.name} asked on {day(a.at)}: “{a.comment}”</p>
        <p className="text-sm text-amber-900/80">The shop will send you a new design to check.</p>
      </section>;
}

export function ProofPage({ token }: { token: string }) {
  const [proof, setProof] = useState<PublicProof | null>(null);
  const [missing, setMissing] = useState('');
  const [name, setName] = useState('');
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const base = `/api/prf/p/${encodeURIComponent(token)}`;

  useEffect(() => {
    document.title = 'Your design · Virtus Garments';
    send<PublicProof>('GET', base).then(setProof, (e: Error & { status?: number }) => setMissing(e.status === 404 ? 'We cannot find this design link. Check that you opened the whole link, or ask the shop to send it again.' : e.message));
  }, [base]);

  if (missing) return <Frame><p role="alert" className="rounded-2xl bg-rose-50 p-5 text-rose-800">{missing}</p></Frame>;
  if (!proof) return <Frame><p className="p-6 text-center text-slate-500">Loading…</p></Frame>;

  const reply = async (answer: 'approved' | 'changes') => {
    setProblem('');
    if (name.trim().length < 2) return setProblem('Type your name first.');
    if (answer === 'changes' && !comment.trim()) return setProblem('Tell us what to change.');
    setBusy(true);
    try { setProof(await send<PublicProof>('POST', `${base}/answer`, { answer, name: name.trim(), ...(answer === 'changes' ? { comment: comment.trim() } : {}) })); setFresh(true); }
    catch (e) { setProblem((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Frame title={`Design for ${proof.jobOrderNumber}`}>
      {proof.answer && <AnswerCard a={proof.answer} fresh={fresh} />}
      {proof.state === 'replaced' && (
        <p className="rounded-2xl bg-sky-50 p-5 text-sky-900">The shop sent a newer design (version {proof.latestVersion}).{' '}
          {proof.latestToken && <a href={`/p/${proof.latestToken}`} className="font-bold underline">Open the newest design</a>}</p>)}
      {proof.state === 'cancelled' && <p className="rounded-2xl bg-amber-50 p-5 text-amber-900">This order was cancelled. To ask about it, call or text the shop at {SHOP_CONTACT.phone}.</p>}

      <section className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-extrabold">Version {proof.version}</h2>
          <p className="text-sm text-slate-500">Sent {day(proof.sentAt)}</p>
        </div>
        {proof.note && <p className="rounded-2xl bg-slate-50 p-4 text-slate-700">{proof.note}</p>}
        <div className="space-y-3">
          {proof.files.map((f) => f.contentType === 'application/pdf'
            ? <a key={f.fileNo} href={`${base}/files/${f.fileNo}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 font-semibold text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">
                <span>{f.fileName}</span><span className="text-sm">Open the PDF ↗</span></a>
            : <a key={f.fileNo} href={`${base}/files/${f.fileNo}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
                <img src={`${base}/files/${f.fileNo}`} alt={`Design, picture ${f.fileNo}`} className="mx-auto max-h-[70vh] w-auto" /></a>)}
          {proof.files.some((f) => f.contentType !== 'application/pdf') && <p className="text-xs text-slate-500">Tap a picture to see it bigger.</p>}
        </div>
        {proof.lines && <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Your order</h3>
          <ul className="mt-2 divide-y divide-slate-100">{proof.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{l.description}</span><span className="shrink-0 font-semibold tabular-nums">{l.qty} pcs</span></li>)}</ul>
          {proof.dueDate && <p className="mt-2 text-sm text-slate-600">Due {day(proof.dueDate)}</p>}
        </div>}
      </section>

      {proof.state === 'open' && (
        <section className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5 sm:p-6">
          <h2 className="text-lg font-extrabold">Is this design right?</h2>
          <p className="text-sm text-slate-600">Check the names, numbers, spelling, colours and logo. Once you approve, we make it exactly like this.</p>
          <label className="block text-sm font-semibold">Your name<input className={`${box} mt-1`} autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {asking && <label className="block text-sm font-semibold">What should we change?
            <textarea className={`${box} mt-1 min-h-28`} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="For example: make the logo bigger, and the number 7 should read 17." /></label>}
          {problem && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{problem}</p>}
          {asking
            ? <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={busy} onClick={() => void reply('changes')} className="rounded-full bg-amber-500 py-3 font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-60">Send my changes</button>
                <button type="button" disabled={busy} onClick={() => { setAsking(false); setProblem(''); }} className="rounded-full bg-slate-100 py-3 font-semibold text-slate-800 hover:bg-slate-200">Go back</button>
              </div>
            : <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={busy} onClick={() => void reply('approved')} className="rounded-full bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-60">Approve this design</button>
                <button type="button" disabled={busy} onClick={() => { setAsking(true); setProblem(''); }} className="rounded-full bg-slate-100 py-3 font-semibold text-slate-800 hover:bg-slate-200">Ask for a change</button>
              </div>}
        </section>
      )}
    </Frame>
  );
}
