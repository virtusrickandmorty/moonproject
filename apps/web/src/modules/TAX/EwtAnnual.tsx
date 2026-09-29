/**
 * The 1604-E data (PLAN D8 "Yearly", E12): the annual information return of expanded withholding. The alphalist, per
 * payee and ATC, with the EWT of each quarter and the year; and its tie-out to the four quarters: the QAP, the 1601-EQ
 * worksheet, the EWT register and the books, with what each quarter's 0619-E and 1601-EQ paid and what is left.
 * Read-only; downloads for Excel. Opens on last year, or the year in its link.
 */
import { api, taxYearPath, type Me } from '../../api.ts';
import { Notice, Panel } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { useYearReport, YearPicker } from './AnnualIncomeTax.tsx';
import { WorksheetChecks } from './QuarterReports.tsx';
import { Excel, pesos } from './ReportParts.tsx';
import { atcWords, rateWords } from './reports.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';

export function EwtAnnualReturnPage({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useYearReport(allowed, api.ewtAnnualReturn);
  if (!allowed) return <Notice>You cannot view the 1604-E data.</Notice>;
  const w = r.data;
  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">1604-E (annual EWT)</h1>
      <p className="text-sm text-slate-600">
        The expanded withholding tax of the year per payee and ATC (the alphalist), built from the four quarters' QAP, and how it ties to each 1601-EQ, the EWT
        register and the books.
      </p>
      <YearPicker today={r.today} year={r.year} setYear={r.setYear} />
      {r.error && <Notice>{r.error}</Notice>}
      {!w && !r.error && r.year !== null && <p className="text-slate-500">Loading…</p>}
      {w && (
        <>
          <Panel title={`Alphalist of payees, ${w.year}`}>
            <p className="text-sm">File the 1604-E by <strong>{w.returnDue}</strong>.</p>
            <WorksheetChecks checks={w.checks} />
            {w.alphalist.length === 0 ? <p className="text-sm text-slate-500">No tax was withheld in {w.year}.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr><th className="pr-3">TIN</th><th className="pr-3">Registered name</th><th className="pr-3">ATC</th><th className="pl-3 text-right">Rate</th>
                      {[1, 2, 3, 4].map((q) => <th key={q} className="pl-3 text-right">Q{q}</th>)}<th className="pl-3 text-right">Base</th><th className="pl-3 text-right">EWT withheld</th></tr>
                  </thead>
                  <tbody>
                    {w.alphalist.map((p, i) => (
                      <tr key={`${p.supplierId}:${p.atc ?? p.ewtClass}:${i}`} className="border-t border-slate-100 align-top">
                        <td className="py-1 pr-3">{p.tin ?? '—'}</td>
                        <td className="py-1 pr-3">{p.registeredName || '—'}</td>
                        <td className="py-1 pr-3">{!p.atc && !p.ewtClass ? 'To classify' : atcWords(p)}</td>
                        <td className={num}>{rateWords(p.rateBp)}</td>
                        {p.quarters.map((c, q) => <td key={q} className={num}>{pesos(c)}</td>)}
                        <td className={num}>{pesos(p.baseCents)}</td>
                        <td className={num}>{pesos(p.ewtCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-slate-300 font-semibold"><td className="py-1" colSpan={8}>Total</td><td className={num}>{pesos(w.totals.baseCents)}</td><td className={num}>{pesos(w.totals.ewtCents)}</td></tr></tfoot>
                </table>
              </div>
            )}
            <Excel url={taxYearPath('1604e', w.year)} />
          </Panel>
          <Panel title="Tie-out to the quarters">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr><th className="pr-3">Quarter</th><th className="pl-3 text-right">QAP</th><th className="pl-3 text-right">1601-EQ</th><th className="pl-3 text-right">EWT register</th><th className="pl-3 text-right">Books</th>
                    <th className="pl-3">Tied</th><th className="pl-3 text-right">Paid (0619-E)</th><th className="pl-3 text-right">Paid (1601-EQ)</th><th className="pl-3 text-right">Left to pay</th></tr>
                </thead>
                <tbody>
                  {w.quarters.map((q) => (
                    <tr key={q.quarter} className="border-t border-slate-100">
                      <td className="py-1 pr-3"><Link to={`/tax/1601eq?${new URLSearchParams({ year: String(w.year), quarter: String(q.quarter) })}`} className="underline">Q{q.quarter}</Link></td>
                      <td className={num}>{pesos(q.qapCents)}</td><td className={num}>{pesos(q.worksheetCents)}</td><td className={num}>{pesos(q.registerCents)}</td><td className={num}>{pesos(q.glCents)}</td>
                      <td className="py-1 pl-3">{q.tied ? 'Yes' : 'No'}</td>
                      <td className={num}>{pesos(q.remittedCents)}</td><td className={num}>{pesos(q.paidCents)}</td><td className={num}>{pesos(q.leftCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-300 font-semibold">
                    <td className="py-1">{w.year}</td><td className={num}>{pesos(w.quartersCents)}</td><td /><td className={num}>{pesos(w.registerCents)}</td><td className={num}>{pesos(w.glCents)}</td>
                    <td className="py-1 pl-3">{w.tied ? 'Yes' : 'No'}</td><td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
