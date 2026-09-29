/**
 * Government remittances (PLAN E11, F4, D5 STAT-REM): the remittance check of recent months, and one month's SSS,
 * PhilHealth and Pag-IBIG lists and 1601-C worksheet, printable. Every figure comes from the server (recorded payrolls
 * and the ledger). Government IDs show only for users with emp.view_ids. The withholding tax is net of year-end tax
 * refunds (K23): the check says what was refunded and where the refunds are taken off, and the 1601-C worksheet shows
 * them on their own line.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type DocDetail, type EmployerNumberRow, type Me, type SchemeCheck, type StatMonth, type UploadScheme } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { ViewParts } from '../../generic/DocView.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { UPLOAD_LIST, canDownloadUploads, checkWords } from './stat.ts';

const newRemittance = (c: SchemeCheck, month: string) => docPath('stat.remittance', `/new?scheme=${c.scheme}&month=${month}${c.dueCents > 0 ? `&amount=${(c.dueCents / 100).toFixed(2)}` : ''}`);

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
                {c.remittances.map((r) => <Link key={r.id} to={docPath('stat.remittance', `/${r.id}`)} className="ml-2 text-xs underline">{r.number}{r.month ? ` (with ${r.month})` : ''}</Link>)}
                {(c.refundCents > 0 || c.carriedInCents > 0) && (
                  <p className="text-xs text-slate-600">
                    {c.refundCents > 0 && `Year-end tax refunds of ${peso(c.refundCents)} are taken off the tax withheld. `}
                    {w.text}.
                  </p>
                )}
                {c.cancelledAfter.length > 0 && <p className="text-xs text-amber-800">Cancelled after it was remitted: {c.cancelledAfter.map((r) => r.number).join(', ')}.</p>}
                {c.overRemitted.length > 0 && <p className="text-xs text-amber-800">Remitted more than the payrolls show for {c.overRemitted.map((o) => `${o.name}${o.part === 'loan' ? ' (loan)' : ''} (${peso(o.cents)})`).join(', ')}. Redo the payroll or tell the accountant.</p>}
              </td>
              <td className="text-right tabular-nums">{peso(c.recordedCents)}{c.loanRecordedCents > 0 && <p className="text-xs text-slate-500">of which loans {peso(c.loanRecordedCents)}</p>}</td>
              <td className="text-right tabular-nums">{peso(c.remittedCents)}</td>
              <td className={`text-right tabular-nums ${w.tone === 'warning' ? 'text-amber-800' : ''}`}>{peso(c.balanceCents)}</td>
              <td className="pl-2 text-right print:hidden">{canRecord && c.dueCents > 0 && <Link to={newRemittance(c, month)} className="underline">Record payment</Link>}</td>
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
      <Link to="/stat/exposure" className="text-sm underline">Statutory exposure: months paid with no contribution recorded</Link>
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

/** Hands a downloaded file to the browser to save. Nothing is kept in the browser. */
function saveFile(f: { filename: string; blob: Blob }) {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * The month's upload files for the agencies' websites, from the same figures as the lists above. A file is refused in
 * plain words when the employer's number is not set or an employee has no ID number. The accountant checks each column
 * against the agency's current template before the first upload.
 */
function UploadFiles({ me, m }: { me: Me; m: StatMonth }) {
  const [numbers, setNumbers] = useState<EmployerNumberRow[]>([]);
  const [typed, setTyped] = useState<Partial<Record<UploadScheme, string>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const step = useStepUpAction('saving the employer number');
  const load = () => api.statEmployerNumbers().then(setNumbers, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  const lists = { SSS: m.sss, PHIC: m.phic, HDMF: m.hdmf };
  const download = async (scheme: UploadScheme) => {
    setBusy(scheme);
    setError('');
    try { saveFile(await api.statUpload(m.month, scheme)); } catch (e) { setError((e as Error).message); }
    setBusy('');
  };
  const save = (scheme: UploadScheme) => step.run(async () => {
    await api.setEmployerNumber(scheme, (typed[scheme] ?? '').trim());
    setTyped((t) => ({ ...t, [scheme]: undefined }));
    await load();
  });
  return (
    <Panel title={`Files for the agencies ${m.month}`}>
      <p className="text-sm text-slate-600">One file for each agency, with the same employees and totals as the lists above. Upload it on the agency's website. Check the columns against the agency's current template first; loan amortizations are not in these files.</p>
      {error && <Notice>{error}</Notice>}
      {step.error && <Notice>{step.error}</Notice>}
      <table className="w-full text-sm">
        <tbody>
          {UPLOAD_LIST.map((u) => {
            const list = lists[u.scheme];
            const n = numbers.find((x) => x.scheme === u.scheme);
            return (
              <tr key={u.scheme} className="border-t border-slate-100 align-top">
                <td className="py-2">
                  <p className="font-medium">{u.label}</p>
                  <p className="text-xs text-slate-600">{u.layout}: {list.rows.length} {list.rows.length === 1 ? 'employee' : 'employees'}, {peso(list.totalCents)}</p>
                </td>
                <td className="py-2">
                  {n?.number ? <p className="text-xs text-slate-600">{n.employerLabel}: {n.number}</p> : <p className="text-xs text-amber-800">{n?.employerLabel ?? 'Employer number'} not set.</p>}
                  {me.permissions.includes('stat.agency.manage') && (
                    <form className="mt-1 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save(u.scheme); }}>
                      <Field label={n?.number ? 'Change the number' : 'Type the number'}><input className={inputClass} value={typed[u.scheme] ?? ''} onChange={(e) => setTyped((t) => ({ ...t, [u.scheme]: e.target.value }))} /></Field>
                      <Button type="submit" disabled={!(typed[u.scheme] ?? '').trim() || step.busy}>Save</Button>
                    </form>
                  )}
                </td>
                <td className="py-2 text-right"><Button tone="primary" disabled={list.rows.length === 0 || busy !== ''} onClick={() => void download(u.scheme)}>Download {u.label} file</Button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {step.dialog}
    </Panel>
  );
}

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
    ['25', 'Total taxes withheld (before year-end tax refunds)', t.taxWithheldCents],
    ...(t.yearEndRefundCents > 0 ? [['26', 'Less: year-end tax refunds to employees (adjustment)', -t.yearEndRefundCents] as [string, string, number]] : []),
    ...(t.refundCarriedInCents > 0 ? [['26', `Less: year-end tax refunds carried from ${t.refundCarriedFrom.join(', ')} (adjustment)`, -t.refundCarriedInCents] as [string, string, number]] : []),
    ...(t.yearEndRefundCents > 0 || t.refundCarriedInCents > 0 ? [['27', 'Taxes withheld for remittance', t.taxToRemitCents] as [string, string, number]] : []),
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
      {canDownloadUploads(me.permissions) && <div className="print:hidden"><UploadFiles me={me} m={m} /></div>}
      {([['SSS', 'SSS no.', m.sssLoans], ['Pag-IBIG', 'Pag-IBIG MID', m.hdmfLoans]] as const).map(([agency, idLabel, list]) => list.rows.length > 0 && (
        <Panel key={agency} title={`${agency} loan amortizations ${m.month}`}>
          <p className="text-sm text-slate-600">Deducted by the month's payrolls; paid on the same {agency} remittance as the contributions.</p>
          <Table head={['Employee', idLabel, 'Loan', 'Loan number', 'Amount']} rows={list.rows.map((r) => [...who(r), r.kindLabel, r.loanNo, peso(r.totalCents)])} foot={['Total', '', '', '', peso(list.totalCents)]} />
        </Panel>
      ))}
      <Panel title={`1601-C worksheet ${m.month}`}>
        <p className="text-sm text-slate-600">{t.employees} {t.employees === 1 ? 'employee' : 'employees'} paid. Item numbers follow BIR Form 1601-C (January 2018).</p>
        <table className="w-full text-sm">
          <tbody>{items.map(([n, label, c]) => <tr key={n} className="border-t border-slate-100"><td className="w-10 py-1 text-slate-500">{n}</td><td>{label}</td><td className="text-right tabular-nums">{peso(c)}</td></tr>)}</tbody>
        </table>
        {t.refundCarriedOutCents > 0 && <p className="text-xs text-slate-600">The year-end tax refunds are {peso(t.refundCarriedOutCents)} more than this month's tax: nothing is left to remit, and the rest comes off next month's 1601-C (item 26).</p>}
        <p className="text-xs text-slate-600">Item 23 (taxable pay not subject to tax, ₱250,000 a year and below) is for the accountant: {peso(t.noTaxWithheldCents)} of this month's taxable pay had no tax withheld. Item 17 is the tax-free part of the 13th-month pays dated this month; de minimis benefits are not paid through payroll yet.</p>
        <Table head={['Employee', 'TIN', 'Compensation', 'Non-taxable', 'Taxable', 'Tax withheld', ...(t.yearEndRefundCents > 0 ? ['Year-end tax refund'] : [])]}
          rows={t.rows.map((r) => [
            `${r.name} (${r.code})${r.isMwe ? ' · MWE' : ''}`, r.idNo ?? '—', peso(r.grossCents), peso(r.nonTaxableCents), peso(r.taxableCents), peso(r.taxCents),
            ...(t.yearEndRefundCents > 0 ? [r.refundCents ? peso(r.refundCents) : '—'] : []),
          ])} />
      </Panel>
    </div>
  );
}

/** A remittance's view: what it cleared for each employee against what was payable, and any penalty paid with it. */
export const remittanceView: ViewParts = {
  noEdit: true,
  extra: (d: DocDetail) => {
    const r = d.doc as
      | {
          month: string; label: string; payableCents: number; penaltyCents?: number; lines: { employeeId: string; name: string; payableCents: number; amountCents: number; loanAmountCents?: number }[];
          adjustments?: { month: string; employeeId: string; name: string; debitCents: number; creditCents: number }[];
        }
      | undefined;
    if (!r) return null;
    return (
      <div className="space-y-1 pt-2 text-sm">
        <p>{r.label} for <Link to={`/stat/${r.month}`} className="underline">{r.month}</Link>: {peso(r.payableCents)} was payable when this was recorded.</p>
        {r.lines.map((l) => <div key={l.employeeId} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{peso(l.amountCents)} of {peso(l.payableCents)}{l.loanAmountCents ? ` (loans ${peso(l.loanAmountCents)})` : ''}</span></div>)}
        {(r.adjustments ?? []).map((a) => (
          <div key={`${a.month}|${a.employeeId}|${a.creditCents > 0}`} className="flex justify-between">
            <span>{a.name}: {a.creditCents > 0 ? `year-end tax refund ${a.month}, taken off` : `tax withheld ${a.month}`}</span>
            <span className="tabular-nums">{a.creditCents > 0 ? `− ${peso(a.creditCents)}` : peso(a.debitCents)}</span>
          </div>
        ))}
        {r.penaltyCents ? <div className="flex justify-between"><span>Late-payment penalty</span><span className="tabular-nums">{peso(r.penaltyCents)}</span></div> : null}
      </div>
    );
  },
};
