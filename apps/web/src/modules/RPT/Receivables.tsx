import { useEffect, useState } from 'react';
import { api, openServerPrint, type Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { BookTitle, Tools, money, td, th, useReport, useToday } from './Books.tsx';
import './books.css';

type Buckets = { current: number; days1to30: number; days31to60: number; days61to90: number; over90: number };
type Aging = { asOf: string; rows: { customerId: string | null; customerName: string; documentId: string | null;
  documentNumber: string; documentType: string | null; jobOrderNumber: string; date: string; dueDate: string;
  buckets: Buckets; totalCents: number }[]; buckets: Buckets; totalCents: number;
  memo: { customerId: string; customerName: string; jobOrderId: string; jobOrderNumber: string; dueDate: string; notInvoicedCents: number }[];
  memoTotalCents: number };
type Statement = { customerId: string; customerName: string; from: string; to: string; openingBalanceCents: number;
  lines: { journalId: string; businessDate: string; journalNumber: string; sourceId: string;
    documentType: string | null; documentNumber: string | null; memo: string; debitCents: number;
    creditCents: number; runningBalanceCents: number }[]; closingBalanceCents: number;
  openingDepositsHeldCents: number; depositLines: { journalId: string; businessDate: string; journalNumber: string;
    sourceId: string; documentType: string | null; documentNumber: string | null; memo: string;
    debitCents: number; creditCents: number; runningHeldCents: number }[]; depositsHeldCents: number };
const bucketNames: [keyof Buckets, string][] = [['current', 'Current'], ['days1to30', '1–30'], ['days31to60', '31–60'],
  ['days61to90', '61–90'], ['over90', 'Over 90']];
function docLink(id: string | null, type: string | null, label: string) {
  return id && type ? <Link className="text-indigo-700 underline print:text-black print:no-underline"
    to={`/docs/${encodeURIComponent(type)}/${encodeURIComponent(id)}`}>{label}</Link> : label;
}

export function ArAging({ me }: { me: Me }) {
  const today = useToday(); const [asOf, setAsOf] = useState(''); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !asOf) setAsOf(today); }, [today, asOf]);
  useEffect(() => { if (asOf && !applied) setApplied(new URLSearchParams({ asOf }).toString()); }, [asOf, applied]);
  const path = applied ? `ar-aging?${applied}` : null;
  const { data, error } = useReport<Aging>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="AR aging" dates={data ? `As of ${data.asOf}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden"><Field label="As of"><input type="date" className={inputClass}
      value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      <Button tone="primary" disabled={!asOf} onClick={() => setApplied(new URLSearchParams({ asOf }).toString())}>Show</Button>
      {path && <Tools path={path} />}</div>
    {error && <Notice>{error}</Notice>}{!data && !error && <p>Loading…</p>}
    {data && <><Panel title="Receivables"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
      {['Customer', 'Document', 'Job order', 'Due date', ...bucketNames.map(([, name]) => name), 'Total'].map((name) =>
        <th className={th} key={name}>{name}</th>)}</tr></thead><tbody>
      {data.rows.map((row, i) => <tr key={`${row.documentId ?? row.documentNumber}-${i}`}><td className={td}>{row.customerName}</td>
        <td className={td}>{docLink(row.documentId, row.documentType, row.documentNumber)}</td>
        <td className={td}>{row.jobOrderNumber}</td><td className={td}>{row.dueDate}</td>
        {bucketNames.map(([key]) => <td className={money} key={key}>{row.buckets[key] ? peso(row.buckets[key]) : ''}</td>)}
        <td className={money}>{peso(row.totalCents)}</td></tr>)}
      <tr className="font-semibold"><td className={td} colSpan={4}>Total AR</td>
        {bucketNames.map(([key]) => <td className={money} key={key}>{peso(data.buckets[key])}</td>)}
        <td className={money}>{peso(data.totalCents)}</td></tr></tbody></table></div></Panel>
      <Panel title="Job orders not yet invoiced (memo only)"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr>{['Customer', 'Job order', 'Due date', 'Amount'].map((name) => <th className={th} key={name}>{name}</th>)}</tr></thead>
        <tbody>{data.memo.map((row) => <tr key={row.jobOrderId}><td className={td}>{row.customerName}</td>
          <td className={td}>{docLink(row.jobOrderId, 'jo.job_order', row.jobOrderNumber)}</td><td className={td}>{row.dueDate}</td>
          <td className={money}>{peso(row.notInvoicedCents)}</td></tr>)}
          <tr className="font-semibold"><td className={td} colSpan={3}>Memo total</td><td className={money}>{peso(data.memoTotalCents)}</td></tr>
        </tbody></table></div></Panel></>}
  </article>;
}

/** "Email this statement": queues it for the customer's address on file, if they agreed to emails (COM). */
function EmailStatement(p: { customerId: string; from: string; to: string }) {
  const [message, setMessage] = useState(''); const [failed, setFailed] = useState(false); const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setMessage('');
    try { await api.comEmailStatement(p); setFailed(false); setMessage('Queued. It goes out with the next batch: see Customer emails.'); }
    catch (e) { setFailed(true); setMessage((e as Error).message); }
    setBusy(false);
  };
  return <><Button disabled={busy} onClick={() => void send()}>Email this statement</Button>
    {message && <Notice tone={failed ? 'error' : 'success'}>{message}</Notice>}</>;
}

export function CustomerStatement({ me }: { me: Me }) {
  const today = useToday(); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [customerId, setCustomerId] = useState(''); const [applied, setApplied] = useState('');
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (today && !from && !to) { setFrom(`${today.slice(0, 7)}-01`); setTo(today); } }, [today, from, to]);
  useEffect(() => { if (me.permissions.includes('rpt.books.view')) void api.report<{ id: string; name: string }[]>('customers').then(setCustomers); }, [me.permissions]);
  const path = applied ? `customer-statement?${applied}` : null;
  const { data, error } = useReport<Statement>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  return <article className="rpt-page space-y-4"><BookTitle title="Customer statement" dates={data ? `${data.customerName} · ${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <Field label="Customer"><select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">Choose a customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
      </select></Field>
      <Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!customerId || !from || !to || from > to}
        onClick={() => setApplied(new URLSearchParams({ customerId, from, to }).toString())}>Show</Button>
      {path && <Tools path={path} />}
      {data && me.permissions.includes('com.statement.send') && <EmailStatement customerId={data.customerId} from={data.from} to={data.to} />}</div>
    {data && <div className="print:hidden"><Button onClick={() => void openServerPrint(me, '/api/prt/reports/statement',
      { customerId: data.customerId, from: data.from, to: data.to })}>Print statement of account</Button></div>}
    {error && <Notice>{error}</Notice>}{!data && !error && applied && <p>Loading…</p>}
    {data && <><Panel title={data.customerName}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
      {['Date', 'Document', 'Memo', 'Debit', 'Credit', 'Balance'].map((name) => <th className={th} key={name}>{name}</th>)}
      </tr></thead><tbody>
      <tr><td className={td} colSpan={5}>Opening balance</td><td className={money}>{peso(data.openingBalanceCents)}</td></tr>
      {data.lines.map((line) => <tr key={line.journalId}><td className={td}>{line.businessDate}</td>
        <td className={td}>{docLink(line.documentType ? line.sourceId : null, line.documentType, line.documentNumber ?? line.journalNumber)}</td>
        <td className={td}>{line.memo}</td><td className={money}>{line.debitCents ? peso(line.debitCents) : ''}</td>
        <td className={money}>{line.creditCents ? peso(line.creditCents) : ''}</td>
        <td className={money}>{peso(line.runningBalanceCents)}</td></tr>)}
      <tr className="font-semibold"><td className={td} colSpan={5}>Closing balance</td><td className={money}>{peso(data.closingBalanceCents)}</td></tr>
    </tbody></table></div></Panel>
    <Panel title="Deposits held"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
      {['Date', 'Document', 'Memo', 'Received', 'Applied', 'Held'].map((name) => <th className={th} key={name}>{name}</th>)}
      </tr></thead><tbody>
      <tr><td className={td} colSpan={5}>Opening deposits held</td><td className={money}>{peso(data.openingDepositsHeldCents)}</td></tr>
      {data.depositLines.map((line) => <tr key={line.journalId}><td className={td}>{line.businessDate}</td>
        <td className={td}>{docLink(line.documentType ? line.sourceId : null, line.documentType, line.documentNumber ?? line.journalNumber)}</td>
        <td className={td}>{line.memo}</td><td className={money}>{line.creditCents ? peso(line.creditCents) : ''}</td>
        <td className={money}>{line.debitCents ? peso(line.debitCents) : ''}</td>
        <td className={money}>{peso(line.runningHeldCents)}</td></tr>)}
      <tr className="font-semibold"><td className={td} colSpan={5}>Deposits held</td><td className={money}>{peso(data.depositsHeldCents)}</td></tr>
    </tbody></table></div></Panel></>}
  </article>;
}
