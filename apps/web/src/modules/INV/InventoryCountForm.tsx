/**
 * Inventory count form (PLAN E9, D5 INV-COUNT): pick the category and the count date (a month end; someone who may
 * backdate picks it, everyone else counts on the day), every active supply of the category is listed with its unit and
 * latest purchase cost, and the counter types the quantities (and a changed cost with its reason). The live total is
 * worked out here; the books' balance and the adjustment come from the server's preview. Also the Edit of a recorded
 * count (cancel + reissue on the same count date, NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Me, type Preview, type SheetSupply } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Loading, Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { EditGate, Errors, Figures, useLive } from '../COL/parts.tsx';
import { CATEGORY_LABEL, costChanged, countLines, countSheetCsvUrl, defaultCountDate, emptyRow, formatQty, lineValue, monthEndOf, parseQty, type Category, type CountLineInput, type Typed } from './count.ts';

type Stored = { category: Category; lines: CountLineInput[]; note?: string };
type StoredDoc = { lines: { supplyId: string; unit: string }[] };
type Figured = { countedCents: number; ledgerCents: number; adjustmentCents: number };
const MILLI = ['yard', 'meter', 'kg'];

export function InventoryCountForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const [today, setToday] = useState('');
  const [category, setCategory] = useState<Category>('materials');
  const [date, setDate] = useState('');
  const [sheet, setSheet] = useState<SheetSupply[] | null>(null);
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const fail = (e: Error) => setError(e.message);
  const modeKey = mode.kind === 'edit' ? mode.id : mode.draftId ?? '';

  useEffect(() => {
    api.health().then((h) => {
      const t = h.serverTime.slice(0, 10); // the server's Manila date
      setToday(t);
      setDate((d) => d || (mayBackdate ? defaultCountDate(t) : t));
    }, fail);
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      const input = d.input as Stored;
      const units = new Map((d.doc as StoredDoc).lines.map((l) => [l.supplyId, l.unit]));
      setOriginal(d.header);
      setCategory(input.category);
      if (mayBackdate) setDate(d.header.businessDate); // the replacement keeps the count date; everyone else can only edit on the day
      setNote(input.note ?? '');
      setTyped(Object.fromEntries(input.lines.map((l) => [l.supplyId, {
        qty: formatQty(l.qty, MILLI.includes(units.get(l.supplyId) ?? '')), cost: l.unitCostCents === undefined ? '' : formatPesos(l.unitCostCents), reason: l.costReason ?? '',
      }])));
    }, fail);
    else if (mode.draftId) api.drafts(type.key).then((all) => {
      const found = all.find((d) => d.id === mode.draftId);
      if (!found) return setError('That draft was already recorded or discarded.');
      const { category: c = 'materials', date: dt = '', note: n = '', typed: t = '{}' } = found.payload.values ?? {};
      setDraft({ id: found.id, version: found.version });
      setCategory(c as Category);
      if (dt && mayBackdate) setDate(dt);
      setNote(n);
      try { setTyped(JSON.parse(t) as Record<string, Typed>); } catch { setTyped({}); }
    }, fail);
  }, [type.key, modeKey]);

  useEffect(() => {
    setSheet(null);
    if (isBusinessDate(date)) api.countSheet(category, date).then((r) => setSheet(r.supplies), fail);
  }, [category, date]);

  const count = countLines(sheet ?? [], typed);
  const errors = [
    ...(isBusinessDate(date) ? [] : ['Pick the count date, like 2026-09-30.']),
    ...count.errors,
    ...(note.trim().length > 500 ? ['Keep the note within 500 characters.'] : []),
  ];
  const businessDate = mayBackdate ? date : undefined; // everyone else counts on the day
  const input = { category, lines: count.lines, ...(note.trim() ? { note: note.trim() } : {}) };
  // Off a month end, someone who may not backdate is told so in the notice above and saves a draft; the server's "not a month end" needs no second telling.
  const offMonthEnd = !mayBackdate && !!today && monthEndOf(today) !== today;
  const live = useLive(JSON.stringify([input, businessDate]), !!sheet && errors.length === 0 && count.lines.length > 0 && !offMonthEnd, () => api.preview(type.key, input, businessDate));
  const figured = live?.doc as Figured | undefined;
  const leftOut = sheet ? Object.keys(typed).filter((id) => typed[id]!.qty.trim() && !sheet.some((s) => s.supplyId === id)).length : 0;

  const openConfirm = () => {
    setTouched(true);
    if (sheet && errors.length === 0) api.preview(type.key, input, businessDate).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original
        ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key, businessDate)
        : await api.post(type.key, input, confirm!.totalCents, key, businessDate);
      if (draft) await api.discardDraft(draft.id).catch(() => undefined);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input, businessDate));
      throw e;
    }
  };
  const saveDraft = async () => {
    setError('');
    try {
      const values = { category, date, note, typed: JSON.stringify(typed) };
      setDraft(draft ? await api.saveDraft(draft.id, draft.version, { values }) : await api.createDraft(type.key, { values }));
      setMessage('Draft saved. It has no number and records nothing until the count is recorded.');
    } catch (e) { fail(e as Error); }
  };
  const set = (id: string, patch: Partial<Typed>) => setTyped((old) => ({ ...old, [id]: { ...(old[id] ?? emptyRow), ...patch } }));

  if (original && !reason) return <EditGate original={original} typeKey={type.key} onReason={setReason} />;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : `New ${type.title}`}</h1>
        {original && <Notice tone="info">{original.number} will be cancelled when you record its replacement. Reason: {reason}</Notice>}
        {error && <Notice>{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        <Panel title="What is counted, and on which day?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" required>
              <select className={inputClass} value={category} disabled={!!original} onChange={(e) => (setCategory(e.target.value as Category), setTyped({}))}>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </Field>
            {mayBackdate ? (
              <Field label="Count date" required hint="The last day of the month counted">
                <input type="date" className={inputClass} value={date} disabled={!!original} onChange={(e) => setDate(e.target.value)} />
              </Field>
            ) : (
              <Field label="Count date"><p className="py-2 text-sm">{date || '…'}</p></Field>
            )}
          </div>
          {!type.canPost && !offMonthEnd && <Notice tone="info">The accountant or an owner records the count. Save it as a draft for them.</Notice>}
          {offMonthEnd && (
            <Notice tone="info">Inventory is counted at a month end and today is not one. Save the count as a draft; the accountant records it dated {defaultCountDate(today)}.</Notice>
          )}
          {isBusinessDate(date) && <a className="text-sm underline" href={countSheetCsvUrl(category, date)} download>Print the count sheet (CSV)</a>}
        </Panel>
        <Panel title="Quantities counted">
          {!sheet && <Loading label="Loading the supplies…" />}
          {sheet?.length === 0 && <Notice tone="info">No active supply is in this category.</Notice>}
          {leftOut > 0 && <Notice tone="warning">{leftOut === 1 ? '1 supply of the recorded count is' : `${leftOut} supplies of the recorded count are`} no longer active and left out.</Notice>}
          {sheet && sheet.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th>Supply</th><th>Unit</th><th className="w-32">Quantity</th><th className="w-36">Cost per unit</th><th className="text-right">Value</th></tr></thead>
                <tbody>
                  {sheet.map((s) => {
                    const t = typed[s.supplyId] ?? emptyRow;
                    const qty = t.qty.trim() ? parseQty(t.qty, s.milliUnits) : undefined;
                    const line = count.lines.find((l) => l.supplyId === s.supplyId);
                    const cost = line?.unitCostCents ?? s.defaultCostCents;
                    return [
                      <tr key={s.supplyId} className="border-t border-slate-100">
                        <td className="py-1">{s.name}<div className="text-xs text-slate-500">{s.costSourceNumber ? `Latest cost from ${s.costSourceNumber}` : 'Cost from the supplies list'}</div></td>
                        <td>{s.unit}</td>
                        <td><input aria-label={`${s.name} quantity in ${s.unit}`} inputMode={s.milliUnits ? 'decimal' : 'numeric'} placeholder={s.milliUnits ? '0.000' : '0'} className={`${inputClass} text-right tabular-nums`} value={t.qty} onChange={(e) => set(s.supplyId, { qty: e.target.value })} /></td>
                        <td><input aria-label={`${s.name} cost per ${s.unit}`} inputMode="decimal" placeholder={formatPesos(s.defaultCostCents)} className={`${inputClass} text-right tabular-nums`} value={t.cost} onChange={(e) => set(s.supplyId, { cost: e.target.value })} /></td>
                        <td className="text-right tabular-nums">{qty !== undefined && line ? peso(lineValue(qty, cost, s.milliUnits)) : '—'}</td>
                      </tr>,
                      costChanged(t, s) && (
                        <tr key={`${s.supplyId}-why`}>
                          <td colSpan={5} className="pb-2"><input aria-label={`Why ${s.name} is not at ${formatPesos(s.defaultCostCents)}`} placeholder={`Why not the latest purchase cost of ${formatPesos(s.defaultCostCents)}?`} className={inputClass} value={t.reason} onChange={(e) => set(s.supplyId, { reason: e.target.value })} /></td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-slate-500">Leave a quantity empty when there is none on hand.</p>
        </Panel>
        <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Errors list={errors} show={touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>
          {mode.kind === 'new' && <Button onClick={saveDraft}>Save draft</Button>}
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <Figures items={[
          ['Counted value', count.totalCents],
          ...(figured ? [
            [`In the books on ${date}`, figured.ledgerCents] as [string, number],
            [figured.adjustmentCents < 0 ? 'Decrease' : 'Increase', Math.abs(figured.adjustmentCents), figured.adjustmentCents < 0 ? 'text-red-700' : undefined] as [string, number, string?],
          ] : []),
        ]} />
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
