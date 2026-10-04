/**
 * The 0619-E and 1601-EQ worksheets (PLAN E12, D5 EWT-REM): the EWT of a month or a quarter by ATC, from the EWT
 * register; the BIR payments already made for it; and what is left, with a link that opens the BIR payment form on the
 * return and period. The 1601-EQ takes off the 0619-E payments of months 1 and 2 and adds the QAP. Read-only; both
 * download for Excel. They open on the period in their link, else on the one whose return is due now.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, ewtMonthPath, taxQuarterPath, type BirForm, type BirPaymentLine, type DocTypeInfo, type EwtAtcLine, type EwtMonthWorksheet, type Me } from '../../api.ts';
import { Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { WorksheetChecks } from './QuarterReports.tsx';
import { Excel, QuarterForm, pesos, useQuarterReport } from './ReportParts.tsx';
import { birPaymentPath, ewtMonthChoices, ewtMonthDefault, monthFromQuery, openingReckoning, quarterFromQuery } from './bir.ts';
import { atcWords, ewtClassWords, quarterTitle, rateWords, returnQuarter, yearChoices } from './reports.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';
/** EWT from a journal voucher has neither an ATC nor a class: the accountant puts it under its ATC on the return. */
const toClassify = (l: { atc: string | null; ewtClass: string | null }) => !l.atc && !l.ewtClass;

/** The EWT of the period per ATC, and its total. */
function AtcTable({ atcs, totals, what }: { atcs: EwtAtcLine[]; totals: { baseCents: number; ewtCents: number }; what: string }) {
  if (atcs.length === 0) return <p className="text-sm text-slate-500">No tax was withheld in {what}.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500"><tr><th className="pr-3">Tax code (ATC)</th><th className="pr-3">EWT class</th><th className="pl-3 text-right">Base</th><th className="pl-3 text-right">EWT</th></tr></thead>
      <tbody>
        {atcs.map((l) => (
          <tr key={l.atc ?? l.ewtClass ?? '~'} className="border-t border-slate-100 align-top">
            <td className="py-1 pr-3">{toClassify(l) ? 'To classify' : atcWords(l)}</td>
            <td className="py-1 pr-3">{ewtClassWords(l.ewtClass)}</td>
            <td className={num}>{pesos(l.baseCents)}</td>
            <td className={num}>{pesos(l.ewtCents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr className="border-t border-slate-300 font-semibold"><td className="py-1" colSpan={2}>Total tax withheld from supplier (EWT)</td><td className={num}>{pesos(totals.baseCents)}</td><td className={num}>{pesos(totals.ewtCents)}</td></tr></tfoot>
    </table>
  );
}

/** Rows of [what, amount]: each payment linked to its BIRP-, the bottom line in bold. */
type Row = { label: ReactNode; cents: number; strong?: boolean };
export const paymentRow = (lead: string, p: BirPaymentLine): Row => ({
  label: <>{lead} <Link to={docPath('tax.bir_payment', `/${p.id}`)} className="underline">{p.number}</Link> on {p.date} ({p.reference})</>, cents: -p.amountCents,
});
export function Reckoning({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={`border-t border-slate-100 ${r.strong ? 'font-semibold' : ''}`}><td className="py-1 pr-3">{r.label}</td><td className={num}>{pesos(r.cents)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Record BIR payment" on the return and period, for someone who may record one. */
export function RecordLink({ docTypes, form, period }: { docTypes: DocTypeInfo[]; form: BirForm; period: string }) {
  if (!docTypes.some((d) => d.key === 'tax.bir_payment' && d.canCreate)) return null;
  return <p><Link to={birPaymentPath(form, period)} className="inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Record BIR payment</Link></p>;
}

export function EwtMonthReturn({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const [today, setToday] = useState('');
  const [month, setMonth] = useState('');
  const [w, setW] = useState<EwtMonthWorksheet | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (allowed) api.health().then((h) => {
      const t = h.serverTime.slice(0, 10);
      setToday(t);
      setMonth(monthFromQuery(location.search) ?? ewtMonthDefault(t));
    }, (e: Error) => setError(e.message));
  }, [allowed]);
  useEffect(() => {
    if (!month) return;
    let current = true; // only the last answer is shown
    setW(null);
    setError('');
    api.ewtMonthWorksheet(month).then((d) => current && setW(d), (e: Error) => current && setError(e.message));
    return () => void (current = false);
  }, [month]);
  if (!allowed) return <Notice>You cannot view the 0619-E worksheet.</Notice>;
  const [year, part] = [month.slice(0, 4), String(Number(month.slice(5, 7)))];
  const pick = (y: string, m: string) => setMonth(`${y}-${m.padStart(2, '0')}`);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">0619-E (monthly EWT)</h1>
      <p className="text-sm text-slate-600">
        The expanded withholding tax of the first or second month of a quarter, by ATC, from the tax withheld from suppliers register (EWT register). The third month has no 0619-E: its EWT goes on the 1601-EQ.
      </p>
      {month && (
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <Field label="Year">
            <select className={inputClass} value={year} onChange={(e) => pick(e.target.value, part)}>
              {[...new Set([Number(year), ...yearChoices(today)])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Month">
            <select className={inputClass} value={part} onChange={(e) => pick(year, e.target.value)}>
              {ewtMonthChoices.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {!w && !error && month && <p className="text-slate-500">Loading…</p>}
      {w && (
        <Panel title={w.label}>
          <p className="text-sm">File and pay the 0619-E by <strong>{w.returnDue}</strong>.</p>
          <WorksheetChecks checks={w.checks} />
          <RecordLink docTypes={docTypes} form="0619-E" period={w.month} />
          <AtcTable atcs={w.atcs} totals={w.totals} what={w.label} />
          <Reckoning rows={[
            ...openingReckoning(w),
            { label: 'Due with the 0619-E', cents: w.dueCents },
            ...w.payments.map((p) => paymentRow('Paid with', p)),
            { label: 'Left to pay', cents: w.leftCents, strong: true },
          ]} />
          <Excel url={ewtMonthPath(w.month)} />
        </Panel>
      )}
    </div>
  );
}

export function EwtQuarterReturn({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const q = useQuarterReport(allowed, (t) => quarterFromQuery(location.search) ?? returnQuarter(t), api.ewtQuarterWorksheet);
  if (!allowed) return <Notice>You cannot view the 1601-EQ worksheet.</Notice>;
  const w = q.data;
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">1601-EQ (quarterly EWT)</h1>
      <p className="text-sm text-slate-600">
        The expanded withholding tax of the quarter by ATC, less what the 0619-E of its first two months paid, and the QAP: each payee with the tax withheld from them.
      </p>
      <QuarterForm q={q} />
      {q.error && <Notice>{q.error}</Notice>}
      {!w && !q.error && q.pick && <p className="text-slate-500">Loading…</p>}
      {w && (
        <>
          <Panel title={quarterTitle(w.year, w.quarter, q.today)}>
            <p className="text-sm">File and pay the 1601-EQ by <strong>{w.returnDue}</strong>.</p>
            <WorksheetChecks checks={w.checks} />
            <RecordLink docTypes={docTypes} form="1601-EQ" period={w.period} />
            <AtcTable atcs={w.atcs} totals={w.totals} what="the quarter" />
            <Reckoning rows={[
              { label: 'Tax withheld from supplier (EWT) in the quarter', cents: w.totals.ewtCents },
              ...openingReckoning(w),
              ...w.remittances.flatMap((r) => (r.payments.length ? r.payments.map((p) => paymentRow(`Less the 0619-E for ${r.label}:`, p)) : [{ label: `Less the 0619-E for ${r.label}: none recorded`, cents: 0 }])),
              { label: 'Due with the 1601-EQ', cents: w.dueCents, strong: true },
              ...w.payments.map((p) => paymentRow('Paid with', p)),
              { label: 'Left to pay', cents: w.leftCents, strong: true },
            ]} />
            <Excel url={taxQuarterPath('1601eq', w.year, w.quarter)} />
          </Panel>
          <Panel title="QAP">
            {w.qap.length === 0 ? <p className="text-sm text-slate-500">No payee had tax withheld in this quarter.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500"><tr><th className="pr-3">TIN</th><th className="pr-3">Registered name</th><th className="pr-3">Tax code (ATC)</th><th className="pl-3 text-right">Base</th><th className="pl-3 text-right">Rate</th><th className="pl-3 text-right">Tax withheld from supplier (EWT)</th></tr></thead>
                  <tbody>
                    {w.qap.map((l, i) => (
                      <tr key={`${l.supplierId}:${l.atc ?? l.ewtClass}:${i}`} className="border-t border-slate-100 align-top">
                        <td className="py-1 pr-3">{l.tin ?? '—'}</td>
                        <td className="py-1 pr-3">{l.registeredName || '—'}</td>
                        <td className="py-1 pr-3">{toClassify(l) ? 'To classify' : atcWords(l)}</td>
                        <td className={num}>{pesos(l.baseCents)}</td>
                        <td className={num}>{rateWords(l.rateBp)}</td>
                        <td className={num}>{pesos(l.ewtCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-slate-300 font-semibold"><td className="py-1" colSpan={3}>Total</td><td className={num}>{pesos(w.totals.baseCents)}</td><td /><td className={num}>{pesos(w.totals.ewtCents)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
