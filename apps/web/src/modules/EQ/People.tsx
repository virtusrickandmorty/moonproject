/**
 * Owners and officers (PLAN E10, H2): the register of stockholders and officers with what each owes and is owed, and one
 * person's page with their owner money documents, officer money out and back, and what is due from and to them.
 * Everything owed is read from the ledger on the server (NR-2). Adding and editing people stays with eq.people.edit.
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type EqBalance, type EqDocument, type EqLedger, type EqPersonRecord, type Me } from '../../api.ts';
import { Loading, Notice, StatusChip, inputClass, peso, searchClass, searchRowClass, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { OFFICER_KIND_WORDS, OWNER_KIND_WORDS, balanceOf, filterPeople, positionWords, recordedTotal, rolesOf } from './register.ts';
import { Card, FigureStrip, PageHead, TABLE_HEAD } from '../../components/Figures.tsx';
import { useLiveReload } from '../../live.ts';
import { Paged } from '../../components/RowPages.tsx';

const num = 'py-1 text-right tabular-nums';
const link = 'rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const can = (me: Me, key: string) => me.permissions.includes(key);

export function People({ me }: { me: Me }) {
  const [rows, setRows] = useState<EqPersonRecord[] | null>(null);
  const [balances, setBalances] = useState<EqBalance[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | 'stockholder' | 'officer'>('all');
  const [showOff, setShowOff] = useState(false);
  const seeMoney = can(me, 'eq.ledger.view');
  useEffect(() => {
    void api.eqRegister().then(setRows, (e: Error) => setError(e.message));
    if (seeMoney) void api.eqBalances().then(setBalances, (e: Error) => setError(e.message));
  }, [seeMoney]);
  useLiveReload(() => Promise.all([api.eqRegister().then(setRows), ...(seeMoney ? [api.eqBalances().then(setBalances)] : [])]));
  if (error) return <Notice>{error}</Notice>;
  if (!rows || (seeMoney && !balances)) return <Loading />;
  const shown = filterPeople(rows, search, role, showOff);
  const owed = (f: (b: EqBalance) => number) => shown.reduce((s, p) => s + f(balanceOf(balances ?? [], p.id)), 0);
  const active = rows.filter((p) => p.isActive);
  const all = (f: (b: EqBalance) => number) => active.reduce((s, p) => s + f(balanceOf(balances ?? [], p.id)), 0);
  return (
    <div className="space-y-4">
      <PageHead title="Owners and officers" sub="The stockholders and officers, their shares, and the money between them and the company." />
      <FigureStrip label="Owners and officers at a glance" figures={[
        { label: 'In the register', value: String(active.length), icon: 'jobs', note: (() => { const s = active.filter((p) => p.shares !== null && p.shares > 0).length, o = active.filter((p) => p.isOfficer).length; return `${s} ${s === 1 ? 'stockholder' : 'stockholders'} · ${o} ${o === 1 ? 'officer' : 'officers'}`; })() },
        ...(seeMoney ? [
          { label: 'Owe the company', value: peso(all((b) => b.dueFromCents)), icon: 'wallet' as const, note: 'Advances and money taken out' },
          { label: 'The company owes them', value: peso(all((b) => b.dueToCents)), icon: 'money' as const, note: 'Money they put in or paid for it' },
          { label: 'Left on subscriptions', value: peso(all((b) => b.unpaidSubscriptionCents)), icon: 'stages' as const, note: 'Shares subscribed, not yet paid' },
        ] : []),
      ]} />
      <div className={searchRowClass}>
        <input aria-label="Search people" placeholder="Search name or position" className={`${inputClass} ${searchClass}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Show" className={`${inputClass} max-w-44`} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="all">Everyone</option><option value="stockholder">Stockholders</option><option value="officer">Officers</option>
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Show people switched off</label>
      </div>
      <Card title="The register" icon="jobs" note={`${shown.length} shown`}>
      {shown.length === 0 ? <p className="text-sm text-slate-500">{rows.length === 0 ? 'Nobody is in the register yet.' : 'Nobody matches.'}</p> : (
        <Paged rows={shown}>{(page) => (<div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr><th className="py-2">Name</th><th>Role</th><th className="text-right">Shares</th>{seeMoney && <><th className="text-right">Owes the company</th><th className="text-right">Company owes them</th><th className="text-right">Left on subscription</th></>}</tr>
          </thead>
          <tbody>
            {page.map((p) => {
              const b = balanceOf(balances ?? [], p.id);
              return (
                <tr key={p.id} className={`border-t border-slate-100 ${p.isActive ? '' : 'text-slate-400'}`}>
                  <td className="py-2"><Link to={`/eq/people/${p.id}`} className="font-medium text-indigo-700 hover:underline">{p.name}</Link>{!p.isActive && ' (off)'}</td>
                  <td className="py-1">{rolesOf(p)}</td><td className={num}>{p.shares === null ? '—' : p.shares.toLocaleString('en-US')}</td>
                  {seeMoney && <><td className={num}>{peso(b.dueFromCents)}</td><td className={num}>{peso(b.dueToCents)}</td><td className={num}>{peso(b.unpaidSubscriptionCents)}</td></>}
                </tr>
              );
            })}
            {seeMoney && (
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-1" colSpan={3}>Total</td>
                <td className={num}>{peso(owed((b) => b.dueFromCents))}</td><td className={num}>{peso(owed((b) => b.dueToCents))}</td><td className={num}>{peso(owed((b) => b.unpaidSubscriptionCents))}</td>
              </tr>
            )}
          </tbody>
        </table></div>)}</Paged>
      )}
      {!seeMoney && <p className="text-sm text-slate-500">What each person owes and is owed is shown to the accountant and owners.</p>}
      </Card>
    </div>
  );
}

function Documents({ title, docs, type, words, empty }: { title: string; docs: EqDocument[]; type: string; words: Record<string, string>; empty: string }) {
  return (
    <Card title={title} icon="cash">
      {docs.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className={TABLE_HEAD}><tr><th className="py-2">Document</th><th>Date</th><th>What</th><th>Cash place</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className={`border-t border-slate-100 ${d.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="py-2"><Link to={docPath(type, `/${d.id}`)} className="text-indigo-700 hover:underline">{d.number}</Link> {d.status !== 'posted' && <StatusChip status={d.status} />}</td>
                <td className="py-1">{showDate(d.date)}</td>
                <td className="py-1">{words[d.kind] ?? d.kind}{d.note ? <span className="block text-xs text-slate-500">{d.note}</span> : null}</td>
                <td className="py-1">{d.accountName}</td><td className={num}>{peso(d.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

export function PersonPage({ me, docTypes, params }: { me: Me; docTypes: DocTypeInfo[]; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [person, setPerson] = useState<EqPersonRecord | null>(null);
  const [ledger, setLedger] = useState<EqLedger | null>(null);
  const [balance, setBalance] = useState<EqBalance | null>(null);
  const [owner, setOwner] = useState<EqDocument[] | null>(null);
  const [officer, setOfficer] = useState<EqDocument[] | null>(null);
  const [error, setError] = useState('');
  const seeMoney = can(me, 'eq.ledger.view');
  const fail = (e: Error) => setError(e.message);
  const load = (onFail: (e: Error) => void) => {
    void api.eqRegister().then((all) => { const p = all.find((x) => x.id === id); return p ? setPerson(p) : setError('That person is not in the register.'); }, onFail);
    if (seeMoney) {
      void api.eqLedger(id).then(setLedger, onFail);
      void api.eqBalances().then((all) => setBalance(balanceOf(all, id)), onFail);
    }
    if (can(me, 'eq.own.view')) void api.eqOwnerMoney(id).then(setOwner, onFail);
    if (can(me, 'eq.ofc.view')) void api.eqOfficerTransactions(id).then(setOfficer, onFail);
  };
  useEffect(() => load(fail), [id]);
  useLiveReload(() => load(() => undefined)); // Live (the owner's check, 26 Oct 2026): a change on any computer shows here too.
  if (error) return <Notice>{error}</Notice>;
  if (!person) return <Loading />;
  const mayPost = (key: string) => docTypes.some((d) => d.key === key && d.canPost);
  return (
    <div className="space-y-4">
      <PageHead
        title={<>{person.name} <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${person.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{person.isActive ? 'Active' : 'Switched off'}</span></>}
        sub={`${rolesOf(person)}${person.shares !== null ? ` · ${person.shares.toLocaleString('en-US')} shares` : ''}`}
        actions={<>
          {person.isActive && mayPost('eq.owner_money') && <Link to={docPath('eq.owner_money', `/new?person=${id}`)} className={link}>Record owner money</Link>}
          {person.isActive && person.isOfficer && mayPost('eq.officer') && <Link to={docPath('eq.officer', `/new?person=${id}`)} className={link}>Record officer money out or back</Link>}
          <Link to="/eq/people" className="self-center text-sm underline">All owners and officers</Link>
        </>} />
      {seeMoney && balance && <FigureStrip label="What is due at a glance" figures={[
        { label: 'Owes the company', value: peso(balance.dueFromCents), icon: 'wallet', warn: balance.dueFromCents > 0 },
        { label: 'The company owes them', value: peso(balance.dueToCents), icon: 'money' },
        { label: 'Left on the subscription', value: peso(balance.unpaidSubscriptionCents), icon: 'stages' },
      ]} />}
      {seeMoney && (
        <Card title="What is due" icon="check">
          {balance ? <ul className="list-disc pl-5 text-sm">{positionWords(balance, peso).map((w) => <li key={w}>{w}</li>)}</ul> : <Loading />}
        </Card>
      )}
      {owner && <Documents title="Owner money" docs={owner} type="eq.owner_money" words={OWNER_KIND_WORDS} empty="No owner money recorded." />}
      {officer && <Documents title="Officer money out and back" docs={officer} type="eq.officer" words={OFFICER_KIND_WORDS} empty="No officer money recorded." />}
      {owner && officer && <p className="text-sm text-slate-500">Recorded in: {peso(recordedTotal(owner))} as owner money; {peso(recordedTotal(officer.filter((d) => d.kind === 'returned')))} paid back by them; {peso(recordedTotal(officer.filter((d) => d.kind !== 'returned')))} out to them.</p>}
      {ledger && (
        <Card title="Officer ledger" icon="clock">
          {ledger.lines.length === 0 ? <p className="text-sm text-slate-500">Nothing has been posted against this person.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className={TABLE_HEAD}><tr><th className="py-2">Date</th><th>Document</th><th>What</th><th className="text-right">Owes company +</th><th className="text-right">Running net</th></tr></thead>
              <tbody>
                {ledger.lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1">{showDate(l.date)}</td><td className="py-1">{l.documentNumber ?? l.journalNumber}</td><td className="py-1 text-slate-600">{l.memo}</td>
                    <td className={num}>{peso(l.amountCents)}</td><td className={num}>{peso(l.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="text-xs text-slate-500">A plus in the net means the person owes the company; a minus means the company owes them.</p>
        </Card>
      )}
    </div>
  );
}
