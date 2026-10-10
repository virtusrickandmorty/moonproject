/**
 * The website's chat with the shop's AI assistant (the owner's request, Oct 2026): a bubble at the bottom right of every
 * website and shop page, shown only while the owner has it on. It answers about products, prices, how to order and an
 * order's status; "Talk to a person" sends the chat to the shop's Support inbox with the customer's name, email and mobile.
 * Customers are told an AI answers first and that the chat is kept. The chat id lives in this tab only.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Line = { role: 'customer' | 'assistant'; text: string };
const KEY = 'virtus-chat';
const remember = (v: { chatId: string; lines: Line[] } | null) => { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* private window */ } };
const recall = (): { chatId: string; lines: Line[] } | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; } };

async function post<T>(url: string, body: object): Promise<T> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((json as { message?: string }).message ?? 'Something went wrong. Please try again.');
  return json as T;
}

export function ChatBubble() {
  const [on, setOn] = useState<{ greeting: string } | null>(null);
  const [open, setOpen] = useState(false);
  const saved = recall();
  const [chatId, setChatId] = useState<string | undefined>(saved?.chatId);
  const [lines, setLines] = useState<Line[]>(saved?.lines ?? []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [person, setPerson] = useState<'offer' | 'form' | 'sent' | null>(null);
  const [contact, setContact] = useState({ name: '', email: '', phone: '', consent: false });
  const [sentAs, setSentAs] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { void fetch('/api/aia/public').then((r) => r.json()).then((x: { on: boolean; greeting: string }) => setOn(x.on ? { greeting: x.greeting } : null), () => setOn(null)); }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [lines, busy, person, open]);
  if (!on) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText(''); setError(''); setBusy(true);
    const next = [...lines, { role: 'customer' as const, text: message }];
    setLines(next);
    try {
      const r = await post<{ chatId: string; reply: string; offerPerson: boolean }>('/api/aia/chat', { ...(chatId ? { chatId } : {}), message });
      const all = [...next, { role: 'assistant' as const, text: r.reply }];
      setChatId(r.chatId); setLines(all); remember({ chatId: r.chatId, lines: all });
      if (r.offerPerson && person === null) setPerson('offer');
    } catch (x) { setError((x as Error).message); }
    setBusy(false);
  };
  const handOff = async (e: FormEvent) => {
    e.preventDefault();
    if (!chatId) return;
    setError(''); setBusy(true);
    try {
      const r = await post<{ number: string }>('/api/aia/handoff', { chatId, name: contact.name, email: contact.email, phone: contact.phone, consent: true });
      setSentAs(r.number); setPerson('sent');
    } catch (x) { setError((x as Error).message); }
    setBusy(false);
  };
  const startOver = () => { remember(null); setChatId(undefined); setLines([]); setPerson(null); setSentAs(''); setError(''); };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <section role="dialog" aria-label="Chat with us" className="flex h-[min(34rem,calc(100vh-7rem))] w-[min(23rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
          <header className="flex items-center gap-3 bg-slate-950 px-4 py-3 text-white">
            <span className="grid size-9 place-items-center rounded-full bg-indigo-600 text-sm font-bold">V</span>
            <div className="min-w-0 flex-1"><p className="font-semibold">Virtus assistant</p><p className="text-xs text-white/60">AI answers first · our staff can take over</p></div>
            {lines.length > 0 && <button type="button" onClick={startOver} className="text-xs text-white/70 underline hover:text-white">New chat</button>}
            <button type="button" aria-label="Close the chat" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full text-xl hover:bg-white/10">×</button>
          </header>
          <div className="flex-1 space-y-2 overflow-y-auto bg-[#fafaf8] p-3 text-sm" aria-live="polite">
            <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-slate-800 ring-1 ring-slate-200">{on.greeting}</p>
            {lines.map((l, i) => (
              <p key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${l.role === 'customer' ? 'ml-auto rounded-br-sm bg-indigo-600 text-white' : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'}`}>{l.text}</p>
            ))}
            {busy && person !== 'form' && <p className="w-14 rounded-2xl bg-white px-3 py-2 text-slate-400 ring-1 ring-slate-200" aria-label="Typing">•••</p>}
            {person === 'offer' && <div className="rounded-xl bg-indigo-50 p-3 text-slate-700">Want our staff to answer?{' '}
              <button type="button" className="font-semibold text-indigo-700 underline" onClick={() => setPerson('form')}>Send this chat to us</button></div>}
            {person === 'form' && (
              <form onSubmit={handOff} className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                <p className="font-semibold">Send this chat to our staff</p>
                <input required aria-label="Your name" placeholder="Your name" className="w-full rounded-lg border border-slate-300 px-3 py-2" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                <input required type="email" aria-label="Email" placeholder="Email" className="w-full rounded-lg border border-slate-300 px-3 py-2" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                <input required aria-label="Mobile number" placeholder="Mobile, like 0917 123 4567" className="w-full rounded-lg border border-slate-300 px-3 py-2" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                <label className="flex items-start gap-2 text-xs text-slate-600"><input required type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} className="mt-0.5" />
                  I agree that Virtus keeps this chat and my contact details to answer me.</label>
                <button type="submit" disabled={busy} className="w-full rounded-full bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Send to staff</button>
              </form>
            )}
            {person === 'sent' && <p className="rounded-xl bg-emerald-50 p-3 text-emerald-800">Sent as {sentAs}. Our staff will reply by phone or email.</p>}
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-200 bg-white p-2">
            <input aria-label="Your message" maxLength={800} placeholder="Ask about products, prices, your order…" className="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-2 text-sm outline-none ring-indigo-500 focus:ring-2"
              value={text} onChange={(e) => setText(e.target.value)} disabled={person === 'sent'} />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="grid size-9 place-items-center rounded-full bg-indigo-600 text-white disabled:opacity-40">➤</button>
          </form>
          <p className="bg-white px-3 pb-2 text-[10px] text-slate-400">
            An AI answers first; prices are estimates until staff confirm. {person === null && lines.length > 0 && <button type="button" className="underline" onClick={() => setPerson('form')}>Talk to a person</button>}
          </p>
        </section>
      )}
      <button type="button" onClick={() => setOpen(!open)} aria-label={open ? 'Close the chat' : 'Chat with us'} aria-expanded={open}
        className="flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 font-semibold text-white shadow-xl hover:bg-indigo-700">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        {open ? 'Close' : 'Chat with us'}
      </button>
    </div>
  );
}
