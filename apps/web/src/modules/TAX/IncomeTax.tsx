/**
 * The 1702Q worksheet (PLAN D5 IT-QPAY, D8 "Quarterly", E12): the quarterly income tax return of Q1, Q2 or Q3, year to
 * date from the books in whole pesos; the tax at the regular rate or MCIT, the credits, what is due, the payments made
 * and what is left, with "Record BIR payment" and the Excel download. Read-only. Below it, the income tax settings in
 * force (rates, the year operations began) and, for someone who may change dated settings, a new version from today on.
 */
import { useEffect, useState } from 'react';
import { api, taxQuarterPath, type DocTypeInfo, type IncomeTaxSettings, type Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { RecordLink, Reckoning, paymentRow } from './EwtWorksheets.tsx';
import { WorksheetChecks } from './QuarterReports.tsx';
import { Excel, QuarterForm, pesos, useQuarterReport } from './ReportParts.tsx';
import { useStepUpAction } from './StepUp.tsx';
import { incomeTaxQuarter, quarterFromQuery } from './bir.ts';
import { incomeTaxReckoning, isIncomeTaxTotal, settingsInput, settingsValues, settingsWords, type SettingsValues } from './income-tax.ts';
import { quarterTitle } from './reports.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';

export function IncomeTaxReturn({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const q = useQuarterReport(allowed, (t) => {
    const asked = quarterFromQuery(location.search);
    return asked && asked.quarter < 4 ? asked : incomeTaxQuarter(t);
  }, api.incomeTaxWorksheet);
  if (!allowed) return <Notice>You cannot view the 1702Q worksheet.</Notice>;
  const w = q.data;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">1702Q worksheet</h1>
      <p className="text-sm text-slate-600">
        The quarterly income tax return, from 1 January to the end of the quarter, in whole pesos. The items are named as on the return but carry no line numbers:
        check them against the form in use. Q4 has no 1702Q: the annual return covers it.
      </p>
      <QuarterForm q={q} quarters={[1, 2, 3]} />
      {q.error && <Notice>{q.error}</Notice>}
      {!w && !q.error && q.pick && <p className="text-slate-500">Loading…</p>}
      {w && (
        <Panel title={`${quarterTitle(w.year, w.quarter, q.today)}, year to date`}>
          <p className="text-sm">
            File and pay the 1702Q by <strong>{w.returnDue}</strong>.
            {w.opening && <> Brought in from the old books by <Link to={docPath('tax.payable.opening', `/${w.opening.documentId}`)} className="underline">{w.opening.number}</Link>.</>}
          </p>
          <WorksheetChecks checks={w.checks} />
          <RecordLink docTypes={docTypes} form="1702Q" period={w.period} />
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">Item</th><th className="pl-3 text-right">Amount</th></tr></thead>
            <tbody>
              {w.lines.map((l) => (
                <tr key={l.key} className={`border-t border-slate-100 align-top ${isIncomeTaxTotal(l.key) ? 'font-semibold' : ''}`}>
                  <td className="py-1 pr-3">{l.label}</td>
                  <td className={num}>{pesos(l.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Reckoning rows={[
            ...incomeTaxReckoning(w),
            ...w.payments.map((p) => paymentRow('Paid with', p)),
            { label: 'Left to pay', cents: w.leftCents, strong: true },
          ]} />
          <p className="text-xs text-slate-500">Rates in force on {w.to}: {settingsWords(w.settings)}.</p>
          <Excel url={taxQuarterPath('1702q', w.year, w.quarter)} />
        </Panel>
      )}
      <SettingsPanel me={me} today={q.today} onSaved={() => q.pick && q.setPick({ ...q.pick })} />
    </div>
  );
}

/** The income tax settings in force and their versions; a new version for someone with acc.settings.manage. */
function SettingsPanel({ me, today, onSaved }: { me: Me; today: string; onSaved: () => void }) {
  const [data, setData] = useState<{ current: IncomeTaxSettings; versions: IncomeTaxSettings[] } | null>(null);
  const [v, setV] = useState<SettingsValues | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [error, setError] = useState('');
  const action = useStepUpAction('changing the income tax settings');
  const mayChange = me.permissions.includes('acc.settings.manage');
  const load = () => api.incomeTaxSettings().then(setData, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return null;
  const set = (patch: Partial<SettingsValues>) => v && setV({ ...v, ...patch });
  const save = () => {
    if (!v) return;
    const checked = settingsInput(v, today);
    setShown(checked.errors);
    if (checked.errors.length) return;
    void action.run(async () => { await api.addIncomeTaxSettings(checked.body); setV(null); await load(); onSaved(); });
  };
  return (
    <Panel title="Income tax settings">
      <p className="text-sm">
        In force today: {settingsWords(data.current)}.{!data.current.confirmed && ' These are the defaults at install: the accountant confirms them.'}
      </p>
      <p className="text-xs text-slate-500">
        The regular rate is 20% for a corporation with taxable income up to ₱5 million and assets up to ₱100 million (land aside), else 25%. MCIT, on gross income,
        applies from the 4th taxable year after the year operations began. Each quarter uses the version in force on its last day.
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="pr-3">From</th><th className="pr-3">Settings</th><th>Reason</th></tr></thead>
        <tbody>
          {data.versions.map((s) => (
            <tr key={s.id} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap py-1 pr-3">{s.effectiveFrom}</td><td className="py-1 pr-3">{settingsWords(s)}</td><td className="py-1">{s.reason}</td></tr>
          ))}
        </tbody>
      </table>
      {mayChange && !v && today && <Button onClick={() => setV(settingsValues(data.current, today))}>Change from a date</Button>}
      {mayChange && v && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="From" required><input type="date" min={today} className={inputClass} value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} /></Field>
            <Field label="Regular rate %" required>
              <select className={inputClass} value={v.regularRate} onChange={(e) => set({ regularRate: e.target.value })}>
                {[...new Set(['20', '25', v.regularRate])].map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </Field>
            <Field label="MCIT rate %" required><input inputMode="decimal" className={`${inputClass} text-right`} value={v.mcitRate} onChange={(e) => set({ mcitRate: e.target.value })} /></Field>
            <Field label="Operations began" hint="Year"><input inputMode="numeric" className={inputClass} value={v.operationsBeganYear} onChange={(e) => set({ operationsBeganYear: e.target.value })} /></Field>
          </div>
          <Field label="Reason" required><input className={inputClass} value={v.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
          {shown.length > 0 && <Notice><ul className="list-disc pl-5">{shown.map((m) => <li key={m}>{m}</li>)}</ul></Notice>}
          {action.error && <Notice>{action.error}</Notice>}
          <div className="flex justify-end gap-2"><Button onClick={() => setV(null)}>Go back</Button><Button tone="primary" type="submit" disabled={action.busy}>Save</Button></div>
        </form>
      )}
      {action.dialog}
    </Panel>
  );
}
