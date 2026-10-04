/**
 * Opening supplier bill form (PLAN D8 "Cut-over" step 3, OBAP-): a supplier bill of the old books still unpaid on the
 * cut-over date. The supplier, their invoice number and date, the due date and what was still owed on it then (after the
 * EWT withheld and any part payments before the cut-over); no lines, VAT or EWT, which were in the old books. The
 * accountant records it dated the cut-over date; afterwards a supplier payment pays it like any bill. Also its Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type OpeningStatus } from '../../api.ts';
import { Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { MoneyForm, SupplierSelect, useList, useMoneyForm } from './parts.tsx';
import { forReplacement, openingBillInput, openingBillValues, openingDateProblem, type OpeningBillInput } from './payables.ts';

export function OpeningBillForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const suppliers = useList(api.suppliers);
  const [opening, setOpening] = useState<OpeningStatus>();
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [owed, setOwed] = useState('');
  const [note, setNote] = useState('');
  const f = useMoneyForm(type, mode, (d) => {
    const v = openingBillValues(d.input as unknown as OpeningBillInput);
    setSupplierId(v.supplierId);
    setInvoiceNo(v.invoiceNo);
    setInvoiceDate(v.invoiceDate);
    setDueDate(v.dueDate);
    setOwed(v.owed);
    setNote(v.note);
  });
  useEffect(() => void api.opening().then(setOpening, f.fail), []);

  const problem = openingDateProblem(opening);
  const typed = openingBillInput({ supplierId, invoiceNo, invoiceDate, dueDate, owed, note });
  const errors = problem ? [...typed.errors, problem] : typed.errors;
  const cutover = opening?.cutoverDate ?? undefined;

  return (
    <MoneyForm type={type} f={f} title="New opening supplier bill" input={typed.input} errors={errors} businessDate={cutover} adjust={(p, n) => forReplacement(p, n)}
      figures={(d: { owedCents: number; dueDate: string }) => [[`Owed to the supplier, due ${d.dueDate}`, d.owedCents]]}>
      {problem && opening ? <Notice>{problem}</Notice> : cutover && <Notice tone="info">Recorded as open on the cut-over date, {cutover}. Pay it later with a supplier payment, like any bill.</Notice>}
      <Panel title="Who billed">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Invoice no. (on the supplier’s invoice)" required>
            <input className={inputClass} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
          <Field label="Invoice date" required hint="On or before the cut-over date.">
            <input type="date" className={inputClass} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
          <Field label="Due date" required hint="As on the invoice or the supplier’s terms.">
            <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
      </Panel>
      <Field label="Still owed on the cut-over date" required hint="After the tax withheld from supplier (EWT) and any part payments made before the cut-over. No VAT or EWT here: they were in the old books.">
        <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={owed} onChange={(e) => setOwed(e.target.value)} />
      </Field>
      <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </MoneyForm>
  );
}
