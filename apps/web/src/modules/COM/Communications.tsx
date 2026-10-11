/**
 * Customer emails (PLAN E14, C9, OWN-11): the outbox, and the settings the owner changes with a fresh password.
 * The App Password is typed here and sent once; it is never shown again, only "saved".
 */
import { Fragment, useEffect, useState } from 'react';
import { api, type BulkStatements, type EmailKind, type EmailSettings, type Me, type Outbox, type OutboxRow } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, inputClass, manilaTime, peso, useAction, usePasswordPrompt } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { useToday } from '../RPT/Books.tsx';
import { KIND_WORDS, PORT_HINT, STATUS_WORDS, TEMPLATE_WORDS, documentWords, progressWords } from './com.ts';

const TABS = [
  { section: '', label: 'Outbox', permission: 'com.outbox.view', denied: 'You cannot see the customer emails.' },
  { section: 'statements', label: 'Email statements', permission: 'com.statement.send', denied: 'Only owners and the accountant can email statements.' },
  { section: 'settings', label: 'Settings', permission: 'com.settings.manage', denied: 'Only an owner can change the email settings.' },
];

export function Communications({ me, params }: { me: Me; params?: Record<string, string> }) {
  const section = params?.section ?? '';
  const tab = TABS.find((t) => t.section === section);
  const allowed = (permission: string) => me.permissions.includes(permission);
  let page = <Notice>Page not found.</Notice>;
  if (tab && !allowed(tab.permission)) page = <Notice>{tab.denied}</Notice>;
  else if (section === '') page = <OutboxTab canResend={allowed('com.outbox.resend')} />;
  else if (section === 'statements') page = <BulkStatementsTab />;
  else if (section === 'settings') page = <SettingsTab />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Customer and payslip emails</h1>
      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-sm">
        {TABS.filter((t) => allowed(t.permission)).map((t) => (
          <Link key={t.section} to={t.section ? `/com/${t.section}` : '/com'} className={`rounded px-3 py-1 ${t.section === section ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`}>{t.label}</Link>
        ))}
      </nav>
      {page}
    </div>
  );
}

function BulkStatementsTab() {
  const today = useToday();
  const [date, setDate] = useState('');
  const [data, setData] = useState<BulkStatements | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = useAction();
  const send = useAction();
  const [done, setDone] = useState('');
  useEffect(() => { if (today && !date) setDate(today); }, [today, date]);
  const show = () => load.run(async () => {
    const next = await api.comBulkStatements(date);
    setData(next); setSelected(new Set(next.eligible.map((row) => row.customerId))); setDone('');
  });
  const toggle = (id: string) => setSelected((old) => {
    const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const queue = () => send.run(async () => {
    const result = await api.comSendBulkStatements(date, [...selected]);
    setDone(result.queued ? `${result.queued} statement email${result.queued === 1 ? '' : 's'} queued.` : 'No new statement emails were queued.');
    setData(await api.comBulkStatements(date));
  });
  return <div className="space-y-4">
    <Panel title="Email statements for a date">
      <p className="text-sm text-slate-600">Customers with a balance, an email address and consent are ticked. Each customer can be queued only once for this statement date.</p>
      <div className="flex flex-wrap items-end gap-3"><Field label="Statement date"><input type="date" className={inputClass} value={date} max={today} onChange={(e) => { setDate(e.target.value); setData(null); setDone(''); }} /></Field>
        <Button disabled={!date || load.busy} onClick={() => void show()}>Show customers</Button></div>
      {(load.error || send.error) && <Notice>{load.error || send.error}</Notice>}{done && <Notice tone="success">{done}</Notice>}
    </Panel>
    {data && <><Panel title={`Ready to email (${data.eligible.length})`}>
      {data.eligible.length === 0 ? <p className="text-sm text-slate-500">No customers are ready.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="pr-3">Send</th><th className="pr-3">Customer</th><th className="pr-3">Email</th><th className="pr-3 text-right">Balance</th><th>Last statement emailed</th></tr></thead><tbody>
        {data.eligible.map((row) => <tr className="border-t border-slate-100" key={row.customerId}><td className="py-2 pr-3"><input aria-label={`Email ${row.customerName}`} type="checkbox" checked={selected.has(row.customerId)} onChange={() => toggle(row.customerId)} /></td><td className="pr-3">{row.customerName}</td><td className="pr-3">{row.email}</td><td className="pr-3 text-right">{peso(row.balanceCents)}</td><td>{row.lastStatementEmailedAt ? manilaTime(row.lastStatementEmailedAt) : 'Never'}</td></tr>)}
      </tbody></table></div>}
      <Button tone="primary" disabled={selected.size === 0 || send.busy} onClick={() => void queue()}>{send.busy ? 'Queuing…' : `Send ${selected.size} statement${selected.size === 1 ? '' : 's'}`}</Button>
    </Panel><Panel title={`Cannot email (${data.excluded.length})`}>
      {data.excluded.length === 0 ? <p className="text-sm text-slate-500">None.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="pr-3">Customer</th><th className="pr-3 text-right">Balance</th><th>Reason</th></tr></thead><tbody>
        {data.excluded.map((row) => <tr className="border-t border-slate-100" key={row.customerId}><td className="py-2 pr-3">{row.customerName}</td><td className="pr-3 text-right">{peso(row.balanceCents)}</td><td>{row.reason}</td></tr>)}
      </tbody></table></div>}
    </Panel></>}
  </div>;
}

function OutboxTab({ canResend }: { canResend: boolean }) {
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [filter, setFilter] = useState<OutboxRow['status'] | ''>('');
  const [kind, setKind] = useState<EmailKind | ''>('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const resend = useAction();
  const load = () => api.comOutbox(filter || undefined, kind || undefined).then(setOutbox, (e: Error) => setError(e.message));
  useEffect(() => void load(), [filter, kind]);
  if (error) return <Notice>{error}</Notice>;
  if (!outbox) return <Loading />;
  return (
    <Panel title={kind ? KIND_WORDS[kind] : 'Emails to customers and employees'}>
      <p className="text-sm text-slate-600">
        Waiting: {outbox.counts.queued} · Sent: {outbox.counts.sent} · Failed: {outbox.counts.failed}. Only customers who agreed to emails, at the address on their record, ever get one.
        A payslip goes only to an employee who agreed to get payslips by email; this list shows who and which pay period, never an amount.
      </p>
      <div className="flex flex-wrap gap-2 text-sm" aria-label="Kind of email">
        {([['', 'All kinds'], ['customer', KIND_WORDS.customer], ['payslip', KIND_WORDS.payslip]] as const).map(([value, label]) => (
          <button key={value} type="button" className={`rounded px-3 py-1 ${kind === value ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`} onClick={() => setKind(value)}>{label}</button>
        ))}
      </div>
      <div className="flex gap-2 text-sm">
        {([['', 'All'], ['queued', 'Waiting'], ['sent', 'Sent'], ['failed', 'Failed']] as const).map(([value, label]) => (
          <button key={value} type="button" className={`rounded px-3 py-1 ${filter === value ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      {resend.error && <Notice>{resend.error}</Notice>}
      {outbox.rows.length === 0 ? <p className="text-sm text-slate-500">No emails here yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">Queued</th><th className="pr-3">To</th><th className="pr-3">Email</th><th className="pr-3">Document</th><th className="pr-3">Status</th><th /></tr></thead>
            <tbody>
              {outbox.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap py-1 pr-3">{manilaTime(r.createdAt)}</td>
                    <td className="py-1 pr-3">{r.customerName}<div className="text-xs text-slate-500">{r.toAddress}</div></td>
                    <td className="py-1 pr-3"><button type="button" className="text-left text-indigo-700 hover:underline" onClick={() => setOpen(open === r.id ? '' : r.id)}>{TEMPLATE_WORDS[r.template]}</button>{r.kind === 'payslip' && <div className="text-xs text-slate-500">Employee</div>}</td>
                    <td className="py-1 pr-3">{documentWords(r)}</td>
                    <td className={`py-1 pr-3 ${r.status === 'failed' ? 'text-red-700' : ''}`}><b>{STATUS_WORDS[r.status]}</b><div className="text-xs">{progressWords(r)}</div></td>
                    <td className="py-1">{canResend && r.status === 'failed' && <Button disabled={resend.busy} onClick={() => resend.run(async () => (await api.comResend(r.id), await load()))}>Send again</Button>}</td>
                  </tr>
                  {open === r.id && <tr><td colSpan={6} className="bg-slate-50 p-3"><b>{r.subject}</b><pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{r.body}</pre>{r.attachmentName && <p className="mt-2 text-xs text-slate-500">Attached: {r.attachmentName}</p>}</td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SettingsTab() {
  const [saved, setSaved] = useState<EmailSettings | null>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ sendingOn: false, host: '', port: '587', user: '', senderName: '', senderAddress: '', appPassword: '' });
  const [done, setDone] = useState('');
  const save = useAction();
  const test = useAction();
  const password = usePasswordPrompt();
  const fill = (s: EmailSettings) => (setSaved(s), setF({ sendingOn: s.sendingOn, host: s.host, port: String(s.port), user: s.user, senderName: s.senderName, senderAddress: s.senderAddress, appPassword: '' }));
  useEffect(() => void api.comSettings().then(fill, (e: Error) => setError(e.message)), []);
  if (error) return <Notice>{error}</Notice>;
  if (!saved) return <Loading />;
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => (setF({ ...f, [key]: value }), setDone(''));
  const doSave = () => save.run(async () => {
    const { appPassword, port, ...rest } = f;
    fill(await api.comSaveSettings(saved.version, { ...rest, port: Number(port), ...(appPassword ? { appPassword } : {}) }));
    setDone('Saved.');
  });
  const doTest = () => test.run(async () => setDone((await api.comTestEmail()).message));
  return (
    <div className="space-y-4">
      <Panel title="Sending">
        <Notice tone="warning">{saved.sendingOn ? 'Sending is ON: customers who agreed to emails get them.' : 'Sending is OFF. No customer is emailed until you turn it on.'}</Notice>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sendingOn} onChange={(e) => set('sendingOn', e.target.checked)} />Send emails to customers who agreed to them</label>
        <p className="text-xs text-slate-500">Turning it on starts from now: orders recorded while it was off are not emailed later.</p>
      </Panel>
      <Panel title="Mail server">
        <div className="max-w-lg space-y-3">
          <Field label="Mail server" hint={PORT_HINT}><input className={inputClass} value={f.host} onChange={(e) => set('host', e.target.value)} /></Field>
          <Field label="Port"><input className={inputClass} inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
          <Field label="User name"><input className={inputClass} autoComplete="off" value={f.user} onChange={(e) => set('user', e.target.value)} /></Field>
          <Field label="Sender name" hint="How the customer sees who it is from."><input className={inputClass} value={f.senderName} onChange={(e) => set('senderName', e.target.value)} /></Field>
          <Field label="Sender address"><input className={inputClass} value={f.senderAddress} onChange={(e) => set('senderAddress', e.target.value)} /></Field>
          <Field label="App Password" hint={saved.appPasswordSet ? 'One is saved. Type a new one only to replace it. It is never shown again.' : 'Make one in the Google account (2-step verification on), then type it here. It is never shown again.'}>
            <input className={inputClass} type="password" autoComplete="new-password" placeholder={saved.appPasswordSet ? 'Saved' : ''} value={f.appPassword} onChange={(e) => set('appPassword', e.target.value)} />
          </Field>
        </div>
        {saved.missing.length > 0 && <p className="text-sm text-slate-600">Still needed before sending can be on: {saved.missing.join(', ')}.</p>}
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" disabled={save.busy} onClick={() => password.ask('Save the email settings', doSave)}>Save</Button>
          <Button disabled={test.busy || !saved.appPasswordSet} onClick={() => password.ask('Send a test email', doTest)}>{test.busy ? 'Sending…' : 'Send a test email'}</Button>
        </div>
        {saved.appPasswordSet && <p className="text-xs text-slate-500">The test email goes to the sender address. Save your changes first.</p>}
        {done && <Notice tone="success">{done}</Notice>}
        {(save.error || test.error) && <Notice>{save.error || test.error}</Notice>}
      </Panel>
      {password.dialog}
    </div>
  );
}
