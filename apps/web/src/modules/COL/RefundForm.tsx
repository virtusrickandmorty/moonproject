/**
 * Customer refund form (PLAN D5 DEP-REFUND, E5): pays back money held for a customer, a job order's deposit (cancelled
 * job orders too, D6) or their unapplied payments, from one or more cash places, with a reason. Also its Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { schemaFields, useBoxes, issueFields, rowFields, usedTenderRows, boxRefusals } from '../JO/boxes.ts';
import { tenderFields } from './typing.ts';
import { refundInput } from './validation.ts';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, type CashPlace, type DocHeader, type DocTypeInfo, type Preview, type Refundable } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { emptyTender, sum, tendersToInput, tendersToRows, type TenderInput, type TenderRow } from './money.ts';
import { CustomerPicker, EditGate, TenderRows, useLive, type Picked } from './parts.tsx';

type Stored = { customerId: string; jobOrderId?: string; tenders: TenderInput[]; reason: string };
const UNAPPLIED = 'unapplied';

export function RefundForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [held, setHeld] = useState<Refundable | null>(null);
  const [original, setOriginal] = useState<{ header: DocHeader; input: Stored; jobOrderNumber: string | null }>();
  const [editReason, setEditReason] = useState('');
  const [what, setWhat] = useState(''); // a JO id, or UNAPPLIED
  const [tenders, setTenders] = useState<TenderRow[]>([emptyTender()]);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(boxes.refuse(e));

  useEffect(() => {
    api.cashPlaces().then((all) => setPlaces(all.filter((p) => p.kind !== 'checks')), fail); // customer checks are deposited, never paid out
    if (mode.kind !== 'edit') return;
    api.get(type.key, mode.id).then((d) => {
      const input = d.input as Stored;
      const doc = d.doc as { customerName: string; jobOrderNumber: string | null };
      setOriginal({ header: d.header, input, jobOrderNumber: doc.jobOrderNumber });
      setCustomer({ id: input.customerId, name: doc.customerName });
      setWhat(input.jobOrderId ?? UNAPPLIED);
      setTenders(tendersToRows(input.tenders));
      setReason(input.reason);
    }, fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  useEffect(() => {
    setHeld(null);
    if (customer) api.refundable(customer.id).then(setHeld, fail);
  }, [customer?.id]);

  // Choices, with what the refund being edited paid back counted as held again (it is cancelled first).
  const back = original && held?.customerId === original.input.customerId ? { key: original.input.jobOrderId ?? UNAPPLIED, cents: original.header.totalCents } : null;
  const plus = (key: string, cents: number) => cents + (back?.key === key ? back.cents : 0);
  const choices = held
    ? [
        ...held.jobOrders.map((jo) => ({ key: jo.id, label: `Deposit for ${jo.number}${jo.status === 'cancelled' ? ' (cancelled job order)' : ''}`, cents: plus(jo.id, jo.depositsHeldCents) })),
        ...(back && back.key !== UNAPPLIED && !held.jobOrders.some((jo) => jo.id === back.key) ? [{ key: back.key, label: `Deposit for ${original!.jobOrderNumber}`, cents: back.cents }] : []),
        { key: UNAPPLIED, label: 'Unapplied payments', cents: plus(UNAPPLIED, held.unappliedCents) },
      ].filter((c) => c.cents > 0)
    : [];

  const pay = tendersToInput(tenders, 'pick where the money came from');
  const errors = [
    ...(customer ? [] : ['Pick the customer.']),
    ...(what ? [] : ['Pick what is paid back.']),
    ...pay.errors,
    ...(reason.trim().length >= 10 ? [] : ['Give a reason of at least 10 characters.']),
  ];
  const input = { customerId: customer?.id ?? '', ...(what && what !== UNAPPLIED ? { jobOrderId: what } : {}), tenders: pay.tenders, reason: reason.trim() };
  const live = useLive(JSON.stringify(input), errors.length === 0, () => api.preview(type.key, input), (e) => boxes.capture(e));

  const remap = (fields: Record<string, string>) => rowFields(fields, 'tenders', usedTenderRows(tenders));
  const boxes = useBoxes({ ...remap(issueFields(live?.issues)), ...schemaFields(refundInput, input), ...tenderFields(tenders, new Set(), 5), ...(!what ? { jobOrderId: 'Pick what is paid back.' } : {}) }, JSON.stringify(input), {}, false, remap);
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
  const chosen = choices.find((c) => c.key === what);
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.header.number}` : 'New customer refund'}</h1>
        {original && <Notice tone="info">When you record, {original.header.number} is cancelled and the replacement gets a new number. Reason: {editReason}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Panel title="Who gets money back">
          <CustomerPicker boxes={boxes} value={customer} onChange={(c) => (setCustomer(c), setWhat(''))} />
        </Panel>
        <Panel title="What is paid back?">
          {customer && held && choices.length === 0 && <p className="text-sm text-slate-500">No money is held for {customer.name}.</p>}
          <Field label="What is paid back?" error={boxes.error('jobOrderId')}><div {...boxes.choice('jobOrderId')} role="radiogroup" aria-label="What is paid back?" className="space-y-2">
            {choices.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={what === c.key} onClick={() => setWhat(c.key)}
                className={`flex w-full justify-between rounded-lg p-3 text-left text-sm ring-1 ${what === c.key ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
                <span>{c.label}</span><span className="tabular-nums">{formatPesos(c.cents)} held</span>
              </button>
            ))}
          </div></Field>
        </Panel>
        <Panel title="Where did the money come from?">
          <TenderRows boxes={boxes} rows={tenders} onChange={setTenders} places={places} question="Where did the money come from?" amountHint={chosen ? formatPesos(chosen.cents) : undefined} />
        </Panel>
        <Field label="Reason (at least 10 characters)" error={boxes.error('reason')} required>
          <textarea {...boxes.box('reason')} rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <p className="text-2xl font-semibold tabular-nums">{peso(sum(pay.tenders.map((t) => t.amountCents)))}</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.filter((i) => i.level !== 'error' || !i.field).map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} original={original?.header} reason={editReason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
