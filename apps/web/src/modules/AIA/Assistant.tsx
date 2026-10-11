/**
 * The website's AI assistant, for the owner (the owner's request, Oct 2026): switch it on, give it the AI service's key
 * (write-only), its greeting and what it should know about the shop; and read the chats customers had with it, with the
 * ones handed to the Support inbox. The website shows the chat only while it is on and has a key.
 */
import { useEffect, useState } from 'react';
import { api, type AiaChats, type AiaMessage, type AiaSettings, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';

const tokens = (n: number) => n.toLocaleString('en-PH');
/** A hint only: what the owner might write (an empty box tells the assistant nothing). */
const EXAMPLE = [
  'For example:',
  'Open Monday to Saturday, 9 AM to 6 PM, at (your address). Mobile 0917 …, Messenger: (your page).',
  'Made-to-order jobs take about 10 to 14 days after the design is approved; rush orders cost more, ask staff.',
  'A 50% downpayment starts the job; the balance is paid on release.',
  'For a team order, send the name, jersey number and size of each player.',
  'Pick-up at the shop, or delivery by courier at the cost of the customer.',
].join('\n');

export function WebsiteAssistant({ me }: { me: Me }) {
  const canManage = me.permissions.includes('aia.manage');
  const [s, setS] = useState<AiaSettings | null>(null);
  const [form, setForm] = useState({ isOn: false, greeting: '', knowledge: '' });
  const [key, setKey] = useState('');
  const [chats, setChats] = useState<AiaChats | null>(null);
  const [open, setOpen] = useState<{ id: string; messages: AiaMessage[]; supportNumber: string | null } | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  const a = useAction();
  const loadSettings = () => (canManage ? api.aiaSettings().then((x) => (setS(x), setForm({ isOn: x.isOn, greeting: x.greeting, knowledge: x.knowledge })), (e: Error) => setError(e.message)) : Promise.resolve());
  useEffect(() => { void loadSettings(); void api.aiaChats().then(setChats, (e: Error) => setError(e.message)); }, []);

  const save = (extra: { apiKey?: string } = {}) => a.run(async () => {
    setSaved('');
    const x = await api.aiaSaveSettings({ ...form, ...extra, version: s!.version });
    setS(x); setForm({ isOn: x.isOn, greeting: x.greeting, knowledge: x.knowledge }); setKey('');
    setSaved(x.isOn ? 'Saved. The chat is on the website now.' : 'Saved. The chat is off.');
  });

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Website assistant</h1>
      <p className="text-sm text-slate-600">An AI chat on the website and shop. It answers from your products, price list and the notes below, tells customers where their order is,
        and sends a chat to the <Link to="/sup" className="text-indigo-700 underline">Support inbox</Link> when a person should answer. It never sees costs, pay or other customers.</p>
      {error && <Notice>{error}</Notice>}
      {canManage && s && (
        <Panel title="Settings">
          <label className="flex items-center gap-3 text-sm">
            <button type="button" role="switch" aria-checked={form.isOn} aria-label="Assistant on the website" onClick={() => setForm({ ...form, isOn: !form.isOn })}
              className={`relative h-6 w-11 rounded-full transition ${form.isOn ? 'bg-indigo-600' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${form.isOn ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
            {form.isOn ? 'On: customers see the chat bubble' : 'Off: the website shows no chat'}
          </label>
          <Field label="Google AI Studio key" hint={s.keySet ? 'A key is saved. Type a new one to replace it, then Save.' : 'From aistudio.google.com → Get API key. Google bills by use beyond its free tier; set a budget in Google Cloud billing.'}>
            <div className="flex flex-wrap gap-2">
              <input type="password" autoComplete="off" className={`${inputClass} max-w-md`} placeholder={s.keySet ? '•••••••• saved' : 'Paste the key from Google AI Studio'} value={key} onChange={(e) => setKey(e.target.value)} />
              {s.keySet && <Button disabled={a.busy} onClick={() => void a.run(async () => { setTested(null); const r = await api.aiaTest(); setTested(r.ok ? { ok: true, text: `It works (${r.model}): "${r.reply}"` } : { ok: false, text: r.message }); })}>Test the key</Button>}
              {s.keySet && <Button disabled={a.busy} onClick={() => void save({ apiKey: '' })}>Remove the key</Button>}
            </div>
          </Field>
          {tested && <Notice tone={tested.ok ? 'success' : 'error'}>{tested.text}</Notice>}
          <Field label="Greeting" hint="The first words customers see"><input className={inputClass} maxLength={300} value={form.greeting} onChange={(e) => setForm({ ...form, greeting: e.target.value })} /></Field>
          <Field label="What it should know" hint="Hours, address, how ordering works, downpayment, lead times, sizes, delivery. Prices and order status come from the ERP itself.">
            <textarea rows={10} className={inputClass} maxLength={20000} value={form.knowledge} onChange={(e) => setForm({ ...form, knowledge: e.target.value })} placeholder={EXAMPLE} />
          </Field>
          {a.error && <Notice>{a.error}</Notice>}
          {saved && !a.error && <Notice tone="success">{saved}</Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="primary" disabled={a.busy} onClick={() => void save(key.trim() ? { apiKey: key.trim() } : {})}>Save</Button>
            <a href="/" target="_blank" rel="noopener" className="text-sm text-indigo-700 underline">Open the website to try it</a>
          </div>
        </Panel>
      )}
      <Panel title="Chats">
        {chats && <p className="text-sm text-slate-600">Last 30 days: <b>{chats.last30Days.chats}</b> chats · {tokens(chats.last30Days.inputTokens)} tokens read and {tokens(chats.last30Days.outputTokens)} written by the AI (the AI service bills by these).</p>}
        {!chats ? <p className="text-sm text-slate-500">Loading…</p> : chats.rows.length === 0 ? <p className="text-sm text-slate-500">No chats yet.</p> : (
          <table className="w-full">
            <thead><tr><th>Started</th><th>First question</th><th>Messages</th><th>Staff</th></tr></thead>
            <tbody>{chats.rows.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => void api.aiaChat(c.id).then((x) => setOpen({ id: c.id, ...x }), (e: Error) => setError(e.message))}>
                <td className="whitespace-nowrap">{c.startedAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="max-w-md truncate" title={c.firstQuestion ?? ''}>{c.firstQuestion}</td>
                <td className="tabular-nums">{c.messages}</td>
                <td>{c.supportNumber ? <Link to="/sup" className="text-indigo-700 underline">{c.supportNumber}</Link> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      {open && (
        <Dialog title="Chat with the website assistant" wide onClose={() => setOpen(null)}>
          {open.supportNumber && <Notice tone="info">Sent to staff as {open.supportNumber}.</Notice>}
          <ol className="space-y-2">
            {open.messages.map((m) => (
              <li key={m.seq} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === 'customer' ? 'ml-auto bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                <p className="whitespace-pre-wrap">{m.text}</p><p className={`mt-1 text-[10px] ${m.role === 'customer' ? 'text-white/70' : 'text-slate-500'}`}>{m.at.slice(11, 16)}</p>
              </li>
            ))}
          </ol>
        </Dialog>
      )}
    </div>
  );
}
