/**
 * The 1702-RT worksheet (PLAN D5 IT-PROV and IT-SETTLE, D8 "Yearly", E12): the annual income tax return of a year from
 * the books in whole pesos; the deductions (itemized, or the 40% optional standard deduction picked for the year), the
 * tax at the regular rate or MCIT, the credits, and what is payable or carried over. Under it the provision, the
 * settlement and the 1702 payments, with links to record each, and the Excel download. Below, the year's deduction
 * method and, for someone who may change dated settings, a new version from today on. Read-only otherwise.
 * Also the provision and settlement form (YearEndTaxForm): pick the year and read the server's preview before recording.
 */
import { useEffect, useState } from 'react';
import { api, taxYearPath, type DeductionSetting, type DocTypeInfo, type Me, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, longDate, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { RecordLink, Reckoning, paymentRow } from './EwtWorksheets.tsx';
import { WorksheetChecks } from './QuarterReports.tsx';
import { Excel, pesos } from './ReportParts.tsx';
import { useStepUpAction } from './StepUp.tsx';
import { annualReckoning, deductionInput, deductionWords, isAnnualTotal, provisionPath, settlementPath, yearEndDate, yearFromQuery, type DeductionValues } from './annual.ts';
import { settingsWords } from './income-tax.ts';
import { yearChoices } from './reports.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';

/** A report of one year: opens on the year in its link (or last year) of the server's today, and loads again when the year changes. */
export function useYearReport<T>(allowed: boolean, load: (year: number) => Promise<T>) {
  const [today, setToday] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (allowed) api.health().then((h) => {
      const t = h.serverTime.slice(0, 10);
      setToday(t);
      setYear(yearFromQuery(location.search, t));
    }, (e: Error) => setError(e.message));
  }, [allowed]);
  useEffect(() => {
    if (year === null) return;
    let current = true; // only the last answer is shown
    setData(null);
    setError('');
    load(year).then((d) => current && setData(d), (e: Error) => current && setError(e.message));
    return () => void (current = false);
  }, [year, again]);
  return { today, year, setYear, data, error, reload: () => setAgain((n) => n + 1) };
}

export function YearPicker({ today, year, setYear }: { today: string; year: number | null; setYear: (y: number) => void }) {
  if (year === null) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <Field label="Year">
        <select className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[...new Set([year, ...yearChoices(today)])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </Field>
    </div>
  );
}

const canCreate = (docTypes: DocTypeInfo[], key: string) => docTypes.some((d) => d.key === key && d.canCreate);
const button = 'inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700';

export function AnnualIncomeTaxReturn({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const allowed = me.permissions.includes('tax.registers.view');
  const r = useYearReport(allowed, api.annualIncomeTaxWorksheet);
  if (!allowed) return <Notice>You cannot view the 1702-RT worksheet.</Notice>;
  const w = r.data;
  const ended = !!w && r.today > w.to;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">1702-RT worksheet (annual income tax)</h1>
      <p className="text-sm text-slate-600">
        The annual income tax return, 1 January to 31 December, in whole pesos. The items are named as on the return but carry no line numbers: check them
        against the form in use. The provision books the year's tax on 31 December; the settlement applies the 1702Q payments and the 2307s in hand against it.
      </p>
      <YearPicker today={r.today} year={r.year} setYear={r.setYear} />
      {r.error && <Notice>{r.error}</Notice>}
      {!w && !r.error && r.year !== null && <p className="text-slate-500">Loading…</p>}
      {w && (
        <Panel title={`${w.year}${ended ? '' : ', so far'}`}>
          <p className="text-sm">File and pay the 1702-RT by <strong>{w.returnDue}</strong>.</p>
          <WorksheetChecks checks={w.checks} />
          <div className="flex flex-wrap gap-2">
            {ended && !w.provision && !w.opening && w.provisionCents > 0 && canCreate(docTypes, 'tax.it_provision') && <Link to={provisionPath(w.year)} className={button}>Record the provision</Link>}
            {ended && !w.settlement && !w.opening && (w.provision || w.provisionCents <= 0) && canCreate(docTypes, 'tax.it_settlement') && <Link to={settlementPath(w.year)} className={button}>Record the settlement</Link>}
            {w.leftCents > 0 && <RecordLink docTypes={docTypes} form="1702" period={String(w.year)} />}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">Item</th><th className="pl-3 text-right">Amount</th></tr></thead>
            <tbody>
              {w.lines.map((l) => (
                <tr key={l.key} className={`border-t border-slate-100 align-top ${isAnnualTotal(l.key) ? 'font-semibold' : ''}`}>
                  <td className="py-1 pr-3">{l.label}</td>
                  <td className={num}>{pesos(l.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Reckoning rows={[
            ...annualReckoning(w),
            ...w.payments.map((p) => paymentRow('Paid with', p)),
            { label: 'Left to pay', cents: w.leftCents, strong: true },
          ]} />
          <p className="text-xs text-slate-500">
            Rates in force on {w.to}: {settingsWords(w.settings)}. Deductions: {deductionWords(w.deduction)}.
            {w.provision && <> Provision <Link to={docPath('tax.it_provision', `/${w.provision.documentId}`)} className="underline">{w.provision.number}</Link>.</>}
            {w.settlement && <> Settlement <Link to={docPath('tax.it_settlement', `/${w.settlement.documentId}`)} className="underline">{w.settlement.number}</Link>.</>}
          </p>
          <Excel url={taxYearPath('1702rt', w.year)} />
        </Panel>
      )}
      {r.year !== null && <DeductionPanel me={me} year={r.year} today={r.today} onSaved={r.reload} />}
    </div>
  );
}

/** The year's deduction method and its versions; a new version for someone with acc.settings.manage. */
function DeductionPanel({ me, year, today, onSaved }: { me: Me; year: number; today: string; onSaved: () => void }) {
  const [data, setData] = useState<{ current: DeductionSetting; versions: DeductionSetting[] } | null>(null);
  const [v, setV] = useState<DeductionValues | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [error, setError] = useState('');
  const action = useStepUpAction('changing the deductions of the year');
  const mayChange = me.permissions.includes('acc.settings.manage');
  const load = () => api.incomeTaxDeductions(year).then(setData, (e: Error) => setError(e.message));
  useEffect(() => void (setV(null), load()), [year]);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return null;
  const save = () => {
    if (!v) return;
    const checked = deductionInput(year, v, today);
    setShown(checked.errors);
    if (checked.errors.length) return;
    void action.run(async () => { await api.addIncomeTaxDeduction(checked.body); setV(null); await load(); onSaved(); });
  };
  return (
    <Panel title={`Deductions of ${year}`}>
      <p className="text-sm">In force today: {deductionWords(data.current)}.</p>
      <p className="text-xs text-slate-500">
        A corporation deducts its expenses (itemized), or instead takes the optional standard deduction: 40% of gross income, with no expenses deducted. The
        choice is made for the whole year; until the accountant confirms it, the worksheet uses itemized and says so.
      </p>
      {data.versions.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="pr-3">From</th><th className="pr-3">Deductions</th><th>Reason</th></tr></thead>
          <tbody>
            {data.versions.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap py-1 pr-3">{s.effectiveFrom}</td><td className="py-1 pr-3">{s.method === 'osd' ? '40% optional standard deduction' : 'Itemized'}</td><td className="py-1">{s.reason}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {mayChange && !v && today && <Button onClick={() => setV({ method: data.current.method === 'osd' ? 'itemized' : 'osd', effectiveFrom: today, reason: '' })}>Change from a date</Button>}
      {mayChange && v && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" required><input type="date" min={today} className={inputClass} value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} /></Field>
            <Field label="Deductions" required>
              <select className={inputClass} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as DeductionValues['method'] })}>
                <option value="itemized">Itemized</option>
                <option value="osd">40% optional standard deduction</option>
              </select>
            </Field>
          </div>
          <Field label="Reason" required><input className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
          {shown.length > 0 && <Notice><ul className="list-disc pl-5">{shown.map((m) => <li key={m}>{m}</li>)}</ul></Notice>}
          {action.error && <Notice>{action.error}</Notice>}
          <div className="flex justify-end gap-2"><Button onClick={() => setV(null)}>Go back</Button><Button tone="primary" type="submit" disabled={action.busy}>Save</Button></div>
        </form>
      )}
      {action.dialog}
    </Panel>
  );
}

/**
 * The provision (ITP-) and settlement (ITS-) form: the year, a note, and the server's preview (summary, checks and the
 * journal) before anything is recorded. A provision carries the year's 31 December; a settlement today, or 31 December
 * when the accountant picks it. Edit = cancel and record again with the books' figures now (NR-4).
 */
export function YearEndTaxForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const kind = type.key === 'tax.it_provision' ? 'provision' : 'settlement';
  const today = useToday();
  const [year, setYear] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [onYearEnd, setOnYearEnd] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const r = useRecord(type, mode, (d) => {
    const input = d.input as { year: number; note?: string };
    setYear(input.year);
    setNote(input.note ?? '');
    setOnYearEnd(d.header.businessDate === `${input.year}-12-31`);
  });
  useEffect(() => void (today && mode.kind === 'new' && year === null && setYear(yearFromQuery(location.search, today))), [today]);

  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const businessDate = year === null ? undefined : yearEndDate(kind, year, today, mayBackdate, onYearEnd);
  const input = year === null ? null : { year, ...(note.trim() ? { note: note.trim() } : {}) };
  const key = JSON.stringify([input, businessDate]);
  useEffect(() => {
    setPreview(null);
    if (!input || !today) return;
    let stale = false;
    const t = setTimeout(() => r.preview(input, businessDate).then((p) => stale || setPreview(p), (e: Error) => stale || r.fail(e)), 250);
    return () => ((stale = true), clearTimeout(t));
  }, [key, today]);

  if (r.gate) return r.gate;
  const end = year === null ? '' : `${year}-12-31`;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title(kind === 'provision' ? 'Provide the income tax of a year' : 'Settle the income tax of a year')}</h1>
      {r.top}
      {year !== null && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Year">
            <select className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[...new Set([year, ...yearChoices(today || `${year}-01-01`)])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Link to={`/tax/1702rt?${new URLSearchParams({ year: String(year) })}`} className="pb-2 text-sm underline">See the 1702-RT worksheet</Link>
        </div>
      )}
      {year !== null && today > end && (kind === 'provision'
        ? <p className="text-sm text-slate-600">Dated {longDate(end)}, the year's last day.</p>
        : mayBackdate
        ? (
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Date of the settlement</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={!onYearEnd} onChange={() => setOnYearEnd(false)} /> Today, {longDate(today)}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={onYearEnd} onChange={() => setOnYearEnd(true)} /> {longDate(end)}, the year's last day</label>
          </fieldset>
        )
        : <p className="text-sm text-slate-600">Dated today, {longDate(today)}.</p>)}
      {year !== null && (
        <Panel title={kind === 'provision' ? `Income tax of ${year}` : `Credits of ${year} against its income tax`}>
          {!preview && <p className="text-slate-500">Working it out…</p>}
          {preview && (
            <>
              <p>{preview.summary}</p>
              {preview.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
              {preview.journal && preview.journal.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500"><tr><th className="pr-3">Account</th><th className="pl-3 text-right">Debit</th><th className="pl-3 text-right">Credit</th></tr></thead>
                  <tbody>
                    {preview.journal.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100"><td className="py-1 pr-3">{l.accountCode} {l.accountName}</td><td className={num}>{l.debitCents ? peso(l.debitCents) : ''}</td><td className={num}>{l.creditCents ? peso(l.creditCents) : ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-sm text-slate-500">Nothing is recorded until you press Record.</p>
            </>
          )}
        </Panel>
      )}
      <Field label="Note" hint="Optional, e.g. the 1702-RT reference"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost || !input} onClick={() => r.ask(input, [], businessDate)}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}
