/**
 * Loan payment form (PLAN D5 LOAN-PAY, E10): pick the loan from the register and the next instalment comes with its
 * scheduled principal and interest; pick where the money came from. When the lender applied it differently, type their
 * split and say why. Opened from a loan with ?loan=<id>. Also the Edit of a recorded payment (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CashPlace, type DocTypeInfo, type LoanRow } from '../../api.ts';
import { Button, CashPlaceButtons, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { paymentInput, type PaymentValues } from './loan.ts';

type Worked = { instalments: number; dueDate: string | null; scheduledPrincipalCents: number; scheduledInterestCents: number; totalCents: number; earlierPaidCents?: number };

export function PaymentForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [v, setV] = useState<PaymentValues>({ loanId: '', instalmentNo: 0, cashPlaceId: '', differs: false, principal: '', interest: '', note: '' });
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { loanId: string; instalmentNo: number; cashPlaceId: number; principalCents?: number; interestCents?: number; note?: string };
    const differs = s.principalCents !== undefined;
    setV({ loanId: s.loanId, instalmentNo: s.instalmentNo, cashPlaceId: String(s.cashPlaceId), differs, principal: differs ? formatPesos(s.principalCents!) : '', interest: differs ? formatPesos(s.interestCents ?? 0) : '', note: s.note ?? '' });
  });
  useEffect(() => {
    api.cashPlaces().then(setPlaces, r.fail);
    api.loans('posted').then((all) => {
      setLoans(all);
      const q = new URLSearchParams(location.search).get('loan');
      const l = all.find((x) => x.id === q && x.nextDue);
      if (mode.kind === 'new' && l) setV((old) => ({ ...old, loanId: l.id, instalmentNo: l.nextDue!.instalmentNo }));
    }, r.fail);
  }, []);

  const { input, errors } = paymentInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const worked = live?.doc as Worked | undefined;
  const set = (patch: Partial<PaymentValues>) => setV({ ...v, ...patch });
  // Loans still owing; an edited payment's loan stays in the list, on the instalment it paid.
  const open = loans.filter((l) => l.nextDue || l.id === v.loanId);
  const loan = loans.find((l) => l.id === v.loanId);
  const pickLoan = (id: string) => {
    const l = loans.find((x) => x.id === id);
    set({ loanId: id, instalmentNo: l?.nextDue?.instalmentNo ?? 0, differs: false, principal: '', interest: '', note: '' });
  };
  const next = loan?.nextDue?.instalmentNo === v.instalmentNo ? loan.nextDue : null;
  const scheduled = worked ? { principal: worked.scheduledPrincipalCents, interest: worked.scheduledInterestCents } : next ? { principal: next.principalCents, interest: next.interestCents } : null;

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New loan payment')}</h1>
        {r.top}
        <Panel title="Which loan?">
          <select aria-label="Loan" className={inputClass} value={v.loanId} onChange={(e) => pickLoan(e.target.value)}>
            <option value="">Pick the loan</option>
            {open.map((l) => <option key={l.id} value={l.id}>{l.number} · {l.lender} · {peso(l.balanceCents)} owed</option>)}
          </select>
          {loans.length > 0 && open.length === 0 && <p className="text-sm text-slate-500">No loan is still owing.</p>}
          {v.loanId && scheduled && (
            <p className="text-sm">
              Instalment {v.instalmentNo}{worked ? ` of ${worked.instalments}` : ''}{(worked?.dueDate ?? next?.dueDate) ? `, due ${worked?.dueDate ?? next?.dueDate}` : ''}
              {worked?.earlierPaidCents ? `, ${peso(worked.earlierPaidCents)} already paid; still due` : ''}:{' '}
              {peso(scheduled.principal)} principal and {peso(scheduled.interest)} interest = <b className="tabular-nums">{peso(scheduled.principal + scheduled.interest)}</b>
            </p>
          )}
        </Panel>
        <Panel title="Where did the money come from?">
          <CashPlaceButtons label="Where did the money come from?" places={places} value={v.cashPlaceId} onChange={(id) => set({ cashPlaceId: id })} />
        </Panel>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.differs} disabled={!scheduled}
            onChange={(e) => set({ differs: e.target.checked, principal: scheduled ? formatPesos(scheduled.principal) : '', interest: scheduled ? formatPesos(scheduled.interest) : '' })} />
          The amount or split differs (a part payment, or the lender applied it differently)
        </label>
        {v.differs && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Principal"><input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={v.principal} onChange={(e) => set({ principal: e.target.value })} /></Field>
            <Field label="Interest"><input inputMode="decimal" className={`${inputClass} text-right tabular-nums`} value={v.interest} onChange={(e) => set({ interest: e.target.value })} /></Field>
            <Field label="Why is it different?" required><input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
        )}
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-2xl font-semibold tabular-nums">{peso(live.totalCents)}</p> : <p className="text-sm text-slate-500">Pick the loan and the cash place to see the payment.</p>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
