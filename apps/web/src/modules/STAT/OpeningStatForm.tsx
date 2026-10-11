/**
 * Opening statutory payable form (OBST-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): a grid of active employees, one
 * contribution month, and what each employee still owes SSS, PhilHealth, Pag-IBIG, withholding tax, and any SSS or
 * Pag-IBIG loan amortizations, for a month on or before the cut-over date that was withheld and not yet remitted.
 * Recorded on the cut-over date; the accountant remits it later like any month's payroll. Also the Edit of a recorded
 * one (cancel + reissue on the cut-over date, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type ActiveEmployee, type DocTypeInfo, type OpeningStatInput, type OpeningStatus } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, inputClass, peso, showDate } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { emptyRow, openingStatInput, openingStatValues, type OpeningStatRow } from './opening.ts';

const money = `${inputClass} w-24 text-right tabular-nums`;

export function OpeningStatForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [month, setMonth] = useState('');
  const [rows, setRows] = useState<Record<string, OpeningStatRow>>({});
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [opening, setOpening] = useState<OpeningStatus>();
  const r = useRecord(type, mode, (d) => {
    setMonth((d.input as unknown as OpeningStatInput).month);
    setRows(openingStatValues(d.input as unknown as OpeningStatInput));
  });
  useEffect(() => {
    api.activeEmployees().then(setEmployees, r.fail);
    api.opening().then(setOpening, r.fail);
  }, []);

  const cutover = opening?.cutoverDate ?? undefined;
  const typed = openingStatInput(month, rows, employees);
  const { input, errors: typedErrors, totalCents } = typed;
  const closed = opening?.closed ? `The opening was closed on ${opening.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.` : '';
  const noDate = opening && !cutover ? 'Set the cut-over date on the opening balances screen first.' : '';
  const errors = [...typedErrors, ...[closed, noDate].filter(Boolean)];
  const live = useLive(JSON.stringify([input, cutover]), typedErrors.length === 0 && !!cutover, () => r.preview(input, cutover));
  const record = () => r.ask(input, errors, cutover);

  const set = (employeeId: string, patch: Partial<OpeningStatRow>) => setRows((old) => ({ ...old, [employeeId]: { ...(old[employeeId] ?? emptyRow()), ...patch } }));
  const rowTotal = (row: OpeningStatRow | undefined) => (row ? Object.values(row).reduce((s, v) => s + (Number(v.replace(/,/g, '')) || 0), 0) : 0);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening statutory payable')}</h1>
        {r.top}
        {noDate && <Notice tone="warning">{noDate}</Notice>}
        {closed && <Notice>{closed}</Notice>}
        {cutover && !closed && <Notice tone="info">Dated the cut-over date, {showDate(cutover)}: what a contribution month on or before it left withheld and not yet remitted.</Notice>}
        <Panel title="Which contribution month?">
          <Field label="Month" required hint="Like 2026-08, the payroll month this is still owed for">
            <input className={`${inputClass} max-w-40`} placeholder="2026-08" value={month} disabled={!!r.original} onChange={(e) => setMonth(e.target.value.trim())} />
          </Field>
        </Panel>
        <Panel title="What each employee still owes">
          {employees.length === 0 && <Loading label="Loading employees…" />}
          {employees.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr><th>Employee</th><th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th><th>Withholding tax</th><th>SSS loan</th><th>Pag-IBIG loan</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {employees.map((e) => {
                    const row = rows[e.id];
                    return (
                      <tr key={e.id} className="border-t border-slate-100">
                        <td className="py-1">{e.name}</td>
                        <td><input aria-label={`${e.name} SSS`} inputMode="decimal" placeholder="0.00" className={money} value={row?.sss ?? ''} onChange={(ev) => set(e.id, { sss: ev.target.value })} /></td>
                        <td><input aria-label={`${e.name} PhilHealth`} inputMode="decimal" placeholder="0.00" className={money} value={row?.phic ?? ''} onChange={(ev) => set(e.id, { phic: ev.target.value })} /></td>
                        <td><input aria-label={`${e.name} Pag-IBIG`} inputMode="decimal" placeholder="0.00" className={money} value={row?.hdmf ?? ''} onChange={(ev) => set(e.id, { hdmf: ev.target.value })} /></td>
                        <td><input aria-label={`${e.name} withholding tax`} inputMode="decimal" placeholder="0.00" className={money} value={row?.wtax ?? ''} onChange={(ev) => set(e.id, { wtax: ev.target.value })} /></td>
                        <td><input aria-label={`${e.name} SSS loan`} inputMode="decimal" placeholder="0.00" className={money} value={row?.sssLoan ?? ''} onChange={(ev) => set(e.id, { sssLoan: ev.target.value })} /></td>
                        <td><input aria-label={`${e.name} Pag-IBIG loan`} inputMode="decimal" placeholder="0.00" className={money} value={row?.hdmfLoan ?? ''} onChange={(ev) => set(e.id, { hdmfLoan: ev.target.value })} /></td>
                        <td className="text-right tabular-nums">{rowTotal(row) > 0 ? peso(rowTotal(row) * 100) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-slate-500">Leave every amount empty for an employee with nothing still to remit for this month.</p>
        </Panel>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !cutover || !!closed} onClick={record}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <p className="text-sm">Total still to remit: <span className="font-semibold tabular-nums">{peso(totalCents)}</span></p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
