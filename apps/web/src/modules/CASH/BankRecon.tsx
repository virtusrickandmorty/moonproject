/**
 * Bank reconciliation screens (PLAN E10, D8 "bank reconciliation per bank"): start one (bank, statement date, ending
 * balance), tick the cash book items that cleared, see the adjusted balances and the difference, and finish at zero.
 * Past reconciliations are listed per bank with who did them. Nothing here posts: the server keeps the ticks as matches
 * (see recon.ts) and works out every figure.
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CashAccount, type DocTypeInfo, type Me, type ReconReport, type ReconRow } from '../../api.ts';
import { Loading, Button, Field, Notice, ReasonDialog, inputClass, peso, showDate } from '../../components/ui.tsx';
import { Card, FigureStrip, PageHead, TABLE_HEAD } from '../../components/Figures.tsx';
import { Link, navigate } from '../../router.tsx';
import { Errors, Figures } from '../COL/parts.tsx';
import { adjustmentLink, byBank, figuresOf, finishBlockers, hasChanges, latestOf, monthEnd, ownMatch, readBalance, savedTicks, startCheck } from './recon.ts';
import { canShowBook } from './rules.ts';
import { saveTicks } from './ticks.ts';
import { Crumb } from '../../shell/crumbs.tsx';
import { useLiveReload } from '../../live.ts';
import { Paged, newestFirst } from '../../components/RowPages.tsx';

type Props = { me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> };
const day = (stamp: string | null) => (stamp ? stamp.slice(0, 10) : '');
/** The month before a date's month, YYYY-MM (no clock). */
const monthBefore = (date: string) => { const [y, m] = date.split('-').map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

/** Bank, statement date and ending balance to start; past reconciliations per bank below. */
export function BankRecon({ me }: Props) {
  const [banks, setBanks] = useState<CashAccount[]>([]);
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [today, setToday] = useState('');
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState('');
  const [balance, setBalance] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = me.permissions.includes('cash.recon.manage');
  useEffect(() => {
    api.cashAccounts().then((all) => setBanks(all.filter((p) => p.kind === 'bank' && p.isActive && canShowBook(p))), (e: Error) => setError(e.message));
    api.cashRecons().then(setRows, (e: Error) => setError(e.message));
    api.health().then((h) => { const t = h.serverTime.slice(0, 10); setToday(t); setDate(t); }, (e: Error) => setError(e.message));
  }, []);
  useLiveReload(() => api.cashRecons().then(setRows));
  if (!me.permissions.includes('cash.recon.view')) return <Notice>You cannot view bank reconciliations.</Notice>;

  const bank = banks.find((b) => String(b.id) === bankId);
  const check = startCheck({ bankId, date, balance, recons: rows, today, ...(bank ? { bankName: bank.name } : {}) });
  const open = bankId ? latestOf(rows, Number(bankId)) : undefined;
  const start = async () => {
    setTouched(true);
    if (check.errors.length > 0) return;
    setBusy(true);
    setError('');
    try { navigate(`/cash/recon/${(await api.startCashRecon(check.bankId!, check.month!, check.endingBalanceCents!)).id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const finished = rows.filter((r) => r.status === 'finished');
  const openOnes = rows.filter((r) => r.status === 'open');
  const lastMonth = finished.map((r) => r.month).sort().at(-1);
  const behind = banks.filter((b) => !finished.some((r) => r.bankId === b.id && today && r.month >= monthBefore(today))).length;
  return <div className="space-y-4">
    <PageHead title="Bank reconciliation" sub="Each month, match a bank's statement to the cash book until the difference is zero." />
    {error && <Notice>{error}</Notice>}
    <FigureStrip label="Reconciliations at a glance" figures={[
      { label: 'Bank accounts', value: String(banks.length), icon: 'bank', note: 'That you can see' },
      { label: 'Still open', value: String(openOnes.length), icon: 'clock', warn: openOnes.length > 0, note: openOnes.length ? openOnes.map((r) => `${r.bankName} ${r.month}`).slice(0, 2).join(', ') : 'Nothing half done' },
      { label: 'Latest month finished', value: lastMonth ?? '—', icon: 'check', good: !!lastMonth, note: `${finished.length} finished in all` },
      { label: 'Behind on last month', value: String(behind), icon: 'alert', warn: behind > 0, note: behind ? 'Banks without last month finished' : 'Every bank is up to date' },
    ]} />
    {canManage && <Card title="Start a reconciliation" icon="draft">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Bank account" required><select className={inputClass} value={bankId} onChange={(e) => setBankId(e.target.value)}><option value="">Pick one</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Statement date" required hint={check.month ? `The books are counted to the end of ${check.month} (${monthEnd(check.month)}).` : 'The last day on the statement'}><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Statement ending balance" required hint="As printed on the statement"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
      </div>
      {banks.length === 0 && <Notice tone="info">No bank account balance is visible to you.</Notice>}
      {open?.status === 'open' && <Notice tone="info">The {open.month} reconciliation of {open.bankName} is not finished. <Link to={`/cash/recon/${open.id}`} className="underline">Continue it</Link></Notice>}
      <Errors list={check.errors} show={touched} />
      <div><Button tone="primary" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start'}</Button></div>
    </Card>}
    <Card title="Past reconciliations" icon="bank" note="Per bank, newest first">
      {rows.length === 0 && <p className="text-sm text-slate-500">No bank has been reconciled yet.</p>}
      {byBank(rows).map((b) => <div key={b.bankId} className="space-y-1">
        <h3 className="font-medium">{b.bankName}</h3>
        <Paged rows={newestFirst(b.rows, (r) => r.month)}>{(page) => (<div className="overflow-x-auto"><table className="w-full text-sm"><thead className={TABLE_HEAD}><tr><th className="py-2 pr-3">Statement month</th><th className="pr-3">Status</th><th className="pr-3 text-right">Statement balance</th><th className="pr-3">Started by</th><th className="pr-3">Finished by</th><th /></tr></thead><tbody>
          {page.map((r) => <tr key={r.id} className="border-t border-slate-100">
            <td className="py-2 pr-3 font-medium">{r.month}</td>
            <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'finished' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.status === 'finished' ? 'Finished' : 'Open'}</span></td>
            <td className="pr-3 text-right tabular-nums">{peso(r.bankBalanceCents)}</td>
            <td className="pr-3">{r.createdByName ?? '?'} <span className="text-slate-500">{showDate(day(r.createdAt))}</span></td>
            <td className="pr-3">{r.finishedAt ? <>{r.finishedByName ?? '?'} <span className="text-slate-500">{showDate(day(r.finishedAt))}</span></> : '—'}</td>
            <td className="text-right"><Link to={`/cash/recon/${r.id}`} className="text-indigo-700 underline">{r.status === 'open' ? 'Continue' : 'View'}</Link></td>
          </tr>)}
        </tbody></table></div>)}</Paged>
      </div>)}
    </Card>
  </div>;
}

/** One reconciliation: tick what cleared, watch the difference, save, finish. */
export function BankReconWork({ me, docTypes, params }: Props) {
  const id = params?.id ?? '';
  const [report, setReport] = useState<ReconReport | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [ending, setEnding] = useState('');
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const recorded = new URLSearchParams(location.search).get('recorded');
  const load = (r: ReconReport, keepTicks?: boolean) => { setReport(r); setEnding(formatPesos(r.bankBalanceCents)); if (!keepTicks) setTicked(savedTicks(r.bookLines)); };
  useEffect(() => {
    api.cashRecon(id).then((r) => load(r), (e: Error) => setError(e.message));
    api.health().then((h) => setToday(h.serverTime.slice(0, 10)), (e: Error) => setError(e.message));
  }, [id]);
  useLiveReload(() => api.cashRecon(id).then((r) => load(r, true))); // the lines ticked here stay ticked
  if (!me.permissions.includes('cash.recon.view')) return <Notice>You cannot view bank reconciliations.</Notice>;
  if (!report) return error ? <Notice>{error}</Notice> : <Loading />;

  const open = report.status === 'open';
  const canManage = open && me.permissions.includes('cash.recon.manage');
  const end = monthEnd(report.month);
  const figures = figuresOf(report, ticked);
  const blockers = finishBlockers(report, figures, ticked);
  const dirty = hasChanges(report, ticked);
  const adjType = docTypes.find((t) => t.key === 'cash.bank_adj');
  const balanceCents = readBalance(ending);

  const toggle = (lineId: number) => setTicked((old) => { const next = new Set(old); if (!next.delete(lineId)) next.add(lineId); return next; });
  /** Ticks become statement lines matched to the items; unticks are undone (ticks.ts). Stops at the first error. */
  const save = async (): Promise<boolean> => {
    try {
      load(await saveTicks(api, report, ticked));
      return true;
    } catch (e) {
      setError((e as Error).message);
      await api.cashRecon(id).then((r) => load(r, true), () => undefined); // show what the server has; keep the ticks typed
      return false;
    }
  };
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); setError(''); setMessage(''); await fn(); setBusy(false); };
  const onSave = run(async () => { if (await save()) setMessage('Saved.'); });
  const finish = run(async () => {
    try { load(await api.finishRecon(id)); setMessage('Finished. This month is now locked.'); }
    catch (e) { setError((e as Error).message); }
  });
  const changeEnding = run(async () => {
    try { load(await api.setReconEnding(id, balanceCents!), true); setMessage('Ending balance changed.'); }
    catch (e) { setError((e as Error).message); }
  });
  const adjust = run(async () => { if (!dirty || (await save())) navigate(adjustmentLink(report, today || end)); });

  const status = (l: ReconReport['bookLines'][number]) => ticked.has(l.journalLineId) ? (l.date > end ? 'Cleared (dated after the month)' : 'Cleared') : l.date > end ? 'Dated after the month' : l.amountCents > 0 ? 'Deposit in transit' : 'Outstanding payment';

  return <div className="space-y-4">
    <Crumb label={`${report.bankName} · ${report.month}`} />
    <PageHead title={<>Bank reconciliation · {report.bankName} · {report.month} <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${open ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{open ? 'Open' : 'Finished'}</span></>}
      sub={`The books up to ${showDate(end)} against the statement.`} actions={<Link to="/cash/recon" className="text-sm underline">All reconciliations</Link>} />
    <FigureStrip label="This reconciliation at a glance" figures={[
      { label: `Book balance at ${showDate(end)}`, value: peso(figures.bookBalanceCents), icon: 'wallet' },
      { label: 'Books adjusted to the statement', value: peso(figures.adjustedBookCents), icon: 'stages' },
      { label: 'Statement ending balance', value: peso(figures.bankBalanceCents), icon: 'bank' },
      { label: 'Difference', value: peso(figures.differenceCents), icon: figures.differenceCents === 0 ? 'check' : 'alert', warn: figures.differenceCents !== 0, good: figures.differenceCents === 0, note: figures.differenceCents === 0 ? 'Zero: it can be finished' : 'Must be zero to finish' },
      { label: 'Items ticked as cleared', value: `${ticked.size} of ${report.bookLines.length}`, icon: 'check' },
    ]} />
    {error && <Notice>{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    {recorded && <Notice tone="success">Recorded {recorded}. It is in the list below: tick it if the statement shows it.</Notice>}
    {report.reopenReason && <Notice tone="info">Reopened: {report.reopenReason}</Notice>}
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Statement" icon="bank">
        <Field label="Ending balance on the statement" error={ending.trim() && balanceCents === undefined ? 'Type an amount like 125,000.00.' : undefined}>
          <div className="flex gap-2"><input inputMode="decimal" aria-label="Ending balance on the statement" className={`${inputClass} text-right`} disabled={!canManage} value={ending} onChange={(e) => setEnding(e.target.value)} />
            {canManage && <Button disabled={busy || balanceCents === undefined || balanceCents === report.bankBalanceCents} onClick={changeEnding}>Change</Button>}</div>
        </Field>
        <p className="text-xs text-slate-500">The whole month counts: books up to {showDate(end)}. Deposits in transit and outstanding payments stay unticked.</p>
      </Card>
      <Card title="Balances" icon="stages">
        <Figures items={[
          [`Book balance at ${end}`, figures.bookBalanceCents],
          ['Less deposits in transit (in the books, not on the statement)', -figures.depositsInTransitCents],
          ['Add outstanding payments (paid in the books, not cleared)', -figures.outstandingPaymentsCents],
          ...(figures.recordedAfterMonthCents !== 0 ? [['Add items dated after the month that the statement shows', figures.recordedAfterMonthCents] as [string, number]] : []),
          ['Books adjusted to the statement', figures.adjustedBookCents],
          ['Statement ending balance', figures.bankBalanceCents],
          ['Difference (must be zero to finish)', figures.differenceCents, figures.differenceCents === 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'],
        ]} />
      </Card>
    </div>
    <Card title="Cash book items: tick what cleared the bank" icon="check">
      {report.bookLines.length === 0 && <p className="text-sm text-slate-500">No cash book items to reconcile.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className={TABLE_HEAD}><tr><th className="py-2">Cleared</th><th>Date</th><th>Document</th><th>Details</th><th className="text-right">Money in</th><th className="text-right">Money out</th><th>Status</th></tr></thead><tbody>
        {report.bookLines.map((l) => {
          const locked = !canManage || busy || l.amountCents === 0 || (l.state === 'cleared' && !ownMatch(report, l));
          return <tr key={l.journalLineId} className="border-t border-slate-100">
            <td className="py-1"><input type="checkbox" aria-label={`Cleared: ${l.documentNumber ?? l.journalNumber}`} checked={ticked.has(l.journalLineId)} disabled={locked} title={l.state === 'cleared' && !ownMatch(report, l) ? 'Matched to statement lines typed elsewhere' : undefined} onChange={() => toggle(l.journalLineId)} /></td>
            <td className="whitespace-nowrap">{showDate(l.date)}</td><td>{l.documentNumber ?? l.journalNumber}</td><td className="text-slate-600">{l.memo}</td>
            <td className="text-right tabular-nums">{l.amountCents > 0 ? peso(l.amountCents) : '—'}</td>
            <td className="text-right tabular-nums">{l.amountCents < 0 ? peso(-l.amountCents) : '—'}</td>
            <td>{status(l)}</td>
          </tr>;
        })}
      </tbody></table></div>
      {canManage && <p className="text-xs text-slate-500">Ticks are kept when you press Save ticks.</p>}
    </Card>
    {open && report.unmatchedStatementCount > 0 && !dirty && <Notice tone="warning">{report.unmatchedStatementCount} statement line(s) typed outside this screen are not matched yet ({peso(report.unmatchedStatementCents)}). Finishing needs every line matched.</Notice>}
    {canManage && <div className="flex flex-wrap gap-2">
      <Button tone="primary" disabled={busy || !dirty} onClick={onSave}>Save ticks</Button>
      <Button tone="primary" disabled={busy || blockers.length > 0} onClick={finish}>Finish</Button>
      {adjType?.canPost && <Button disabled={busy} onClick={adjust}>Record a bank adjustment</Button>}
      {blockers.length > 0 && <span className="self-center text-sm text-slate-600">To finish: {blockers.join(' ')}</span>}
    </div>}
    <ReopenRecon report={report} me={me} onReopened={(r) => { load(r); setError(''); setMessage('Reopened. The month is unlocked: change what is needed and finish it again.'); }} />
  </div>;
}

/**
 * A finished reconciliation reopens with a reason (cash.recon.reopen, audit A1-005): the Reopen button asks first. Only a
 * bank's latest month reopens; the server says so plainly when it is not.
 */
export function ReopenRecon({ report, me, onReopened, startOpen = false }: { report: ReconReport; me: Me; onReopened: (r: ReconReport) => void; startOpen?: boolean }) {
  const [asking, setAsking] = useState(startOpen);
  if (report.status !== 'finished' || !me.permissions.includes('cash.recon.reopen')) return null;
  return <div className="flex flex-wrap gap-2">
    <Button onClick={() => setAsking(true)}>Reopen</Button>
    {asking && <ReasonDialog title={`Reopen ${report.bankName} · ${report.month}?`} confirmLabel="Reopen" danger onClose={() => setAsking(false)}
      explain="This unlocks the month so its ticks and statement lines can change. It must be finished again at zero difference. Only a bank's latest month reopens."
      onConfirm={async (reason) => { const r = await api.reopenRecon(report.id, reason); setAsking(false); onReopened(r); }} />}
  </div>;
}
