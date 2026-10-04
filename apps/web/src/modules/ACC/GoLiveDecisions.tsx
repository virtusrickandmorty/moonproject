import { useCallback, useEffect, useState } from 'react';
import { api, type GoLiveDecision, type GoLiveRegister, type Me } from '../../api.ts';
import { Button, Field, Notice, inputClass, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { GO_LIVE_PRINT_TITLE, visibleDecisions } from './go-live.ts';

const groupName = { accountant: 'Accountant', owner: 'Owner', 'co-owners': 'Co-owners' } as const;
function Decision({ row, reload, canAnswer }: { row: GoLiveDecision; reload: (d: GoLiveRegister) => void; canAnswer: boolean }) {
  const [answer, setAnswer] = useState(''), [name, setName] = useState(''), [date, setDate] = useState(''), [note, setNote] = useState('');
  const action = useAction(), latest = row.history[0];
  const submit = () => void action.run(async () => { reload(await api.recordGoLiveAnswer({ decisionId: row.id, answer: answer.trim(), decidedBy: name.trim(), decidedOn: date, note: note.trim() })); setAnswer(''); setNote(''); });
  return <article className="break-inside-avoid space-y-2 border-b border-slate-200 py-4">
    <div className="flex flex-wrap gap-2"><strong>{row.id}</strong><span className="rounded bg-slate-100 px-2 text-xs">{groupName[row.group]}</span><span className="text-xs text-slate-500">Needed: {row.when}</span></div>
    <p>{row.question}</p><p className="text-sm text-slate-600"><strong>Default:</strong> {row.defaultAnswer}</p>
    {row.setting && <p className={`text-sm ${row.setting.matches === false ? 'font-medium text-amber-800' : 'text-slate-600'}`}>Current setting: <strong>{row.setting.words}</strong>. <Link className="underline print:hidden" to="/acc/settings">Open Settings</Link>{row.setting.matches === false && ' — Warning: the recorded answer differs from this setting.'}</p>}
    {!latest && <p className="font-medium text-amber-700">Open — no answer recorded.</p>}
    {row.history.length > 0 && <details open><summary className="text-sm font-medium">History ({row.history.length})</summary><ol className="ml-5 list-decimal text-sm">{row.history.map((h, i) => <li key={h.id} className={i ? 'text-slate-500' : ''}><strong>{h.answer}</strong> — {h.decidedBy}, {h.decidedOn}{h.note && <>. {h.note}</>} <span className="text-xs">(recorded by {h.recordedByName})</span></li>)}</ol></details>}
    {canAnswer && <form className="grid gap-2 sm:grid-cols-2 print:hidden" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field label="What was decided (or done)" required><input className={inputClass} maxLength={1000} value={answer} onChange={(e) => setAnswer(e.target.value)} /></Field>
      <Field label="Who decided it" required><input className={inputClass} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Decision date" required><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Note"><input className={inputClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div><Button tone="primary" type="submit" disabled={action.busy || !answer.trim() || name.trim().length < 2 || !date}>Record new answer</Button></div>
      {action.error && <Notice>{action.error}</Notice>}
    </form>}
  </article>;
}
export function GoLiveDecisions({ me }: { me: Me }) {
  const [data, setData] = useState<GoLiveRegister>(), [group, setGroup] = useState('all'), [error, setError] = useState('');
  const load = useCallback(() => api.goLiveDecisions().then(setData, (e: Error) => setError(e.message)), []); useEffect(() => void load(), [load]);
  if (!me.permissions.includes('acc.golive.view')) return <Notice>Access denied.</Notice>;
  return <div className="max-w-4xl space-y-4 print:max-w-none">
    <style>{'@media print{@page{size:A4;margin:12mm} nav,header,.print\\:hidden{display:none!important} body{font-size:10pt} details>summary{display:none}}'}</style>
    <div className="flex flex-wrap items-end gap-3"><div><h1 className="text-2xl font-semibold">{GO_LIVE_PRINT_TITLE}</h1><p className="text-sm text-slate-600">{data ? `${data.open} of ${data.rows.length} rows still open.` : 'Loading…'}</p></div><span className="flex-1"/><Field label="Who must decide"><select className={`${inputClass} print:hidden`} value={group} onChange={(e) => setGroup(e.target.value)}><option value="all">Everyone</option><option value="accountant">Accountant</option><option value="owner">Owner</option><option value="co-owners">Co-owners</option></select></Field><Button className="print:hidden" onClick={() => window.print()}>Print for signature</Button></div>
    {error && <Notice>{error}</Notice>}{data && visibleDecisions(data.rows, group).map((r) => <Decision key={r.id} row={r} reload={setData} canAnswer={me.permissions.includes('acc.golive.answer')} />)}
    <div className="hidden border-t pt-8 print:block">Accountant signature: ____________________ &nbsp; Date: ____________________</div>
  </div>;
}
