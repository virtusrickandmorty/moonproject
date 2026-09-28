/**
 * Opening loan form (PLAN D8 "Cut-over" step 3): a loan or equipment financing received before the cut-over date and not
 * yet paid off. The lender, the loan as received (for the register), the principal still owed on the cut-over date, the
 * rate, and the rest of the schedule: worked out by the server from the next due date and the months left, or typed from
 * the lender's table. Dated the cut-over date. Also the Edit of a recorded one, while no payment stands and the opening is open.
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type OpeningStatus } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { cents } from '../COL/money.ts';
import { MethodPicker, ScheduleTable, TypedRows } from './LoanForm.tsx';
import { emptyOpening, openingInput, openingValues, type OpeningValues } from './loan.ts';

type ScheduleRow = { instalmentNo: number; dueDate: string; principalCents: number; interestCents: number };

export function OpeningForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<OpeningValues>(emptyOpening);
  const [opening, setOpening] = useState<OpeningStatus>();
  const r = useRecord(type, mode, (d) => setV(openingValues(d.input as Parameters<typeof openingValues>[0])));
  useEffect(() => void api.opening().then(setOpening, r.fail), []);

  const cutover = opening?.cutoverDate ?? undefined;
  const { input, errors } = openingInput(v);
  const live = useLive(JSON.stringify([input, cutover]), errors.length === 0 && !!cutover, () => r.preview(input, cutover));
  const set = (patch: Partial<OpeningValues>) => setV({ ...v, ...patch });
  const original = cents(v.original) ?? 0;
  const owed = cents(v.owed) ?? 0;
  const schedule = (live?.doc as { rows?: ScheduleRow[] } | undefined)?.rows ?? [];
  const money = `${inputClass} text-right tabular-nums`;

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening loan')}</h1>
        {r.top}
        {opening && !cutover && <Notice>Set the cut-over date on the opening balances screen first.</Notice>}
        {opening?.closed && <Notice>The opening was closed on {opening.closed.closedAt.slice(0, 10)}. Correct loans with a journal voucher.</Notice>}
        {cutover && <Notice tone="info">Dated the cut-over date, {cutover}. Payments after it are recorded as loan payments.</Notice>}
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
        <Panel title="The loan before the cut-over">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loan as received (principal)" required><input inputMode="decimal" placeholder="0.00" className={money} value={v.original} onChange={(e) => set({ original: e.target.value })} /></Field>
            <Field label="Date received" required><input type="date" className={inputClass} value={v.dateReceived} onChange={(e) => set({ dateReceived: e.target.value })} /></Field>
            <Field label={`Principal still owed on ${cutover ?? 'the cut-over date'}`} required hint="From the lender’s statement">
              <input inputMode="decimal" placeholder="0.00" className={money} value={v.owed} onChange={(e) => set({ owed: e.target.value })} />
            </Field>
            <Field label="Interest rate, % a year" required hint="Like 12 or 10.5; 0 if none"><input inputMode="decimal" className={inputClass} value={v.rate} onChange={(e) => set({ rate: e.target.value })} /></Field>
            <Field label="Months left" required><input inputMode="numeric" className={inputClass} value={v.monthsLeft} onChange={(e) => set({ monthsLeft: e.target.value })} /></Field>
          </div>
        </Panel>
        <Panel title="Rest of the schedule">
          <MethodPicker value={v.schedule} onChange={(schedule) => set({ schedule })} />
          {v.schedule !== 'typed' && (
            <Field label="Next instalment due" required>
              <input type="date" className={`${inputClass} max-w-48`} value={v.nextDueDate} onChange={(e) => set({ nextDueDate: e.target.value })} />
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
          <Button tone="primary" disabled={!type.canPost || !cutover} onClick={() => r.ask(input, errors, cutover)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-600">Loan as received</dt><dd className="text-right tabular-nums">{peso(original)}</dd>
          <dt className="text-slate-600">Repaid before the cut-over</dt><dd className="text-right tabular-nums">{peso(Math.max(original - owed, 0))}</dd>
          <dt className="text-slate-600">Still owed to the lender</dt><dd className="text-right tabular-nums">{peso(owed)}</dd>
        </dl>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
