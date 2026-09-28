/**
 * The tax registers (PLAN E12): the sales register and the 2307s received, for a range of dates (this quarter so far
 * when the screen opens), with totals, the check against the ledger and a download for Excel. The server reads every
 * row from the ledger; a cancel is its own negative row on the day it was cancelled.
 */
import { api, taxRegisterPath, type Me } from '../../api.ts';
import { Notice, Panel } from '../../components/ui.tsx';
import { Excel, RangeForm, RegisterTable, customerColumns, pesos, useRangeReport } from './ReportParts.tsx';
import { certificateWords, ledgerWarnings, pendingWords, quarterSoFar } from './reports.ts';

export function SalesRegister({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useRangeReport(allowed, quarterSoFar, api.salesRegister);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const d = r.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Sales register</h1>
      <p className="text-sm text-slate-600">Every sale with output VAT, from the books: VATable sales, VAT and total, with the booklet number and the buyer's TIN.</p>
      <RangeForm r={r} />
      {r.error && <Notice>{r.error}</Notice>}
      {d && (
        <Panel title={`${d.from} to ${d.to}`}>
          {ledgerWarnings([['VAT', 'output VAT', d.totals.vatCents, d.glVatCents]]).map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
          <RegisterTable rows={d.rows} lead={customerColumns} columns={[
            { head: 'VATable sales', amount: true, cell: (x) => pesos(x.netCents), total: pesos(d.totals.netCents) },
            { head: 'VAT', amount: true, cell: (x) => pesos(x.vatCents), total: pesos(d.totals.vatCents) },
            { head: 'Total', amount: true, cell: (x) => pesos(x.totalCents), total: pesos(d.totals.totalCents) },
          ]} />
          <Excel url={taxRegisterPath('sales', d.from, d.to)} />
        </Panel>
      )}
    </div>
  );
}

export function WithholdingReceived({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useRangeReport(allowed, quarterSoFar, api.withholdingReceived);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const d = r.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">2307s received</h1>
      <p className="text-sm text-slate-600">Tax withheld by customers (CWT) and VAT withheld by government buyers, with each 2307's ATC and whether it is in hand.</p>
      <RangeForm r={r} />
      {r.error && <Notice>{r.error}</Notice>}
      {d && (
        <Panel title={`${d.from} to ${d.to}`}>
          {ledgerWarnings([
            ['CWT', 'creditable withholding tax', d.totals.cwtCents, d.glCwtCents],
            ['VAT withheld', 'VAT withheld', d.totals.vatWithheldCents, d.glVatWithheldCents],
          ]).map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
          <p className="text-sm">{pendingWords(d.pendingCount)}</p>
          <RegisterTable rows={d.rows} lead={customerColumns} columns={[
            { head: 'ATC', cell: (x) => x.atc ?? '—' },
            { head: '2307', cell: (x) => certificateWords(x.certificate) },
            { head: 'CWT', amount: true, cell: (x) => pesos(x.cwtCents), total: pesos(d.totals.cwtCents) },
            { head: 'VAT withheld', amount: true, cell: (x) => pesos(x.vatWithheldCents), total: pesos(d.totals.vatWithheldCents) },
          ]} />
          <Excel url={taxRegisterPath('withholding-received', d.from, d.to)} />
        </Panel>
      )}
    </div>
  );
}
