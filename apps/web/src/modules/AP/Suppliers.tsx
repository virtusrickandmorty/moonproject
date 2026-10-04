/**
 * Payables by supplier (PLAN E9 "AP aging and supplier ledger"): who is owed on bills (2101) and who holds an advance
 * not yet applied or returned (1230), netted; and one supplier's page with its bills (advances applied, paid, still
 * owed), payments and advances (applied, returned, still open), with "Pay an advance", "Record a bill", "Pay bills" and
 * "Gives an advance back". Everything is read from the ledger on the server (NR-2).
 */
import { useEffect, useState } from 'react';
import { api, type ApBalance, type ApLedger, type DocTypeInfo } from '../../api.ts';
import { Notice, Panel, StatusChip, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';

const link = 'rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const num = 'py-1 text-right tabular-nums';

export function ApBalances() {
  const [rows, setRows] = useState<ApBalance[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.apBalances().then(setRows, (e: Error) => setError(e.message)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <p className="text-slate-500">Loading…</p>;
  const total = (k: 'balanceCents' | 'advancesCents' | 'netCents') => rows.reduce((s, r) => s + r[k], 0);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Payables by supplier</h1>
      {rows.length === 0 ? <p className="text-slate-500">Nothing is owed to a supplier and no advance is open.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Supplier</th><th className="text-right">Owed on bills</th><th className="text-right">Advances still open</th><th className="text-right">Net</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplierId} className="border-t border-slate-100">
                <td className="py-1"><Link to={`/ap/suppliers/${r.supplierId}`} className="underline">{r.supplierName}</Link></td>
                <td className={num}>{peso(r.balanceCents)}</td><td className={num}>{peso(r.advancesCents)}</td><td className={num}>{peso(r.netCents)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-1">Total</td><td className={num}>{peso(total('balanceCents'))}</td><td className={num}>{peso(total('advancesCents'))}</td><td className={num}>{peso(total('netCents'))}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="text-sm text-slate-500">Net is what would be left to pay if every open advance went on that supplier’s bills; a minus means the supplier holds more of Virtus’s money than it is owed.</p>
    </div>
  );
}

export function ApSupplierPage({ docTypes, params }: { docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [l, setL] = useState<ApLedger | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void api.apLedger(id).then(setL, (e: Error) => setError(e.message)), [id]);
  if (error) return <Notice>{error}</Notice>;
  if (!l) return <p className="text-slate-500">Loading…</p>;
  const may = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  const open = l.advances.filter((a) => a.status === 'posted' && a.openCents > 0);
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{l.supplierName}</h1>
      <p>Owed on bills <b className="tabular-nums">{peso(l.balanceCents)}</b> · advances still open <b className="tabular-nums">{peso(l.advancesCents)}</b></p>
      <div className="flex flex-wrap gap-2">
        {may('ap.advance') && <Link to={docPath('ap.advance', `/new?supplier=${id}`)} className={link}>Pay an advance</Link>}
        {may('ap.bill') && <Link to={docPath('ap.bill', '/new')} className={link}>Record a bill</Link>}
        {l.balanceCents > 0 && may('ap.payment') && <Link to={docPath('ap.payment', '/new')} className={link}>Pay bills</Link>}
        {open.length > 0 && may('ap.advance_return') && <Link to={docPath('ap.advance_return', `/new?supplier=${id}`)} className={link}>Gives an advance back</Link>}
      </div>
      <Panel title="Advances">
        {l.advances.length === 0 ? <p className="text-sm text-slate-500">No advances paid to this supplier.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Advance</th><th>Date</th><th className="text-right">Advance</th><th className="text-right">Tax withheld from supplier (EWT)</th><th className="text-right">On bills</th><th className="text-right">Given back</th><th className="text-right">Still open</th></tr></thead>
            <tbody>
              {l.advances.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-1">
                    <Link to={docPath('ap.advance', `/${a.id}`)} className="underline">{a.number}</Link>{a.purchaseOrderNumber ? ` · ${a.purchaseOrderNumber}` : ''} {a.status !== 'posted' && <StatusChip status={a.status} />}
                    {a.bills.length > 0 && <span className="block text-xs text-slate-500">{a.bills.map((b) => `${b.billNumber} ${peso(b.amountCents)}`).join(', ')}</span>}
                  </td>
                  <td className="py-1">{a.date}</td>
                  <td className={num}>{peso(a.amountCents)}</td><td className={num}>{peso(a.ewtCents)}</td><td className={num}>{peso(a.appliedCents)}</td><td className={num}>{peso(a.returnedCents)}</td>
                  <td className={num}>{peso(a.openCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm text-slate-500">A bill of this supplier takes its open advances, oldest first. Tax withheld from the supplier (EWT) on an advance stays with it, and the bill does not withhold it again.</p>
      </Panel>
      <Panel title="Bills">
        {l.bills.length === 0 ? <p className="text-sm text-slate-500">No bills.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Bill</th><th>Due</th><th className="text-right">Owed on it</th><th className="text-right">Advances</th><th className="text-right">Paid</th><th className="text-right">Still owed</th></tr></thead>
            <tbody>
              {l.bills.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="py-1"><Link to={docPath(b.docType ?? 'ap.bill', `/${b.id}`)} className="underline">{b.number}</Link> · invoice no. {b.supplierInvoiceNo} {b.status !== 'posted' && <StatusChip status={b.status} />}</td>
                  <td className="py-1">{b.dueDate}</td>
                  <td className={num}>{peso(b.payableCents)}</td><td className={num}>{peso(b.advanceCents ?? 0)}</td><td className={num}>{peso(b.paidCents ?? 0)}</td><td className={num}>{peso(b.owedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Payments">
        {(l.payments ?? []).length === 0 ? <p className="text-sm text-slate-500">No payments.</p> : (
          <table className="w-full text-sm">
            <tbody>
              {l.payments!.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1"><Link to={docPath('ap.payment', `/${p.id}`)} className="underline">{p.number}</Link> {p.status !== 'posted' && <StatusChip status={p.status} />}</td>
                  <td className="py-1">{p.date}</td><td className="py-1 text-slate-600">{p.bills.map((b) => b.billNumber).join(', ')}</td><td className={num}>{peso(p.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
