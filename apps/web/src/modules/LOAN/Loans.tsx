/**
 * Loans (PLAN E10, H2): every loan with lender, principal, paid, left and the next due date, with a warning for what is
 * late; and one loan's page with its schedule, its payments and what is late. Balances come from the ledger on the
 * server (NR-2); "late" is an instalment past its due date that recorded payments do not fully cover, as of the server's date.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type DocTypeInfo, type LateInstalment, type LoanDetail, type LoanPayment, type LoanRow } from '../../api.ts';
import { Notice, Panel, StatusChip, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { KIND_WORDS, STATE_WORDS, lateCounts, leftCents, loanDocType, loanTotals, ratePercent, scheduleStates } from './register.ts';
import { Crumb } from '../../shell/crumbs.tsx';

const num = 'py-1 text-right tabular-nums';
const link = 'rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const lateChip = <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Late</span>;

function LateNotice({ late }: { late: LateInstalment[] }) {
  if (late.length === 0) return null;
  const total = late.reduce((s, l) => s + l.principalCents + l.interestCents, 0);
  return <Notice tone="warning">{late.length} instalment{late.length === 1 ? ' is' : 's are'} late, {peso(total)} in all. The oldest was due {late[0]!.dueDate} ({late[0]!.daysLate} day{late[0]!.daysLate === 1 ? '' : 's'} ago).</Notice>;
}

export function Loans({ docTypes }: { docTypes: DocTypeInfo[] }) {
  const [rows, setRows] = useState<LoanRow[] | null>(null);
  const [late, setLate] = useState<LateInstalment[]>([]);
  const [error, setError] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  useEffect(() => void Promise.all([api.loans(), api.loansLate()]).then(([r, l]) => (setRows(r), setLate(l)), (e: Error) => setError(e.message)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <p className="text-slate-500">Loading…</p>;
  const shown = rows.filter((r) => showCancelled || r.status === 'posted');
  const t = loanTotals(rows);
  const counts = lateCounts(late);
  const may = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">Loans</h1>
        {may('loan.loan') && <Link to={docPath('loan.loan', '/new')} className={link}>Record a loan</Link>}
        {may('loan.payment') && <Link to={docPath('loan.payment', '/new')} className={link}>Record a payment</Link>}
      </div>
      <LateNotice late={late} />
      <p className="text-sm"><b>{t.count}</b> loan{t.count === 1 ? '' : 's'} · borrowed <b className="tabular-nums">{peso(t.principalCents)}</b> · paid <b className="tabular-nums">{peso(t.paidCents)}</b> · left <b className="tabular-nums">{peso(t.leftCents)}</b></p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled loans</label>
      {shown.length === 0 ? <p className="text-slate-500">No loan is recorded yet.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Loan</th><th>Lender</th><th className="text-right">Principal</th><th className="text-right">Paid</th><th className="text-right">Left</th><th>Next due</th></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 ${counts.has(l.id) ? 'border-l-4 border-l-red-500' : ''} ${l.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="py-1 pl-1"><Link to={`/loan/loans/${l.id}`} className="underline">{l.number}</Link> {l.kind === 'equipment' && <span className="text-xs text-slate-500">equipment</span>}</td>
                <td className="py-1">{l.lender}</td>
                <td className={num}>{peso(l.principalCents)}</td><td className={num}>{peso(l.principalPaidCents ?? 0)}</td><td className={num}>{peso(leftCents(l))}</td>
                <td className="py-1">{l.nextDue ? <>{l.nextDue.dueDate} · {peso(l.nextDue.principalCents + l.nextDue.interestCents)}</> : l.status === 'cancelled' ? '' : l.balanceCents > 0 ? '—' : 'Paid off'} {counts.has(l.id) && lateChip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function LoanPage({ docTypes, params }: { docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [l, setL] = useState<LoanDetail | null>(null);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [late, setLate] = useState<LateInstalment[]>([]);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => void Promise.all([api.loan(id), api.loanPayments(id), api.loansLate(), api.health()]).then(
    ([x, p, all, h]) => (setL(x), setPayments(p), setLate(all.filter((z) => z.loanId === id)), setToday(h.serverTime.slice(0, 10)), setError('')), (e: Error) => setError(e.message)), [id]);
  useEffect(load, [load]);
  if (error) return <Notice>{error}</Notice>;
  if (!l) return <p className="text-slate-500">Loading…</p>;
  const may = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  const states = scheduleStates(l.schedule, today);
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Crumb label={l.lender} /><h1 className="text-2xl font-semibold">{l.lender}</h1>
        <Link to={docPath(loanDocType(l.number), `/${l.id}`)} className="underline">{l.number}</Link>
        {l.status !== 'posted' && <StatusChip status={l.status} />}
        <span className="flex-1" />
        <Link to="/loan/loans" className="text-sm underline">All loans</Link>
      </div>
      <p className="text-sm">{KIND_WORDS[l.kind]}{l.dateReceived && ` received ${l.dateReceived}`}{l.rateBp !== undefined && ` · ${ratePercent(l.rateBp)} a year`}{l.termMonths !== undefined && ` · ${l.termMonths} months`}{l.reference ? ` · ref. ${l.reference}` : ''}</p>
      <p>Principal <b className="tabular-nums">{peso(l.principalCents)}</b> · paid <b className="tabular-nums">{peso(l.principalPaidCents ?? 0)}</b> · left <b className="tabular-nums">{peso(leftCents(l))}</b>{l.interestPaidCents ? <> · interest paid <b className="tabular-nums">{peso(l.interestPaidCents)}</b></> : null}</p>
      {l.status === 'posted' && l.nextDue && may('loan.payment') && <div><Link to={docPath('loan.payment', `/new?loan=${l.id}`)} className={link}>Record the next payment</Link></div>}
      {late.length > 0 && (
        <Panel title="Late">
          <LateNotice late={late} />
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Instalment</th><th>Was due</th><th className="text-right">Days late</th><th className="text-right">Principal</th><th className="text-right">Interest</th></tr></thead>
            <tbody>
              {late.map((z) => (
                <tr key={z.instalmentNo} className="border-t border-slate-100"><td className="py-1">{z.instalmentNo} of {l.instalments}</td><td className="py-1">{z.dueDate}</td><td className={num}>{z.daysLate}</td><td className={num}>{peso(z.principalCents)}</td><td className={num}>{peso(z.interestCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <Panel title="Schedule">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>No.</th><th>Due</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Instalment</th><th>State</th></tr></thead>
          <tbody>
            {states.map((r) => (
              <tr key={r.instalmentNo} className={`border-t border-slate-100 ${r.state === 'late' ? 'bg-red-50' : ''}`}>
                <td className="py-1">{r.instalmentNo}</td><td className="py-1">{r.dueDate}</td>
                <td className={num}>{peso(r.principalCents)}</td><td className={num}>{peso(r.interestCents)}</td><td className={num}>{peso(r.principalCents + r.interestCents)}</td>
                <td className="py-1">{r.state === 'paid' ? `Paid (${r.paidBy})` : r.state === 'late' ? <span className="font-medium text-red-800">{STATE_WORDS.late}</span> : STATE_WORDS[r.state]}
                  {r.state !== 'paid' && (r.paidPrincipalCents ?? 0) + (r.paidInterestCents ?? 0) > 0 && <> · part paid, {peso((r.remainingPrincipalCents ?? 0) + (r.remainingInterestCents ?? 0))} still due</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Payments">
        {payments.length === 0 ? <p className="text-sm text-slate-500">No payment recorded yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th>Payment</th><th>Date</th><th>Instalment</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={`border-t border-slate-100 ${p.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                  <td className="py-1"><Link to={docPath('loan.payment', `/${p.id}`)} className="underline">{p.number}</Link> {p.status !== 'posted' && <StatusChip status={p.status} />}</td>
                  <td className="py-1">{p.date}</td><td className="py-1">{p.instalmentNo}{p.note ? <span className="block text-xs text-slate-500">{p.note}</span> : null}</td>
                  <td className={num}>{peso(p.principalCents)}</td><td className={num}>{peso(p.interestCents)}</td><td className={num}>{peso(p.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

