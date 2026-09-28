import { useEffect, useState } from 'react';
import { api, type BookletUsage, type Me } from '../../api.ts';
import { Button, Field, Notice, Panel, ReasonDialog, inputClass, longDate } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { bookletInput, documentLink, skippedNumbers, type BookletFields } from './booklets.ts';
import { useStepUpAction } from './StepUp.tsx';

const kindName = (kind: string) => kind === 'SALES_INVOICE' ? 'Sales invoice' : 'Collection receipt';
const status = (active: boolean) => <span className={`rounded-full px-2 py-1 text-xs font-medium ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{active ? 'In use' : 'Retired'}</span>;
const PAGE_SIZE = 100;

export function BookletTable({ rows }: { rows: BookletUsage[] }) {
  return <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
    <table className="w-full text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:py-2">
      <thead className="bg-slate-50 text-left text-slate-500"><tr><th>Kind</th><th>ATP number</th><th>Serial range</th><th>Received</th><th>Status</th><th className="text-right">Used</th><th className="text-right">Skipped</th><th className="text-right">Left</th></tr></thead>
      <tbody>{rows.map(({ booklet: b, usedCount, skippedCount, leftCount }) => <tr key={b.id} className="border-t border-slate-100">
        <td>{kindName(b.kind)}</td><td className="font-medium"><Link className="text-indigo-700 underline" to={`/tax/booklets/${encodeURIComponent(b.id)}`}>{b.atpNo}</Link></td>
        <td className="whitespace-nowrap tabular-nums">{b.serialFrom.toLocaleString()}–{b.serialTo.toLocaleString()}</td><td className="whitespace-nowrap">{longDate(b.receivedOn)}</td>
        <td>{status(b.isActive)}</td><td className="text-right tabular-nums">{usedCount.toLocaleString()}</td><td className="text-right tabular-nums">{skippedCount.toLocaleString()}</td><td className="text-right tabular-nums">{leftCount.toLocaleString()}</td>
      </tr>)}</tbody>
    </table>
    {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No booklets registered yet.</p>}
  </div>;
}

export function Booklets({ me }: { me: Me }) {
  const [rows, setRows] = useState<BookletUsage[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void api.booklets().then(setRows, (e: Error) => setError(e.message)); }, []);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">Booklet register</h1><span className="flex-1" />
      {me.permissions.includes('tax.booklets.manage') && <Link to="/tax/booklets/new" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Register booklet</Link>}
    </div>
    {error && <Notice>{error}</Notice>}
    <p className="text-sm text-slate-600">Used includes cancelled forms. Skipped counts numbers below the last used form that no document took. Left counts numbers after the last used form.</p>
    <BookletTable rows={rows} />
  </div>;
}

export function BookletDetail({ usage, shownUsed, shownSkipped }: { usage: BookletUsage; shownUsed: number; shownSkipped: number }) {
  const { booklet: b } = usage;
  const skipped = skippedNumbers(usage);
  return <div className="space-y-4">
    <Panel title="Booklet details"><dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-slate-500">Kind</dt><dd>{kindName(b.kind)}</dd></div><div><dt className="text-slate-500">ATP number</dt><dd>{b.atpNo}</dd></div>
      <div><dt className="text-slate-500">Serial range</dt><dd className="tabular-nums">{b.serialFrom.toLocaleString()}–{b.serialTo.toLocaleString()}</dd></div>
      <div><dt className="text-slate-500">Received</dt><dd>{longDate(b.receivedOn)}</dd></div>
      <div><dt className="text-slate-500">Status</dt><dd>{status(b.isActive)}</dd></div><div><dt className="text-slate-500">Printer</dt><dd>{b.printer ?? '—'}</dd></div>
      <div><dt className="text-slate-500">Used</dt><dd>{usage.usedCount.toLocaleString()} (including {usage.cancelledCount.toLocaleString()} cancelled)</dd></div>
      <div><dt className="text-slate-500">Skipped / left</dt><dd>{usage.skippedCount.toLocaleString()} / {usage.leftCount.toLocaleString()}</dd></div>
    </dl>{b.note && <p className="text-sm text-slate-600">Last note: {b.note}</p>}</Panel>
    <Panel title={`Used numbers (${usage.usedCount.toLocaleString()})`}>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="py-2">Booklet number</th><th>Document</th><th>Status</th></tr></thead><tbody>
        {usage.used.slice(0, shownUsed).map((line) => <tr key={line.n} className="border-t border-slate-100"><td className="py-2 tabular-nums">{line.n.toLocaleString()}</td>
          <td>{line.documentId && line.docType ? <Link className="text-indigo-700 underline" to={documentLink(line.docType, line.documentId)}>{line.number}</Link> : line.number}</td>
          <td>{line.status === 'cancelled' ? <span className="font-medium text-red-700">Cancelled (all copies kept)</span> : 'Recorded'}</td></tr>)}
      </tbody></table></div>
      {usage.used.length === 0 && <p className="text-sm text-slate-500">No numbers used yet.</p>}
    </Panel>
    <Panel title={`Skipped numbers (${usage.skippedCount.toLocaleString()})`}>
      <p className="text-sm text-slate-600">These numbers are below the last used number and have no document.</p>
      {skipped.length ? <p className="break-words text-sm tabular-nums">{skipped.slice(0, shownSkipped).map((n) => n.toLocaleString()).join(', ')}</p> : <p className="text-sm text-slate-500">No skipped numbers.</p>}
    </Panel>
  </div>;
}

export function BookletPage({ me, params }: { me: Me; params?: Record<string, string> }) {
  const id = params?.id ?? '';
  const [usage, setUsage] = useState<BookletUsage | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [shownUsed, setShownUsed] = useState(PAGE_SIZE);
  const [shownSkipped, setShownSkipped] = useState(PAGE_SIZE);
  const action = useStepUpAction();
  const load = () => api.booklet(id).then(setUsage, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [id]);
  const change = async (reason: string) => {
    if (!usage) return;
    await action.run(async () => { await api.setBookletActive(id, usage.booklet.version, !usage.booklet.isActive, reason); setChanging(false); await load(); });
  };
  const skippedCount = usage ? skippedNumbers(usage).length : 0;
  return <div className="space-y-4">
    <Link to="/tax/booklets" className="text-sm text-indigo-700 underline">← Booklet register</Link>
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{usage ? `ATP ${usage.booklet.atpNo}` : 'Booklet'}</h1><span className="flex-1" />
      {usage && me.permissions.includes('tax.booklets.manage') && <Button onClick={() => setChanging(true)}>{usage.booklet.isActive ? 'Retire booklet' : 'Switch back on'}</Button>}
    </div>
    {error && <Notice>{error}</Notice>}{action.error && <Notice>{action.error}</Notice>}
    {usage && <><BookletDetail usage={usage} shownUsed={shownUsed} shownSkipped={shownSkipped} />
      {shownUsed < usage.used.length && <Button onClick={() => setShownUsed(shownUsed + PAGE_SIZE)}>Show more used numbers</Button>}
      {shownSkipped < skippedCount && <Button onClick={() => setShownSkipped(shownSkipped + PAGE_SIZE)}>Show more skipped numbers</Button>}
    </>}
    {changing && usage && <ReasonDialog title={usage.booklet.isActive ? 'Retire booklet' : 'Switch booklet back on'}
      explain={usage.booklet.isActive ? 'This booklet will no longer accept new numbers. Its existing records stay in the register.' : 'This booklet will accept new numbers again.'}
      confirmLabel={usage.booklet.isActive ? 'Retire booklet' : 'Switch back on'} danger={usage.booklet.isActive}
      onClose={() => setChanging(false)} onConfirm={change}>{action.error && <Notice>{action.error}</Notice>}</ReasonDialog>}
    {action.dialog}
  </div>;
}

const blank: BookletFields = { kind: 'SALES_INVOICE', atpNo: '', printer: '', serialFrom: '', serialTo: '', receivedOn: '', note: '' };
export function RegisterBooklet({ me }: { me: Me }) {
  const [fields, setFields] = useState<BookletFields>(blank);
  const [errors, setErrors] = useState<string[]>([]);
  const action = useStepUpAction();
  if (!me.permissions.includes('tax.booklets.manage')) return <Notice>You do not have permission to register a booklet.</Notice>;
  const set = <K extends keyof BookletFields>(key: K, value: BookletFields[K]) => setFields((f) => ({ ...f, [key]: value }));
  const save = () => {
    const checked = bookletInput(fields);
    setErrors(checked.errors);
    if (!checked.input) return;
    void action.run(async () => { const b = await api.registerBooklet(checked.input!); navigate(`/tax/booklets/${encodeURIComponent(b.id)}`); });
  };
  return <div className="max-w-2xl space-y-4">
    <Link to="/tax/booklets" className="text-sm text-indigo-700 underline">← Booklet register</Link>
    <h1 className="text-2xl font-semibold">Register a booklet</h1>
    <p className="text-sm text-slate-600">Check the ATP number and serial range before saving. A registered range cannot be edited.</p>
    <Panel title="Booklet details"><form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
      <Field label="Kind" required><select className={inputClass} value={fields.kind} onChange={(e) => set('kind', e.target.value as BookletFields['kind'])}><option value="SALES_INVOICE">Sales invoice</option><option value="CR">Collection receipt</option></select></Field>
      <Field label="ATP number" required><input className={inputClass} value={fields.atpNo} onChange={(e) => set('atpNo', e.target.value)} /></Field>
      <Field label="Printer"><input className={inputClass} value={fields.printer} onChange={(e) => set('printer', e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="First serial number" required><input inputMode="numeric" className={inputClass} value={fields.serialFrom} onChange={(e) => set('serialFrom', e.target.value)} /></Field>
        <Field label="Last serial number" required><input inputMode="numeric" className={inputClass} value={fields.serialTo} onChange={(e) => set('serialTo', e.target.value)} /></Field></div>
      <Field label="Date received" required><input type="date" className={inputClass} value={fields.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} /></Field>
      <Field label="Note"><textarea rows={2} className={inputClass} value={fields.note} onChange={(e) => set('note', e.target.value)} /></Field>
      {errors.length > 0 && <Notice><ul className="list-disc pl-5">{errors.map((message) => <li key={message}>{message}</li>)}</ul></Notice>}
      {action.error && <Notice>{action.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={() => navigate('/tax/booklets')}>Go back</Button><Button tone="primary" type="submit" disabled={action.busy}>Register booklet</Button></div>
    </form></Panel>
    {action.dialog}
  </div>;
}
