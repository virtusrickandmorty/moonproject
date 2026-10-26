/**
 * Loans (PLAN E10, H2): every loan with lender, principal, paid, left and the next due date, with a warning for what is
 * late; and one loan's page with its schedule, its payments and what is late. Balances come from the ledger on the
 * server (NR-2); "late" is an instalment past its due date that recorded payments do not fully cover, as of the server's date.
 * Users with loan.forgive see "Forgive the rest" on the instalment that may be forgiven (the first one not settled).
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type DocTypeInfo, type LateInstalment, type LoanDetail, type LoanPayment, type LoanRow } from '../../api.ts';
import { Loading, Notice, StatusChip, peso, showDate } from '../../components/ui.tsx';
import { Card, FigureStrip, PageHead, TABLE_HEAD } from '../../components/Figures.tsx';
import { TickBar } from '../../components/charts.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { KIND_WORDS, STATE_WORDS, forgivableNo, forgivenWords, lateCounts, leftCents, loanDocType, loanTotals, ratePercent, scheduleStates } from './register.ts';
import { Crumb } from '../../shell/crumbs.tsx';
import { useLiveReload } from '../../live.ts';
import { Paged, newestFirst } from '../../components/RowPages.tsx';

const num = 'py-1 text-right tabular-nums';
const link = 'rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const small = 'rounded-md bg-white px-2 py-0.5 text-xs font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const lateChip = <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Late</span>;

function LateNotice({ late }: { late: LateInstalment[] }) {
  if (late.length === 0) return null;
  const total = late.reduce((s, l) => s + l.principalCents + l.interestCents, 0);
  return <Notice tone="warning">{late.length} instalment{late.length === 1 ? ' is' : 's are'} late, {peso(total)} in all. The oldest was due {showDate(late[0]!.dueDate)} ({late[0]!.daysLate} day{late[0]!.daysLate === 1 ? '' : 's'} ago).</Notice>;
}

export function Loans({ docTypes }: { docTypes: DocTypeInfo[] }) {
  const [rows, setRows] = useState<LoanRow[] | null>(null);
  const [late, setLate] = useState<LateInstalment[]>([]);
  const [error, setError] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  useEffect(() => void Promise.all([api.loans(), api.loansLate()]).then(([r, l]) => (setRows(r), setLate(l)), (e: Error) => setError(e.message)), []);
  useLiveReload(() => Promise.all([api.loans(), api.loansLate()]).then(([r, l]) => (setRows(r), setLate(l)))); // Live (the owner's check, 26 Oct 2026): a change on any computer shows here too.
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <Loading />;
  const shown = rows.filter((r) => showCancelled || r.status === 'posted');
  const t = loanTotals(rows);
  const counts = lateCounts(late);
  const may = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  return (
    <div className="space-y-4">
      <PageHead title="Loans" sub="Money the shop borrowed: what is paid, what is left and what falls due next."
        actions={<>
          {may('loan.loan') && <Link to={docPath('loan.loan', '/new')} className={link}>Record a loan</Link>}
          {may('loan.payment') && <Link to={docPath('loan.payment', '/new')} className={link}>Record a payment</Link>}
        </>} />
      <FigureStrip label="Loans at a glance" figures={[
        { label: 'Loans', value: String(t.count), icon: 'bank', note: 'Recorded and not cancelled' },
        { label: 'Borrowed', value: peso(t.principalCents), icon: 'money' },
        { label: 'Paid', value: peso(t.paidCents), icon: 'check', good: t.principalCents > 0 && t.leftCents === 0,
          side: t.principalCents > 0 ? <TickBar parts={[{ share: t.paidCents / t.principalCents, tone: 'bg-slate-700' }]} ticks={20} height="h-5" label={`${Math.round((t.paidCents / t.principalCents) * 100)}% paid`} /> : undefined,
          note: t.principalCents > 0 ? `${Math.round((t.paidCents / t.principalCents) * 100)}% of the principal` : undefined },
        { label: 'Left to pay', value: peso(t.leftCents), icon: 'wallet' },
        { label: 'Late', value: peso(late.reduce((s, l) => s + l.principalCents + l.interestCents, 0)), icon: 'alert', warn: late.length > 0, note: late.length ? `${late.length} instalment${late.length === 1 ? '' : 's'} past due` : 'Nothing past due' },
      ]} />
      <LateNotice late={late} />
      <Card title="Every loan" icon="bank" note="Newest first" actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled loans</label>}>
      {shown.length === 0 ? <p className="text-sm text-slate-500">No loan is recorded yet.</p> : (
        <Paged rows={newestFirst(shown, (l) => l.dateReceived)}>{(page) => (<div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className={TABLE_HEAD}><tr><th className="py-2">Loan</th><th>Lender</th><th className="text-right">Principal</th><th className="text-right">Paid</th><th className="text-right">Left</th><th>Next due</th></tr></thead>
          <tbody>
            {page.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 ${counts.has(l.id) ? 'border-l-4 border-l-red-500' : ''} ${l.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="py-2 pl-1"><Link to={`/loan/loans/${l.id}`} className="font-medium text-indigo-700 hover:underline">{l.number}</Link> {l.kind === 'equipment' && <span className="text-xs text-slate-500">equipment</span>}</td>
                <td className="py-1">{l.lender}</td>
                <td className={num}>{peso(l.principalCents)}</td><td className={num}>{peso(l.principalPaidCents ?? 0)}</td><td className={num}>{peso(leftCents(l))}</td>
                <td className="py-1">{l.nextDue ? <>{showDate(l.nextDue.dueDate)} · {peso(l.nextDue.principalCents + l.nextDue.interestCents)}</> : l.status === 'cancelled' ? '' : l.balanceCents > 0 ? '—' : 'Paid off'} {counts.has(l.id) && lateChip}</td>
              </tr>
            ))}
          </tbody>
        </table></div>)}</Paged>
      )}
      </Card>
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
  useLiveReload(load);
  if (error) return <Notice>{error}</Notice>;
  if (!l) return <Loading />;
  const may = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  const states = scheduleStates(l.schedule, today);
  const forgiveNo = may('loan.forgiveness') ? forgivableNo(l) : undefined;
  const forgiveLink = (no: number) => <Link to={docPath('loan.forgiveness', `/new?loan=${l.id}&instalment=${no}`)} className={small}>Forgive the rest</Link>;
  return (
    <div className="space-y-4">
      <Crumb label={l.lender} />
      <PageHead title={<>{l.lender} <Link to={docPath(loanDocType(l.number), `/${l.id}`)} className="ml-1 align-middle text-base font-medium text-indigo-700 underline">{l.number}</Link> {l.status !== 'posted' && <StatusChip status={l.status} />}</>}
        sub={`${KIND_WORDS[l.kind]}${l.dateReceived ? ` received ${showDate(l.dateReceived)}` : ''}${l.rateBp !== undefined ? ` · ${ratePercent(l.rateBp)} a year` : ''}${l.termMonths !== undefined ? ` · ${l.termMonths} months` : ''}${l.reference ? ` · ref. ${l.reference}` : ''}`}
        actions={<>
          {l.status === 'posted' && l.nextDue && may('loan.payment') && <Link to={docPath('loan.payment', `/new?loan=${l.id}`)} className={link}>Record the next payment</Link>}
          <Link to="/loan/loans" className="self-center text-sm underline">All loans</Link>
        </>} />
      <FigureStrip label="This loan at a glance" figures={[
        { label: 'Principal', value: peso(l.principalCents), icon: 'money' },
        { label: 'Paid', value: peso(l.principalPaidCents ?? 0), icon: 'check', good: leftCents(l) === 0 && l.status === 'posted',
          side: l.principalCents > 0 ? <TickBar parts={[{ share: (l.principalPaidCents ?? 0) / l.principalCents, tone: 'bg-slate-700' }, { share: (l.principalForgivenCents ?? 0) / l.principalCents, tone: 'bg-slate-400' }]} ticks={20} height="h-5" label={`${Math.round(((l.principalPaidCents ?? 0) / l.principalCents) * 100)}% paid`} /> : undefined,
          note: l.principalForgivenCents ? `${peso(l.principalForgivenCents)} forgiven` : l.interestPaidCents ? `Interest paid ${peso(l.interestPaidCents)}` : undefined },
        { label: 'Left to pay', value: peso(leftCents(l)), icon: 'wallet' },
        { label: 'Next due', value: l.nextDue ? peso(l.nextDue.principalCents + l.nextDue.interestCents) : leftCents(l) > 0 ? '—' : 'Paid off', icon: 'calendar', good: !l.nextDue && leftCents(l) === 0, note: l.nextDue ? showDate(l.nextDue.dueDate) : undefined },
        { label: 'Late', value: String(late.length), icon: 'alert', warn: late.length > 0, note: late.length ? `${peso(late.reduce((s, z) => s + z.principalCents + z.interestCents, 0))} past due` : 'Nothing past due' },
      ]} />
      {late.length > 0 && (
        <Card title="Late" icon="alert">
          <LateNotice late={late} />
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className={TABLE_HEAD}><tr><th className="py-2">Instalment</th><th>Was due</th><th className="text-right">Days late</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th /></tr></thead>
            <tbody>
              {late.map((z) => (
                <tr key={z.instalmentNo} className="border-t border-slate-100"><td className="py-1">{z.instalmentNo} of {l.instalments}</td><td className="py-1">{showDate(z.dueDate)}</td><td className={num}>{z.daysLate}</td><td className={num}>{peso(z.principalCents)}</td><td className={num}>{peso(z.interestCents)}</td>
                  <td className="py-1 pl-2 text-right">{z.instalmentNo === forgiveNo && forgiveLink(z.instalmentNo)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
      <Card title="Schedule" icon="calendar">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className={TABLE_HEAD}><tr><th className="py-2">No.</th><th>Due</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Instalment</th><th>State</th></tr></thead>
          <tbody>
            {states.map((r) => (
              <tr key={r.instalmentNo} className={`border-t border-slate-100 ${r.state === 'late' ? 'bg-red-50' : ''}`}>
                <td className="py-1">{r.instalmentNo}</td><td className="py-1">{showDate(r.dueDate)}</td>
                <td className={num}>{peso(r.principalCents)}</td><td className={num}>{peso(r.interestCents)}</td><td className={num}>{peso(r.principalCents + r.interestCents)}</td>
                <td className="py-1">{r.state === 'paid' ? `Paid (${r.paidBy})` : r.state === 'forgiven' ? <>{(r.paidPrincipalCents ?? 0) + (r.paidInterestCents ?? 0) > 0 ? 'Part paid, ' : ''}{forgivenWords(r)} ({r.forgivenBy})</>
                  : r.state === 'late' ? <span className="font-medium text-red-800">{STATE_WORDS.late}</span> : STATE_WORDS[r.state]}
                  {r.state !== 'paid' && r.state !== 'forgiven' && (r.paidPrincipalCents ?? 0) + (r.paidInterestCents ?? 0) > 0 && <> · part paid, {peso((r.remainingPrincipalCents ?? 0) + (r.remainingInterestCents ?? 0))} still due</>}
                  {r.instalmentNo === forgiveNo && <> {forgiveLink(r.instalmentNo)}</>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      <Card title="Payments" icon="cash">
        {payments.length === 0 ? <p className="text-sm text-slate-500">No payment recorded yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className={TABLE_HEAD}><tr><th className="py-2">Payment</th><th>Date</th><th>Instalment</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={`border-t border-slate-100 ${p.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                  <td className="py-1"><Link to={docPath('loan.payment', `/${p.id}`)} className="text-indigo-700 hover:underline">{p.number}</Link> {p.status !== 'posted' && <StatusChip status={p.status} />}</td>
                  <td className="py-1">{showDate(p.date)}</td><td className="py-1">{p.instalmentNo}{p.note ? <span className="block text-xs text-slate-500">{p.note}</span> : null}</td>
                  <td className={num}>{peso(p.principalCents)}</td><td className={num}>{peso(p.interestCents)}</td><td className={num}>{peso(p.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

