/**
 * TPL stock value form (the owner's request, 22 Oct 2026): at a month end the accountant values the pieces held for the
 * TPL clients at cost. Every item with pieces on hand on the date is listed with its quantity (from the stock itself);
 * the accountant types each one's cost per piece (materials and labor; the last value's cost is offered). The server's
 * preview gives the books' balance and the adjustment. Also the Edit of a recorded value (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos, isBusinessDate, parsePesos } from '@moonproject/shared';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Me, type Preview } from '../../api.ts';
import { Link, navigate } from '../../router.tsx';
import { Loading, Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { EditGate, Errors, Figures, useLive } from '../COL/parts.tsx';

interface SheetItem { itemId: string; customerName: string; description: string; size: string; qty: number; lastCostCents: number | null }
type Stored = { lines: { itemId: string; unitCostCents: number }[]; note?: string };
type Figured = { valuedCents: number; ledgerCents: number; adjustmentCents: number };

/** The last day of a date's month, and the month end before a date (both YYYY-MM-DD, no clock). */
const monthEndOf = (d: string) => { const [y, m] = d.split('-').map(Number) as [number, number]; return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const previousMonthEnd = (d: string) => { const [y, m] = d.split('-').map(Number) as [number, number]; const e = new Date(Date.UTC(y, m - 1, 0)); return `${e.getUTCFullYear()}-${String(e.getUTCMonth() + 1).padStart(2, '0')}-${String(e.getUTCDate()).padStart(2, '0')}`; };

export function TplValueForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const [today, setToday] = useState('');
  const [date, setDate] = useState('');
  const [sheet, setSheet] = useState<SheetItem[] | null>(null);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);
  const modeKey = mode.kind === 'edit' ? mode.id : '';

  useEffect(() => {
    api.health().then((h) => {
      const t = h.serverTime.slice(0, 10); // the server's Manila date
      setToday(t);
      setDate((d) => d || (mayBackdate && monthEndOf(t) !== t ? previousMonthEnd(t) : t));
    }, fail);
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      const input = d.input as Stored;
      setOriginal(d.header);
      if (mayBackdate) setDate(d.header.businessDate);
      setNote(input.note ?? '');
      setCosts(Object.fromEntries(input.lines.map((l) => [l.itemId, formatPesos(l.unitCostCents)])));
    }, fail);
  }, [type.key, modeKey]);

  useEffect(() => {
    setSheet(null);
    if (!isBusinessDate(date)) return;
    api.tplValueSheet<{ items: SheetItem[] }>(date).then((r) => {
      setSheet(r.items);
      // The last value's cost is offered where nothing is typed yet.
      setCosts((old) => ({ ...Object.fromEntries(r.items.filter((i) => i.lastCostCents !== null).map((i) => [i.itemId, formatPesos(i.lastCostCents!)])), ...old }));
    }, fail);
  }, [date]);

  const lines = (sheet ?? []).map((s) => ({ s, cents: costs[s.itemId]?.trim() ? parsePesos(costs[s.itemId]!) : undefined }));
  const errors = [
    ...(isBusinessDate(date) ? [] : ['Pick the value date, like 2026-10-31.']),
    ...lines.filter((l) => l.cents === undefined || l.cents === null || Number.isNaN(l.cents) || l.cents < 0).map((l) => `Type the cost per piece of ${l.s.customerName}'s ${l.s.description}${l.s.size ? ` (${l.s.size})` : ''}.`),
  ];
  const input = { lines: lines.map((l) => ({ itemId: l.s.itemId, unitCostCents: Number(l.cents ?? 0) })), ...(note.trim() ? { note: note.trim() } : {}) };
  const valued = lines.reduce((n, l) => n + l.s.qty * Number(l.cents ?? 0), 0);
  const businessDate = mayBackdate ? date : undefined;
  const offMonthEnd = !mayBackdate && !!today && monthEndOf(today) !== today;
  const live = useLive(JSON.stringify([input, businessDate]), !!sheet && sheet.length > 0 && errors.length === 0 && !offMonthEnd, () => api.preview(type.key, input, businessDate));
  const figured = live?.doc as Figured | undefined;

  const openConfirm = () => {
    setTouched(true);
    if (sheet && errors.length === 0) api.preview(type.key, input, businessDate).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original
        ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key, businessDate)
        : await api.post(type.key, input, confirm!.totalCents, key, businessDate);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input, businessDate));
      throw e;
    }
  };

  if (original && !reason) return <EditGate original={original} typeKey={type.key} onReason={setReason} />;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : `New ${type.title}`}</h1>
        {original && <Notice tone="info">{original.number} will be cancelled when you record its replacement. Reason: {reason}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Panel title="Which month end?">
          <p className="text-sm text-slate-600">
            The pieces you hold for TPL clients are still yours until delivered, so at a month end they go on the books at cost.
            The quantities come from the clients' stock on that day.
          </p>
          {mayBackdate ? (
            <Field label="Value date" required hint="The last day of the month"><input type="date" className={inputClass} value={date} disabled={!!original} onChange={(e) => setDate(e.target.value)} /></Field>
          ) : (
            <Field label="Value date"><p className="py-2 text-sm">{date || '…'}</p></Field>
          )}
          {offMonthEnd && <Notice tone="info">TPL stock is valued at a month end and today is not one. The accountant records it dated {previousMonthEnd(today)}.</Notice>}
        </Panel>
        <Panel title="Cost per piece">
          <p className="text-sm text-slate-600">
            Materials plus labor for one piece. The <Link to="/rpt/job-margin" className="text-indigo-700 underline">Job margin</Link> report shows each client's labor per piece.
          </p>
          {!sheet && isBusinessDate(date) && <Loading label="Loading the clients' stock…" />}
          {sheet?.length === 0 && <Notice tone="info">No TPL pieces are on hand on {date}.</Notice>}
          {sheet && sheet.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th>Client</th><th>Item</th><th className="text-right">On hand</th><th className="w-36">Cost per piece</th><th className="text-right">Value</th></tr></thead>
                <tbody>
                  {lines.map(({ s, cents }) => (
                    <tr key={s.itemId} className="border-t border-slate-100">
                      <td className="py-1">{s.customerName}</td>
                      <td>{s.description}{s.size ? ` (${s.size})` : ''}</td>
                      <td className="text-right tabular-nums">{s.qty}</td>
                      <td><input aria-label={`Cost per piece of ${s.customerName}'s ${s.description}${s.size ? ` ${s.size}` : ''}`} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`}
                        value={costs[s.itemId] ?? ''} onChange={(e) => setCosts((c) => ({ ...c, [s.itemId]: e.target.value }))} /></td>
                      <td className="text-right tabular-nums">{cents !== undefined && cents !== null && !Number.isNaN(cents) ? peso(s.qty * cents) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Errors list={errors} show={touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost || !sheet?.length} onClick={openConfirm}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <Figures items={[
          ['Value at cost', valued],
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
