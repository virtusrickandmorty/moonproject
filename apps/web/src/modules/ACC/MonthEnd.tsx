/**
 * Accounting & Tax › Month-end checklist (PLAN D8 "Monthly"): pick a month; each item shows done, not done or not needed,
 * read from the app, with a link to the screen that does it. The accountant signs the month off with a note (fresh
 * password); a change dated in a signed-off month shows here as "changed after sign-off".
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type MonthEndChecklist } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { STATE_CLASS, STATE_LABEL, monthChoices, monthName, noteError, signoffButton, signoffLine, summaryLine } from './month-end.ts';

const Chip = ({ state }: { state: keyof typeof STATE_LABEL }) => <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>;
const when = (ts: string) => `${ts.slice(0, 10)} ${ts.slice(11, 16)}`;

export function MonthEnd({ me }: { me: Me }) {
  const [month, setMonth] = useState('');
  const [data, setData] = useState<MonthEndChecklist>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const action = useStepUpAction('signing off the month');
  const load = useCallback((m?: string) => api.monthEnd(m).then((d) => { setData(d); setMonth(d.month); setError(''); }, (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  if (!me.permissions.includes('acc.monthend.view')) return <Notice>Access denied.</Notice>;
  const choices = data ? monthChoices(data.asOf) : [];
  const signed = data && signoffLine(data);
  const problem = noteError(note);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Month-end checklist</h1>
        <Field label="Month">
          <select className={inputClass} value={month} onChange={(e) => { setMonth(e.target.value); setData(undefined); void load(e.target.value); }}>
            {(choices.some((c) => c.value === month) || !month ? choices : [{ value: month, label: monthName(month) }, ...choices]).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      {error && <Notice>{error}</Notice>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <>
          <p className="text-sm text-slate-700">{monthName(data.month)}: {summaryLine(data.items)} Read from the app as of {data.asOf}.</p>
          {signed && (
            <Notice tone={signed.changed ? 'warning' : 'success'}>
              {signed.text} “{data.signoff!.note}”
              {signed.changed && <> <strong>Changed after sign-off:</strong> {data.changedAfterSignoff!.count} {data.changedAfterSignoff!.count === 1 ? 'document' : 'documents'} dated in {monthName(data.month)} {data.changedAfterSignoff!.count === 1 ? 'was' : 'were'} recorded or cancelled since.</>}
            </Notice>
          )}
          <Panel title="Items">
            <ul className="divide-y divide-slate-100">
              {data.items.map((i) => (
                <li key={i.key} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip state={i.state} />
                    <span className="font-medium">{i.title}</span>
                    <Link to={i.href} className="ml-auto text-sm text-indigo-700 hover:underline">{i.linkLabel}</Link>
                  </div>
                  <p className="text-sm text-slate-700">{i.detail}</p>
                  {i.rows.length > 0 && (
                    <ul className="ml-2 space-y-0.5 border-l border-slate-200 pl-3 text-sm">
                      {i.rows.map((r) => (
                        <li key={r.label} className="flex flex-wrap items-baseline gap-2"><Chip state={r.state} /><span>{r.label}</span><span className="text-slate-500">{r.detail}</span></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          {data.changedAfterSignoff && data.changedAfterSignoff.count > 0 && (
            <Panel title="Changed after sign-off">
              <ul className="space-y-1 text-sm">
                {data.changedAfterSignoff.documents.map((d) => <li key={`${d.number}:${d.action}`}>{d.number} · {d.title} dated {d.date}, {d.action} {when(d.at)}</li>)}
              </ul>
              {data.changedAfterSignoff.count > data.changedAfterSignoff.documents.length && <p className="text-xs text-slate-500">The first {data.changedAfterSignoff.documents.length} of {data.changedAfterSignoff.count} are listed.</p>}
            </Panel>
          )}
          <Panel title="Sign-off">
            {data.earlierSignoffs.length > 0 && (
              <ul className="text-sm text-slate-600">
                {data.earlierSignoffs.map((s) => <li key={s.id}>Earlier: {s.signedByName}, {when(s.signedAt)}. “{s.note}”</li>)}
              </ul>
            )}
            {data.canSignOff ? (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void action.run(async () => { setData(await api.signOffMonth(data.month, note.trim())); setNote(''); }); }}>
                <Field label="Note" hint="What you checked, and what is still open and why." error={note && problem ? problem : undefined}>
                  <textarea className={inputClass} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Button tone="primary" type="submit" disabled={!!problem || action.busy}>{signoffButton(data)}</Button>
                <p className="text-xs text-slate-500">You will be asked for your password. A sign-off is kept as it was; nothing is edited or deleted.</p>
              </form>
            ) : (
              <p className="text-sm text-slate-600">
                {!data.over ? `${monthName(data.month)} has not ended yet. It can be signed off after its last day.` : me.permissions.includes('acc.monthend.signoff') ? '' : 'Only the accountant signs a month off.'}
              </p>
            )}
            {action.error && <Notice>{action.error}</Notice>}
            {action.dialog}
          </Panel>
          <p className="text-sm text-slate-500">The exceptions inbox and the old drafts are read as of today, whichever month you pick.</p>
        </>
      )}
    </div>
  );
}
