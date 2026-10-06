/**
 * Loan forgiveness form (the owner's decision of 6 Oct 2026): the lender forgave what is still due on one instalment.
 * Opened from the loan's schedule or late list with ?loan=<id>&instalment=<n>; the amount is read only (the server
 * forgives all that is still due, never more). Only the principal posts, as a gain. Also the Edit of a recorded
 * forgiveness (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type LoanDetail } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { forgivenessInput, type ForgiveValues } from './loan.ts';

type Worked = { principalCents: number; interestCents: number; totalCents: number; loanNumber: string; lender: string; instalments: number; dueDate: string | null };

const asked = (): ForgiveValues => {
  const q = new URLSearchParams(location.search);
  return { loanId: q.get('loan') ?? '', instalmentNo: Number(q.get('instalment') ?? 0) || 0, reason: '', note: '' };
};

export function ForgiveForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<ForgiveValues>(() => (mode.kind === 'new' ? asked() : { loanId: '', instalmentNo: 0, reason: '', note: '' }));
  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { loanId: string; instalmentNo: number; reason: string; note?: string };
    setV({ loanId: s.loanId, instalmentNo: s.instalmentNo, reason: s.reason, note: s.note ?? '' });
  });
  // The schedule shows what is still due before the reason is typed; the preview then confirms it.
  useEffect(() => void (v.loanId ? api.loan(v.loanId).then(setLoan, () => setLoan(null)) : setLoan(null)), [v.loanId]);

  const { input, errors } = forgivenessInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  const worked = live?.doc as Worked | undefined;
  const row = loan?.schedule.find((x) => x.instalmentNo === v.instalmentNo);
  const due = worked
    ? { principal: worked.principalCents, interest: worked.interestCents }
    : row?.forgivenBy ? { principal: row.forgivenPrincipalCents ?? 0, interest: row.forgivenInterestCents ?? 0 } // an edit: what it forgave
    : row ? { principal: row.remainingPrincipalCents ?? row.principalCents, interest: row.remainingInterestCents ?? row.interestCents } : null;

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('Forgive the rest of an instalment')}</h1>
        {r.top}
        <Panel title="What the lender forgave">
          {loan && <p className="text-sm">{loan.number} · {loan.lender} · instalment {v.instalmentNo} of {loan.instalments}{row ? `, due ${row.dueDate}` : ''}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Principal"><input readOnly aria-label="Principal forgiven" className={`${inputClass} bg-slate-50 text-right tabular-nums`} value={due ? peso(due.principal) : ''} /></Field>
            <Field label="Interest"><input readOnly aria-label="Interest forgiven" className={`${inputClass} bg-slate-50 text-right tabular-nums`} value={due ? peso(due.interest) : ''} /></Field>
            <Field label="Amount forgiven"><input readOnly aria-label="Amount forgiven" className={`${inputClass} bg-slate-50 text-right font-semibold tabular-nums`} value={due ? peso(due.principal + due.interest) : ''} /></Field>
          </div>
          <p className="text-sm text-slate-600">All that is still due on the instalment. The principal is booked as a gain; the interest was never expensed, so it only closes the instalment.</p>
        </Panel>
        <Field label="Why did the lender forgive it? (10 to 200 characters)" required>
          <textarea rows={2} maxLength={200} className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
        <Field label="Note" hint="For example where the lender's letter is filed.">
          <input className={inputClass} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="danger" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Forgive the rest</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-2xl font-semibold tabular-nums">{peso(live.totalCents)}</p> : <p className="text-sm text-slate-500">Type the reason to see what is recorded.</p>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
