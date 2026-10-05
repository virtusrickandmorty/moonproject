/**
 * The purchases-side tax registers (PLAN E12): the purchases register (input VAT) and the EWT register, for a range of
 * dates (this quarter so far when the screen opens), with totals, the check against the ledger and a download for
 * Excel. The server reads every row from the ledger and the posting document; a cancel is its own negative row on the
 * day it was cancelled.
 */
import { api, taxRegisterPath, type Me } from '../../api.ts';
import { Notice, Panel, Pager } from '../../components/ui.tsx';
import { Excel, RangeForm, RegisterTable, pesos, supplierColumns, useRangeReport } from './ReportParts.tsx';
import { atcToConfirmWords, atcWords, classTotals, classWords, ewtClassWords, ledgerWarnings, quarterSoFar, rateWords } from './reports.ts';

export function PurchasesRegister({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useRangeReport(allowed, quarterSoFar, api.purchasesRegister);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const d = r.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Purchases register</h1>
      <p className="text-sm text-slate-600">
        Every purchase with input VAT, from the books: amount before VAT, input VAT and total, with the supplier's invoice number and TIN, and the class the
        2550Q and the SLP ask for.
      </p>
      <RangeForm r={r} />
      {r.error && <Notice>{r.error}</Notice>}
      {d && (
        <Panel title={`${d.from} to ${d.to}`}>
          {ledgerWarnings([['VAT', 'input VAT', d.totals.vatCents, d.glVatCents]]).map((w) => <Notice key={w}>{w}</Notice>)}
          <table className="text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="pr-3">By class</th><th className="pl-3 text-right">Amount before VAT</th><th className="pl-3 text-right">Input VAT</th><th className="pl-3 text-right">Total</th></tr>
            </thead>
            <tbody>
              {classTotals(d.byClass).map(([label, t]) => (
                <tr key={label} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{label}</td>
                  {[t.netCents, t.vatCents, t.totalCents].map((c, i) => <td key={i} className="whitespace-nowrap py-1 pl-3 text-right tabular-nums">{pesos(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <RegisterTable rows={d.rows} lead={[{ head: 'Supplier invoice', cell: (x) => x.supplierInvoiceNo ?? '—' }, ...supplierColumns]} columns={[
            { head: 'Class', cell: (x) => classWords(x.purchaseClass) },
            { head: 'Amount before VAT', amount: true, cell: (x) => pesos(x.netCents), total: pesos(d.totals.netCents) },
            { head: 'Input VAT', amount: true, cell: (x) => pesos(x.vatCents), total: pesos(d.totals.vatCents) },
            { head: 'Total', amount: true, cell: (x) => pesos(x.totalCents), total: pesos(d.totals.totalCents) },
          ]} />
          <Pager page={d.page} onOffset={r.goto} />
          <Excel url={taxRegisterPath('purchases', d.from, d.to)} />
        </Panel>
      )}
    </div>
  );
}

export function EwtRegister({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useRangeReport(allowed, quarterSoFar, api.ewtRegister);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const d = r.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tax withheld from suppliers (EWT register)</h1>
      <p className="text-sm text-slate-600">Tax Virtus withheld from suppliers (expanded withholding tax), from the books: the EWT class, its ATC, the base, the rate and the EWT.</p>
      <RangeForm r={r} />
      {r.error && <Notice>{r.error}</Notice>}
      {d && (
        <Panel title={`${d.from} to ${d.to}`}>
          {ledgerWarnings([['EWT', 'EWT payable', d.totals.ewtCents, d.glEwtCents]]).map((w) => <Notice key={w}>{w}</Notice>)}
          <p className="text-sm">{atcToConfirmWords(d.atcToConfirmCount)}</p>
          <RegisterTable rows={d.rows} lead={supplierColumns} columns={[
            { head: 'EWT class', cell: (x) => ewtClassWords(x.ewtClass) },
            { head: 'Tax code (ATC)', cell: (x) => atcWords(x) },
            { head: 'Base', amount: true, cell: (x) => (x.baseCents === null ? '—' : pesos(x.baseCents)), total: pesos(d.totals.baseCents) },
            { head: 'Rate', amount: true, cell: (x) => rateWords(x.rateBp) },
            { head: 'EWT', amount: true, cell: (x) => pesos(x.ewtCents), total: pesos(d.totals.ewtCents) },
          ]} />
          <Pager page={d.page} onOffset={r.goto} />
          <Excel url={taxRegisterPath('ewt', d.from, d.to)} />
        </Panel>
      )}
    </div>
  );
}
