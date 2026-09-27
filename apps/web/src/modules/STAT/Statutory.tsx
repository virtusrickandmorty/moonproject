/**
 * Government remittances (PLAN E11, F4, D5 STAT-REM): the remittance check of recent months, and one month's SSS,
 * PhilHealth and Pag-IBIG lists and 1601-C worksheet, printable. Every figure comes from the server (recorded payrolls
 * and the ledger). Government IDs show only for users with emp.view_ids.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type DocDetail, type Me, type SchemeCheck, type StatMonth } from '../../api.ts';
import { Button, Notice, Panel, peso } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { checkWords } from './stat.ts';

const newRemittance = (c: SchemeCheck, month: string) => docPath('stat.remittance', `/new?scheme=${c.scheme}&month=${month}${c.balanceCents > 0 ? `&amount=${(c.balanceCents / 100).toFixed(2)}` : ''}`);

/** The remittance check: per scheme, what the payrolls recorded, what was remitted and what is left, with D6 flags. */
function Check({ month, check, canRecord }: { month: string; check: SchemeCheck[]; canRecord: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500"><tr><th>For {month}</th><th className="text-right">Payrolls recorded</th><th className="text-right">Remitted</th><th className="text-right">Left</th><th /></tr></thead>
      <tbody>
        {check.map((c) => {
          const w = checkWords(c);
          return (
            <tr key={c.scheme} className="border-t border-slate-100 align-top">
              <td className="py-1">
                {c.label}
                {c.remittances.map((r) => <Link key={r.id} to={docPath('stat.remittance', `/${r.id}`)} className="ml-2 text-xs underline">{r.number}</Link>)}
                {c.cancelledAfter.length > 0 && <p className="text-xs text-amber-800">Cancelled after it was remitted: {c.cancelledAfter.map((r) => r.number).join(', ')}.</p>}
                {c.overRemitted.length > 0 && <p className="text-xs text-amber-800">Remitted more than the payrolls show for {c.overRemitted.map((o) => `${o.name} (${peso(o.cents)})`).join(', ')}. Redo the payroll or tell the accountant.</p>}
              </td>
              <td className="text-right tabular-nums">{peso(c.recordedCents)}</td>
              <td className="text-right tabular-nums">{peso(c.remittedCents)}</td>
              <td className={`text-right tabular-nums ${w.tone === 'warning' ? 'text-amber-800' : ''}`}>{peso(c.balanceCents)}</td>
              <td className="pl-2 text-right print:hidden">{canRecord && c.balanceCents > 0 && <Link to={newRemittance(c, month)} className="underline">Record payment</Link>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Recent months with payrolls or remittances, each with its remittance check. */
export function StatMonths({ me }: { me: Me }) {
  const [months, setMonths] = useState<{ month: string; check: SchemeCheck[] }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.statMonths().then(setMonths, (e: Error) => setError(e.message)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!months) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Government remittances</h1>
      <p className="text-sm text-slate-600">What each month's payrolls owe SSS, PhilHealth, Pag-IBIG and the BIR (1601-C), what was paid, and what is left.</p>
      {months.length === 0 && <p className="text-slate-500">No payroll is recorded yet.</p>}
      {months.map((m) => (
        <Panel key={m.month} title={m.month}>
          <Check month={m.month} check={m.check} canRecord={me.permissions.includes('stat.rem.post')} />
          <Link to={`/stat/${m.month}`} className="text-sm underline">Lists and 1601-C worksheet for {m.month}</Link>
        </Panel>
      ))}
    </div>
  );
}

const Table = ({ head, rows, foot }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[] }) => (
  <table className="w-full text-sm">
    <thead className="text-left text-slate-500"><tr>{head.map((h, i) => <th key={i} className={i > 1 ? 'text-right' : ''}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className={j > 1 ? 'text-right tabular-nums' : 'py-1'}>{c}</td>)}</tr>)}</tbody>
    {foot && <tfoot><tr className="border-t border-slate-300 font-semibold">{foot.map((c, j) => <td key={j} className={j > 1 ? 'text-right tabular-nums' : 'py-1'}>{c}</td>)}</tr></tfoot>}
  </table>
);

/** One month: the check, the three contribution lists and the 1601-C worksheet. */
export function StatMonthPage({ me, params }: { me: Me; params?: Record<string, string> }) {
  const month = params?.month ?? '';
  const [m, setM] = useState<StatMonth | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.statMonth(month).then(setM, (e: Error) => setError(e.message)), [month]);
  if (error) return <Notice>{error}</Notice>;
  if (!m) return <p className="text-slate-500">Loading…</p>;
  const who = (r: { name: string; code: string; idNo: string | null }) => [`${r.name} (${r.code})`, r.idNo ?? '—'];
  const t = m.tax;
  const items: [string, string, number][] = [
    ['14', 'Total amount of compensation', t.totalCompensationCents],
    ['15', 'Statutory minimum wage (minimum wage earners)', t.mweBasicCents],
    ['16', 'Holiday pay, overtime, night differential, hazard pay (minimum wage earners)', t.mwePremiumCents],
    ['17', '13th month pay and other benefits', t.thirteenthMonthCents],
    ['18', 'De minimis benefits', t.deMinimisCents],
    ['19', 'SSS, PhilHealth and Pag-IBIG contributions (employee share)', t.eeSharesCents],
    ['20', 'Other non-taxable compensation', t.otherNonTaxableCents],
    ['21', 'Total non-taxable compensation', t.nonTaxableCents],
    ['22', 'Total taxable compensation', t.taxableCents],
    ['25', 'Total taxes withheld', t.taxWithheldCents],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Government remittances {m.month}</h1>
        <Button tone="primary" onClick={() => window.print()}>Print</Button>
        <Link to="/stat" className="underline">All months</Link>
      </div>
      <Panel title="Remittance check">
        <Check month={m.month} check={m.check} canRecord={me.permissions.includes('stat.rem.post')} />
        {m.notDeducted.length > 0 && (
          <Notice tone="warning">
            Employee shares the pay could not cover, not deducted by the month's last payroll: {m.notDeducted.map((n) => `${n.name} ${peso(n.cents)}`).join(', ')}. They are still owed to the agencies; the accountant decides who bears them.
          </Notice>
        )}
      </Panel>
      <Panel title={`SSS contributions list ${m.month}`}>
        <Table head={['Employee', 'SSS no.', 'MSC', 'of which MPF', 'Employee share', 'Employer share', 'EC', 'Total']}
          rows={m.sss.rows.map((r) => [...who(r), peso(r.mscCents), peso(r.mpfMscCents), peso(r.eeCents), peso(r.erCents), peso(r.ecCents), peso(r.totalCents)])}
          foot={['Total', '', '', '', '', '', '', peso(m.sss.totalCents)]} />
      </Panel>
      <Panel title={`PhilHealth list ${m.month}`}>
        <Table head={['Employee', 'PhilHealth PIN', 'Monthly basis', 'Employee share', 'Employer share', 'Total']}
          rows={m.phic.rows.map((r) => [...who(r), peso(r.basisCents), peso(r.eeCents), peso(r.erCents), peso(r.totalCents)])} foot={['Total', '', '', '', '', peso(m.phic.totalCents)]} />
      </Panel>
      <Panel title={`Pag-IBIG list ${m.month}`}>
        <Table head={['Employee', 'Pag-IBIG MID', 'Compensation', 'Employee share', 'Employer share', 'Total']}
          rows={m.hdmf.rows.map((r) => [...who(r), peso(r.compensationCents), peso(r.eeCents), peso(r.erCents), peso(r.totalCents)])} foot={['Total', '', '', '', '', peso(m.hdmf.totalCents)]} />
      </Panel>
      <Panel title={`1601-C worksheet ${m.month}`}>
        <p className="text-sm text-slate-600">{t.employees} {t.employees === 1 ? 'employee' : 'employees'} paid. Item numbers follow BIR Form 1601-C (January 2018).</p>
        <table className="w-full text-sm">
          <tbody>{items.map(([n, label, c]) => <tr key={n} className="border-t border-slate-100"><td className="w-10 py-1 text-slate-500">{n}</td><td>{label}</td><td className="text-right tabular-nums">{peso(c)}</td></tr>)}</tbody>
        </table>
        <p className="text-xs text-slate-600">Item 23 (taxable pay not subject to tax, ₱250,000 a year and below) is for the accountant: {peso(t.noTaxWithheldCents)} of this month's taxable pay had no tax withheld. 13th month pay and de minimis benefits are not paid through payroll yet.</p>
        <Table head={['Employee', 'TIN', 'Compensation', 'Non-taxable', 'Taxable', 'Tax withheld']}
          rows={t.rows.map((r) => [`${r.name} (${r.code})${r.isMwe ? ' · MWE' : ''}`, r.idNo ?? '—', peso(r.grossCents), peso(r.nonTaxableCents), peso(r.taxableCents), peso(r.taxCents)])} />
      </Panel>
    </div>
  );
}

/** A remittance's view: what it cleared for each employee against what was payable. */
export const remittanceView: ViewParts = {
  noEdit: true,
  extra: (d: DocDetail) => {
    const r = d.doc as { month: string; label: string; payableCents: number; lines: { employeeId: string; name: string; payableCents: number; amountCents: number }[] } | undefined;
    if (!r) return null;
    return (
      <div className="space-y-1 pt-2 text-sm">
        <p>{r.label} for <Link to={`/stat/${r.month}`} className="underline">{r.month}</Link>: {peso(r.payableCents)} was payable when this was recorded.</p>
        {r.lines.map((l) => <div key={l.employeeId} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{peso(l.amountCents)} of {peso(l.payableCents)}</span></div>)}
      </div>
    );
  },
};
