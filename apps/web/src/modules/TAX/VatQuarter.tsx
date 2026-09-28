/**
 * VAT of a quarter (PLAN E13 "VAT this quarter"): output VAT less input VAT, the VAT government buyers withheld and the
 * input VAT carried over, then what is payable with the 2550Q or carried over. Opens on today's quarter. The server reads
 * the ledger, so the figures are an estimate until the quarter's VAT close is recorded; then it names the close.
 */
import { useEffect, useState } from 'react';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { api, type Me, type VatSummary } from '../../api.ts';
import { Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { QUARTERS, quarterOf, quarterTitle, vatBottomLine, withheldPendingWords, yearChoices, type Quarter } from './reports.ts';

export function VatQuarter({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const [today, setToday] = useState('');
  const [pick, setPick] = useState<{ year: number; quarter: Quarter } | null>(null);
  const [v, setV] = useState<VatSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!allowed) return;
    api.health().then((h) => {
      const t = h.serverTime.slice(0, 10);
      setToday(t);
      setPick(quarterOf(t));
    }, (e: Error) => setError(e.message));
  }, [allowed]);
  useEffect(() => {
    if (!pick) return;
    let current = true;
    setV(null);
    setError('');
    api.vatSummary(pick.year, pick.quarter).then((s) => current && setV(s), (e: Error) => current && setError(e.message));
    return () => void (current = false);
  }, [pick]);
  if (!allowed) return <Notice>You cannot view the VAT of a quarter.</Notice>;
  const lines: [string, number, string | null][] = v
    ? [
      ['Output VAT on sales', v.outputVatCents, null],
      ['Less input VAT on purchases', v.inputVatCents, null],
      ['Less VAT withheld by government buyers', v.vatWithheldCents, withheldPendingWords(v.vatWithheldPendingCents)],
      ['Less input VAT carried over from earlier quarters', v.carryOverCents, null],
    ]
    : [];
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">VAT this quarter</h1>
      {pick && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Year">
            <select className={inputClass} value={pick.year} onChange={(e) => setPick({ ...pick, year: Number(e.target.value) })}>
              {yearChoices(today).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Quarter">
            <select className={inputClass} value={pick.quarter} onChange={(e) => setPick({ ...pick, quarter: Number(e.target.value) as Quarter })}>
              {QUARTERS.map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </Field>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {!v && !error && <p className="text-slate-500">Loading…</p>}
      {v && (
        <Panel title={quarterTitle(v.year, v.quarter, today)}>
          {v.close
            ? <Notice tone="info">Closed by <Link to={docPath('tax.vat_close', `/${v.close.documentId}`)} className="underline">{v.close.number}</Link> on {v.close.date}.</Notice>
            : <Notice tone="info">This is an estimate from the books until the quarter's VAT close is recorded.</Notice>}
          <table className="w-full text-sm">
            <tbody>
              {lines.map(([label, cents, note]) => (
                <tr key={label} className="border-t border-slate-100 align-top">
                  <td className="py-1">{label}{note && <span className="block text-xs text-amber-800">{note}</span>}</td>
                  <td className="py-1 text-right tabular-nums">{peso(cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-300 pt-2 text-lg font-semibold">{vatBottomLine(v)}</p>
        </Panel>
      )}
    </div>
  );
}
