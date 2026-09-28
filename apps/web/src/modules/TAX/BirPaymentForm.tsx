/**
 * BIR payment form (BIRP-, PLAN D5 VAT-PAY and EWT-REM, E12): the return paid (2550Q, 0619-E or 1601-EQ), the quarter
 * or month it pays, where the money came from, the amount (by default what the worksheet leaves to pay), any penalty
 * paid on top and the eFPS, eBIRForms or bank reference. The server's preview shows what the period leaves to pay and,
 * for EWT, what the amount clears per payee. Opened from a worksheet with the return and period filled in. Someone who
 * may backdate (acc.backdate) gives the date paid. Also the Edit of a recorded one (cancel + reissue, NR-4).
 */
import { useEffect, useRef, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CashPlace, type DocTypeInfo, type Me } from '../../api.ts';
import { Button, CashPlaceButtons, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { Errors, useLive } from '../COL/parts.tsx';
import { paidOn } from '../STAT/stat.ts';
import {
  BIR_FORMS, BIR_FORM_WORDS, amountText, birPaymentInput, defaultPeriod, ewtMonthChoices, isBirForm, leftToPay, leftWithDue, paysMonth, periodOf, periodParts, quarterOfPeriod,
  worksheetPath, type BirPaymentInput, type BirValues,
} from './bir.ts';
import { QUARTERS, yearChoices } from './reports.ts';

interface BirPaymentDoc {
  periodLabel: string; payableCents: number; totalCents: number;
  vatClose: { documentId: string; number: string; date: string } | null;
  opening: { documentId: string; number: string; date: string } | null;
  lines: { partyId: string; name: string; payableCents: number; amountCents: number }[];
}

function fromQuery(): BirValues {
  const q = new URLSearchParams(location.search);
  const form = q.get('form');
  const p = isBirForm(form) ? periodParts(q.get('period') ?? '') : null;
  return { form: isBirForm(form) ? form : '', year: p?.year ?? '', part: p?.part ?? '', cashPlaceId: '', amount: '', penalty: '', reference: '', note: '' };
}

export function BirPaymentForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const today = useToday();
  const [v, setV] = useState<BirValues>(fromQuery);
  const [paidOnText, setPaidOnText] = useState('');
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const amountTyped = useRef(false); // once typed (or edited from a recorded one), the worksheet no longer fills it
  const r = useRecord(type, mode, (d) => {
    const input = d.input as unknown as BirPaymentInput;
    const p = periodParts(input.period);
    amountTyped.current = true;
    setV({
      form: input.form, year: p?.year ?? '', part: p?.part ?? '', cashPlaceId: String(input.cashPlaceId), amount: formatPesos(input.amountCents),
      penalty: input.penaltyCents ? formatPesos(input.penaltyCents) : '', reference: input.reference, note: input.note ?? '',
    });
    setPaidOnText(d.header.businessDate);
  });
  useEffect(() => void api.cashPlaces().then(setPlaces, r.fail), []);

  const form = isBirForm(v.form) ? v.form : null;
  const period = form ? periodOf(form, v.year, v.part) : null;
  useEffect(() => {
    setLeft(null);
    if (!form || !period) return;
    let stale = false;
    const { year, quarter } = paysMonth(form) ? { year: 0, quarter: 1 } : quarterOfPeriod(period);
    const worksheet = form === '0619-E' ? api.ewtMonthWorksheet(period) : form === '1601-EQ' ? api.ewtQuarterWorksheet(year, quarter) : api.vatWorksheet(year, quarter);
    // A 2550Q of a quarter before the cut-over has no VAT close here: what its opening left comes with the returns due.
    const cents = worksheet.then(async (w) => {
      const fromWorksheet = leftToPay(form, w);
      return form === '2550Q' && fromWorksheet === 0 ? leftWithDue(form, period, fromWorksheet, await api.taxPaymentsDue()) : fromWorksheet;
    });
    cents.then((cents) => {
      if (stale) return;
      setLeft(cents);
      if (!amountTyped.current) setV((old) => ({ ...old, amount: amountText(cents) }));
    }, () => undefined); // the worksheet is a convenience: the preview still says what is left
    return () => void (stale = true);
  }, [form, period]);

  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  const date = mayBackdate ? paidOn(paidOnText) : {};
  const typed = birPaymentInput(v);
  const { input } = typed;
  const errors = date.error ? [...typed.errors, date.error] : typed.errors;
  const live = useLive(JSON.stringify([input, date.businessDate]), errors.length === 0, () => r.preview(input, date.businessDate));
  const doc = live?.doc as BirPaymentDoc | undefined;
  const set = (patch: Partial<BirValues>) => setV({ ...v, ...patch });
  /** A new return opens on the period whose return is due now. */
  const pickForm = (f: string) => set({ form: f, ...(isBirForm(f) && today ? periodParts(defaultPeriod(f, today)) : { year: '', part: '' }) });
  const years = [...new Set([...(v.year ? [Number(v.year)] : []), ...(today ? yearChoices(today) : [])])].sort((a, b) => b - a);
  const sheet = form && period ? worksheetPath(form, period) : null;

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title('New BIR payment')}</h1>
      {r.top}
      <Panel title="Which return is paid?">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Return" required>
            <select className={inputClass} value={v.form} onChange={(e) => pickForm(e.target.value)}>
              <option value="">Pick one</option>
              {BIR_FORMS.map((f) => <option key={f} value={f}>{BIR_FORM_WORDS[f]}</option>)}
            </select>
          </Field>
          <Field label="Year" required>
            <select className={inputClass} value={v.year} onChange={(e) => set({ year: e.target.value })}>
              <option value="" />
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label={form && paysMonth(form) ? 'Month' : 'Quarter'} required hint={form && paysMonth(form) ? 'The third month of a quarter goes on the 1601-EQ' : undefined}>
            <select className={inputClass} value={v.part} onChange={(e) => set({ part: e.target.value })}>
              <option value="" />
              {form && paysMonth(form)
                ? ewtMonthChoices.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
                : QUARTERS.map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </Field>
        </div>
        {left !== null && form && !r.original && (
          <p className="text-sm text-slate-600">
            The {form} worksheet leaves {peso(left)} to pay.{sheet && <> <Link to={sheet} className="underline">See the worksheet</Link></>}
          </p>
        )}
      </Panel>
      <Panel title="Where did the money come from?">
        <CashPlaceButtons label="Where did the money come from?" places={places} value={v.cashPlaceId} onChange={(id) => set({ cashPlaceId: id })} />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount paid" required hint="The tax paid with the return">
          <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => ((amountTyped.current = true), set({ amount: e.target.value }))} />
        </Field>
        <Field label="Penalty" hint="Surcharge, interest and compromise, paid on top"><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.penalty} onChange={(e) => set({ penalty: e.target.value })} /></Field>
        <Field label="Reference" required hint="eFPS, eBIRForms or bank reference"><input className={inputClass} value={v.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
      </div>
      {mayBackdate && (
        <Field label="Date paid" hint="Leave empty for today. If the payment is recorded later, give the day the money left.">
          <input type="date" max={today || undefined} className={inputClass} value={paidOnText} onChange={(e) => setPaidOnText(e.target.value)} />
        </Field>
      )}
      <Field label="Note"><input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      {live && (
        <Panel title={doc ? `The ${input.form} for ${doc.periodLabel}` : 'Preview'}>
          <p className="text-sm">{live.summary}{date.businessDate && ` Dated ${date.businessDate}, the day paid.`}</p>
          {doc && (
            <p className="text-sm text-slate-600">
              Left to pay with this return: {peso(doc.payableCents)}.
              {doc.vatClose && <> From the VAT close <Link to={docPath('tax.vat_close', `/${doc.vatClose.documentId}`)} className="underline">{doc.vatClose.number}</Link> of {doc.vatClose.date}.</>}
              {doc.opening && <> From the old books: the opening <Link to={docPath('tax.payable.opening', `/${doc.opening.documentId}`)} className="underline">{doc.opening.number}</Link> of {doc.opening.date}.</>}
            </p>
          )}
          {doc && doc.lines.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="pr-3">Payee</th><th className="pl-3 text-right">EWT payable</th><th className="pl-3 text-right">Paid now</th></tr></thead>
              <tbody>
                {doc.lines.map((l) => (
                  <tr key={l.partyId} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{l.name}</td>
                    <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums">{peso(l.payableCents)}</td>
                    <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums">{peso(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {live.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
        </Panel>
      )}
      <Errors list={errors} show={r.touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={() => r.ask(input, errors, date.businessDate)}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}
