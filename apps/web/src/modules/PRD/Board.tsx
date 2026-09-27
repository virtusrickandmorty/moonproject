/**
 * Production board (PLAN E7, H1): every line still to release, in a column per step, with due-date and rush filters. A card
 * opens its line: the route with Complete / Not needed / Reopen, "Record pieces", and the route setup.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type BoardCard, type DocTypeInfo, type Me, type PrdCatalogue, type StepStatus } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Dialog, Field, Notice, ReasonDialog, inputClass, useAction } from '../../components/ui.tsx';
import { docPath } from '../../shell/menu.ts';
import { columns, filterCards, type Due } from './board.ts';

const STATUS: Record<StepStatus, [string, string]> = {
  pending: ['Pending', 'bg-slate-100 text-slate-700'],
  in_progress: ['In progress', 'bg-amber-100 text-amber-900'],
  completed: ['Completed', 'bg-emerald-100 text-emerald-800'],
  not_needed: ['Not needed', 'bg-slate-200 text-slate-500 line-through'],
};
const chip = (s: StepStatus) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[s][1]}`}>{STATUS[s][0]}</span>;

export function ProductionBoard({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const [cat, setCat] = useState<PrdCatalogue | null>(null);
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [today, setToday] = useState('');
  const [due, setDue] = useState<Due>('all');
  const [rushOnly, setRushOnly] = useState(false);
  const [open, setOpen] = useState<{ jobOrderId: string; lineNo: number } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.prdBoard().then(setCards, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    api.prdCatalogue().then(setCat, (e: Error) => setError(e.message));
    api.health().then((h) => setToday(h.serverTime.slice(0, 10)), () => undefined);
    void load();
  }, [load]);

  if (error) return <Notice>{error}</Notice>;
  if (!cat || !cards) return <p className="text-slate-500">Loading…</p>;
  const can = { progress: me.permissions.includes('prd.progress'), assign: !!docTypes.find((d) => d.key === 'prd.entry')?.canCreate };
  const shown = filterCards(cards, { due, rushOnly }, today);
  const card = open && cards.find((c) => c.jobOrderId === open.jobOrderId && c.lineNo === open.lineNo);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Production board</h1>
        <span className="flex-1" />
        <select aria-label="Due" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={due} onChange={(e) => setDue(e.target.value as Due)}>
          <option value="all">All due dates</option>
          <option value="week">Due within 7 days</option>
          <option value="overdue">Overdue</option>
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={rushOnly} onChange={(e) => setRushOnly(e.target.checked)} /> Rush only</label>
        {can.assign && <Link to={docPath('prd.entry', '/new')} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">+ Record pieces</Link>}
      </div>
      {shown.length === 0 && <p className="text-slate-500">{cards.length === 0 ? 'No job order is in production.' : 'No line matches these filters.'}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns(cat.steps, shown).map((col) => (
          <section key={col.key} aria-label={col.title} className="w-60 shrink-0 space-y-2 rounded-lg bg-slate-100 p-2">
            <h2 className="flex justify-between px-1 text-sm font-semibold"><span>{col.title}</span><span className="text-slate-500">{col.cards.length}</span></h2>
            {col.cards.map((c) => {
              const here = c.steps?.find((s) => s.stepId === c.currentStepId);
              const late = today && c.dueDate < today;
              return (
                <button key={`${c.jobOrderId}-${c.lineNo}`} type="button" onClick={() => setOpen({ jobOrderId: c.jobOrderId, lineNo: c.lineNo })}
                  className={`block w-full rounded-md bg-white p-2 text-left text-sm shadow-sm ring-1 ring-slate-200 hover:ring-indigo-400 ${late ? 'border-l-4 border-red-500' : ''}`}>
                  <span className="flex justify-between font-medium"><span>{c.number} · line {c.lineNo}</span>{c.priority === 'rush' && <span className="text-xs font-semibold text-red-700">RUSH</span>}</span>
                  <span className="block text-slate-600">{c.customerName}</span>
                  <span className="block">{c.description} · {c.qty - c.releasedQty} pcs</span>
                  <span className={`block text-xs ${late ? 'text-red-700' : 'text-slate-500'}`}>Due {c.dueDate}{here ? ` · ${here.pieces} of ${c.qty} done` : ''}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {card && <LinePanel card={card} cat={cat} can={can} onChanged={load} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LinePanel({ card, cat, can, onChanged, onClose }: { card: BoardCard; cat: PrdCatalogue; can: { progress: boolean; assign: boolean }; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const [editing, setEditing] = useState(card.steps === null);
  const [reopen, setReopen] = useState<number | null>(null);
  const a = useAction();
  const name = (id: number) => cat.steps.find((s) => s.id === id)?.name ?? '?';
  const step = (id: number, action: 'complete' | 'not-needed' | 'reopen', reason?: string) => api.prdStep(card.jobOrderId, card.lineNo, id, action, reason).then(onChanged);
  return (
    <Dialog title={`${card.number} · line ${card.lineNo}: ${card.description}`} onClose={onClose}>
      <p className="text-sm text-slate-600">{card.customerName} · {card.qty} pcs · due {card.dueDate}{card.garmentType ? ` · ${card.garmentType} (${card.complexity})` : ''}</p>
      {editing ? (
        <SetupForm card={card} cat={cat} onSaved={() => onChanged().then(() => setEditing(false))} onCancel={card.steps ? () => setEditing(false) : onClose} disabled={!can.progress} />
      ) : (
        <>
          <ol className="space-y-2">
            {card.steps!.map((s) => {
              const closed = s.status === 'completed' || s.status === 'not_needed';
              return (
                <li key={s.stepId} className="flex flex-wrap items-center gap-2 rounded-md p-2 ring-1 ring-slate-200">
                  <span className="min-w-28 font-medium">{name(s.stepId)}</span>
                  {chip(s.status)}
                  <span className="text-sm text-slate-600">{s.pieces} of {card.qty}{s.reworkPieces ? ` + ${s.reworkPieces} rework` : ''}</span>
                  <span className="flex-1" />
                  {can.assign && !closed && <Link to={docPath('prd.entry', `/new?jo=${card.jobOrderId}&step=${s.stepId}`)} className="text-sm text-indigo-700 underline">Record pieces</Link>}
                  {can.progress && !closed && <Button disabled={a.busy} onClick={() => a.run(() => step(s.stepId, 'complete'))}>Complete</Button>}
                  {can.progress && s.status === 'pending' && <Button disabled={a.busy} onClick={() => a.run(() => step(s.stepId, 'not-needed'))}>Not needed</Button>}
                  {can.progress && closed && <Button onClick={() => setReopen(s.stepId)}>Reopen</Button>}
                </li>
              );
            })}
          </ol>
          {a.error && <Notice>{a.error}</Notice>}
          <div className="flex justify-between gap-2">
            {can.progress ? <Button onClick={() => setEditing(true)}>Change route</Button> : <span />}
            <Button onClick={onClose}>Close</Button>
          </div>
        </>
      )}
      {reopen !== null && (
        <ReasonDialog title={`Reopen ${name(reopen)}?`} explain="The step goes back to work until it is completed again. The job order is no longer ready." confirmLabel="Reopen"
          onConfirm={(reason) => step(reopen, 'reopen', reason).then(() => setReopen(null))} onClose={() => setReopen(null)} />
      )}
    </Dialog>
  );
}

function SetupForm({ card, cat, onSaved, onCancel, disabled }: { card: BoardCard; cat: PrdCatalogue; onSaved: () => Promise<unknown>; onCancel: () => void; disabled: boolean }) {
  const [templateId, setTemplateId] = useState<number | undefined>(card.templateId ?? undefined);
  const [stepIds, setStepIds] = useState<number[]>(card.steps?.map((s) => s.stepId) ?? []);
  const [garmentType, setGarmentType] = useState(card.garmentType ?? '');
  const [complexity, setComplexity] = useState(card.complexity ?? 'standard');
  const a = useAction();
  const toggle = (id: number) => setStepIds(stepIds.includes(id) ? stepIds.filter((x) => x !== id) : [...stepIds, id]);
  const save = () => api.prdSetup(card.jobOrderId, card.lineNo, { ...(templateId ? { templateId } : {}), stepIds, garmentType: garmentType.trim(), complexity }).then(onSaved);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Start from a route</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {cat.templates.map((t) => (
            <button key={t.id} type="button" onClick={() => (setTemplateId(t.id), setStepIds(t.stepIds))}
              className={`rounded-md px-2 py-1 text-sm ring-1 ${templateId === t.id ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{t.code} {t.name}</button>
          ))}
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Steps (always in this order)</legend>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {cat.steps.filter((s) => s.isActive || stepIds.includes(s.id)).map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stepIds.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name}</label>
          ))}
        </div>
      </fieldset>
      <Field label="Garment type (for piece rates)" required>
        <input list="garment-types" className={inputClass} value={garmentType} onChange={(e) => setGarmentType(e.target.value)} />
        <datalist id="garment-types">{cat.garmentTypes.map((g) => <option key={g} value={g} />)}</datalist>
      </Field>
      <div role="radiogroup" aria-label="Complexity" className="flex gap-2">
        {cat.complexities.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={complexity === x} onClick={() => setComplexity(x)}
            className={`rounded-md px-3 py-1 text-sm capitalize ring-1 ${complexity === x ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>{x}</button>
        ))}
      </div>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Back</Button>
        <Button tone="primary" disabled={disabled || a.busy || stepIds.length === 0 || !garmentType.trim()} onClick={() => a.run(save)}>Save route</Button>
      </div>
    </div>
  );
}
