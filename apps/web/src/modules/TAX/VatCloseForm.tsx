/**
 * VAT close form (PLAN D7 VAT-CLOSE, E13): pick the year and quarter, then read the server's preview of the close (its
 * figures, plain summary and checks) before anything is recorded. Opens on the quarter before today's, or the one
 * "VAT this quarter" linked from. Someone who may backdate (acc.backdate) dates it on the quarter's last day, or today.
 * Edit = cancel and close again with the ledger's figures now (NR-4).
 */
import { useEffect, useState } from 'react';
import type { DocTypeInfo, Me, Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, longDate, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { QUARTERS, closeDate, lastEndedQuarter, quarterRange, quarterTitle, vatBottomLine, vatLines, yearChoices, type Quarter, type VatFigures } from './reports.ts';

type Period = { year: number; quarter: Quarter };
type CloseDoc = VatFigures & { payableCents: number; carryForwardCents: number };

function fromQuery(): Period | null {
  const q = new URLSearchParams(location.search);
  const year = Number(q.get('year'));
  const quarter = Number(q.get('quarter'));
  return year >= 2000 && QUARTERS.includes(quarter as Quarter) ? { year, quarter: quarter as Quarter } : null;
}

export function VatCloseForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const today = useToday();
  const [pick, setPick] = useState<Period | null>(fromQuery);
  const [onLastDay, setOnLastDay] = useState(true);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const r = useRecord(type, mode, (d) => {
    const input = d.input as Period & { note?: string };
    setPick({ year: input.year, quarter: input.quarter });
    setNote(input.note ?? '');
    setOnLastDay(d.header.businessDate === quarterRange(input.year, input.quarter).to);
  });
  useEffect(() => void (today && mode.kind === 'new' && !pick && setPick(lastEndedQuarter(today))), [today]);

  const to = pick ? quarterRange(pick.year, pick.quarter).to : '';
  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const businessDate = closeDate(to, today, mayBackdate, onLastDay);
  const input = pick ? { ...pick, ...(note.trim() ? { note: note.trim() } : {}) } : null;
  const key = JSON.stringify([input, businessDate]);
  useEffect(() => {
    setPreview(null);
    if (!input || !today) return;
    let stale = false;
    const t = setTimeout(() => r.preview(input, businessDate).then((p) => stale || setPreview(p), (e: Error) => stale || r.fail(e)), 250);
    return () => ((stale = true), clearTimeout(t));
  }, [key, today]);

  if (r.gate) return r.gate;
  const doc = preview?.doc as CloseDoc | undefined;
  const set = (p: Partial<Period>) => pick && setPick({ ...pick, ...p });
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title('Close the VAT of a quarter')}</h1>
      {r.top}
      {pick && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Year">
            <select className={inputClass} value={pick.year} onChange={(e) => set({ year: Number(e.target.value) })}>
              {[...new Set([pick.year, ...yearChoices(today || `${pick.year}-01-01`)])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Quarter">
            <select className={inputClass} value={pick.quarter} onChange={(e) => set({ quarter: Number(e.target.value) as Quarter })}>
              {QUARTERS.map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </Field>
        </div>
      )}
      {pick && today > to && (mayBackdate
        ? (
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Date of the close</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={onLastDay} onChange={() => setOnLastDay(true)} /> {longDate(to)}, the quarter's last day</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!onLastDay} onChange={() => setOnLastDay(false)} /> Today, {longDate(today)}</label>
          </fieldset>
        )
        : <p className="text-sm text-slate-600">Dated today, {longDate(today)}.</p>)}
      {pick && (
        <Panel title={quarterTitle(pick.year, pick.quarter, today)}>
          {!preview && <p className="text-slate-500">Working out the close…</p>}
          {preview && (
            <>
              <p>{preview.summary}</p>
              {preview.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
              {doc && (
                <>
                  <table className="w-full text-sm">
                    <tbody>
                      {vatLines(doc).map(([label, cents, hint]) => (
                        <tr key={label} className="border-t border-slate-100 align-top">
                          <td className="py-1">{label}{hint && <span className="block text-xs text-amber-800">{hint}</span>}</td>
                          <td className="py-1 text-right tabular-nums">{peso(cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-slate-300 pt-2 text-lg font-semibold">{vatBottomLine(doc)}</p>
                </>
              )}
              <p className="text-sm text-slate-500">Nothing is recorded until you press Record.</p>
            </>
          )}
        </Panel>
      )}
      <Field label="Note" hint="Optional, e.g. the 2550Q reference"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost || !input} onClick={() => r.ask(input, [], businessDate)}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}
