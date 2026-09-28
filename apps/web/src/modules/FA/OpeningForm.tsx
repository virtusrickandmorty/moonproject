/**
 * Opening fixed-asset form (MIG-02 part 2, PLAN D8 "Cut-over"): an asset the shop owned before the cut-over date, with
 * its cost, residual value and useful life, and the accumulated depreciation the old books had on that date. It is
 * dated the cut-over date; the server works out the book value (credited to opening balance equity) and how the months
 * of life left are depreciated. Also the Edit of a recorded one (cancel + reissue on the cut-over date, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type AssetClass, type DocTypeInfo, type OpeningStatus } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { emptyOpening, openingInput, openingValues, type OpeningValues } from './opening.ts';

type Worked = { bookValueCents: number; monthsInService: number; straightLineCents: number; leftCents: number; monthsLeft: number; monthlyChargeCents: number };
const money = `${inputClass} text-right tabular-nums`;

export function OpeningForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [v, setV] = useState<OpeningValues>(emptyOpening);
  const [classes, setClasses] = useState<AssetClass[]>([]);
  const [opening, setOpening] = useState<OpeningStatus>();
  const r = useRecord(type, mode, (d) => setV(openingValues(d.input as Parameters<typeof openingValues>[0])));
  useEffect(() => {
    api.assetClasses().then(setClasses, r.fail);
    api.openingStatus().then(setOpening, r.fail);
  }, []);

  const cutover = opening?.cutoverDate ?? undefined;
  const { input, errors } = openingInput(v, cutover);
  const live = useLive(JSON.stringify([input, cutover]), errors.length === 0 && !!cutover, () => r.preview(input, cutover));
  const worked = live?.doc as Worked | undefined;
  const set = (patch: Partial<OpeningValues>) => setV({ ...v, ...patch });
  const cls = classes.find((c) => c.code === v.classCode);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New opening fixed asset')}</h1>
        {r.top}
        {opening && !cutover && <Notice>Set the cut-over date on the opening balances screen first. Opening assets are dated that day.</Notice>}
        {opening?.closed && <Notice>The opening was closed on {opening.closed.closedAt.slice(0, 10)}. Correct balances with a journal voucher.</Notice>}
        {cutover && !opening?.closed && <Notice tone="info">Dated the cut-over date, {cutover}: the asset as the old books had it that day.</Notice>}
        <Panel title="What is the asset?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind of asset" required>
              <select className={inputClass} value={v.classCode} onChange={(e) => set({ classCode: e.target.value })}>
                <option value="">Pick one</option>
                {classes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Where it is kept"><input className={inputClass} value={v.location} onChange={(e) => set({ location: e.target.value })} /></Field>
          </div>
          <Field label="Description" required hint="e.g. Industrial sewing machine, serial no. 12345"><input className={inputClass} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Date acquired" required hint="From the purchase invoice or the old asset list">
            <input type="date" className={inputClass} max={cutover} value={v.acquiredOn} onChange={(e) => set({ acquiredOn: e.target.value })} />
          </Field>
        </Panel>
        <Panel title="From the old books">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Cost" required><input inputMode="decimal" placeholder="0.00" className={money} value={v.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>
            <Field label="Residual value" hint="What it is worth at the end; blank for none"><input inputMode="decimal" placeholder="0.00" className={money} value={v.residual} onChange={(e) => set({ residual: e.target.value })} /></Field>
            <Field label="Useful life in months" hint={cls?.defaultLifeMonths ? `Usual for ${cls.name.toLowerCase()}: ${cls.defaultLifeMonths}` : 'For leasehold improvements, the lease term'}>
              <input inputMode="numeric" placeholder={cls?.defaultLifeMonths ? String(cls.defaultLifeMonths) : ''} className={inputClass} value={v.life} onChange={(e) => set({ life: e.target.value })} />
            </Field>
          </div>
          <Field label="Accumulated depreciation on the cut-over date" hint="Blank for none">
            <input inputMode="decimal" placeholder="0.00" className={money} value={v.accumulated} onChange={(e) => set({ accumulated: e.target.value })} />
          </Field>
        </Panel>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !cutover} onClick={() => r.ask(input, errors, cutover)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {worked && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-600">Book value</dt><dd className="text-right tabular-nums">{peso(worked.bookValueCents)}</dd>
            <dt className="text-slate-600">Straight line for {worked.monthsInService} months</dt><dd className="text-right tabular-nums">{peso(worked.straightLineCents)}</dd>
            <dt className="text-slate-600">Left to depreciate</dt><dd className="text-right tabular-nums">{peso(worked.leftCents)}</dd>
            <dt className="text-slate-600">Over the months left</dt><dd className="text-right">{worked.monthsLeft}</dd>
            <dt className="text-slate-600">About a month</dt><dd className="text-right tabular-nums">{peso(worked.monthlyChargeCents)}</dd>
          </dl>
        )}
        {live ? <p className="text-sm">{live.summary}</p> : <p className="text-sm text-slate-500">Fill in the asset and the figures from the old books to see its book value.</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
