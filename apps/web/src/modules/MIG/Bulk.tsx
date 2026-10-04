/**
 * Two bulk tools on the review screen: the sheet's MANUAL size rows (typed in the old app with no customer), and the employees
 * that still need a rate or a pay type. Both only fill in what a Fix would; the rows are then accepted, and the dry run and the
 * commit run as before. The server checks everything again.
 */
import { useEffect, useState } from 'react';
import { api, type CustomerGroup, type CustomerRow, type MigRow, type MigSizeSuggestion } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';
import {
  PAY_CHOICES, assignBody, assignedWords, employeeFixes, employeeStart, employeeTableRows, employeesLeftWords, groupChoice, manualSizes, sizeName, suggestionBatches,
  suggestionFor, suggestionWords, takesRate, type EmployeeEdit, type PayChoice, type SizeChoice,
} from './importer.ts';

type Picked = { id: string; name: string };

function CustomerPicker({ picked, onPick }: { picked: Picked | null; onPick: (c: Picked | null) => void }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<CustomerRow[]>([]);
  useEffect(() => {
    if (!search.trim()) return setFound([]);
    const timer = setTimeout(() => void api.customers(search.trim()).then(setFound, () => setFound([])), 250);
    return () => clearTimeout(timer);
  }, [search]);
  if (picked) return <p className="text-sm">Customer: <strong>{picked.name}</strong> <button type="button" className="ml-2 underline" onClick={() => onPick(null)}>Change</button></p>;
  return (
    <div className="space-y-1">
      <Field label="Customer" hint="Type part of the customer's name.">
        <input className={inputClass} aria-label="Customer" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers" />
      </Field>
      {found.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
          {found.filter((c) => c.is_active === 1).map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => onPick({ id: c.id, name: `${c.display_name} (${c.code})` })}>{c.display_name} <span className="text-slate-500">{c.code}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The sizes with no customer: tick rows, then either one customer each, or all under one customer and group. */
export function BulkSizes({ uploadId, rows, onChanged }: { uploadId: string; rows: MigRow[]; onChanged: () => Promise<unknown> }) {
  const waiting = manualSizes(rows);
  const [suggestions, setSuggestions] = useState<MigSizeSuggestion[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'own' | 'under'>('own');
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [groupKind, setGroupKind] = useState<'none' | 'existing' | 'new'>('none');
  const [groupId, setGroupId] = useState('');
  const [newName, setNewName] = useState('');
  const [problem, setProblem] = useState('');
  const [said, setSaid] = useState('');
  const apply = useAction();
  useEffect(() => { void api.migSizeSuggestions(uploadId).then(setSuggestions, () => setSuggestions([])); }, [uploadId, waiting.length]);
  useEffect(() => {
    setGroups([]); setGroupKind('none'); setGroupId('');
    if (customer) void api.customerGroups(customer.id).then(setGroups, () => setGroups([]));
  }, [customer]);
  if (waiting.length === 0 && !said) return null;

  const stillTicked = waiting.filter((r) => ticked.has(r.id)).map((r) => r.id);
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const batches = suggestionBatches(rows, suggestions);
  const run = (body: Parameters<typeof api.migAssignSizes>[1]) => apply.run(async () => {
    const r = await api.migAssignSizes(uploadId, body);
    setSaid(assignedWords(r));
    setTicked(new Set());
    await onChanged();
  });
  const submit = () => {
    const choice: SizeChoice = mode === 'own' ? { mode: 'own' } : { mode: 'under', customerId: customer?.id ?? '', group: groupChoice(groupKind, groupId, newName, groups) };
    const made = assignBody(stillTicked, choice);
    if (!made.ok) return setProblem(made.message);
    setProblem('');
    void run(made.body);
  };
  return (
    <Panel title={`Sizes typed without a customer (${waiting.length})`}>
      <p className="text-sm text-slate-600">
        These sizes were typed in the old app with no customer: usually people measured one by one, often for a group order. Tick the rows, then choose what to do with them all at once. Nothing is imported until you check the import and choose to import these approved rows.
      </p>
      {batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 p-3 text-sm">
          <span>{batches.reduce((n, b) => n + b.rowIds.length, 0)} names match exactly one customer.</span>
          <Button disabled={apply.busy} onClick={() => void apply.run(async () => {
            let assigned = 0;
            const skipped: { rowId: string; rowNumber: number; reason: string }[] = [];
            for (const b of batches) { const r = await api.migAssignSizes(uploadId, { rowIds: b.rowIds, mode: 'under', customerId: b.customerId }); assigned += r.assigned; skipped.push(...r.skipped); }
            setSaid(assignedWords({ assigned, skipped }));
            await onChanged();
          })}>Accept every suggestion</Button>
        </div>
      )}
      {waiting.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Button onClick={() => setTicked(new Set(waiting.map((r) => r.id)))}>Tick all {waiting.length}</Button>
            <Button onClick={() => setTicked(new Set())}>Tick none</Button>
            <span className="self-center text-slate-600">{stillTicked.length} ticked</span>
          </div>
          <div className="max-h-96 overflow-auto rounded-md ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="w-8 px-2 py-1"><span className="sr-only">Tick</span></th><th className="px-2 py-1">Row</th><th className="px-2 py-1">Name in the sheet</th><th className="px-2 py-1">Suggestion</th></tr></thead>
              <tbody>
                {waiting.map((r) => {
                  const suggestion = suggestionFor(r, suggestions);
                  const name = sizeName(r);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-2 py-1"><input type="checkbox" aria-label={`Tick row ${r.rowNumber}`} checked={ticked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td className="px-2 py-1 text-slate-500">{r.rowNumber}</td>
                      <td className="px-2 py-1">{name || <span className="text-amber-800">No name in the sheet</span>}</td>
                      <td className="px-2 py-1">
                        {suggestion ? <Button disabled={apply.busy} onClick={() => void run({ rowIds: [r.id], mode: 'under', customerId: suggestion.customerId })}>Use {suggestionWords(suggestion)}</Button> : <span className="text-slate-400">None</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">What should happen to the {stillTicked.length} ticked rows?</legend>
            <label className="flex items-start gap-2"><input type="radio" name="size-mode" checked={mode === 'own'} onChange={() => setMode('own')} /><span>Make each its own customer (a person), named as in the sheet</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="size-mode" checked={mode === 'under'} onChange={() => setMode('under')} /><span>Put them under one customer: each row becomes a wearer with its measurements</span></label>
          </fieldset>
          {mode === 'under' && (
            <div className="max-w-xl space-y-3 rounded-md bg-slate-50 p-3">
              <CustomerPicker picked={customer} onPick={setCustomer} />
              {customer && (
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="size-group" checked={groupKind === 'none'} onChange={() => setGroupKind('none')} />No group</label>
                  {groups.length > 0 && (
                    <label className="flex items-center gap-2"><input type="radio" name="size-group" checked={groupKind === 'existing'} onChange={() => setGroupKind('existing')} />One of its groups
                      <select className={`${inputClass} max-w-xs`} value={groupId} onChange={(e) => { setGroupId(e.target.value); setGroupKind('existing'); }} aria-label="Group">
                        <option value="">Choose a group…</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-2"><input type="radio" name="size-group" checked={groupKind === 'new'} onChange={() => setGroupKind('new')} />A new group
                    <input className={`${inputClass} max-w-xs`} value={newName} onChange={(e) => { setNewName(e.target.value); setGroupKind('new'); }} placeholder="Name of the group" aria-label="New group name" />
                  </label>
                </div>
              )}
            </div>
          )}
          {problem && <Notice tone="warning">{problem}</Notice>}
          <Button tone="primary" disabled={apply.busy} onClick={submit}>{apply.busy ? 'Saving…' : `Apply to the ${stillTicked.length} ticked rows`}</Button>
        </>
      )}
      {apply.error && <Notice>{apply.error}</Notice>}
      {said && <Notice tone="info">{said}</Notice>}
    </Panel>
  );
}

/** The employees that still need a rate or a pay type: type and choose them all, then save them all at once. */
export function BulkEmployees({ uploadId, rows, onChanged }: { uploadId: string; rows: MigRow[]; onChanged: () => Promise<unknown> }) {
  const table = employeeTableRows(rows);
  const [edits, setEdits] = useState<Record<string, EmployeeEdit>>({});
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState('');
  const save = useAction();
  if (table.length === 0 && !saved) return null;
  const editOf = (r: MigRow): EmployeeEdit => edits[r.id] ?? employeeStart(r);
  const change = (r: MigRow, patch: Partial<EmployeeEdit>) => setEdits({ ...edits, [r.id]: { ...editOf(r), ...patch } });
  const submit = () => {
    const made = employeeFixes(table, edits);
    if (!made.ok) return setProblem(made.message);
    setProblem(''); setSaved('');
    void save.run(async () => {
      const r = await api.migFixEmployees(uploadId, made.fixes);
      setSaved(`${r.saved} ${r.saved === 1 ? 'employee' : 'employees'} saved and accepted.`);
      setEdits({});
      await onChanged();
    });
  };
  return (
    <Panel title={`Employees who need a rate or a pay type (${table.length})`}>
      <p className="text-sm text-slate-600">Type each rate and choose each pay type, then save them all at once. Pesos: the daily rate for daily pay, the monthly rate for monthly pay. Piece rate pay has no rate here: the piece-rate list has it. If any row is refused, nothing is saved and the message says which row.</p>
      {table.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">Row</th><th className="pr-3">Employee</th><th className="pr-3">Salary category in the sheet</th><th className="pr-3">Pay type</th><th>Rate (pesos)</th></tr></thead>
            <tbody>
              {table.map((r) => {
                const e = editOf(r);
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3 text-slate-500">{r.rowNumber}</td>
                    <td className="py-1 pr-3">{r.raw.Employee_Name}{r.legacyId ? ` (${r.legacyId})` : ''}</td>
                    <td className="py-1 pr-3 text-slate-600">{r.raw.Salary_Category || 'Blank'}</td>
                    <td className="py-1 pr-3">
                      <select className={inputClass} aria-label={`Pay type, row ${r.rowNumber}`} value={e.payType} onChange={(ev) => change(r, { payType: ev.target.value as PayChoice })}>
                        {PAY_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1"><input className={inputClass} inputMode="decimal" aria-label={`Rate in pesos, row ${r.rowNumber}`} disabled={!takesRate(e.payType)} value={e.rate} onChange={(ev) => change(r, { rate: ev.target.value })} placeholder={takesRate(e.payType) ? '0.00' : 'None'} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-slate-600">{employeesLeftWords(table.length)}</p>
      {problem && <Notice tone="warning">{problem}</Notice>}
      {save.error && <Notice>{save.error}</Notice>}
      {saved && <Notice tone="success">{saved}</Notice>}
      {table.length > 0 && <Button tone="primary" disabled={save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Save all'}</Button>}
    </Panel>
  );
}
