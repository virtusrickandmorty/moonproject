/**
 * Sizer sets (PLAN E8): the sets and the sizes in each, who has them, the overdue ones, and the ones already returned,
 * with Lend and Take back. Nothing is posted: a lost set is charged as a quick sale. The date out and today's date are
 * the server's; a set can be lent only while it is in the shop, and back only once.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type SizerBoard, type SizerSet } from '../../api.ts';
import { Loading, Button, Dialog, Field, Notice, Panel, askConfirm, inputClass, useAction, searchClass, searchRowClass } from '../../components/ui.tsx';
import { CustomerPicker, type Picked } from '../COL/parts.tsx';
import { STATUS_WORDS, dueWords, filterSets, lendInput, returnInput, setInput, weekFrom, type ReturnValues, type SetValues } from './sizer.ts';

const chip = (s: SizerSet['status']) => `rounded-full px-2 py-0.5 text-xs font-medium ${s === 'in shop' ? 'bg-emerald-100 text-emerald-800' : s === 'lent' ? 'bg-sky-100 text-sky-800' : 'bg-red-100 text-red-800'}`;

function Lend({ set, today, onDone, onClose }: { set: SizerSet; today: string; onDone: () => void; onClose: () => void }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [due, setDue] = useState(weekFrom(today));
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { input, errors } = lendInput({ setId: set.id, customerId: customer?.id ?? '', expectedReturnDate: due }, today);
  return (
    <Dialog title={`Lend ${set.code}`} onClose={onClose}>
      <p className="text-sm text-slate-700">{set.garmentType}: {set.sizesIncluded}. It goes out today.</p>
      <Field label="Who is borrowing it?" required><CustomerPicker value={customer} onChange={setCustomer} /></Field>
      <Field label="Due back on" required><input type="date" aria-label="Due back on" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Go back</Button>
        <Button tone="primary" disabled={a.busy} onClick={() => (setTouched(true), errors.length === 0 && a.run(async () => { await api.sizerLend(input); onDone(); }))}>Lend it</Button>
      </div>
    </Dialog>
  );
}

function TakeBack({ set, onDone, onClose }: { set: SizerSet; onDone: () => void; onClose: () => void }) {
  const [v, setV] = useState<ReturnValues>({ status: 'in shop', condition: '' });
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { input, errors } = returnInput(v);
  const holder = set.holder!;
  return (
    <Dialog title={`Take back ${set.code}`} onClose={onClose}>
      <p className="text-sm text-slate-700">Lent to {holder.customerName} on {holder.dateOut}, due back {holder.expectedReturnDate}.</p>
      <Field label="What came back?" required>
        <select aria-label="What came back?" className={inputClass} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ReturnValues['status'] })}>
          <option value="in shop">The set is back in the shop</option><option value="lost or damaged">The set is lost or damaged</option>
        </select>
      </Field>
      <Field label="Condition" required hint="Write “Complete” when nothing is wrong.">
        <textarea rows={2} aria-label="Condition" className={inputClass} value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value })} />
      </Field>
      {v.status === 'lost or damaged' && <Notice tone="info">Nothing is charged here. If the borrower pays for the set, record it as a quick sale.</Notice>}
      {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Go back</Button>
        <Button tone="primary" disabled={a.busy} onClick={() => (setTouched(true), errors.length === 0 && a.run(async () => { await api.sizerReturn(holder.loanId, holder.loanVersion, input); onDone(); }))}>Record the return</Button>
      </div>
    </Dialog>
  );
}

/** A sizer set made or changed (the owner's request, Oct 2026): its code, the garment it fits and the sizes in it. */
function SetForm({ set, garments, onClose, onDone }: { set: SizerSet | null; garments: string[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<SetValues>({ code: set?.code ?? '', garmentType: set?.garmentType ?? '', sizesIncluded: set?.sizesIncluded ?? '' });
  const [touched, setTouched] = useState(false);
  const a = useAction();
  const { input, errors } = setInput(v);
  const save = () => (setTouched(true), errors.length === 0 && a.run(async () => {
    await (set ? api.sizerSetUpdate(set.id, set.version, input) : api.sizerSetCreate(input));
    onDone();
  }));
  return (
    <Dialog title={set ? `Change ${set.code}` : 'New sizer set'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Code" required hint="Its own name, written on the bag, e.g. SZ-JERSEY-01"><input autoFocus className={inputClass} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Garment type" required hint="The garment it fits, as on the price list">
          <input list="sizer-garments" className={inputClass} value={v.garmentType} onChange={(e) => setV({ ...v, garmentType: e.target.value })} />
          <datalist id="sizer-garments">{garments.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Sizes in it" required hint="e.g. XS, S, M, L, XL, 2XL"><input className={inputClass} value={v.sizesIncluded} onChange={(e) => setV({ ...v, sizesIncluded: e.target.value })} /></Field>
        {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
        {a.error && <Notice>{a.error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Go back</Button>
          <Button tone="primary" disabled={a.busy} onClick={save}>{set ? 'Save the change' : 'Add the set'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function SizerSets({ me }: { me: Me }) {
  const [board, setBoard] = useState<SizerBoard | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SizerSet['status'] | 'all'>('all');
  const [dialog, setDialog] = useState<{ kind: 'lend' | 'back'; set: SizerSet } | { kind: 'set'; set: SizerSet | null } | null>(null);
  const [offError, setOffError] = useState('');
  const load = useCallback(() => void api.sizerBoard().then((b) => (setBoard(b), setError('')), (e: Error) => setError(e.message)), []);
  useEffect(load, [load]);
  if (error) return <Notice>{error}</Notice>;
  if (!board) return <Loading />;
  const canEdit = me.permissions.includes('szr.loan.edit');
  const canSets = me.permissions.includes('szr.set.edit');
  const garments = [...new Set(board.sets.map((s) => s.garmentType))].sort();
  const switchOff = async (s: SizerSet) => {
    if (!(await askConfirm(`${s.code} leaves the list; its loans stay on record.`, { title: `Switch ${s.code} off?`, yes: 'Switch it off', danger: true }))) return;
    api.sizerSetDeactivate(s.id, s.version).then(load, (e: Error) => setOffError(e.message));
  };
  const shown = filterSets(board.sets, search, status);
  const count = (s: SizerSet['status']) => board.sets.filter((x) => x.status === s).length;
  const done = () => (setDialog(null), load());
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Sizer sets</h1>
        {canSets && <Button tone="primary" onClick={() => setDialog({ kind: 'set', set: null })}>+ New sizer set</Button>}
      </div>
      {offError && <Notice>{offError}</Notice>}
      {board.overdue.length > 0 && (
        <Notice tone="warning">
          Overdue: {board.overdue.map((s) => `${s.code} with ${s.holder!.customerName} (${dueWords(s.holder!.expectedReturnDate, board.today)})`).join('; ')}.
        </Notice>
      )}
      <p className="text-sm"><b>{count('in shop')}</b> in the shop · <b>{count('lent')}</b> lent out · <b>{count('lost or damaged')}</b> lost or damaged</p>
      <div className={searchRowClass}>
        <input aria-label="Search sets" placeholder="Search code, garment, size or borrower" className={`${inputClass} ${searchClass}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Status" className={`${inputClass} max-w-44`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">Every status</option>
          {(Object.keys(STATUS_WORDS) as SizerSet['status'][]).map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
        </select>
      </div>
      {shown.length === 0 ? <p className="text-slate-500">{board.sets.length === 0 ? 'No sizer set is on file yet.' : 'No set matches.'}</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Set</th><th>Sizes in it</th><th>Status</th><th>Who has it</th><th /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className={`border-t border-slate-100 ${s.holder && s.holder.daysOverdue > 0 ? 'border-l-4 border-l-red-500' : ''}`}>
                <td className="py-1 pl-1"><b>{s.code}</b> <span className="text-slate-500">{s.garmentType}</span></td>
                <td className="py-1">{s.sizesIncluded}</td>
                <td className="py-1"><span className={chip(s.status)}>{STATUS_WORDS[s.status]}</span></td>
                <td className="py-1">{s.holder ? <>{s.holder.customerName}<span className="block text-xs text-slate-500">out {s.holder.dateOut} · due {s.holder.expectedReturnDate} · {dueWords(s.holder.expectedReturnDate, board.today)}</span></> : '—'}</td>
                <td className="py-1 text-right">
                  {canEdit && s.status === 'in shop' && <Button onClick={() => setDialog({ kind: 'lend', set: s })}>Lend</Button>}
                  {canEdit && s.status === 'lent' && s.holder && <Button onClick={() => setDialog({ kind: 'back', set: s })}>Take back</Button>}
                  {canSets && <button type="button" className="ml-2 text-xs text-indigo-700 hover:underline" onClick={() => setDialog({ kind: 'set', set: s })}>Change</button>}
                  {canSets && s.status !== 'lent' && <button type="button" className="ml-2 text-xs text-red-700 hover:underline" onClick={() => void switchOff(s)}>Switch off</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Panel title="Returned">
        {board.returned.length === 0 ? <p className="text-sm text-slate-500">Nothing has been returned yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Set</th><th>Borrower</th><th>Out</th><th>Due</th><th>Back</th><th>Condition</th></tr></thead>
            <tbody>
              {board.returned.map((r) => (
                <tr key={r.loanId} className="border-t border-slate-100">
                  <td className="py-1"><b>{r.setCode}</b> <span className="text-slate-500">{r.garmentType}</span></td><td className="py-1">{r.customerName}</td>
                  <td className="py-1">{r.dateOut}</td><td className="py-1">{r.expectedReturnDate}</td>
                  <td className={`py-1 ${r.returnedDate > r.expectedReturnDate ? 'text-red-800' : ''}`}>{r.returnedDate}</td><td className="py-1">{r.conditionOnReturn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {dialog?.kind === 'set' && <SetForm set={dialog.set} garments={garments} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'lend' && <Lend set={dialog.set} today={board.today} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'back' && <TakeBack set={dialog.set} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
