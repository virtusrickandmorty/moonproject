/**
 * Opening officer balance form (PLAN D8 "Cut-over" step 3, OBOF-): which officer, which way the balance goes, and the
 * amount on the cut-over date. Dated the cut-over date; settled afterwards like any officer money (eq.officer), shown
 * in the officer ledger. Also the Edit of a recorded one (NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type EqPerson, type OpeningStatus } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { emptyOpening, openingInput, openingValues, type Direction, type OpeningValues } from './opening.ts';

const DIRECTIONS: [Direction, string][] = [
  ['owes_shop', 'The officer owed the company'],
  ['shop_owes', 'The company owed the officer'],
];

export function OpeningForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<OpeningValues>(emptyOpening);
  const [people, setPeople] = useState<EqPerson[]>([]);
  const [opening, setOpening] = useState<OpeningStatus>();
  const [owed, setOwed] = useState<{ dueFromCents: number; dueToCents: number } | null>(null);
  const r = useRecord(type, mode, (d) => setV(openingValues(d.input as Parameters<typeof openingValues>[0])));
  useEffect(() => {
    api.eqPeople().then((p) => setPeople(p.filter((x) => x.isOfficer)), r.fail);
    api.opening().then(setOpening, r.fail);
  }, []);
  useEffect(() => {
    setOwed(null);
    if (v.personId) api.officerBalances(v.personId).then(setOwed, () => undefined);
  }, [v.personId]);

  const cutover = opening?.cutoverDate ?? undefined;
  const { input, errors } = openingInput(v);
  const live = useLive(JSON.stringify([input, cutover]), errors.length === 0 && !!cutover, () => r.preview(input, cutover));
  const set = (patch: Partial<OpeningValues>) => setV({ ...v, ...patch });

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening officer balance')}</h1>
        {r.top}
        {opening && !cutover && <Notice>Set the cut-over date on the opening balances screen first.</Notice>}
        {opening?.closed && <Notice>The opening was closed on {opening.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.</Notice>}
        {cutover && !opening?.closed && <Notice tone="info">Dated the cut-over date, {cutover}. Settled afterwards like any officer money.</Notice>}
        <Panel title="Which officer?">
          <select aria-label="Officer" className={inputClass} value={v.personId} onChange={(e) => set({ personId: e.target.value })}>
            <option value="">Pick from the register</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.position ? ` (${p.position})` : ''}</option>)}
          </select>
          {owed && <p className="text-sm text-slate-600">Already owes the company {peso(owed.dueFromCents)} · the company already owes them {peso(owed.dueToCents)}</p>}
        </Panel>
        <Panel title="Which way?">
          <div role="radiogroup" aria-label="Which way?" className="grid gap-2 sm:grid-cols-2">
            {DIRECTIONS.map(([k, words]) => (
              <button key={k} type="button" role="radio" aria-checked={v.direction === k} onClick={() => set({ direction: k })}
                className={`rounded-lg p-2 text-left text-sm ring-1 ${v.direction === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{words}</button>
            ))}
          </div>
        </Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount on the cut-over date" required>
            <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
          </Field>
          <Field label="Note" required><input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !cutover} onClick={() => r.ask(input, errors, cutover)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-sm">{live.summary}</p> : <p className="text-sm text-slate-500">Fill in the officer and the amount to see the summary.</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
