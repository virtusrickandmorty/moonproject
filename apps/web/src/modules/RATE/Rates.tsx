/**
 * Piece rates (PLAN E7 RATE): the rates in force today by garment type, step and complexity, their history, and a new
 * rate from today or a later date for those with rate.manage (the owner's rate decisions, OWN-05).
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type PrdStep, type RateTable } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso, useAction, searchClass, searchRowClass } from '../../components/ui.tsx';
import { cents } from '../COL/money.ts';

export function PieceRates({ me }: { me: Me }) {
  const [table, setTable] = useState<RateTable | null>(null);
  const [steps, setSteps] = useState<PrdStep[]>([]);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => api.rates().then(setTable, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
    api.prdCatalogue().then((c) => setSteps(c.steps), () => undefined);
  }, [load]);

  if (error) return <Notice>{error}</Notice>;
  if (!table) return <p className="text-slate-500">Loading…</p>;
  const stepName = (code: string) => steps.find((s) => s.code === code)?.name ?? code;
  const rows = (history ? table.history : table.current).filter((r) => r.garmentType.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Piece rates</h1>
      <div className={searchRowClass}>
        <input aria-label="Search garment type" placeholder="Search garment type" className={`${inputClass} ${searchClass}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Show history (rates that start later too)</label>
      </div>
      <Panel title={history ? 'All rates, newest first' : `Rates in force on ${table.asOf}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Garment type</th><th>Step</th><th>Complexity</th><th className="text-right">Per piece</th><th className="pl-6">From</th>{history && <th className="pl-4">Why</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1">{r.garmentType}</td><td>{stepName(r.stepCode)}</td><td className="capitalize">{r.complexity}</td>
                <td className="text-right tabular-nums">{peso(r.rateCents)}</td><td className="pl-6">{r.effectiveFrom}</td>{history && <td className="pl-4 text-slate-600">{r.reason}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-slate-500">No rate matches.</p>}
      </Panel>
      {me.permissions.includes('rate.manage') && <NewRate table={table} steps={steps} onSaved={load} />}
    </div>
  );
}

function NewRate({ table, steps, onSaved }: { table: RateTable; steps: PrdStep[]; onSaved: () => Promise<unknown> }) {
  const blank = { garmentType: '', stepCode: 'SEWING', complexity: 'standard', rate: '', effectiveFrom: table.asOf, reason: '' };
  const [v, setV] = useState(blank);
  const [done, setDone] = useState('');
  const a = useAction();
  const rateCents = cents(v.rate);
  const ready = v.garmentType.trim() && rateCents !== undefined && v.rate.trim() && v.reason.trim().length >= 10;
  const save = async () => {
    const r = await api.addRate({ garmentType: v.garmentType.trim(), stepCode: v.stepCode, complexity: v.complexity, rateCents: rateCents!, effectiveFrom: v.effectiveFrom, reason: v.reason.trim() });
    setDone(`${r.garmentType} ${r.stepCode.toLowerCase()} (${r.complexity}) is ${peso(r.rateCents)} per piece from ${r.effectiveFrom}.`);
    setV(blank);
    await onSaved();
  };
  return (
    <Panel title="New rate">
      <p className="text-sm text-slate-600">A new rate starts on its date. Pieces already recorded keep the rate they took.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Garment type" required>
          <input list="rate-garments" className={inputClass} value={v.garmentType} onChange={(e) => setV({ ...v, garmentType: e.target.value })} />
          <datalist id="rate-garments">{table.garmentTypes.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Step" required>
          <select className={inputClass} value={v.stepCode} onChange={(e) => setV({ ...v, stepCode: e.target.value })}>{steps.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
        </Field>
        <Field label="Complexity" required>
          <select className={inputClass} value={v.complexity} onChange={(e) => setV({ ...v, complexity: e.target.value })}>{['simple', 'standard', 'complex'].map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Rate per piece" required>
          <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
        </Field>
        <Field label="From (today or later)" required>
          <input type="date" min={table.asOf} className={inputClass} value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} />
        </Field>
        <Field label="Why (at least 10 characters)" required>
          <input className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
      {a.error && <Notice>{a.error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      <Button tone="primary" disabled={!ready || a.busy} onClick={() => a.run(save)}>Save rate</Button>
    </Panel>
  );
}
