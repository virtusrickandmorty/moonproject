/**
 * Opening cash advance form (PLAN D8 "Cut-over" step 3, OBCA-): who still owed cash advances on the cut-over date, what
 * is still owed, the deduction per payroll, and the old CA numbers it replaces. Dated the cut-over date; the first
 * payroll after it deducts the instalment typed here, like any CA-. Also the Edit of a recorded one (NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type ActiveEmployee, type CaStatus, type DocTypeInfo, type OpeningStatus } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { emptyOpening, openingInput, openingValues, type OpeningValues } from './opening.ts';

export function OpeningForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<OpeningValues>(emptyOpening);
  const [people, setPeople] = useState<ActiveEmployee[]>([]);
  const [opening, setOpening] = useState<OpeningStatus>();
  const [owed, setOwed] = useState<CaStatus | null>(null);
  const r = useRecord(type, mode, (d) => setV(openingValues(d.input as Parameters<typeof openingValues>[0])));
  useEffect(() => {
    api.activeEmployees().then(setPeople, r.fail);
    api.opening().then(setOpening, r.fail);
  }, []);
  useEffect(() => {
    setOwed(null);
    if (v.employeeId) api.caStatus(v.employeeId).then(setOwed, () => undefined);
  }, [v.employeeId]);

  const cutover = opening?.cutoverDate ?? undefined;
  const { input, errors } = openingInput(v);
  const live = useLive(JSON.stringify([input, cutover]), errors.length === 0 && !!cutover, () => r.preview(input, cutover));
  const set = (patch: Partial<OpeningValues>) => setV({ ...v, ...patch });

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening cash advance')}</h1>
        {r.top}
        {opening && !cutover && <Notice>Set the cut-over date on the opening balances screen first.</Notice>}
        {opening?.closed && <Notice>The opening was closed on {opening.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.</Notice>}
        {cutover && !opening?.closed && <Notice tone="info">Dated the cut-over date, {showDate(cutover)}. The first payroll after it deducts the instalment below, like any cash advance.</Notice>}
        <Panel title="Who still owed it?">
          <select aria-label="Employee" className={inputClass} value={v.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
            <option value="">Pick the employee</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
          {owed && owed.outstandingCents > 0 && <p className="text-sm text-slate-600">Already owes {peso(owed.outstandingCents)} on cash advances recorded here.</p>}
        </Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Still owed on the cut-over date" required>
            <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.owed} onChange={(e) => set({ owed: e.target.value })} />
          </Field>
          <Field label="Deducted each payroll" required>
            <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.installment} onChange={(e) => set({ installment: e.target.value })} />
          </Field>
        </div>
        <Field label="Old cash advance numbers this replaces" required hint="From the old books, e.g. CA-0098, CA-0102">
          <input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !cutover} onClick={() => r.ask(input, errors, cutover)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-sm">{live.summary}</p> : <p className="text-sm text-slate-500">Fill in the employee and the figures to see the summary.</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
