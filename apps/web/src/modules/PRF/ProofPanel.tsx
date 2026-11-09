/**
 * The design proofs of a job order, on its page (the owner's request, Nov 2026): every version sent, newest first, with the
 * customer's answer; Send a design makes the next version and its private link, with a message ready to paste in Messenger.
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, showDate, useAction } from '../../components/ui.tsx';
import { PICTURE_ACCEPT } from '../../components/pictures.ts';
import { useLiveReload } from '../../live.ts';
import { base64, prepare } from '../../shop/Support.tsx';

export interface StaffProof {
  id: string; jobOrderNumber: string; version: number; token: string; note: string | null; sentAt: string; sentBy: string | null; replaced: boolean;
  files: { fileNo: number; fileName: string; contentType: string; bytes: number }[];
  answer: { answer: 'approved' | 'changes'; name: string; comment?: string; at: string } | null;
}

const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** The address the customer opens: the website's, even when staff work on the shop's own network. */
export const proofUrl = (token: string) => `${/(^|\.)virtusgarments\.com$/.test(location.hostname) ? location.origin : 'https://www.virtusgarments.com'}/p/${token}`;
/** A message to paste in Messenger or a text. */
export const proofMessage = (number: string, version: number, url: string) =>
  `Hi! Here is the design for your order ${number}${version > 1 ? ` (version ${version})` : ''}. Please check the names, numbers, spelling and colours, then tap Approve, or tell us what to change: ${url}`;
const when = (at: string) => `${showDate(at.slice(0, 10))}, ${at.slice(11, 16)}`;

function Status({ p }: { p: StaffProof }) {
  if (p.answer?.answer === 'approved') return <p className="text-sm font-semibold text-emerald-700">Approved by {p.answer.name} · {when(p.answer.at)}</p>;
  if (p.answer) return <p className="text-sm text-amber-800"><b>Change asked</b> by {p.answer.name} · {when(p.answer.at)}: “{p.answer.comment}”</p>;
  if (p.replaced) return <p className="text-sm text-slate-500">Replaced by a newer version before an answer</p>;
  return <p className="text-sm font-semibold text-sky-700">Waiting for the customer</p>;
}

function LinkBox({ p }: { p: StaffProof }) {
  const [copied, setCopied] = useState<'' | 'link' | 'message'>('');
  const url = proofUrl(p.token);
  const copy = (what: 'link' | 'message') => void navigator.clipboard?.writeText(what === 'link' ? url : proofMessage(p.jobOrderNumber, p.version, url)).then(() => setCopied(what), () => undefined);
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <input readOnly value={url} className={`${inputClass} min-w-0 flex-1`} aria-label={`The link to version ${p.version}`} onFocus={(e) => e.target.select()} />
      <Button onClick={() => copy('link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
      <Button tone="primary" onClick={() => copy('message')}>{copied === 'message' ? 'Copied' : 'Copy message'}</Button>
    </div>
    <p className="text-xs text-slate-500">Paste it in Messenger or a text to the customer. Anyone with the link can answer, so send it only to them.</p>
  </div>;
}

function SendDialog({ jobOrderId, onClose, onSent }: { jobOrderId: string; onClose: () => void; onSent: (p: { version: number; token: string }) => void }) {
  const [files, setFiles] = useState<{ name: string; blob: Blob; url: string | null }[]>([]);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [adding, setAdding] = useState(false);
  const a = useAction();
  /** Pictures are made smaller here first (as on the website); a PDF goes as it is, up to 5 MB. */
  const add = async (list: FileList | null) => {
    setProblem(''); setAdding(true);
    for (const f of [...(list ?? [])]) {
      try {
        const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (pdf && f.size > MAX_PDF_BYTES) throw new Error(`${f.name} is bigger than 5 MB. Send a smaller PDF.`);
        const item = pdf ? { name: f.name, blob: f as Blob, url: null } : await prepare(f);
        setFiles((x) => (x.length >= 6 ? x : [...x, item]));
      } catch (e) { setProblem((e as Error).message); }
    }
    setAdding(false);
  };
  const ready = files;
  const send = () => a.run(async () => {
    const body = { ...(note.trim() ? { note: note.trim() } : {}), files: await Promise.all(ready.map(async (f) => ({ name: f.name, data: await base64(f.blob) }))) };
    onSent(await api.prfSend(jobOrderId, body));
  });
  return <Dialog title="Send a design to the customer" onClose={onClose}>
    <Field label="The design (pictures or a PDF, up to 6)" required>
      <input type="file" multiple accept={`${PICTURE_ACCEPT},application/pdf,.pdf`} className={inputClass} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
    </Field>
    {ready.length > 0 && <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{ready.map((f, i) => (
      <li key={i} className="relative overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
        {f.url ? <img src={f.url} alt={f.name} className="aspect-square w-full object-contain" /> : <p className="grid aspect-square place-items-center p-2 text-center text-xs font-semibold text-slate-600">PDF<br />{f.name}</p>}
        <button type="button" aria-label={`Take out ${f.name}`} className="absolute right-1 top-1 rounded-full bg-white/90 px-2 text-sm font-bold text-rose-700 shadow" onClick={() => setFiles((x) => x.filter((y) => y !== f))}>×</button>
      </li>))}</ul>}
    <Field label="A note for the customer (optional)"><textarea className={`${inputClass} min-h-20`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: front and back, with the names from your list." /></Field>
    {(problem || a.error) && <Notice>{problem || a.error}</Notice>}
    <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button tone="primary" disabled={a.busy || adding || ready.length === 0} onClick={() => void send()}>Make the link</Button></div>
  </Dialog>;
}

export function ProofPanel({ d }: { d: DocDetail }) {
  const [proofs, setProofs] = useState<StaffProof[] | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const { id, status } = d.header;
  const load = () => api.prfProofs(id).then((r) => setProofs(r.proofs), (e: Error) => setError(e.message));
  useEffect(() => { void api.me().then((me) => setPerms(me.permissions), () => setPerms([])); }, []);
  useEffect(() => { if (perms.includes('prf.view')) void load(); }, [id, perms.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveReload(() => (perms.includes('prf.view') ? load() : Promise.resolve()));
  if (!perms.includes('prf.view')) return null;
  const may = perms.includes('prf.manage') && status === 'posted';
  const latest = proofs?.[0];
  return <Panel title="Design proof">
    {error && <Notice>{error}</Notice>}
    {proofs && proofs.length === 0 && <p className="text-sm text-slate-600">No design sent yet. Send it here and the customer approves it, or asks for a change, on their phone.</p>}
    {proofs?.map((p) => (
      <div key={p.id} className={`space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0 ${p === latest ? '' : 'opacity-75'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Version {p.version}{p.jobOrderNumber !== d.header.number ? ` (on ${p.jobOrderNumber})` : ''}</p>
          <p className="text-xs text-slate-500">Sent {when(p.sentAt)}{p.sentBy ? ` by ${p.sentBy}` : ''}</p>
        </div>
        <Status p={p} />
        {p.note && <p className="text-sm text-slate-600">Note: {p.note}</p>}
        <div className="flex flex-wrap gap-2">{p.files.map((f) => (
          <a key={f.fileNo} href={`/api/prf/proofs/${p.id}/files/${f.fileNo}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-slate-200 hover:ring-indigo-400" title={f.fileName}>
            {f.contentType === 'application/pdf' ? <span className="grid size-20 place-items-center bg-slate-50 p-1 text-center text-xs font-semibold text-slate-600">PDF</span>
              : <img src={`/api/prf/proofs/${p.id}/files/${f.fileNo}`} alt={f.fileName} className="size-20 object-cover" />}
          </a>))}</div>
        {p === latest && !p.answer && <LinkBox p={p} />}
      </div>
    ))}
    {may && <div><Button tone={latest?.answer?.answer === 'approved' ? 'plain' : 'primary'} onClick={() => setOpen(true)}>{proofs?.length ? 'Send a new design' : 'Send a design'}</Button></div>}
    {open && <SendDialog jobOrderId={id} onClose={() => setOpen(false)} onSent={() => { setOpen(false); void load(); }} />}
  </Panel>;
}
