/**
 * The quarter's tax reports (PLAN E12): the 2307s Virtus issues to suppliers, and the 2550Q worksheet with its checks
 * before filing. Both open on the quarter whose returns are due now (returnQuarter) and download for Excel. The server
 * reads every figure from the ledger, the same place as the VAT close, so the worksheet, the close and the books agree.
 */
import { Fragment } from 'react';
import { api, taxQuarterPath, type CertificatesToIssue as Certificates, type DocTypeInfo, type Me, type VatWorksheet as Worksheet } from '../../api.ts';
import { Notice, Panel } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { Excel, QuarterForm, pesos, useQuarterReport } from './ReportParts.tsx';
import { atcWords, checkTone, ewtClassWords, isWorksheetTotal, monthName, quarterTitle, returnQuarter, sortedChecks, worksheetCloseLink } from './reports.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';

/** One row per supplier and ATC: each month's base and EWT, and the quarter's. */
export function CertificateTable({ c }: { c: Certificates }) {
  if (c.lines.length === 0) return <p className="text-sm text-slate-500">No tax was withheld from a supplier in this quarter, so there is no 2307 to issue.</p>;
  const periods = [...c.months.map(monthName), 'Quarter'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            {['Supplier', 'TIN', 'ATC'].map((h) => <th key={h} rowSpan={2} className="pr-3 align-bottom">{h}</th>)}
            {periods.map((p) => <th key={p} colSpan={2} className="pl-3 text-center">{p}</th>)}
          </tr>
          <tr>{periods.map((p) => <Fragment key={p}><th className="pl-3 text-right">Base</th><th className="pl-3 text-right">EWT</th></Fragment>)}</tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={`${l.supplierId}:${l.atc ?? l.ewtClass}`} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-3">{l.supplierName || '—'}</td>
              <td className="py-1 pr-3">{l.tin ?? '—'}</td>
              <td className="py-1 pr-3">{atcWords(l)}<span className="block text-xs text-slate-500">{ewtClassWords(l.ewtClass)}</span></td>
              {l.months.map((m) => <Fragment key={m.month}><td className={num}>{pesos(m.baseCents)}</td><td className={num}>{pesos(m.ewtCents)}</td></Fragment>)}
              <td className={`${num} font-semibold`}>{pesos(l.baseCents)}</td>
              <td className={`${num} font-semibold`}>{pesos(l.ewtCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-300 font-semibold">
            <td className="py-1" colSpan={3 + 2 * c.months.length}>Total</td>
            <td className={num}>{pesos(c.totals.baseCents)}</td>
            <td className={num}>{pesos(c.totals.ewtCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function CertificatesToIssue({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const q = useQuarterReport(allowed, returnQuarter, api.certificatesToIssue);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const c = q.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">2307s to issue</h1>
      <p className="text-sm text-slate-600">
        The 2307 each supplier gets for the tax Virtus withheld from them: one per supplier and ATC, with each month's income payment (base) and tax withheld,
        from the EWT register.
      </p>
      <QuarterForm q={q} />
      {q.error && <Notice>{q.error}</Notice>}
      {!c && !q.error && q.pick && <p className="text-slate-500">Loading…</p>}
      {c && (
        <Panel title={quarterTitle(c.year, c.quarter, q.today)}>
          <CertificateTable c={c} />
          <Excel url={taxQuarterPath('2307-to-issue', c.year, c.quarter)} />
        </Panel>
      )}
    </div>
  );
}

/** The checks before filing, errors first: an error in red, a warning in amber, information in grey. */
export function WorksheetChecks({ checks }: { checks: Worksheet['checks'] }) {
  return <>{sortedChecks(checks).map((c) => <Notice key={c.code} tone={checkTone(c.level)}>{c.message}</Notice>)}</>;
}

/** Each item of the return: the amount of sales or purchases (blank where the form has none) and the tax; totals in bold. */
export function WorksheetTable({ lines }: { lines: Worksheet['lines'] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500"><tr><th className="pr-3">Item</th><th className="pl-3 text-right">Amount</th><th className="pl-3 text-right">Tax</th></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className={`border-t border-slate-100 align-top ${isWorksheetTotal(l.key) ? 'font-semibold' : ''}`}>
            <td className="py-1 pr-3">{l.label}</td>
            <td className={num}>{l.amountCents === null ? '' : pesos(l.amountCents)}</td>
            <td className={num}>{pesos(l.taxCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VatWorksheet({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const q = useQuarterReport(allowed, returnQuarter, api.vatWorksheet);
  if (!allowed) return <Notice>You cannot view the 2550Q worksheet.</Notice>;
  const w = q.data;
  const close = w && docTypes.some((d) => d.key === 'tax.vat_close' && d.canCreate) ? worksheetCloseLink(w) : null;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">2550Q worksheet</h1>
      <p className="text-sm text-slate-600">
        The items of the quarterly VAT return, from the books. They are named as on the return but carry no line numbers: check them against the form in use.
      </p>
      <QuarterForm q={q} />
      {q.error && <Notice>{q.error}</Notice>}
      {!w && !q.error && q.pick && <p className="text-slate-500">Loading…</p>}
      {w && (
        <Panel title={quarterTitle(w.year, w.quarter, q.today)}>
          <p className="text-sm">
            File the 2550Q by <strong>{w.returnDue}</strong>.{' '}
            {w.close
              ? <>Closed by <Link to={docPath('tax.vat_close', `/${w.close.documentId}`)} className="underline">{w.close.number}</Link> on {w.close.date}.</>
              : 'No VAT close is recorded for this quarter.'}
          </p>
          <WorksheetChecks checks={w.checks} />
          {close && <p><Link to={close} className="inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">Record the VAT close of Q{w.quarter} {w.year}</Link></p>}
          <WorksheetTable lines={w.lines} />
          <Excel url={taxQuarterPath('2550q', w.year, w.quarter)} />
        </Panel>
      )}
    </div>
  );
}
