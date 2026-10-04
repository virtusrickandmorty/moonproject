/**
 * People & Payroll › 2316 and alphalist (PLAN F4, D8 "Yearly"): pick a year; per employee the 2316's totals, the year-end
 * adjustment and substituted filing, with a printable 2316 data sheet each, and the 1604-C alphalist (schedule 1 and
 * schedule 2) to download for the BIR data entry. Every figure is worked out by the server (year-end.ts).
 */
import { useEffect, useState } from 'react';
import { api, alphalistPath, type Data2316, type Me } from '../../api.ts';
import { Button, Notice, Panel, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { ITEMS_2316, yearsToPick } from './year-end.ts';

export function YearEndPage({ me }: { me: Me }) {
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState<Data2316[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.health().then((h) => {
      const ys = yearsToPick(h.serverTime);
      setYears(ys);
      setYear(ys[0]!);
    }, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!year) return;
    setRows(null);
    api.all2316(year).then(setRows, (e: Error) => setError(e.message));
  }, [year]);
  const ids = me.permissions.includes('emp.view_ids');
  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="text-2xl font-semibold">2316 and alphalist</h1>
      {error && <Notice>{error}</Notice>}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="text-sm">Year{' '}
          <select className="rounded border border-slate-300 px-2 py-1" value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {year && (
          <>
            <a href={`${alphalistPath(year)}&format=csv&schedule=1`} className="text-sm underline">1604-C schedule 1 (CSV)</a>
            <a href={`${alphalistPath(year)}&format=csv&schedule=2`} className="text-sm underline">1604-C schedule 2, minimum wage earners (CSV)</a>
          </>
        )}
      </div>
      {!ids && <Notice tone="info">Your role cannot view government numbers. Ask the owner to review your access in Roles and permissions.</Notice>}
      <Panel title={year ? `Employees paid in ${year}` : 'Employees'}>
        {!rows && <p className="text-sm text-slate-500">Loading…</p>}
        {rows?.length === 0 && <p className="text-sm text-slate-500">Nobody was paid in {year}.</p>}
        {rows && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th>Employee</th><th className="text-right">Gross</th><th className="text-right">Taxable (with previous employer)</th><th className="text-right">Tax due</th><th className="text-right">Tax withheld</th><th className="pl-3">Year-end adjustment</th><th>Substituted filing</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.employeeId} className="border-t border-slate-100 align-top">
                  <td className="py-1">{d.name} <span className="text-slate-500">{d.code}</span>{d.isMwe && <span className="block text-xs text-slate-500">Minimum wage earner (schedule 2)</span>}</td>
                  <td className="text-right tabular-nums">{peso(d.figures.i19GrossCents)}</td>
                  <td className="text-right tabular-nums">{peso(d.figures.i23GrossTaxableCents)}</td>
                  <td className="text-right tabular-nums">{peso(d.figures.i24TaxDueCents)}</td>
                  <td className={`text-right tabular-nums ${d.figures.i24TaxDueCents !== d.figures.i26WithheldCents ? 'font-semibold text-amber-700' : ''}`}>{peso(d.figures.i26WithheldCents)}</td>
                  <td className="pl-3 text-xs">
                    {d.yearEnd ? (
                      <Link to={docPath('pay.run', `/${d.yearEnd.id}`)} className="underline">
                        {d.yearEnd.number}: {d.yearEnd.refundCents ? `refund ${peso(d.yearEnd.refundCents)}` : `withheld ${peso(d.yearEnd.withheldCents)}`}
                      </Link>
                    ) : 'Not done yet'}
                  </td>
                  <td>{d.substitutedFiling ? 'Yes' : 'No'}</td>
                  <td className="text-right"><Link to={`/pay/2316/${d.year}/${d.employeeId}`} className="underline">2316</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pt-2 text-xs text-slate-500">
          Tax withheld in amber differs from the tax due: the year-end adjustment is not done yet, or the pay could not cover it. Substituted filing also needs the
          employee to have had no other income and one employer the whole year; ask them before ticking it on the 2316.
        </p>
      </Panel>
    </div>
  );
}

/** One employee's 2316 data sheet, printable: the figures to copy into BIR Form 2316, by item. */
export function Sheet2316({ params }: { me: Me; params?: Record<string, string> }) {
  const [d, setD] = useState<Data2316 | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.one2316(Number(params?.year), params?.employeeId ?? '').then(setD, (e: Error) => setError(e.message)), [params?.year, params?.employeeId]);
  if (error) return <Notice>{error}</Notice>;
  if (!d) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">2316 data {d.year}</h1>
        <Button tone="primary" onClick={() => window.print()}>Print</Button>
        <Link to="/pay/2316" className="underline">Back</Link>
      </div>
      <section className="space-y-2 rounded-lg bg-white p-4 text-sm ring-1 ring-slate-300">
        <h2 className="font-semibold">BIR Form 2316 data, {d.year}: figures to copy into the form</h2>
        <p>{d.name} <span className="text-slate-500">{d.code}</span> · TIN {d.tin ?? '(hidden)'} · employed {d.periodFrom} to {d.periodTo}{d.separatedOn ? ' (separated)' : ''}</p>
        {d.isMwe && d.smw && (
          <p>Minimum wage earner: statutory minimum wage {peso(d.smw.perDayCents)} a day, {peso(d.smw.perMonthCents)} a month ({d.smw.factor} days a year).</p>
        )}
        {d.previousEmployer && <p>Previous employer this year: {d.previousEmployer.name} · TIN {d.previousEmployer.tin ?? '(hidden)'}</p>}
        {ITEMS_2316.map(([part, items]) => (
          <table key={part} className="w-full">
            <thead><tr><th colSpan={3} className="pt-2 text-left">{part}</th></tr></thead>
            <tbody>
              {items.map(([no, label, key]) => (
                <tr key={no} className="border-t border-slate-100"><td className="w-10 text-slate-500">{no}</td><td>{label}</td><td className="text-right tabular-nums">{peso(d.figures[key])}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
        <p>
          Year-end adjustment: {d.yearEnd ? `${d.yearEnd.number}, ${d.yearEnd.refundCents ? `refunded ${peso(d.yearEnd.refundCents)}` : `withheld ${peso(d.yearEnd.withheldCents)}`}` : 'not done yet'}.
          {' '}Tax withheld January to November {peso(d.figures.withheldJanNovCents)}; in December {peso(d.figures.withheldDecemberCents)}; refunded {peso(d.figures.refundedCents)}.
        </p>
        <p>Qualifies for substituted filing: {d.substitutedFiling ? 'Yes, if the employee had no other income' : 'No'}.</p>
      </section>
    </div>
  );
}
