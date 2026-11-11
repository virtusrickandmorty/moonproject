/**
 * Who received a release sent out for delivery (the owner's request, Nov 2026): on the slip's own page, typed from the signed copy
 * and typed again to put it right. A release claimed in person already says who, so this shows only on one for delivery.
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail, type JoStatus } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, showDate, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';

type Received = { receivedBy: string; receivedOn: string };

/** What was recorded, from the release as the server loaded it. */
export const receivedOf = (doc: DocDetail['doc']): Received | null =>
  typeof doc?.receivedBy === 'string' && typeof doc.receivedOn === 'string' ? { receivedBy: doc.receivedBy, receivedOn: doc.receivedOn } : null;

function ReceivedDialog({ id, number, wentOut, now, onClose, onSaved }: { id: string; number: string; wentOut: string; now: Received | null; onClose: () => void; onSaved: (r: Received) => void }) {
  const [today, setToday] = useState('');
  const [name, setName] = useState(now?.receivedBy ?? '');
  const [date, setDate] = useState(now?.receivedOn ?? '');
  const a = useAction();
  useEffect(() => { void api.health().then((h) => { const d = h.serverTime.slice(0, 10); setToday(d); setDate((x) => x || d); }, () => undefined); }, []);
  const save = () => a.run(async () => { onSaved(await api.joReleaseReceived(id, { receivedBy: name.trim(), receivedOn: date })); });
  return <Dialog title={`Who received ${number}`} onClose={onClose}>
    <p className="text-sm text-slate-600">From the signed release slip.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Received by" required><input className={inputClass} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Date received" required><input type="date" className={inputClass} min={wentOut} max={today || undefined} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    </div>
    {a.error && <Notice>{a.error}</Notice>}
    <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button tone="primary" disabled={a.busy || !name.trim() || !date} onClick={() => void save()}>Save</Button></div>
  </Dialog>;
}

const ID_WORDS: Record<string, string> = { government_id: 'government ID seen', school_id: 'school ID seen', company_id: 'company ID seen', other_id: 'an ID seen', none: 'no ID seen' };

/**
 * The job order's releases and who got each (the owner's request, Nov 2026), on the job order's own page: claimed in person
 * by whom, or delivered and received by whom; a delivery with nobody typed yet can be typed here.
 */
export function JoReleases({ releases, may, onSaved }: { releases: NonNullable<JoStatus['releases']>; may: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState<(typeof releases)[number] | null>(null);
  if (releases.length === 0) return null;
  const pcs = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;
  return <Panel title="Released to">
    <ul className="divide-y divide-slate-100 text-sm">
      {releases.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <span className="min-w-0">
            <Link to={docPath('jo.release', `/${r.id}`)} className="font-medium text-indigo-700 hover:underline">{r.number}</Link>
            <span className="text-slate-500"> · {showDate(r.date)} · {pcs(r.pieces)}</span>
            <span className="block">
              {!r.forDelivery ? <>Claimed by <b>{r.claimedBy}</b> <span className="text-slate-500">({ID_WORDS[r.idSeen] ?? r.idSeen})</span></>
                : r.receivedBy ? <>Delivered · received by <b>{r.receivedBy}</b>{r.receivedOn && <span className="text-slate-500"> on {showDate(r.receivedOn)}</span>}</>
                : <span className="font-medium text-amber-800">Sent for delivery · who received it is not typed yet</span>}
            </span>
          </span>
          {may && r.forDelivery && <Button onClick={() => setOpen(r)}>{r.receivedBy ? 'Change' : 'Type who received it'}</Button>}
        </li>
      ))}
    </ul>
    {open && open.forDelivery && <ReceivedDialog id={open.id} number={open.number} wentOut={open.date}
      now={open.receivedBy && open.receivedOn ? { receivedBy: open.receivedBy, receivedOn: open.receivedOn } : null}
      onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved(); }} />}
  </Panel>;
}

export function ReleaseReceived({ d }: { d: DocDetail }) {
  const [now, setNow] = useState(() => receivedOf(d.doc));
  const [may, setMay] = useState(false);
  const [open, setOpen] = useState(false);
  const { id, number, status, businessDate } = d.header;
  useEffect(() => { setNow(receivedOf(d.doc)); }, [d.doc]);
  useEffect(() => { void api.me().then((me) => setMay(me.permissions.includes('jo.release')), () => setMay(false)); }, []);
  if (d.doc?.forDelivery !== true) return null;
  return <Panel title="Delivery">
    {now ? <p className="text-sm">Received by <b>{now.receivedBy}</b> on {showDate(now.receivedOn)}.</p> : <p className="text-sm text-slate-600">Sent out for delivery. Who received it is not recorded yet.</p>}
    {status === 'posted' && may && <div><Button onClick={() => setOpen(true)}>{now ? 'Change who received it' : 'Record who received it'}</Button></div>}
    {open && <ReceivedDialog id={id} number={number} wentOut={businessDate} now={now} onClose={() => setOpen(false)} onSaved={(r) => { setNow(r); setOpen(false); }} />}
  </Panel>;
}
