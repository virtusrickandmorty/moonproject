/**
 * Accounting & Tax › Chart of accounts (PLAN D2): the accounts in code order under their headings, with type, role key and
 * whether each is active. With acc.coa.manage: add an account, rename, deactivate (asks for the password again) and
 * activate. The server's rules come back as plain refusals: an account with a balance or a posting-rule role stays active.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type CoaAccount, type Me } from '../../api.ts';
import { Loading, Button, Dialog, Field, Notice, inputClass, peso, useAction } from '../../components/ui.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { TYPES, TYPE_WORDS, accountNotes, newAccountInput, ownSideCents, renameInput, typeWarning, visibleAccounts } from './coa.ts';

type Open = { kind: 'add' } | { kind: 'rename' | 'deactivate'; account: CoaAccount };

export function ChartOfAccounts({ me }: { me: Me }) {
  const [accounts, setAccounts] = useState<CoaAccount[]>();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [open, setOpen] = useState<Open | null>(null);
  const manage = me.permissions.includes('acc.coa.manage');
  const view = me.permissions.includes('acc.coa.view');
  const load = () => api.coaAccounts().then(setAccounts, (e: Error) => setError(e.message));
  useEffect(() => { if (view) void load(); }, [view]);
  const activate = useAction();
  if (!view) return <Notice>You do not have permission to see the chart of accounts.</Notice>;
  const finished = (message: string) => { setOpen(null); setDone(message); void load(); };
  const doActivate = (a: CoaAccount) => {
    setDone('');
    void activate.run(async () => {
      try { await api.activateAccount(a.id, a.version); } catch (e) { void load(); throw e; } // a refusal such as "someone changed this account": show the fresh list too
      finished(`Activated ${a.code} ${a.name}.`);
    });
  };
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Chart of accounts</h1>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive accounts</label>
        {manage && <Button tone="primary" onClick={() => { setDone(''); setOpen({ kind: 'add' }); }}>Add an account</Button>}
      </div>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {activate.error && <Notice>{activate.error}</Notice>}
      {!accounts && !error && <Loading />}
      {accounts && <AccountTable accounts={visibleAccounts(accounts, showInactive)} manage={manage} onRename={(a) => { setDone(''); setOpen({ kind: 'rename', account: a }); }} onDeactivate={(a) => { setDone(''); setOpen({ kind: 'deactivate', account: a }); }} onActivate={doActivate} busy={activate.busy} />}
      <p className="text-sm text-slate-500">Accounts are never deleted. An account with a balance, or one the posting rules use, cannot be deactivated: rename it instead.</p>
      {open?.kind === 'add' && <AddAccount onClose={() => setOpen(null)} onDone={(a) => finished(`Added ${a.code} ${a.name}.${a.warning ? ` ${a.warning}` : ''}`)} />}
      {open?.kind === 'rename' && <Rename account={open.account} onClose={() => setOpen(null)} onStale={() => void load()} onDone={(a) => finished(`Renamed ${a.code} to ${a.name}.`)} />}
      {open?.kind === 'deactivate' && <Deactivate account={open.account} onClose={() => setOpen(null)} onStale={() => void load()} onDone={() => finished(`Deactivated ${open.account.code} ${open.account.name}.`)} />}
    </div>
  );
}

export function AccountTable({ accounts, manage, onRename, onDeactivate, onActivate, busy }: {
  accounts: CoaAccount[]; manage: boolean; onRename?: (a: CoaAccount) => void; onDeactivate?: (a: CoaAccount) => void; onActivate?: (a: CoaAccount) => void; busy?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="p-2">Code</th><th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2">Role key</th><th className="p-2 text-right">Balance</th><th className="p-2">Active</th>{manage && <th className="p-2" />}</tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className={`border-t border-slate-100 align-top ${a.isHeader ? 'bg-slate-50 font-semibold' : ''} ${a.isActive ? '' : 'text-slate-500'}`}>
              <td className="whitespace-nowrap p-2 tabular-nums">{a.code}</td>
              <td className={`p-2 ${a.isHeader ? '' : 'pl-6'}`}>
                {a.name}
                {accountNotes(a).map((n) => <span key={n} className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">{n}</span>)}
              </td>
              <td className="p-2">{TYPE_WORDS[a.type]}</td>
              <td className="p-2 font-mono text-xs">{a.roleKey ?? '—'}</td>
              <td className="whitespace-nowrap p-2 text-right tabular-nums">{a.isHeader ? '' : peso(ownSideCents(a))}</td>
              <td className="p-2">{a.isActive ? 'Yes' : 'No'}</td>
              {manage && (
                <td className="space-x-2 whitespace-nowrap p-2 text-right">
                  <Button onClick={() => onRename?.(a)}>Rename</Button>
                  {a.isActive ? <Button onClick={() => onDeactivate?.(a)}>Deactivate</Button> : <Button disabled={busy} onClick={() => onActivate?.(a)}>Activate</Button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Form({ title, onClose, onSubmit, children, errors, action, label, tone = 'primary' }: {
  title: string; onClose: () => void; onSubmit: () => void; children: ReactNode; errors?: string[]; action: ReturnType<typeof useStepUpAction>; label: string; tone?: 'primary' | 'danger';
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        {children}
        {errors && errors.length > 0 && <Notice><ul className="list-disc pl-5">{errors.map((m) => <li key={m}>{m}</li>)}</ul></Notice>}
        {action.error && <Notice>{action.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button type="submit" tone={tone} disabled={action.busy}>{label}</Button></div>
      </form>
      {action.dialog}
    </Dialog>
  );
}

function AddAccount({ onClose, onDone }: { onClose: () => void; onDone: (a: CoaAccount & { warning?: string }) => void }) {
  const [v, setV] = useState({ code: '', name: '', type: 'expense' as CoaAccount['type'], contra: false });
  const [errors, setErrors] = useState<string[]>([]);
  const action = useStepUpAction('adding the account');
  const submit = () => {
    const checked = newAccountInput(v);
    setErrors(checked.errors);
    if (checked.body) { const body = checked.body; void action.run(async () => onDone(await api.addAccount(body))); }
  };
  return (
    <Form title="Add an account" onClose={onClose} onSubmit={submit} errors={errors} action={action} label="Add account">
      <Field label="Code" required hint="Four digits, 1000 to 8999. It sits in code order under the heading it falls in."><input autoFocus inputMode="numeric" className={inputClass} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
      <Field label="Name" required><input className={inputClass} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Type" required>
        <select className={inputClass} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as CoaAccount['type'] })}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}</select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.contra} onChange={(e) => setV({ ...v, contra: e.target.checked })} />Contra account: its balance sits on the opposite side (for example an allowance or a discount)</label>
      {typeWarning(v.code, v.type) && <Notice tone="warning">{typeWarning(v.code, v.type)} You can still add it.</Notice>}
    </Form>
  );
}

function Rename({ account, onClose, onDone, onStale }: { account: CoaAccount; onClose: () => void; onDone: (a: CoaAccount) => void; onStale: () => void }) {
  const [name, setName] = useState(account.name);
  const [error, setError] = useState('');
  const action = useStepUpAction('renaming the account');
  const submit = () => {
    const checked = renameInput(name, account.name);
    setError(checked.error);
    const next = checked.name;
    if (next) void action.run(async () => { try { onDone(await api.renameAccount(account.id, account.version, next)); } catch (e) { onStale(); throw e; } });
  };
  return (
    <Form title={`Rename ${account.code}`} onClose={onClose} onSubmit={submit} errors={error ? [error] : []} action={action} label="Save name">
      <Field label="Name" required><input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Form>
  );
}

function Deactivate({ account, onClose, onDone, onStale }: { account: CoaAccount; onClose: () => void; onDone: () => void; onStale: () => void }) {
  const action = useStepUpAction('deactivating the account');
  return (
    <Form title={`Deactivate ${account.code} ${account.name}?`} onClose={onClose} action={action} label="Deactivate" tone="danger"
      onSubmit={() => void action.run(async () => { try { await api.deactivateAccount(account.id, account.version); } catch (e) { onStale(); throw e; } onDone(); })}>
      <p className="text-sm text-slate-700">It stops appearing in pickers. Its history stays, and you can activate it again. An account with a balance, or one the posting rules use, cannot be deactivated.</p>
    </Form>
  );
}
