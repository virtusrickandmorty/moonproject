/** Sales › Support inbox: messages sent from the public support page, with their pictures, notes and status. */
import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Notice, Panel, inputClass, manilaTime, useAction } from '../../components/ui.tsx';
import { masterRequest } from '../CUS/http.ts';
import { useLocation } from '../../router.tsx';

type Status = 'new' | 'in_progress' | 'closed';
type Kind = 'inquiry' | 'complaint' | 'suggestion' | 'quotation';
interface Message {
  id: string; number: string; kind: Kind; name: string; email: string | null; phone: string | null; subject: string; message: string;
  orderRef: string | null; status: Status; receivedAt: string; version: number; files: number;
}
interface Detail extends Message {
  attachments: { id: string; fileName: string; contentType: string; bytes: number }[];
  notes: { id: string; status: Status; note: string; at: string; userName: string }[];
}

export const STATUS_LABELS: Record<Status, string> = { new: 'New', in_progress: 'In progress', closed: 'Closed' };
const KIND_LABELS: Record<Kind, [string, string]> = {
  quotation: ['Quotation request', 'bg-indigo-100 text-indigo-800'], inquiry: ['Inquiry', 'bg-sky-100 text-sky-800'],
  complaint: ['Complaint', 'bg-rose-100 text-rose-800'], suggestion: ['Suggestion', 'bg-amber-100 text-amber-800'],
};
const Kind = ({ kind }: { kind: Kind }) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_LABELS[kind][1]}`}>{KIND_LABELS[kind][0]}</span>;

export function SupportInbox({ me }: { me: Me }) {
  const [filter, setFilter] = useState<Status | 'all'>('new');
  const [list, setList] = useState<{ rows: Message[]; counts: Record<Status, number> } | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [status, setStatus] = useState<Status>('new');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const canManage = me.permissions.includes('sup.manage');
  // A notification links here with ?open=<id>: show that message straight away.
  const opening = new URLSearchParams(useLocation().split('?')[1] ?? '').get('open');

  const load = useCallback(() => run(async () => setList(await masterRequest(me, `/api/sup/messages?status=${filter}`))), [me, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (opening) void show(opening); }, [opening]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (id: string) => run(async () => {
    const d = await masterRequest<Detail>(me, `/api/sup/messages/${encodeURIComponent(id)}`);
    setOpen(d); setStatus(d.status === 'new' ? 'in_progress' : d.status); setNote('');
  });
  const save = () => open && run(async () => {
    await masterRequest(me, `/api/sup/messages/${encodeURIComponent(open.id)}/notes`, 'POST', { status, note, version: open.version });
    await show(open.id);
    setList(await masterRequest(me, `/api/sup/messages?status=${filter}`));
  });

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold">Support inbox</h1><p className="text-sm text-slate-600">Inquiries, complaints, suggestions and quotation requests sent from the website's support page.</p></div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {(['new', 'in_progress', 'closed', 'all'] as const).map((s) => (
          <Button key={s} tone={filter === s ? 'primary' : 'plain'} onClick={() => { setFilter(s); setOpen(null); }}>
            {s === 'all' ? 'All' : STATUS_LABELS[s]}{s !== 'all' && list ? ` (${list.counts[s]})` : ''}
          </Button>))}
      </div>
      {error && <Notice>{error}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <ul className="divide-y divide-slate-100 self-start overflow-hidden rounded-lg bg-white shadow-sm">
          {list?.rows.length === 0 && <li className="p-5 text-sm text-slate-500">No messages here.</li>}
          {list?.rows.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => void show(m.id)} className={`block w-full px-4 py-3 text-left hover:bg-indigo-50 ${open?.id === m.id ? 'bg-indigo-50' : ''}`}>
                <div className="flex items-center justify-between gap-2"><Kind kind={m.kind} /><span className="text-xs text-slate-500">{manilaTime(m.receivedAt)}</span></div>
                <p className={`mt-1 truncate ${m.status === 'new' ? 'font-bold' : 'font-medium'}`}>{m.subject}</p>
                <p className="truncate text-sm text-slate-500">{m.name} · {m.number}{m.files ? ` · ${m.files} picture${m.files > 1 ? 's' : ''}` : ''}</p>
              </button>
            </li>))}
        </ul>

        {open ? (
          <div className="space-y-4">
            <Panel title={open.subject}>
              <div className="flex flex-wrap items-center gap-2 text-sm"><Kind kind={open.kind} /><span className="font-semibold">{open.number}</span><span className="text-slate-500">received {manilaTime(open.receivedAt)}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{STATUS_LABELS[open.status]}</span></div>
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div><dt className="text-slate-500">From</dt><dd className="font-semibold">{open.name}</dd></div>
                {open.email && <div><dt className="text-slate-500">Email</dt><dd><a href={`mailto:${open.email}?subject=${encodeURIComponent(`Re: ${open.subject} (${open.number})`)}`} className="text-indigo-700 underline">{open.email}</a></dd></div>}
                {open.phone && <div><dt className="text-slate-500">Phone</dt><dd><a href={`tel:${open.phone}`} className="text-indigo-700 underline">{open.phone}</a></dd></div>}
                {open.orderRef && <div><dt className="text-slate-500">Order</dt><dd className="font-semibold">{open.orderRef}</dd></div>}
              </dl>
              <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm">{open.message}</p>
              {open.attachments.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{open.attachments.map((a) => {
                const url = `/api/sup/messages/${encodeURIComponent(open.id)}/files/${encodeURIComponent(a.id)}`;
                return <a key={a.id} href={url} target="_blank" rel="noreferrer" className="block"><img src={url} alt={a.fileName} className="aspect-square w-full rounded-md object-cover ring-1 ring-slate-200" /><span className="mt-1 block truncate text-xs text-slate-500">{a.fileName}</span></a>;
              })}</div>}
            </Panel>
            <Panel title="Notes">
              {open.notes.length === 0 ? <p className="text-sm text-slate-500">No notes yet.</p> : (
                <ol className="space-y-2 text-sm">{open.notes.map((n) => <li key={n.id} className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">{manilaTime(n.at)} · {n.userName} · set to {STATUS_LABELS[n.status]}</p>{n.note && <p className="mt-1 whitespace-pre-wrap">{n.note}</p>}</li>)}</ol>)}
              {canManage && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className={inputClass} placeholder="What was done or agreed (a call back, a quotation number, a fix)" aria-label="Note" />
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={`${inputClass} w-auto`} aria-label="Status">
                      {(['new', 'in_progress', 'closed'] as const).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <Button tone="primary" disabled={busy || (status === open.status && !note.trim())} onClick={() => void save()}>Save</Button>
                  </div>
                </div>)}
            </Panel>
          </div>
        ) : <p className="rounded-lg bg-white p-6 text-sm text-slate-500 shadow-sm">Pick a message to read it.</p>}
      </div>
    </div>
  );
}
