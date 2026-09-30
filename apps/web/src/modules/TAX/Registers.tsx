/**
 * The tax registers (PLAN E12): the sales register and the 2307s received, for a range of dates (this quarter so far
 * when the screen opens), with totals, the check against the ledger and a download for Excel. The server reads every
 * row from the ledger; a cancel is its own negative row on the day it was cancelled. A 2307 still to come, on a
 * collection or an opening withholding, is marked received here when it arrives.
 */
import { useState } from 'react';
import { api, taxRegisterPath, type Me, type WithholdingRegister } from '../../api.ts';
import { Button, Dialog, Notice, Panel, useAction, Pager } from '../../components/ui.tsx';
import { Excel, RangeForm, RegisterTable, customerColumns, pesos, useRangeReport } from './ReportParts.tsx';
import { canMarkReceived, certificateCell } from './opening.ts';
import { ledgerWarnings, pendingWords, quarterSoFar } from './reports.ts';

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
          <Pager page={d.page} onOffset={r.goto} />
          <Excel url={taxRegisterPath('sales', d.from, d.to)} />
        </Panel>
      )}
    </div>
  );
}

export function WithholdingReceived({ me }: { me: Me }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useRangeReport(allowed, quarterSoFar, api.withholdingReceived);
  const canMark = me.permissions.includes('tax.2307.receive');
  const act = useAction();
  const [asking, setAsking] = useState<WithholdingRegister['rows'][number] | null>(null);
  if (!allowed) return <Notice>You cannot view the tax registers.</Notice>;
  const d = r.data;
  const markReceived = (x: WithholdingRegister['rows'][number]) => act.run(() => api.mark2307Received(x.documentId!, x.lineNo).then(() => (setAsking(null), r.show())));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">2307s received</h1>
      <p className="text-sm text-slate-600">
        Tax withheld by customers (CWT) and VAT withheld by government buyers, with each 2307's ATC and whether it is in hand. Those from before the cut-over
        date say "opening", with the quarter they cover. Mark a pending 2307 received when it arrives: its VAT withheld is then claimed at the next VAT close.
      </p>
      <RangeForm r={r} />
      {r.error && <Notice>{r.error}</Notice>}
      {act.error && <Notice>{act.error}</Notice>}
      {d && (
        <Panel title={`${d.from} to ${d.to}`}>
          {ledgerWarnings([
            ['CWT', 'creditable withholding tax', d.totals.cwtCents, d.glCwtCents],
            ['VAT withheld', 'VAT withheld', d.totals.vatWithheldCents, d.glVatWithheldCents],
          ]).map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
          <p className="text-sm">{pendingWords(d.pendingCount)}</p>
          <RegisterTable rows={d.rows} lead={customerColumns} columns={[
            { head: 'ATC', cell: (x) => x.atc ?? '—' },
            {
              head: '2307',
              cell: (x) => (
                <span className="flex flex-wrap items-center gap-2">
                  {certificateCell(x)}
                  {canMark && canMarkReceived(x) && (
                    <Button className="print:hidden" disabled={act.busy} onClick={() => setAsking(x)}>Mark received</Button>
                  )}
                </span>
              ),
            },
            { head: 'CWT', amount: true, cell: (x) => pesos(x.cwtCents), total: pesos(d.totals.cwtCents) },
            { head: 'VAT withheld', amount: true, cell: (x) => pesos(x.vatWithheldCents), total: pesos(d.totals.vatWithheldCents) },
          ]} />
          <Pager page={d.page} onOffset={r.goto} />
          <Excel url={taxRegisterPath('withholding-received', d.from, d.to)} />
        </Panel>
      )}
      {asking && (
        <Dialog title="Mark the 2307 received" onClose={() => setAsking(null)}>
          <p className="text-sm">
            The 2307 of {asking.customerName} on {asking.documentNumber}{asking.opening ? `, row ${asking.lineNo}` : ''} is in hand from today. This cannot be undone: the next VAT
            close claims its VAT withheld.
          </p>
          <div className="flex gap-2">
            <Button tone="primary" disabled={act.busy} onClick={() => markReceived(asking)}>Mark received</Button>
            <Button onClick={() => setAsking(null)}>Back</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
