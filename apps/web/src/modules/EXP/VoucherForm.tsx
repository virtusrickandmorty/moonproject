/**
 * Expense voucher form (PLAN E9 EXP-, D5 EXP-PAY): something paid now. What it was for (the fixed expense categories),
 * who was paid (a supplier on file or someone else), the receipt (its number, date and the payee's TIN claim the input
 * VAT), the EWT and the cash place it came from (petty cash is one of them). The server works out VAT, EWT and what is
 * paid out. Also the Edit of a recorded voucher (NR-4).
 * The money can come from up to four cash places, each with its amount and a reference; one cash place typed without an
 * amount pays whatever the server says is paid out (the receipt less the EWT).
 */
import { useState } from 'react';
import { api, type CashPlace, type DocTypeInfo, type Me } from '../../api.ts';
import { Field, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { PrintedDateField, usePrintedDate } from '../../generic/PrintedDate.tsx';
import { formatPesos } from '@moonproject/shared';
import { TenderRows } from '../COL/parts.tsx';
import { MoneyForm, SupplierSelect, useEwtRates, useList, useMoneyForm } from '../AP/parts.tsx';
import { MAY_GO_AHEAD, ewtChoices, forReplacement, voucherFigures } from '../AP/payables.ts';
import { MAX_TENDERS, emptyVoucher, voucherInput, voucherValues, type VoucherInput, type VoucherValues } from './voucher.ts';

export function VoucherForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const categories = useList(api.expCategories);
  const suppliers = useList(api.suppliers);
  const places = useList<CashPlace>(api.cashPlaces);
  const rates = useEwtRates();
  const [v, setV] = useState<VoucherValues>(emptyVoucher);
  const f = useMoneyForm(type, mode, (d) => setV(voucherValues(d.input as unknown as VoucherInput)));
  // Any change to the receipt makes the server's last payout figure stale until the next live preview.
  const set = (patch: Partial<VoucherValues>) => (setV({ ...v, ...patch }), setCashCents(undefined));
  const [cashCents, setCashCents] = useState<number>();
  const typed = voucherInput(v, cashCents);
  const printed = usePrintedDate(f.original);
  const { input } = typed;
  const errors = printed.error ? [...typed.errors, printed.error] : typed.errors;
  const usual = (v.payee === 'supplier' ? suppliers.find((s) => s.id === v.supplierId)?.ewt_class : null) ?? categories.find((c) => String(c.id) === v.categoryId)?.defaultEwtClass ?? null;

  return (
    <MoneyForm type={type} f={f} title="New expense voucher" input={input} errors={errors} figures={voucherFigures} mayGoAhead={me.permissions.includes(MAY_GO_AHEAD)} adjust={(p, n) => forReplacement(p, n)} businessDate={printed.businessDate}
      onLive={(p) => setCashCents((p.doc as { cashCents: number }).cashCents)}>
      <Panel title="What was it for?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Expense" required>
            <select className={inputClass} value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">Pick one</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Description" required><input className={inputClass} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
      </Panel>
      <Panel title="Who was paid?">
        <div role="radiogroup" aria-label="Who was paid?" className="flex gap-4 text-sm">
          {([['other', 'Someone not on file'], ['supplier', 'A supplier on file']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2"><input type="radio" checked={v.payee === k} onChange={() => set({ payee: k })} />{label}</label>
          ))}
        </div>
        {v.payee === 'supplier' ? (
          <SupplierSelect suppliers={suppliers} value={v.supplierId} onChange={(supplierId) => set({ supplierId })} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" required><input className={inputClass} value={v.payeeName} onChange={(e) => set({ payeeName: e.target.value })} /></Field>
            <Field label="TIN" hint="As on the receipt"><input className={inputClass} placeholder="123-456-789-000" value={v.payeeTin} onChange={(e) => set({ payeeTin: e.target.value })} /></Field>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={v.payeeVatRegistered} onChange={(e) => set({ payeeVatRegistered: e.target.checked })} />VAT-registered (a VAT receipt)</label>
          </div>
        )}
      </Panel>
      <Panel title="The receipt">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount (VAT included)" required>
            <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
          </Field>
          <Field label="Receipt no."><input className={inputClass} value={v.receiptNo} onChange={(e) => set({ receiptNo: e.target.value })} /></Field>
          <Field label="Receipt date"><input type="date" className={inputClass} value={v.receiptDate} onChange={(e) => set({ receiptDate: e.target.value })} /></Field>
        </div>
        <PrintedDateField label="Date on the voucher" value={printed.text} onChange={printed.setText} />
        <p className="text-sm text-slate-500">Input VAT is claimed only with the receipt number, its date and the payee’s TIN.</p>
        <Field label="Tax withheld from supplier (EWT)">
          <select className={inputClass} value={v.ewtClass} onChange={(e) => set({ ewtClass: e.target.value })}>
            {ewtChoices(usual, rates).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </Field>
      </Panel>
      <Panel title="Where did the money come from?">
        <TenderRows rows={v.tenders} onChange={(tenders) => setV({ ...v, tenders })} places={places} question="Where did the money come from?" max={MAX_TENDERS}
          amountHint={cashCents ? formatPesos(cashCents) : undefined} />
        <p className="text-sm text-slate-500">The amounts add up to what is paid out: the receipt less any tax withheld from the supplier (EWT).</p>
      </Panel>
    </MoneyForm>
  );
}
