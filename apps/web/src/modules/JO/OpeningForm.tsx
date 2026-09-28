/**
 * Opening job order form (PLAN D8 "Cut-over" step 2): a job order the shop took before the cut-over date and has not
 * finished or not been paid for. The accountant types what is still to make or release, the deposits paid on it and
 * what was invoiced and not yet paid; it is recorded on the cut-over date. Also its Edit (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type OpeningStatus } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { cents } from '../COL/money.ts';
import { CustomerPicker, Errors, Figures, useLive, type Picked } from '../COL/parts.tsx';
import { KINDS, TERMS, emptyOpening, emptyOpeningLine, openingInput, openingValues, type OpeningInput, type OpeningLineRow, type OpeningValues } from './opening.ts';

const money = `${inputClass} text-right tabular-nums`;

export function OpeningJobOrderForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<OpeningValues>(emptyOpening);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [opening, setOpening] = useState<OpeningStatus | null>(null);
  const r = useRecord(type, mode, (d) => {
    setV(openingValues(d.input as unknown as OpeningInput));
    setCustomer({ id: (d.input as { customerId: string }).customerId, name: (d.doc as { customerName?: string } | undefined)?.customerName ?? 'Customer on file' });
  });
  useEffect(() => void api.opening().then(setOpening, r.fail), []);

  const set = (patch: Partial<OpeningValues>) => setV((old) => ({ ...old, ...patch }));
  const setLine = (i: number, patch: Partial<OpeningLineRow>) => set({ lines: v.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const typed = openingInput({ ...v, customerId: customer?.id ?? '' });
  const date = opening?.cutoverDate ?? undefined;
  const closed = opening?.closed ? `The opening was closed on ${opening.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.` : '';
  const noDate = opening && !opening.cutoverDate ? 'Set the cut-over date on the opening balances screen first.' : '';
  const errors = [...typed.errors, ...[closed, noDate].filter(Boolean)];
  const live = useLive(JSON.stringify([typed.input, date]), typed.errors.length === 0 && !!date, () => r.preview(typed.input, date));
  const record = () => r.ask(typed.input, errors, date);

  const receivable = cents(v.receivable) ?? 0;
  const deposits = cents(v.deposits) ?? 0;
  const totalCents = typed.linesCents + receivable;

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening job order')}</h1>
        {r.top}
        {closed && <Notice>{closed}</Notice>}
        {noDate && <Notice tone="warning">{noDate}</Notice>}
        {date && !closed && <Notice tone="info">A job order taken before the cut-over and not finished or not paid for. It is recorded on the cut-over date, {date}, and then works like any job order.</Notice>}
        <Panel title="The job order">
          <Field label="Customer" required>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job order no. in the old records" required>
              <input className={inputClass} value={v.oldNumber} onChange={(e) => set({ oldNumber: e.target.value })} />
            </Field>
            <Field label="Due date" required hint="As promised to the customer">
              <input type="date" className={inputClass} value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
            <Field label="Priority" required>
              <select className={inputClass} value={v.priority} onChange={(e) => set({ priority: e.target.value as OpeningValues['priority'] })}>
                <option value="normal">Normal</option>
                <option value="rush">Rush</option>
              </select>
            </Field>
            <Field label="Payment terms" required>
              <select className={inputClass} value={v.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value as OpeningValues['paymentTerms'] })}>
                <option value="" />
                {TERMS.map(([key, words]) => <option key={key} value={key}>{words}</option>)}
              </select>
            </Field>
            <Field label="Contact">
              <input className={inputClass} value={v.contact} onChange={(e) => set({ contact: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input className={inputClass} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </Panel>
        <Panel title="Still to make or release">
          <p className="text-sm text-slate-600">Only what has not been released yet, at the old prices. Leave it empty when everything went out.</p>
          {v.lines.map((row, i) => (
            <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <select aria-label={`Line ${i + 1} kind`} className={inputClass} value={row.kind} onChange={(e) => setLine(i, { kind: e.target.value as OpeningLineRow['kind'] })}>
                  {KINDS.map(([key, words]) => <option key={key} value={key}>{words}</option>)}
                </select>
                <input aria-label={`Line ${i + 1} description`} placeholder="What, e.g. Team jersey set" className={inputClass} value={row.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                <Button onClick={() => set({ lines: v.lines.length > 1 ? v.lines.filter((_, j) => j !== i) : [emptyOpeningLine()] })} title="Remove this line">✕</Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input aria-label={`Line ${i + 1} pieces`} inputMode="numeric" placeholder="Pieces" className={money} value={row.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <input aria-label={`Line ${i + 1} price each`} inputMode="decimal" placeholder="Price each" className={money} value={row.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                <input aria-label={`Line ${i + 1} discount`} inputMode="decimal" placeholder="Discount" className={money} value={row.discount} onChange={(e) => setLine(i, { discount: e.target.value })} />
              </div>
              {row.roster.length > 0 && <p className="text-xs text-slate-500">{row.roster.length} wearers on the roster are kept.</p>}
            </div>
          ))}
          {v.lines.length < 50 && <Button onClick={() => set({ lines: [...v.lines, emptyOpeningLine()] })}>+ Add a line</Button>}
        </Panel>
        <Panel title="Money at the cut-over">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deposits held" hint="Paid on it and not yet applied to an invoice">
              <input inputMode="decimal" placeholder="0.00" className={money} value={v.deposits} onChange={(e) => set({ deposits: e.target.value })} />
            </Field>
            <Field label="Old receipt numbers">
              <input className={inputClass} value={v.depositsMemo} onChange={(e) => set({ depositsMemo: e.target.value })} />
            </Field>
            <Field label="Invoiced and not yet paid" hint="Released and invoiced before the cut-over">
              <input inputMode="decimal" placeholder="0.00" className={money} value={v.receivable} onChange={(e) => set({ receivable: e.target.value })} />
            </Field>
            <Field label="Old invoice numbers" required={receivable > 0}>
              <input className={inputClass} value={v.oldInvoices} onChange={(e) => set({ oldInvoices: e.target.value })} />
            </Field>
          </div>
        </Panel>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !!closed} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <Figures items={[['Still to release', typed.linesCents], ['Invoiced, not yet paid', receivable], ['Total', totalCents], ['Deposits held', deposits], ['Balance due', totalCents - deposits, 'font-semibold']]} />
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
