/**
 * Deposit transfer form (PLAN D5 DEP-XFER, D6): moves a customer's money held, a job order's deposit (a cancelled or
 * edited one, usually) or their unapplied payments, to another of their job orders. No cash moves. Opened from a JO view
 * with ?from=<JO> (and &to=<JO>), the edited JO's replacement is picked for you. Also its Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { schemaFields, useBoxes, issueFields, boxRefusals } from '../JO/boxes.ts';
import { tenderFields } from './typing.ts';
import { depositTransferInput } from './validation.ts';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Preview, type Transferable } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { cents } from './money.ts';
import { CustomerPicker, EditGate, useLive, type Picked } from './parts.tsx';
import { UNAPPLIED, sources, targets, type Moved } from './transfer.ts';

type Stored = { customerId: string; fromJobOrderId?: string; toJobOrderId: string; amountCents: number; note?: string };
const choice = (on: boolean) => `flex w-full justify-between rounded-lg p-3 text-left text-sm ring-1 ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`;

export function DepositTransferForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [held, setHeld] = useState<Transferable | null>(null);
  const [original, setOriginal] = useState<{ header: DocHeader; moved: Moved }>();
  const [editReason, setEditReason] = useState('');
  const [from, setFrom] = useState(''); // a JO id, or UNAPPLIED
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(''); // blank = as much as both sides allow
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(boxes.refuse(e));

  useEffect(() => {
    if (mode.kind === 'edit') {
      api.get(type.key, mode.id).then((d) => {
        const input = d.input as Stored;
        const doc = d.doc as { customerName: string; fromJobOrderNumber: string | null; toJobOrderNumber: string };
        const fromKey = input.fromJobOrderId ?? UNAPPLIED;
        setOriginal({ header: d.header, moved: { fromKey, fromLabel: `Deposit for ${doc.fromJobOrderNumber}`, toId: input.toJobOrderId, toLabel: doc.toJobOrderNumber, cents: input.amountCents } });
        setCustomer({ id: input.customerId, name: doc.customerName });
        setFrom(fromKey);
        setTo(input.toJobOrderId);
        setAmount(formatPesos(input.amountCents));
        setNote(input.note ?? '');
      }, fail);
      return;
    }
    const q = new URLSearchParams(location.search);
    const jo = q.get('from');
    if (!jo) return;
    api.get('jo.job_order', jo).then((d) => {
      setCustomer({ id: (d.input as { customerId: string }).customerId, name: (d.doc as { customerName: string }).customerName });
      setFrom(jo);
      setTo(q.get('to') ?? '');
    }, fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  useEffect(() => {
    setHeld(null);
    if (customer) api.transferable(customer.id).then(setHeld, fail);
  }, [customer?.id]);

  const back = original && held?.customerId === customer?.id ? original.moved : undefined;
  const froms = held ? sources(held, back) : [];
  const source = froms.find((s) => s.key === from);
  const tos = held && from ? targets(held, from, back) : [];
  const target = tos.find((t) => t.id === to);
  // An edited JO's deposit goes to its replacement unless the encoder picks another JO.
  useEffect(() => void (source?.replacementId && !to && tos.some((t) => t.id === source.replacementId) && setTo(source.replacementId)), [source?.replacementId, tos.length]);

  const suggested = source && target ? Math.min(source.cents, target.dueCents) : 0;
  const typed = amount.trim() ? cents(amount) : suggested;
  const errors = [
    ...(customer ? [] : ['Pick the customer.']),
    ...(source ? [] : ['Pick where the money is now.']),
    ...(target ? [] : ['Pick the job order it goes to.']),
    ...(typed === undefined || typed <= 0 ? ['Type an amount like 1,250.00'] : []),
  ];
  const input = {
    customerId: customer?.id ?? '',
    ...(from && from !== UNAPPLIED ? { fromJobOrderId: from } : {}),
    toJobOrderId: to,
    amountCents: typed ?? 0,
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  const live = useLive(JSON.stringify(input), errors.length === 0, () => api.preview(type.key, input), (e) => boxes.capture(e));

  const boxes = useBoxes({ ...issueFields(live?.issues), ...schemaFields(depositTransferInput, input), ...(!source ? { fromJobOrderId: 'Pick where the money is now.' } : {}) }, JSON.stringify(input));
  const openConfirm = () => {
    setTouched(true); boxes.submit();
    if (errors.length === 0) api.preview(type.key, input).then((p) => { if (boxes.review(p)) setConfirm(p); }, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.header.id, input, confirm!.totalCents, editReason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      fail(e as Error);
      if (Object.keys(boxRefusals(e)).length) setConfirm(null);
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };

  if (original && !editReason) return <EditGate original={original.header} typeKey={type.key} onReason={setEditReason} />;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.header.number}` : 'Move a deposit'}</h1>
        {original && <Notice tone="info">When you record, {original.header.number} is cancelled and the replacement gets a new number. Reason: {editReason}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Panel title="Whose money">
          <CustomerPicker boxes={boxes} value={customer} onChange={(c) => (setCustomer(c), setFrom(''), setTo(''))} />
        </Panel>
        <Panel title="Where is the money now?">
          {customer && held && froms.length === 0 && <p className="text-sm text-slate-500">No money is held for {customer.name}.</p>}
          <Field label="Where is the money now?" error={boxes.error('fromJobOrderId')}><div {...boxes.choice('fromJobOrderId')} role="radiogroup" aria-label="Where is the money now?" className="space-y-2">
            {froms.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={from === s.key} onClick={() => (setFrom(s.key), setTo(''))} className={choice(from === s.key)}>
                <span>{s.label}</span><span className="tabular-nums">{formatPesos(s.cents)} held</span>
              </button>
            ))}
          </div></Field>
        </Panel>
        <Panel title="Which job order does it go to?">
          {source && tos.length === 0 && <p className="text-sm text-slate-500">{customer?.name} has no other job order with a balance due.</p>}
          <Field label="Which job order does it go to?" error={boxes.error('toJobOrderId')}><div {...boxes.choice('toJobOrderId')} role="radiogroup" aria-label="Which job order does it go to?" className="space-y-2">
            {tos.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={to === t.id} onClick={() => setTo(t.id)} className={choice(to === t.id)}>
                <span>{t.label}{t.id === source?.replacementId ? ' (replaces it)' : ''}</span><span className="tabular-nums">{formatPesos(t.dueCents)} to pay</span>
              </button>
            ))}
          </div></Field>
        </Panel>
        <Field label="Amount" error={boxes.error('amountCents')} hint="Leave blank to move as much as both allow.">
          <input {...boxes.box('amountCents')} aria-label="Amount" inputMode="decimal" placeholder={suggested ? formatPesos(suggested) : '0.00'} className={`${inputClass} max-w-40 text-right tabular-nums`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Note" error={boxes.error('note')}>
          <input {...boxes.box('note')} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <p className="text-2xl font-semibold tabular-nums">{peso(typed ?? 0)}</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.filter((i) => i.level !== 'error' || !i.field).map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} original={original?.header} reason={editReason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
