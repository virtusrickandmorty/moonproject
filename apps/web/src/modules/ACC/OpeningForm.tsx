/**
 * Opening balances form (OB-, PLAN D8 "Cut-over" steps 1, 3 and 4): the balances at the cut-over date that no other
 * document keeps the detail of (cash places, inventories, input VAT carried over, prepayments, the equity breakdown).
 * Accounts come from the opening page, which lists only those an OB- may open; the server's preview shows the 3900 line
 * that takes the difference. Always dated the cut-over date. Also the Edit of a recorded one (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type EqPerson, type Me, type OpeningState } from '../../api.ts';
import { Button, Notice, Panel, inputClass, longDate, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { Link } from '../../router.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { emptyOpeningRow, equityLineWords, openingDate, openingInput, openingRows, openingSides, type OpeningLineInput, type OpeningRow } from './opening.ts';

type OpeningDoc = { equityDebitCents: number; equityCreditCents: number; totalCents: number };

export function OpeningForm({ type, mode }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const [state, setState] = useState<OpeningState | null>(null);
  const [stockholders, setStockholders] = useState<EqPerson[]>([]);
  const [rows, setRows] = useState<OpeningRow[]>([emptyOpeningRow()]);
  const today = useToday();
  const r = useRecord(type, mode, (d) => setRows(openingRows((d.input as { lines: OpeningLineInput[] }).lines)));
  useEffect(() => void api.opening().then(setState, r.fail), []);
  const accounts = state?.accounts ?? [];
  const needsStockholder = accounts.some((a) => a.needsStockholder);
  useEffect(() => void (needsStockholder && api.eqPeople().then((p) => setStockholders(p.filter((x) => x.isStockholder)), r.fail)), [needsStockholder]);

  const date = openingDate(state?.cutoverDate ?? null, today);
  const typed = openingInput(rows, accounts);
  const errors = date.error && state ? [...typed.errors, date.error] : typed.errors;
  const { input } = typed;
  const sides = openingSides(rows);
  const live = useLive(JSON.stringify([input, date.businessDate]), !!state && !!today && errors.length === 0, () => r.preview(input, date.businessDate));
  const doc = live?.doc as OpeningDoc | undefined;
  const set = (i: number, patch: Partial<OpeningRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const record = () => r.ask(input, errors, date.businessDate);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening balances')}</h1>
        {r.top}
        <p className="text-sm text-slate-600">
          {state?.cutoverDate ? <>Dated the cut-over date, {longDate(state.cutoverDate)}. </> : null}
          Customers, suppliers, loans, fixed assets and other balances kept per person or item open with their own documents, so their accounts are not offered here.{' '}
          <Link to="/acc/opening" className="underline">Opening balances page</Link>
        </p>
        <Panel title="Lines">
          {rows.map((row, i) => {
            const a = accounts.find((x) => String(x.id) === row.accountId);
            return (
              <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
                <div className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
                  <select aria-label={`Line ${i + 1} account`} className={inputClass} value={row.accountId} onChange={(e) => set(i, { accountId: e.target.value, stockholderId: '' })}>
                    <option value="">Pick an account</option>
                    {accounts.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}{x.isCashPlace ? ' (cash place)' : ''}</option>)}
                  </select>
                  <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="Debit" className={`${inputClass} text-right tabular-nums`} value={row.debit} onChange={(e) => set(i, { debit: e.target.value })} />
                  <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="Credit" className={`${inputClass} text-right tabular-nums`} value={row.credit} onChange={(e) => set(i, { credit: e.target.value })} />
                  <Button disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove this line">✕</Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {a?.needsStockholder && (
                    <select aria-label={`Line ${i + 1} stockholder`} className={inputClass} value={row.stockholderId} onChange={(e) => set(i, { stockholderId: e.target.value })}>
                      <option value="">Pick the stockholder</option>
                      {stockholders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                  <input aria-label={`Line ${i + 1} memo`} placeholder="Line memo (optional), e.g. per bank statement of 30 June" className={`${inputClass} ${a?.needsStockholder ? '' : 'sm:col-span-2'}`} value={row.memo} onChange={(e) => set(i, { memo: e.target.value })} />
                </div>
              </div>
            );
          })}
          {rows.length < 200 && <Button onClick={() => setRows([...rows, emptyOpeningRow()])}>+ Add a line</Button>}
        </Panel>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !state} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-600">Debits typed</dt><dd className="text-right tabular-nums">{peso(sides.debits)}</dd>
          <dt className="text-slate-600">Credits typed</dt><dd className="text-right tabular-nums">{peso(sides.credits)}</dd>
        </dl>
        {doc ? <p className="text-sm font-medium">{equityLineWords(doc)}</p> : <p className="text-sm text-slate-500">The opening balance equity line shows once the lines are complete.</p>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
