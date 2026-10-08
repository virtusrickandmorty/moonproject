/**
 * Production board (PLAN E7, H1): every line still to release, in a column per step, with due-date and rush filters. A card
 * opens its line: the route with Complete / Not needed / Reopen, "Record pieces", and the route setup.
 */
import { useEffect, useState } from 'react';
import { api, type BoardCard, type DocTypeInfo, type Me, type PrdCatalogue, type StepStatus } from '../../api.ts';
import { addRewrite, Link, navigate, useLocation } from '../../router.tsx';
import { EntryForm } from './EntryForm.tsx';
import { Button, Dialog, Field, Notice, ReasonDialog, inputClass, useAction, searchClass, showDate } from '../../components/ui.tsx';
import { docPath } from '../../shell/menu.ts';
import { columns, filterCards, stepFlow, useBoardRefresh, type Due } from './board.ts';

const readBoard = async () => {
  const [cards, cat, health] = await Promise.all([api.prdBoard(), api.prdCatalogue(), api.health()]);
  return { cards, cat, today: health.serverTime.slice(0, 10) };
};

const STATUS: Record<StepStatus, [string, string]> = {
  pending: ['Pending', 'bg-slate-100 text-slate-700'],
  in_progress: ['In progress', 'bg-amber-100 text-amber-900'],
  completed: ['Completed', 'bg-emerald-100 text-emerald-800'],
  not_needed: ['Not needed', 'bg-slate-200 text-slate-500 line-through'],
};
const chip = (s: StepStatus) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[s][1]}`}>{STATUS[s][0]}</span>;

export function ProductionBoard({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const { data, error, words, stale, refresh: load } = useBoardRefresh(readBoard);
  const [due, setDue] = useState<Due>('all');
  const [rushOnly, setRushOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{ jobOrderId: string; lineNo: number } | null>(null);
  // Record pieces opens over the board (?record&jo=…&step=…, which the form reads); once recorded the board comes back
  // with the new entry (?recorded=<id>) and its counts refreshed.
  const query = new URLSearchParams(useLocation().split('?')[1] ?? '');
  const entryType = docTypes.find((d) => d.key === 'prd.entry');
  const recordedId = query.get('recorded');
  useEffect(() => addRewrite((to) => {
    const [path = '', q = ''] = to.split('?');
    if (path === docPath('prd.entry', '/new')) return { to: `/prd/board?record${q ? `&${q}` : ''}` };
    const done = /^\/docs\/prd\.entry\/([^/]+)$/.exec(path);
    return done && q === 'recorded=1' ? { to: `/prd/board?recorded=${encodeURIComponent(done[1]!)}`, replace: true } : null;
  }), []);
  useEffect(() => { if (recordedId) void load(); }, [recordedId, load]);
  if (!data) return <div className="space-y-3"><p role="status">{words}</p>{error && <Notice>{error}</Notice>}<p className="text-slate-500">Loading…</p></div>;
  const { cat, cards, today } = data;
  const can = { progress: me.permissions.includes('prd.progress'), assign: !!docTypes.find((d) => d.key === 'prd.entry')?.canCreate };
  const shown = filterCards(cards, { due, rushOnly, search }, today);
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
      <p role="status" className={`text-sm ${stale ? 'font-semibold text-red-800' : 'text-slate-500'}`}>{words} · Refreshes every 30 seconds</p>
      {error && <Notice>{error}</Notice>}
      {recordedId && <Notice tone="success">Pieces recorded. <Link to={docPath('prd.entry', `/${recordedId}`)} className="underline">Open the entry</Link></Notice>}
      <div className="flex flex-wrap items-end justify-end gap-3">
        <div className={searchClass}><Field label="Search job number or customer"><input type="search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} /></Field></div>
        <Button onClick={() => { setSearch(''); setDue('all'); setRushOnly(false); }}>Reset filters</Button>
      </div>
      {shown.length === 0 && <p className="text-slate-500">{cards.length === 0 ? 'No job order is in production.' : 'No line matches these filters.'}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns(cat.steps, shown).map((col) => (
          <section key={col.key} aria-label={col.title} className="w-60 shrink-0 space-y-2 rounded-lg bg-slate-100 p-2">
            <h2 className="flex justify-between px-1 text-sm font-semibold"><span>{col.title}</span><span className="text-slate-500">{col.cards.length}</span></h2>
            {col.cards.map((c) => {
              const here = c.steps?.find((s) => s.stepId === (col.stepId ?? c.currentStepId));
              const waiting = here ? Math.max(0, here.receivedPieces - here.pieces) : 0; // came from the step before, not done here yet
              const late = today && c.dueDate < today;
              return (
                <button key={`${c.jobOrderId}-${c.lineNo}`} type="button" onClick={() => setOpen({ jobOrderId: c.jobOrderId, lineNo: c.lineNo })}
                  className={`block w-full rounded-md bg-white p-2 text-left text-sm shadow-sm ring-1 ring-slate-200 hover:ring-indigo-400 ${late ? 'border-l-4 border-red-500' : ''}`}>
                  <span className="flex justify-between font-medium"><span>{c.number} · line {c.lineNo}</span>{c.priority === 'rush' && <span className="text-xs font-semibold text-red-700">RUSH</span>}</span>
                  <span className="block text-slate-600">{c.customerName}</span>
                  <span className="block">{c.description} · {c.qty - c.releasedQty} pcs</span>
                  <span className={`block text-xs ${late ? 'text-red-700' : 'text-slate-500'}`}>Due {showDate(c.dueDate)}</span>
                  {here && col.stepId && <span className="mt-1 block text-xs font-medium text-indigo-800">
                    {here.parts ? `Upper ${here.parts.upper} · Lower ${here.parts.lower} of ${c.qty} done` : `${here.pieces} of ${c.qty} done`}{waiting > 0 && !here.parts ? ` · ${waiting} waiting` : ''}
                  </span>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {card && <LinePanel card={card} cat={cat} can={can} onChanged={load} onClose={() => setOpen(null)} />}
      {query.has('record') && entryType && (
        <Dialog title="Record pieces" size="full" hideTitle onClose={() => navigate('/prd/board', { replace: true })}>
          <EntryForm type={entryType} mode={{ kind: 'new' }} />
        </Dialog>
      )}
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
    <Dialog wide title={`${card.number} · line ${card.lineNo}: ${card.description}`} onClose={onClose}>
      <p className="text-sm text-slate-600">{card.customerName} · {card.qty} {card.isSet ? 'sets (upper and lower)' : 'pcs'} · due {showDate(card.dueDate)}</p>
      {editing ? (
        <SetupForm card={card} cat={cat} onSaved={() => onChanged().then(() => setEditing(false))} onCancel={card.steps ? () => setEditing(false) : onClose} disabled={!can.progress} />
      ) : (
        <>
          <ol className="space-y-2">
            {card.steps!.map((s, i) => {
              const closed = s.status === 'completed' || s.status === 'not_needed';
              const flow = stepFlow(card.steps!, i, card.qty, name);
              return (
                <li key={s.stepId} className="space-y-2 rounded-md p-3 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-28 font-medium">{name(s.stepId)}</span>
                    {chip(s.status)}
                    <span className="text-sm text-slate-600">{s.parts ? `Upper ${s.parts.upper} of ${card.qty} · Lower ${s.parts.lower} of ${card.qty}` : `${s.pieces} of ${card.qty} pcs done`}{s.reworkPieces ? ` + ${s.reworkPieces} rework` : ''}</span>
                  </div>
                  {s.status !== 'not_needed' && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${name(s.stepId)} pieces done`} aria-valuemin={0} aria-valuemax={card.qty} aria-valuenow={s.pieces}>
                      <div className={`h-full rounded-full ${flow.percent === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${flow.percent}%` }} />
                    </div>
                  )}
                  {(flow.received || flow.forwarded) && (
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {flow.received && <span className="text-slate-600">← {flow.received.pieces} pcs received from {flow.received.from}</span>}
                      {flow.forwarded && <span className="font-medium text-indigo-700">→ {flow.forwarded.pieces} pcs forwarded to {flow.forwarded.to}</span>}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {can.assign && !closed && <Link to={docPath('prd.entry', `/new?jo=${card.jobOrderId}&step=${s.stepId}`)} className="text-sm text-indigo-700 underline">Record pieces</Link>}
                    <span className="flex-1" />
                    {can.progress && !closed && <Button disabled={a.busy || !flow.canComplete} title={flow.shortWords || undefined} onClick={() => a.run(() => step(s.stepId, 'complete'))}>Complete</Button>}
                    {can.progress && s.status === 'pending' && <Button disabled={a.busy} onClick={() => a.run(() => step(s.stepId, 'not-needed'))}>Not needed</Button>}
                    {can.progress && closed && <Button onClick={() => setReopen(s.stepId)}>Reopen</Button>}
                  </div>
                  {can.progress && flow.shortWords && <p className="text-xs text-amber-800">{flow.shortWords}</p>}
                </li>
              );
            })}
          </ol>
          {a.error && <Notice>{a.error}</Notice>}
          <div className="flex justify-between gap-2">
            {can.progress ? <Button onClick={() => setEditing(true)}>Change production steps</Button> : <span />}
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
  const a = useAction();
  const toggle = (id: number) => setStepIds(stepIds.includes(id) ? stepIds.filter((x) => x !== id) : [...stepIds, id]);
  // The garment type for piece rates (and whether the line is a set) comes from the price list item the line matches: not typed here.
  // Piece rates go by the price list item (the owner's decision, Oct 2026): no complexity is picked; the standard rate applies.
  const save = () => api.prdSetup(card.jobOrderId, card.lineNo, { ...(templateId ? { templateId } : {}), stepIds, complexity: 'standard' }).then(onSaved);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Start from a set of production steps</p>
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
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Back</Button>
        <Button tone="primary" disabled={disabled || a.busy || stepIds.length === 0} onClick={() => a.run(save)}>Save production steps</Button>
      </div>
    </div>
  );
}
