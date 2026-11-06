/**
 * Who received a release sent out for delivery (the owner's request, Nov 2026): on the slip's own page, typed from the signed copy
 * and typed again to put it right. A release claimed in person already says who, so this shows only on one for delivery.
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, showDate, useAction } from '../../components/ui.tsx';

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
