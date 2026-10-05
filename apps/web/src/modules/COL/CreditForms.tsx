/**
 * Credits with no cash (PLAN D5, E5 "other documents"): the 2307 received with no cash (CWT-), the deposit forfeit
 * (DFF-), the credit memo (CM-) and the bad debt write-off (BDW-). Each picks the customer, then one of their invoices
 * (or, for a forfeit, a job order with a deposit held), shows what it owes, and previews on the server as you type.
 * The forms also prefill an Edit, but the views offer none: a replacement's preview would still count the credit it
 * replaces (what the invoice owes, what is left to credit), so the correction is a cancel and a new document.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { schemaFields, useBoxes, issueFields } from '../JO/boxes.ts';
import { cwtOnlyInput as cwtSchema, creditMemoInput as memoSchema, forfeitInput as forfeitSchema, writeOffInput as offSchema } from './validation.ts';
import { formatPesos } from '@moonproject/shared';
import { api, type CustomerInvoices, type DocDetail, type DocTypeInfo, type Forfeitable, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { useRecord } from '../JO/record.tsx';
import { CustomerPicker, useLive, type Picked } from './parts.tsx';
import { creditMemoInput, cwtOnlyInput, emptyCreditMemo, emptyCwtOnly, emptyForfeit, emptyWriteOff, forfeitInput, writeOffInput } from './credits.ts';

type Invoice = CustomerInvoices['invoices'][number];
const invoiceLabel = (i: Invoice) => `Invoice no. ${i.invoiceNumber} · ${i.number}${i.jobOrderNumber ? ` · ${i.jobOrderNumber}` : ' · quick sale'} · ${i.businessDate}`;

function Choice({ picked, onPick, label, right, disabled, note }: { picked: boolean; onPick: () => void; label: string; right: string; disabled?: boolean; note?: string | null }) {
  return (
    <button type="button" role="radio" aria-checked={picked} disabled={disabled} onClick={onPick}
      className={`flex w-full justify-between gap-3 rounded-lg p-3 text-left text-sm ring-1 disabled:opacity-50 ${picked ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>
      <span>{label}{note && <span className="block text-xs">{note}</span>}</span><span className="tabular-nums">{right}</span>
    </button>
  );
}

/** The customer, then one of their recorded invoices. `describe` says what each shows and whether it can be picked. */
function InvoicePicker(p: {
  boxes: import('../JO/boxes.ts').Boxes;
  customer: Picked | null; onCustomer: (c: Picked | null) => void; invoiceId: string; onPick: (i: Invoice | null) => void;
  describe: (i: Invoice) => { right: string; disabled?: boolean; note?: string | null };
}) {
  const [list, setList] = useState<CustomerInvoices | null>(null);
  useEffect(() => {
    setList(null);
    if (p.customer) api.customerInvoices(p.customer.id).then(setList, () => undefined);
  }, [p.customer?.id]);
  useEffect(() => void (list && p.onPick(list.invoices.find((i) => i.id === p.invoiceId) ?? null)), [list, p.invoiceId]);
  return (
    <>
      <Panel title="Customer">
        <CustomerPicker boxes={p.boxes} value={p.customer} onChange={(c) => (p.onCustomer(c), p.onPick(null))} />
      </Panel>
      {(
        <Panel title="Which invoice?">
          {list && list.invoices.length === 0 && <p className="text-sm text-slate-500">{p.customer?.name} has no recorded invoices.</p>}
          <Field label="Which invoice?" error={p.boxes.error('invoiceId')}><div {...p.boxes.choice('invoiceId')} role="radiogroup" aria-label="Which invoice?" className="space-y-2">
            {list?.invoices.map((i) => {
              const d = p.describe(i);
              return <Choice key={i.id} picked={p.invoiceId === i.id} onPick={() => p.onPick(i)} label={invoiceLabel(i)} {...d} />;
            })}
          </div></Field>
        </Panel>
      )}
    </>
  );
}

function Live({ live }: { live: Preview | null }) {
  return (
    <>
      {live && <p className="text-sm">{live.summary}</p>}
      {live?.issues.filter((i) => i.level !== 'error' || !i.field).map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
    </>
  );
}

function Shell(p: { type: DocTypeInfo; title: string; top: ReactNode; children: ReactNode; live: Preview | null; errors: string[]; touched: boolean; action: string; danger?: boolean; onRecord: () => void; dialog: ReactNode }) {
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{p.title}</h1>
      {p.top}
      {p.children}
      <Live live={p.live} />

      <div className="flex gap-2">
        <Button tone={p.danger ? 'danger' : 'primary'} disabled={!p.type.canPost} onClick={p.onRecord}>{p.action}</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {p.dialog}
    </form>
  );
}

const customerOf = (d: DocDetail): Picked => {
  const doc = d.doc as { customerId: string; customerName: string };
  return { id: doc.customerId, name: doc.customerName };
};

export function CwtOnlyForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [v, setV] = useState(emptyCwtOnly);
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { invoiceId: string; cwtCents: number; atc: 'WC158' | 'WC160' | 'other'; periodYear: number; periodQuarter: number; note?: string };
    setCustomer(customerOf(d));
    setV({ invoiceId: s.invoiceId, amount: formatPesos(s.cwtCents), atc: s.atc, period: `${s.periodYear}-Q${s.periodQuarter}`, note: s.note ?? '' });
  });
  const { input, errors } = cwtOnlyInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const boxes = useBoxes({ ...issueFields(live?.issues), ...schemaFields(cwtSchema, input), ...( !v.atc ? { atc: 'Pick the ATC printed on the 2307.' } : {}) }, JSON.stringify(v), r.refusedInput === JSON.stringify(input) ? r.refused : {}, r.touched);
  if (r.gate) return r.gate;
  return (
    <Shell type={type} title={r.title('2307 received with no payment')} top={r.top} live={live} errors={[]} touched={r.touched} action="Record" onRecord={() => { boxes.submit(); r.ask(input, errors); }} dialog={r.dialog}>
      <Notice tone="info">For a 2307 that came after the customer paid the invoice net of the tax. A 2307 that comes with a payment goes on the collection.</Notice>
      <InvoicePicker boxes={boxes} customer={customer} onCustomer={setCustomer} invoiceId={v.invoiceId} onPick={(i) => (setInvoice(i), setV((x) => ({ ...x, invoiceId: i?.id ?? '' })))}
        describe={(i) => ({ right: `owes ${peso(i.owedCents)}`, disabled: i.owedCents <= 0 && i.id !== v.invoiceId })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tax withheld (on the 2307)" error={boxes.error('cwtCents')} required hint={invoice ? `The invoice owes ${peso(invoice.owedCents)}` : undefined}>
          <input {...boxes.box('cwtCents')} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Tax code (ATC)" error={boxes.error('atc')} required>
          <select {...boxes.box('atc')} aria-label="Tax code (ATC)" className={inputClass} value={v.atc} onChange={(e) => setV({ ...v, atc: e.target.value as typeof v.atc })}>
            <option value="">Pick</option>
            <option value="WC158">WC158 goods 1%</option>
            <option value="WC160">WC160 services 2%</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Quarter on the 2307" error={boxes.error('periodYear', 'periodQuarter')} required hint="Like 2026-Q3">
          <input {...boxes.box('periodYear')} className={inputClass} placeholder="2026-Q3" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} />
        </Field>
      </div>
      <Field label="Note" error={boxes.error('note')}><input {...boxes.box('note')} className={inputClass} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
    </Shell>
  );
}

export function CreditMemoForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [v, setV] = useState(emptyCreditMemo);
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { invoiceId: string; kind: 'return' | 'allowance'; amountCents: number; formNumber?: string; reason: string };
    setCustomer(customerOf(d));
    setV({ invoiceId: s.invoiceId, kind: s.kind, amount: formatPesos(s.amountCents), formNumber: s.formNumber ?? '', reason: s.reason });
  });
  const { input, errors } = creditMemoInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const boxes = useBoxes({ ...issueFields(live?.issues), ...schemaFields(memoSchema, input), ...(!v.kind ? { kind: 'Pick return or allowance.' } : {}) }, JSON.stringify(v), r.refusedInput === JSON.stringify(input) ? r.refused : {}, r.touched);
  if (r.gate) return r.gate;
  return (
    <Shell type={type} title={r.title('New credit memo')} top={r.top} live={live} errors={[]} touched={r.touched} action="Record" onRecord={() => { boxes.submit(); r.ask(input, errors); }} dialog={r.dialog}>
      <InvoicePicker boxes={boxes} customer={customer} onCustomer={setCustomer} invoiceId={v.invoiceId} onPick={(i) => (setInvoice(i), setV((x) => ({ ...x, invoiceId: i?.id ?? '' })))}
        describe={(i) => ({
          right: `${peso(i.grossCents)} · owes ${peso(i.owedCents)}`,
          disabled: (i.creditableCents <= 0 || !!i.writtenOff) && i.id !== v.invoiceId,
          note: i.writtenOff ? `Written off (${i.writtenOff})` : i.creditableCents < i.grossCents ? `${peso(i.creditableCents)} left to credit` : null,
        })} />
      <Panel title="Return or allowance?">
        <Field label="Return or allowance?" error={boxes.error('kind')}><div {...boxes.choice('kind')} role="radiogroup" aria-label="Return or allowance?" className="grid grid-cols-2 gap-2">
          {(['return', 'allowance'] as const).map((k) => (
            <Choice key={k} picked={v.kind === k} onPick={() => setV({ ...v, kind: k })} label={k === 'return' ? 'Return (goods came back)' : 'Allowance (price reduced)'} right="" />
          ))}
        </div></Field>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount, with VAT" error={boxes.error('amountCents')} required hint={invoice ? `At most ${peso(invoice.creditableCents)}` : undefined}>
          <input {...boxes.box('amountCents')} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Credit memo form no. (if one is used)" error={boxes.error('formNumber')}>
          <input {...boxes.box('formNumber')} inputMode="numeric" className={inputClass} value={v.formNumber} onChange={(e) => setV({ ...v, formNumber: e.target.value })} />
        </Field>
      </div>
      {invoice && invoice.creditableCents > 0 && <Button onClick={() => setV({ ...v, amount: formatPesos(invoice.creditableCents) })}>All that is left</Button>}
      <Field label="Why? (at least 10 characters)" error={boxes.error('reason')} required>
        <textarea {...boxes.box('reason')} rows={2} className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Field>
    </Shell>
  );
}

export function WriteOffForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [v, setV] = useState(emptyWriteOff);
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { invoiceId: string; reason: string };
    setCustomer(customerOf(d));
    setV({ invoiceId: s.invoiceId, reason: s.reason });
  });
  const { input, errors } = writeOffInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const boxes = useBoxes({ ...issueFields(live?.issues), ...schemaFields(offSchema, input) }, JSON.stringify(v), r.refusedInput === JSON.stringify(input) ? r.refused : {}, r.touched);
  if (r.gate) return r.gate;
  return (
    <Shell type={type} title={r.title('Write off a bad debt')} top={r.top} live={live} errors={[]} touched={r.touched} action="Write off" danger onRecord={() => { boxes.submit(); r.ask(input, errors); }} dialog={r.dialog}>
      <Notice tone="info">All that the invoice still owes is written off. Its output VAT stays. No payment on it is taken until the write-off is cancelled.</Notice>
      <InvoicePicker boxes={boxes} customer={customer} onCustomer={setCustomer} invoiceId={v.invoiceId} onPick={(i) => setV((x) => ({ ...x, invoiceId: i?.id ?? '' }))}
        describe={(i) => ({ right: `owes ${peso(i.owedCents)}`, disabled: (i.owedCents <= 0 || !!i.writtenOff) && i.id !== v.invoiceId, note: i.writtenOff ? `Written off (${i.writtenOff})` : null })} />
      <Field label="Why is it written off? (at least 10 characters)" error={boxes.error('reason')} required>
        <textarea {...boxes.box('reason')} rows={2} className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Field>
    </Shell>
  );
}

export function ForfeitForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [held, setHeld] = useState<Forfeitable | null>(null);
  const [v, setV] = useState(emptyForfeit);
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { jobOrderId: string; amountCents: number; reason: string };
    setCustomer(customerOf(d));
    setV({ jobOrderId: s.jobOrderId, amount: formatPesos(s.amountCents), reason: s.reason });
  });
  useEffect(() => {
    setHeld(null);
    if (customer) api.forfeitable(customer.id).then(setHeld, r.fail);
  }, [customer?.id]);
  const { input, errors } = forfeitInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const boxes = useBoxes({ ...issueFields(live?.issues), ...schemaFields(forfeitSchema, input) }, JSON.stringify(v), r.refusedInput === JSON.stringify(input) ? r.refused : {}, r.touched);
  const chosen = held?.jobOrders.find((jo) => jo.id === v.jobOrderId);
  if (r.gate) return r.gate;
  return (
    <Shell type={type} title={r.title('Keep an abandoned order’s deposit')} top={r.top} live={live} errors={[]} touched={r.touched} action="Forfeit" danger onRecord={() => { boxes.submit(); r.ask(input, errors); }} dialog={r.dialog}>
      <Notice tone="info">Only when the customer abandoned the order and the terms say the deposit is not refunded. The job order is marked abandoned: nothing more is released or invoiced on it.</Notice>
      <Panel title="Customer">
        <CustomerPicker boxes={boxes} value={customer} onChange={(c) => (setCustomer(c), setV({ ...v, jobOrderId: '' }))} />
      </Panel>
      {(
        <Panel title="Which job order?">
          {held && held.jobOrders.length === 0 && <p className="text-sm text-slate-500">No deposit is held for {customer?.name}.</p>}
          <Field label="Which job order?" error={boxes.error('jobOrderId')}><div {...boxes.choice('jobOrderId')} role="radiogroup" aria-label="Which job order?" className="space-y-2">
            {held?.jobOrders.map((jo) => (
              <Choice key={jo.id} picked={v.jobOrderId === jo.id} onPick={() => setV({ ...v, jobOrderId: jo.id })} disabled={!!jo.blocked && jo.id !== v.jobOrderId}
                label={`${jo.number} · ${jo.status === 'cancelled' ? 'Cancelled' : jo.stageLabel}`} right={`${formatPesos(jo.depositsHeldCents)} held`} note={jo.blocked} />
            ))}
          </div></Field>
        </Panel>
      )}
      <Field label="Amount kept" error={boxes.error('amountCents')} required hint={chosen ? `All of it is ${peso(chosen.depositsHeldCents)}` : undefined}>
        <input {...boxes.box('amountCents')} inputMode="decimal" placeholder="0.00" className={`${inputClass} max-w-48 text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
      </Field>
      {chosen && <Button onClick={() => setV({ ...v, amount: formatPesos(chosen.depositsHeldCents) })}>All of it</Button>}
      <Field label="Why is it kept? (at least 10 characters)" error={boxes.error('reason')} required>
        <textarea {...boxes.box('reason')} rows={2} className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Field>
    </Shell>
  );
}

/** What the four views add under "What this did": the invoice or job order, and the amounts each account got. */
function Rows({ rows }: { rows: [string, string | number | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.filter(([, x]) => x !== null && x !== undefined && x !== 0).map(([k, x]) => (
        <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="tabular-nums">{typeof x === 'number' ? peso(x) : x}</dd></div>
      ))}
    </dl>
  );
}
type OnInvoice = { customerName: string; invoice: { number: string; invoiceNumber: string; jobOrderNumber: string | null } };
const invoiceRow = (d: OnInvoice): [string, string] => ['Invoice', `no. ${d.invoice.invoiceNumber} (${d.invoice.number}${d.invoice.jobOrderNumber ? `, ${d.invoice.jobOrderNumber}` : ''})`];

export const cwtOnlyView: ViewParts = {
  noEdit: true,
  extra: (d) => {
    const x = d.doc as OnInvoice & { cwtCents: number; atc: string; periodYear: number; periodQuarter: number };
    return <Rows rows={[['Customer', x.customerName], invoiceRow(x), ['2307', `${x.atc}, Q${x.periodQuarter} ${x.periodYear}`], ['Tax withheld', x.cwtCents]]} />;
  },
};
export const creditMemoView: ViewParts = {
  noEdit: true,
  extra: (d) => {
    const x = d.doc as OnInvoice & { kind: string; formNumber?: string; netCents: number; vatCents: number; arCents: number; creditCents: number; reason: string };
    return (
      <Rows rows={[
        ['Customer', x.customerName], invoiceRow(x), ['Kind', x.kind === 'return' ? 'Return' : 'Allowance'], ['Form no.', x.formNumber],
        ['Sales down', x.netCents], ['Output VAT down', x.vatCents], ['Off what it owed', x.arCents], ['Kept as customer credit', x.creditCents], ['Reason', x.reason],
      ]} />
    );
  },
};
export const writeOffView: ViewParts = {
  noEdit: true,
  extra: (d) => {
    const x = d.doc as OnInvoice & { totalCents: number; reason: string };
    return <Rows rows={[['Customer', x.customerName], invoiceRow(x), ['Written off', x.totalCents], ['Reason', x.reason]]} />;
  },
};
export const forfeitView: ViewParts = {
  noEdit: true,
  extra: (d) => {
    const x = d.doc as { customerName: string; jobOrderNumber: string; incomeCents: number; vatCents: number; vatable: boolean; reason: string };
    return <><Rows rows={[['Customer', x.customerName], ['Job order', `${x.jobOrderNumber} (abandoned)`], ['Other income', x.incomeCents], ['Output VAT', x.vatable ? x.vatCents : 'None'], ['Reason', x.reason]]} /><details className="text-sm text-slate-600"><summary className="cursor-pointer">Policy note</summary>Go-live decision ACC-15 covers VAT on forfeited deposits.</details></>;
  },
};
