/**
 * Opening tax payable form (OBTP-, PLAN D8 "Cut-over" step 3): the BIR returns of periods before the cut-over date that
 * were prepared from the old books and not yet paid. One row per return: the form, the period and the amount still to
 * pay, per supplier and ATC for a 0619-E or 1601-EQ. Always dated the cut-over date. A 2550Q, 0619-E or 1601-EQ is then
 * paid with a BIR payment like any other; a 1702Q or 1702 stays payable until income tax payments are built. Also the
 * Edit of a recorded one.
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Me, type OpeningState } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, longDate, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { Link } from '../../router.tsx';
import { openingDate } from '../ACC/opening.ts';
import { SupplierSelect, useList } from '../AP/parts.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import {
  OPENING_ATCS, OPENING_FORMS, OPENING_FORM_WORDS, emptyPayee, emptyReturn, formOf, isEwtForm, payableInput, payableRows, payableTotals, periodChoices,
  type OpeningPayableInput, type PayeeRow, type ReturnRow,
} from './opening-payable.ts';

export function OpeningPayableForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const [state, setState] = useState<OpeningState | null>(null);
  const [rows, setRows] = useState<ReturnRow[]>([emptyReturn()]);
  const [note, setNote] = useState('');
  const suppliers = useList(api.suppliers);
  const today = useToday();
  const r = useRecord(type, mode, (d) => {
    const input = d.input as unknown as OpeningPayableInput;
    setRows(payableRows(input.rows));
    setNote(input.note ?? '');
  });
  useEffect(() => void api.opening().then(setState, r.fail), []);

  const date = openingDate(state?.cutoverDate ?? null, today);
  const typed = payableInput(rows, note);
  const errors = date.error && state ? [...typed.errors, date.error] : typed.errors;
  const { input } = typed;
  const sums = payableTotals(rows);
  const live = useLive(JSON.stringify([input, date.businessDate]), !!state && !!today && errors.length === 0, () => r.preview(input, date.businessDate));
  const set = (i: number, patch: Partial<ReturnRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setPayee = (i: number, k: number, patch: Partial<PayeeRow>) => set(i, { payees: rows[i]!.payees.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
  const record = () => r.ask(input, errors, date.businessDate);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening tax payable')}</h1>
        {r.top}
        <p className="text-sm text-slate-600">
          {state?.cutoverDate ? <>Dated the cut-over date, {longDate(state.cutoverDate)}. </> : null}
          Each BIR return of a period before the cut-over that the old books prepared and that is not paid yet. Pay a 2550Q, 0619-E or 1601-EQ with a{' '}
          <Link to="/docs/tax.bir_payment/new" className="underline">BIR payment</Link> afterwards; a 1702Q or 1702 stays payable for now.{' '}
          <Link to="/acc/opening" className="underline">Opening balances page</Link>
        </p>
        <Panel title="Returns not yet paid">
          {rows.map((row, i) => (
            <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <select aria-label={`Row ${i + 1} return`} className={inputClass} value={row.form} onChange={(e) => set(i, { form: formOf(e.target.value), period: '' })}>
                    <option value="">The return</option>
                    {OPENING_FORMS.map((f) => <option key={f} value={f}>{OPENING_FORM_WORDS[f]}</option>)}
                  </select>
                  <select aria-label={`Row ${i + 1} period`} className={inputClass} value={row.period} disabled={!row.form} onChange={(e) => set(i, { period: e.target.value })}>
                    <option value="">{row.form === '0619-E' ? 'The month' : row.form === '1702' ? 'The year' : 'The quarter'}</option>
                    {periodChoices(row.form, state?.cutoverDate ?? null).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <Button disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove this return">✕</Button>
              </div>
              {row.form && !isEwtForm(row.form) && (
                <input aria-label={`Row ${i + 1} amount`} inputMode="decimal" placeholder="Still to pay" className={`${inputClass} text-right tabular-nums`} value={row.amount} onChange={(e) => set(i, { amount: e.target.value })} />
              )}
              {isEwtForm(row.form) && (
                <div className="space-y-2">
                  {row.payees.map((p, k) => (
                    <div key={k} className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
                      <SupplierSelect suppliers={suppliers} value={p.supplierId} onChange={(id) => setPayee(i, k, { supplierId: id })} label={`Row ${i + 1} payee ${k + 1}`} />
                      <select aria-label={`Row ${i + 1} payee ${k + 1} ATC`} className={inputClass} value={p.atc} onChange={(e) => setPayee(i, k, { atc: e.target.value as PayeeRow['atc'] })}>
                        <option value="">ATC</option>
                        {OPENING_ATCS.map((a) => <option key={a} value={a}>{a === 'other' ? 'Other ATC' : a}</option>)}
                      </select>
                      <input aria-label={`Row ${i + 1} payee ${k + 1} EWT`} inputMode="decimal" placeholder="EWT still to pay" className={`${inputClass} text-right tabular-nums`} value={p.amount} onChange={(e) => setPayee(i, k, { amount: e.target.value })} />
                      <Button disabled={row.payees.length <= 1} onClick={() => set(i, { payees: row.payees.filter((_, j) => j !== k) })} title="Remove this payee">✕</Button>
                    </div>
                  ))}
                  {row.payees.length < 200 && <Button onClick={() => set(i, { payees: [...row.payees, emptyPayee()] })}>+ Add a payee</Button>}
                </div>
              )}
            </div>
          ))}
          {rows.length < 50 && <Button onClick={() => setRows([...rows, emptyReturn()])}>+ Add a return</Button>}
        </Panel>
        <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !state} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-600">VAT payable (2302)</dt><dd className="text-right tabular-nums">{peso(sums.vatCents)}</dd>
          <dt className="text-slate-600">EWT payable (2311)</dt><dd className="text-right tabular-nums">{peso(sums.ewtCents)}</dd>
          <dt className="text-slate-600">Income tax payable (2320)</dt><dd className="text-right tabular-nums">{peso(sums.incomeTaxCents)}</dd>
        </dl>
        <p className="text-sm text-slate-500">The total comes out of opening balance equity (3900).</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
