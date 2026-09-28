/**
 * Loan form (PLAN D5 LOAN-IN, E10): the lender, where the proceeds went (a cash place, or the supplier of a financed
 * asset purchase), the principal and fees, the yearly rate and term, and the repayment schedule: worked out by the
 * server (declining or flat) or typed from the lender's table. The server's schedule shows before anything is recorded.
 * Also the Edit of a recorded loan (cancel + reissue, NR-4), which the server allows only while no payment stands.
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type Account, type CashPlace, type DocTypeInfo, type FinancedPurchase, type Me } from '../../api.ts';
import { Button, CashPlaceButtons, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { cents } from '../COL/money.ts';
import { METHOD_WORDS, emptyLoan, emptyRowText, feeAccounts, loanInput, loanValues, scheduledPrincipal, type LoanValues, type Method, type RowText } from './loan.ts';

type ScheduleRow = { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number };
const SHOWN = 12;

export function LoanForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const [v, setV] = useState<LoanValues>(emptyLoan);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [financed, setFinanced] = useState<FinancedPurchase[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const mayPickFeeAccount = me.permissions.includes('loan.in.fee_account');
  const r = useRecord(type, mode, (d) => {
    setV(loanValues(d.input as Parameters<typeof loanValues>[0]));
    // The purchase this loan took over is no longer offered by the server; keep it for the edit.
    const a = (d.doc as { asset: FinancedPurchase | null }).asset;
    if (a) setFinanced((old) => [a, ...old.filter((x) => x.id !== a.id)]);
  });
  useEffect(() => {
    api.cashPlaces().then(setPlaces, r.fail);
    api.financedAssets().then((list) => setFinanced((old) => [...old.filter((x) => !list.some((y) => y.id === x.id)), ...list]), r.fail);
    if (mayPickFeeAccount) api.accounts().then((a) => setAccounts(feeAccounts(a)), r.fail);
  }, []);

  const { input, errors } = loanInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const set = (patch: Partial<LoanValues>) => setV({ ...v, ...patch });
  const pickPurchase = (id: string) => {
    const p = financed.find((x) => x.id === id);
    set({ assetPurchaseId: id, kind: 'equipment', ...(p && !v.lender.trim() ? { lender: p.lender } : {}), ...(p && !v.principal.trim() ? { principal: formatPesos(p.financedCents) } : {}) });
  };
  const net = (cents(v.principal) ?? 0) - (cents(v.fee) ?? 0);
  const schedule = (live?.doc as { rows?: ScheduleRow[] } | undefined)?.rows ?? [];
  const purchase = financed.find((x) => x.id === v.assetPurchaseId);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New loan')}</h1>
        {r.top}
        <Panel title="Who lent it?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lender" required><input className={inputClass} value={v.lender} onChange={(e) => set({ lender: e.target.value })} /></Field>
            <Field label="Loan or promissory note no."><input className={inputClass} value={v.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={v.kind === 'loan'} onChange={() => set({ kind: 'loan' })} /> Loan</label>
            <label className="flex items-center gap-2"><input type="radio" checked={v.kind === 'equipment'} onChange={() => set({ kind: 'equipment' })} /> Equipment financing</label>
          </div>
        </Panel>
        <Panel title="Where did the loan money go?">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={v.proceeds === 'cash'} onChange={() => set({ proceeds: 'cash' })} /> It arrived in a cash place</label>
            {(financed.length > 0 || v.proceeds === 'asset') && (
              <label className="flex items-center gap-2"><input type="radio" checked={v.proceeds === 'asset'} onChange={() => set({ proceeds: 'asset' })} /> The lender paid the supplier of an asset purchase</label>
            )}
          </div>
          {v.proceeds === 'cash' && <CashPlaceButtons label="Where did the loan money arrive?" places={places} value={v.cashPlaceId} onChange={(id) => set({ cashPlaceId: id })} />}
          {v.proceeds === 'asset' && (
            <Field label="Asset purchase" hint={purchase ? `${peso(purchase.financedCents)} of ${purchase.number} was financed by ${purchase.lender}: the loan less its fees must be that much.` : undefined}>
              <select className={inputClass} value={v.assetPurchaseId} onChange={(e) => pickPurchase(e.target.value)}>
                <option value="">Pick the purchase</option>
                {financed.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.description} from {p.supplierName} · {peso(p.financedCents)} financed</option>)}
              </select>
            </Field>
          )}
        </Panel>
        <Panel title="Amount and terms">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loan amount (principal)" required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.principal} onChange={(e) => set({ principal: e.target.value })} /></Field>
            <Field label="Fees the lender deducted"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.fee} onChange={(e) => set({ fee: e.target.value })} /></Field>
            <Field label="Interest rate, % a year" required hint="Like 12 or 10.5; 0 if none"><input inputMode="decimal" className={inputClass} value={v.rate} onChange={(e) => set({ rate: e.target.value })} /></Field>
            <Field label="Term in months" required><input inputMode="numeric" className={inputClass} value={v.term} onChange={(e) => set({ term: e.target.value })} /></Field>
          </div>
          {mayPickFeeAccount && (cents(v.fee) ?? 0) > 0 && (
            <Field label="Put the fees on">
              <select className={inputClass} value={v.feeAccountId} onChange={(e) => set({ feeAccountId: e.target.value })}>
                <option value="">Interest and financing charges (usual)</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </Field>
          )}
        </Panel>
        <Panel title="Repayment schedule">
          <MethodPicker value={v.schedule} onChange={(schedule) => set({ schedule })} />
          {v.schedule !== 'typed' && (
            <Field label="First instalment due" hint="Empty: one month after today">
              <input type="date" className={`${inputClass} max-w-48`} value={v.firstDueDate} onChange={(e) => set({ firstDueDate: e.target.value })} />
            </Field>
          )}
          {v.schedule === 'typed' && <TypedRows rows={v.rows} onChange={(rows) => set({ rows })} />}
        </Panel>
        {schedule.length > 0 && v.schedule !== 'typed' && (
          <Panel title="The schedule the server worked out">
            <ScheduleTable rows={schedule} />
          </Panel>
        )}
        <Field label="Note"><input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-600">{v.proceeds === 'cash' ? 'Money received' : 'Paid to the supplier'}</dt><dd className="text-right tabular-nums">{peso(net)}</dd>
          <dt className="text-slate-600">Owed to the lender</dt><dd className="text-right tabular-nums">{peso(cents(v.principal) ?? 0)}</dd>
        </dl>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}

/** How the schedule is made: worked out by the server (declining or flat) or typed from the lender's table. */
export function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  return (
    <div className="space-y-1 text-sm">
      {(Object.keys(METHOD_WORDS) as Method[]).map((m) => (
        <label key={m} className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={value === m} onChange={() => onChange(m)} />
          <span><span className="font-medium">{METHOD_WORDS[m][0]}</span> <span className="text-slate-500">{METHOD_WORDS[m][1]}</span></span>
        </label>
      ))}
    </div>
  );
}

/** The instalments typed from the lender's table, with the principal they repay. */
export function TypedRows({ rows, onChange }: { rows: RowText[]; onChange: (rows: RowText[]) => void }) {
  const setRow = (i: number, patch: Partial<RowText>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr_auto] items-center gap-2">
          <span className="text-sm text-slate-500">{i + 1}</span>
          <input type="date" aria-label={`Instalment ${i + 1} due date`} className={inputClass} value={row.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })} />
          <input aria-label={`Instalment ${i + 1} principal`} inputMode="decimal" placeholder="Principal" className={`${inputClass} text-right tabular-nums`} value={row.principal} onChange={(e) => setRow(i, { principal: e.target.value })} />
          <input aria-label={`Instalment ${i + 1} interest`} inputMode="decimal" placeholder="Interest" className={`${inputClass} text-right tabular-nums`} value={row.interest} onChange={(e) => setRow(i, { interest: e.target.value })} />
          <Button disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Remove this instalment">✕</Button>
        </div>
      ))}
      {rows.length < 360 && <Button onClick={() => onChange([...rows, emptyRowText()])}>+ Add an instalment</Button>}
      <p className="text-sm text-slate-600">The instalments repay {peso(scheduledPrincipal(rows))} of principal.</p>
    </div>
  );
}

/** Instalments with their payment; long schedules show the first 12 and the totals. */
export function ScheduleTable({ rows }: { rows: ScheduleRow[] }) {
  const sum = (k: 'principalCents' | 'interestCents') => rows.reduce((s, x) => s + x[k], 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500"><tr><th>No.</th><th>Due</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Payment</th></tr></thead>
      <tbody>
        {rows.slice(0, SHOWN).map((x) => (
          <tr key={x.instalmentNo} className="border-t border-slate-100">
            <td className="py-1">{x.instalmentNo}</td><td className="py-1">{x.dueDate}</td>
            <td className="py-1 text-right tabular-nums">{peso(x.principalCents)}</td><td className="py-1 text-right tabular-nums">{peso(x.interestCents)}</td>
            <td className="py-1 text-right tabular-nums">{peso(x.principalCents + x.interestCents)}</td>
          </tr>
        ))}
        {rows.length > SHOWN && <tr className="border-t border-slate-100 text-slate-500"><td colSpan={5} className="py-1">… and {rows.length - SHOWN} more, to {rows.at(-1)!.dueDate}</td></tr>}
        <tr className="border-t border-slate-300 font-medium">
          <td className="py-1" colSpan={2}>Total of {rows.length}</td>
          <td className="py-1 text-right tabular-nums">{peso(sum('principalCents'))}</td><td className="py-1 text-right tabular-nums">{peso(sum('interestCents'))}</td>
          <td className="py-1 text-right tabular-nums">{peso(sum('principalCents') + sum('interestCents'))}</td>
        </tr>
      </tbody>
    </table>
  );
}
