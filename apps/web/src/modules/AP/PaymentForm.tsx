/**
 * Supplier payment form (PLAN E9 SPAY-, D5 BILL-PAY): the supplier, what is paid on which of their open bills (AP by
 * supplier, read from the ledger), where the money came from (split tenders; a check is a bank tender with its number)
 * and the bank's fee. No EWT here: it was withheld when each bill was recorded (D4.8). Also its Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type ApLedger, type CashPlace, type DocTypeInfo } from '../../api.ts';
import { Button, Field, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { emptyTender, tendersToRows, type TenderRow } from '../COL/money.ts';
import { TenderRows } from '../COL/parts.tsx';
import { MoneyForm, SupplierSelect, useList, useMoneyForm } from './parts.tsx';
import { forReplacement, openBills, paymentInput, type PaymentInput } from './payables.ts';

export function PaymentForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const suppliers = useList(api.suppliers);
  const places = useList<CashPlace>(api.cashPlaces);
  const [supplierId, setSupplierId] = useState('');
  const [ledger, setLedger] = useState<ApLedger | null>(null);
  const [paidBefore, setPaidBefore] = useState<PaymentInput['bills']>([]);
  const [pay, setPay] = useState<Record<string, string>>({});
  const [tenders, setTenders] = useState<TenderRow[]>([emptyTender()]);
  const [fee, setFee] = useState('');
  const [note, setNote] = useState('');
  const f = useMoneyForm(type, mode, (d) => {
    const input = d.input as unknown as PaymentInput;
    setSupplierId(input.supplierId);
    setPaidBefore(input.bills);
    setPay(Object.fromEntries(input.bills.map((b) => [b.billId, formatPesos(b.amountCents)])));
    setTenders(tendersToRows(input.tenders));
    setFee(input.feeCents ? formatPesos(input.feeCents) : '');
    setNote(input.note ?? '');
  });
  useEffect(() => {
    setLedger(null);
    if (supplierId) api.apLedger(supplierId).then(setLedger, f.fail);
  }, [supplierId]);

  const bills = ledger ? openBills(ledger, paidBefore) : [];
  const { input, errors } = paymentInput({ supplierId, bills, pay, tenders, fee, note });
  const due = input.bills.reduce((s, b) => s + b.amountCents, 0) + (input.feeCents ?? 0);
  // An edit's preview still sees the original's payments: an amount within what was owed before it is not too much.
  const fits = (field: string) => {
    const b = input.bills[Number(/^bills\.(\d+)\.amountCents$/.exec(field)?.[1] ?? -1)];
    return !!b && b.amountCents <= (bills.find((x) => x.id === b.billId)?.owedCents ?? 0);
  };

  return (
    <MoneyForm type={type} f={f} title="New supplier payment" input={input} errors={errors} adjust={(p, n) => forReplacement(p, n, fits)}
      figures={(d: { paidCents: number; feeCents?: number }) => [['Paid on bills', d.paidCents], ['Bank fee', d.feeCents ?? 0]]}>
      <Panel title="Who is paid">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={(id) => (setSupplierId(id), setPay({}))} />
      </Panel>
      <Panel title="Which bills?">
        {!supplierId && <p className="text-sm text-slate-500">Pick the supplier to see their open bills.</p>}
        {ledger && bills.length === 0 && <p className="text-sm text-slate-500">Nothing is owed on a bill of {ledger.supplierName}.</p>}
        {bills.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Bill</th><th className="text-right">Still owed</th><th className="w-40 text-right">Pay now</th><th /></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="py-1">{b.label}</td>
                  <td className="py-1 text-right tabular-nums">{formatPesos(b.owedCents)}</td>
                  <td className="py-1"><input aria-label={`Pay now on ${b.label}`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={pay[b.id] ?? ''} onChange={(e) => setPay({ ...pay, [b.id]: e.target.value })} /></td>
                  <td className="py-1 pl-2"><Button onClick={() => setPay({ ...pay, [b.id]: formatPesos(b.owedCents) })}>All</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm text-slate-500">EWT was withheld when each bill was recorded, so what is owed is already after it.</p>
      </Panel>
      <Panel title="Where did the money come from?">
        <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money come from?" amountHint={due > 0 ? formatPesos(due) : undefined} />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank fee" hint="What the bank charged for the transfer, if any">
          <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <Field label="Note"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </MoneyForm>
  );
}
