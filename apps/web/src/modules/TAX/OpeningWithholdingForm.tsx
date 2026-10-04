/**
 * Opening withholding form (OBWT-, PLAN D8 "Cut-over" step 3): the customers' 2307s for sales before the cut-over date
 * whose tax withheld was not yet used on a return. One row per 2307: the customer, the quarter it covers, the ATC, the
 * CWT and the VAT withheld (government buyers), and whether it is in hand. Always dated the cut-over date. A 2307 still
 * to come is marked received later on the 2307s received page, like a collection's. Also the Edit of a recorded one.
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Me, type OpeningState } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, longDate, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { Link } from '../../router.tsx';
import { openingDate } from '../ACC/opening.ts';
import { CustomerPicker, Errors, useLive } from '../COL/parts.tsx';
import {
  ATCS, ATC_WORDS, emptyWithholdingRow, quarterChoices, withholdingInput, withholdingRows, withholdingTotals,
  type OpeningWithholdingInput, type WithholdingRow,
} from './opening.ts';

export function OpeningWithholdingForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const [state, setState] = useState<OpeningState | null>(null);
  const [rows, setRows] = useState<WithholdingRow[]>([emptyWithholdingRow()]);
  const [note, setNote] = useState('');
  const today = useToday();
  const r = useRecord(type, mode, (d) => {
    const input = d.input as unknown as OpeningWithholdingInput;
    setRows(withholdingRows(input.rows, (d.doc?.rows ?? []) as { customerName?: string }[]));
    setNote(input.note ?? '');
  });
  useEffect(() => void api.opening().then(setState, r.fail), []);

  const date = openingDate(state?.cutoverDate ?? null, today);
  const typed = withholdingInput(rows, note);
  const errors = date.error && state ? [...typed.errors, date.error] : typed.errors;
  const { input } = typed;
  const sums = withholdingTotals(rows);
  const quarters = quarterChoices(state?.cutoverDate ?? null);
  const live = useLive(JSON.stringify([input, date.businessDate]), !!state && !!today && errors.length === 0, () => r.preview(input, date.businessDate));
  const set = (i: number, patch: Partial<WithholdingRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const record = () => r.ask(input, errors, date.businessDate);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening withholding')}</h1>
        {r.top}
        <p className="text-sm text-slate-600">
          {state?.cutoverDate ? <>Dated the cut-over date, {longDate(state.cutoverDate)}. </> : null}
          Each customer's 2307 for sales before the cut-over whose tax withheld was not yet claimed on a return. A 2307 still to come is marked received on the{' '}
          <Link to="/tax/2307-received" className="underline">2307s received</Link> page when it arrives.{' '}
          <Link to="/acc/opening" className="underline">Opening balances page</Link>
        </p>
        <Panel title="2307s">
          {rows.map((row, i) => (
            <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <CustomerPicker value={row.customerId ? { id: row.customerId, name: row.customerName } : null} onChange={(c) => set(i, { customerId: c?.id ?? '', customerName: c?.name ?? '' })} />
                </div>
                <Button disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove this 2307">✕</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label={`Row ${i + 1} quarter`} className={inputClass} value={row.quarter} onChange={(e) => set(i, { quarter: e.target.value })}>
                  <option value="">The quarter the 2307 covers</option>
                  {quarters.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
                <select aria-label={`Row ${i + 1} tax code (ATC)`} className={inputClass} value={row.atc} onChange={(e) => set(i, { atc: e.target.value as WithholdingRow['atc'] })}>
                  {ATCS.map((a) => <option key={a} value={a}>{ATC_WORDS[a]}</option>)}
                </select>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input aria-label={`Row ${i + 1} CWT`} inputMode="decimal" placeholder="Tax withheld (CWT)" className={`${inputClass} text-right tabular-nums`} value={row.cwt} onChange={(e) => set(i, { cwt: e.target.value })} />
                <input aria-label={`Row ${i + 1} VAT withheld`} inputMode="decimal" placeholder="VAT withheld (government)" className={`${inputClass} text-right tabular-nums`} value={row.vatWithheld} onChange={(e) => set(i, { vatWithheld: e.target.value })} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={row.inHand} onChange={(e) => set(i, { inHand: e.target.checked })} /> 2307 in hand
                </label>
              </div>
            </div>
          ))}
          {rows.length < 200 && <Button onClick={() => setRows([...rows, emptyWithholdingRow()])}>+ Add a 2307</Button>}
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
          <dt className="text-slate-600">Tax withheld (CWT, 1410)</dt><dd className="text-right tabular-nums">{peso(sums.cwtCents)}</dd>
          <dt className="text-slate-600">VAT withheld (1404)</dt><dd className="text-right tabular-nums">{peso(sums.vatWithheldCents)}</dd>
          <dt className="text-slate-600">2307s still to come</dt><dd className="text-right tabular-nums">{sums.pending}</dd>
        </dl>
        <p className="text-sm text-slate-500">The total goes to opening balance equity (3900).</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
