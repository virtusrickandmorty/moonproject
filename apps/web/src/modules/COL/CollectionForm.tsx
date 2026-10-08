/**
 * Collection form (PLAN E5, H2): the customer, what they pay on (job orders and quick sales still owed, oldest due first),
 * where the money went (split tenders), tax withheld (2307, with VAT withheld by government buyers) and the CR booklet number. The server computes every split;
 * this screen suggests the customer's withholding, then sends the encoder's figures. Also the Edit of a recorded collection (cancel + reissue, NR-4).
 * A check put in Checks on hand carries its number, bank and date; `?pdc=<id>` fills the form from a post-dated check
 * that is due (ACC-23): its customer, the check in Checks on hand, and its amount on its job orders, oldest due first.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, type CashPlace, type DocHeader, type DocTypeInfo, type OpenItems, type PostDatedCheck, type Preview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Field, Notice, Panel, inputClass, showDate } from '../../components/ui.tsx';
import { SalesActions, Exception } from '../JO/entry.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { PrintedDateField, usePrintedDate } from '../../generic/PrintedDate.tsx';
import { cents, checkPlaceIds, emptyTender, oldestFirst, sum, tendersToInput, tendersToRows, type TenderInput, type TenderRow } from './money.ts';
import { CustomerPicker, EditGate, Errors, Figures, TenderRows, useLive, type Picked } from './parts.tsx';
import { collectionPreset } from '../JO/forms.ts';
import type { WithholdingProfile } from '../CUS/withholding.ts';
import { emptyWithholding, paymentGross, withholdingRows, type WithholdingRows } from './withholding.ts';

/** Something the customer can pay on; `due` already counts back what the collection being edited paid on it. */
interface Item { key: string; label: string; date: string; due: number; ref: { jobOrderId: string } | { saleId: string } }
type Stored = { customerId: string; crNumber: string; applications: { jobOrderId: string; amountCents: number }[]; sales?: { saleId: string; amountCents: number }[]; tenders: TenderInput[];
  withholding?: { cwtCents: number; atc: string; certificate: string; vatWithheldCents?: number }; settleSmallDifference?: boolean; note?: string; postDatedCheckId?: string };
type StoredDoc = { customerName: string; applications: { jobOrderId: string; jobOrderNumber: string }[]; sales: { saleId: string; saleNumber: string; invoiceNumber: string }[] };

function itemsOf(open: OpenItems, original?: { input: Stored; doc: StoredDoc }): Item[] {
  const back = new Map<string, number>([
    ...(original?.input.applications ?? []).map((a): [string, number] => [`jo:${a.jobOrderId}`, a.amountCents]),
    ...(original?.input.sales ?? []).map((a): [string, number] => [`qs:${a.saleId}`, a.amountCents]),
  ]);
  const items: Item[] = [
    ...open.jobOrders.map((jo) => ({ key: `jo:${jo.id}`, label: `${jo.number} · due ${showDate(jo.dueDate)}`, date: jo.dueDate, due: jo.balanceDueCents, ref: { jobOrderId: jo.id } })),
    ...open.quickSales.map((s) => ({ key: `qs:${s.id}`, label: `Invoice no. ${s.invoiceNumber} (${s.number}) · ${showDate(s.businessDate)}`, date: s.businessDate, due: s.openCents, ref: { saleId: s.id } })),
  ];
  // What the collection being edited paid is owed again once it is cancelled; fully paid items are not in open items.
  for (const [key, cents] of back) {
    const it = items.find((i) => i.key === key);
    if (it) it.due += cents;
    else if (key.startsWith('jo:')) {
      const id = key.slice(3);
      items.push({ key, label: original!.doc.applications.find((a) => a.jobOrderId === id)?.jobOrderNumber ?? 'Job order', date: '', due: cents, ref: { jobOrderId: id } });
    } else {
      const s = original!.doc.sales.find((a) => a.saleId === key.slice(3));
      items.push({ key, label: s ? `Invoice no. ${s.invoiceNumber} (${s.saleNumber})` : 'Quick sale', date: '', due: cents, ref: { saleId: key.slice(3) } });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function CollectionForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [open, setOpen] = useState<OpenItems | null>(null);
  const [original, setOriginal] = useState<{ header: DocHeader; input: Stored; doc: StoredDoc }>();
  const printed = usePrintedDate(original?.header);
  const [reason, setReason] = useState('');
  const [crNumber, setCr] = useState('');
  const [tenders, setTenders] = useState<TenderRow[]>([emptyTender()]);
  const [manualCwt, setCwt] = useState<WithholdingRows | null>(null);
  const [certificate, setCertificate] = useState('pending');
  const [profile, setProfile] = useState<{ customerId: string; value: WithholdingProfile; vatBp: number } | null>(null);
  const [typed, setTyped] = useState<Record<string, string> | null>(null); // null = apply oldest first
  const [settle, setSettle] = useState(false);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);

  // From a job order's view: its customer, and the downpayment still asked or the balance due, paid on that job order.
  const [preset, setPreset] = useState<{ key: string; cents: number } | null>(null);
  // From the post-dated checks list: the check, due today or earlier.
  const [pdc, setPdc] = useState<PostDatedCheck | null>(null);
  useEffect(() => {
    api.cashPlaces().then(setPlaces, fail);
    const q = new URLSearchParams(location.search);
    const pdcId = q.get('pdc');
    if (mode.kind === 'new' && pdcId) {
      api.pdc(pdcId).then((p) => {
        setPdc(p);
        setCustomer({ id: p.customerId, name: p.customerName });
        setNote(`Post-dated check no. ${p.checkNumber} (${p.bank}) dated ${showDate(p.checkDate)}`);
      }, fail);
    }
    const jo = q.get('jo');
    if (mode.kind === 'new' && jo) {
      api.joStatus(jo).then((s) => {
        const p = collectionPreset(s, q.get('for') === 'downpayment');
        setCustomer(p.customer);
        setPreset({ key: p.key, cents: p.cents });
      }, fail);
    }
    if (mode.kind !== 'edit') return;
    api.get(type.key, mode.id).then((d) => {
      const input = d.input as Stored;
      const doc = d.doc as StoredDoc;
      setOriginal({ header: d.header, input, doc });
      setCustomer({ id: input.customerId, name: doc.customerName });
      setTenders(tendersToRows(input.tenders));
      const w = input.withholding;
      setCwt(w ? { amount: formatPesos(w.cwtCents), atc: w.atc, certificate: w.certificate, vat: w.vatWithheldCents ? formatPesos(w.vatWithheldCents) : '' } : emptyWithholding());
      setCertificate(w?.certificate ?? 'pending');
      setTyped(Object.fromEntries([...input.applications.map((a) => [`jo:${a.jobOrderId}`, formatPesos(a.amountCents)]), ...(input.sales ?? []).map((a) => [`qs:${a.saleId}`, formatPesos(a.amountCents)])]));
      setSettle(!!input.settleSmallDifference);
      setNote(input.note ?? '');
    }, fail);
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);

  useEffect(() => {
    setOpen(null);
    setProfile(null);
    if (!customer) return;
    let stale = false;
    api.openItems(customer.id).then((o) => { if (!stale) setOpen(o); }, (e: Error) => { if (!stale) fail(e); });
    Promise.all([api.customerWithholding(customer.id), api.settings()]).then(([c, settings]) => {
      if (stale) return;
      const vatBp = settings.find((s) => s.key === 'tax.vat_rate_bp')?.current;
      if (typeof vatBp !== 'number') throw new Error('Could not read the VAT rate for the withholding suggestion.');
      setProfile({ customerId: customer.id, value: c.withholding_profile, vatBp });
    }).catch((e: Error) => { if (!stale) fail(e); });
    return () => { stale = true; };
  }, [customer?.id]);

  // The check goes to Checks on hand with its details once the cash places are known.
  const checksPlace = places.find((p) => p.kind === 'checks');
  useEffect(() => {
    if (!pdc || !checksPlace) return;
    setTenders([{ cashPlaceId: String(checksPlace.id), amount: formatPesos(pdc.amountCents), reference: '', checkNumber: pdc.checkNumber, bank: pdc.bank, checkDate: pdc.checkDate }]);
  }, [pdc?.id, checksPlace?.id]);

  const items = useMemo(() => (open?.customerId === customer?.id && open ? itemsOf(open, original?.input.customerId === open.customerId ? original : undefined) : []), [open, original, customer?.id]);
  useEffect(() => {
    if (!preset || !open || !items.some((i) => i.key === preset.key)) return;
    const amount = preset.cents > 0 ? formatPesos(preset.cents) : '';
    setTyped(Object.fromEntries(items.map((i) => [i.key, i.key === preset.key ? amount : ''])));
    setTenders([{ ...emptyTender(), amount }]);
    setPreset(null);
  }, [preset, open, items]);
  // The check's amount goes to the job orders it is for, oldest due first; anything left is kept as a deposit.
  useEffect(() => {
    if (!pdc || !open || original) return;
    const mine = items.filter((i) => 'jobOrderId' in i.ref && pdc.jobOrders.some((j) => 'jobOrderId' in i.ref && j.id === i.ref.jobOrderId));
    const paid = oldestFirst(pdc.amountCents, mine.map((i) => i.due));
    setTyped(Object.fromEntries(items.map((i) => {
      const n = mine.indexOf(i);
      return [i.key, n >= 0 && paid[n]! > 0 ? formatPesos(paid[n]!) : ''];
    })));
  }, [pdc?.id, open, items]);
  const pay = tendersToInput(tenders, undefined, checkPlaceIds(places));
  const mine = profile?.customerId === customer?.id ? profile : null;
  const cashCents = sum(pay.tenders.map((t) => t.amountCents));
  const selectedCents = typed ? sum(items.map((i) => Math.max(0, cents(typed[i.key] ?? '') ?? 0))) : 0;
  const grossCents = selectedCents || (mine ? paymentGross(mine.value, cashCents, mine.vatBp) : cashCents);
  const cwt = { ...withholdingRows(manualCwt, mine?.value ?? 'none', grossCents, mine?.vatBp ?? 0), certificate };
  const cwtCents = cents(cwt.amount);
  const vatWithheldCents = cents(cwt.vat);
  const received = sum(pay.tenders.map((t) => t.amountCents)) + (cwtCents ?? 0) + (vatWithheldCents ?? 0);
  const auto = oldestFirst(received, items.map((i) => i.due));
  const amountOf = (i: Item, n: number) => (typed ? cents(typed[i.key] ?? '') : auto[n]);
  const amounts = items.map(amountOf);
  const applied = sum(amounts.map((a) => a ?? 0));

  const errors = [
    ...(customer ? [] : ['Pick the customer.']),
    ...(printed.error ? [printed.error] : []),
    ...(/^\d+$/.test(crNumber.trim()) ? [] : ['Type the CR number from the booklet (digits only).']),
    ...pay.errors,
    ...(cwtCents === undefined ? ['Type the tax withheld like 250.00'] : cwtCents > 0 && !cwt.atc ? ['Pick the tax code (ATC).'] : []),
    ...(vatWithheldCents === undefined ? ['Type the VAT withheld like 500.00'] : vatWithheldCents > 0 && !cwtCents ? ['VAT withheld comes with tax withheld on the same 2307: type that amount too.'] : []),
    ...items.filter((_, n) => amounts[n] === undefined || amounts[n]! < 0).map((i) => `${i.label}: type an amount like 1,250.00`),
  ];
  const input = {
    customerId: customer?.id ?? '',
    crNumber: crNumber.trim(),
    applications: items.flatMap((i, n) => ('jobOrderId' in i.ref && amounts[n]! > 0 ? [{ jobOrderId: i.ref.jobOrderId, amountCents: amounts[n]! }] : [])),
    ...(items.some((i, n) => 'saleId' in i.ref && amounts[n]! > 0)
      ? { sales: items.flatMap((i, n) => ('saleId' in i.ref && amounts[n]! > 0 ? [{ saleId: i.ref.saleId, amountCents: amounts[n]! }] : [])) }
      : {}),
    tenders: pay.tenders,
    ...(cwtCents ? { withholding: { cwtCents, atc: cwt.atc, certificate: cwt.certificate, ...(vatWithheldCents ? { vatWithheldCents } : {}) } } : {}),
    ...(settle ? { settleSmallDifference: true } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(pdc ? { postDatedCheckId: pdc.id } : original?.input.postDatedCheckId ? { postDatedCheckId: original.input.postDatedCheckId } : {}), // an edit keeps its post-dated check
  };
  const day = printed.businessDate;
  const live = useLive(JSON.stringify([input, day]), errors.length === 0, () => api.preview(type.key, input, day));

  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) api.preview(type.key, input, day).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = original ? await api.reissue(type.key, original.header.id, input, confirm!.totalCents, reason, key, day) : await api.post(type.key, input, confirm!.totalCents, key, day);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input, day));
      throw e;
    }
  };

  if (original && !reason) return <EditGate original={original.header} typeKey={type.key} onReason={setReason} />;
  const difference = received - applied;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{original ? `Edit ${original.header.number}` : 'New collection'}</h1>
        {pdc && <Notice tone="info">Filled from post-dated check no. {pdc.checkNumber} of {pdc.bank}, {formatPesos(pdc.amountCents)} dated {showDate(pdc.checkDate)}. Recording it takes it off the post-dated checks list.</Notice>}
        {original && <Notice tone="info">When you record, {original.header.number} is cancelled and the replacement gets a new number. Reason: {reason}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Panel title="Who paid">
          <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setTyped(null); setCwt(null); setCertificate('pending'); }} />
        </Panel>
        <Panel title="What is it for?">
          {!customer && <p className="text-sm text-slate-500">Pick the customer to see what they can pay on.</p>}
          {customer && open && items.length === 0 && <p className="text-sm text-slate-500">Nothing is owed. Money received is kept as {customer.name}'s deposit.</p>}
          {items.length > 0 && (
            <table className="block w-full text-sm sm:table">
              <thead className="hidden text-left text-slate-500 sm:table-header-group"><tr><th>Job order or invoice</th><th className="text-right">Left to pay</th><th className="w-40 text-right">Pay now</th></tr></thead>
              <tbody className="grid gap-3 sm:table-row-group">
                {items.map((i, n) => (
                  <tr key={i.key} className="grid gap-2 rounded border p-3 sm:table-row sm:border-0 sm:p-0">
                    <td className="py-1">{i.label}</td>
                    <td className="py-1 text-right tabular-nums"><span className="mr-2 sm:hidden">Left to pay</span>{formatPesos(i.due)}</td>
                    <td className="py-1">
                      <Field label="Pay now"><input aria-label={`Pay now on ${i.label}`} inputMode="decimal" className={`${inputClass} text-right tabular-nums`}
                        value={typed ? (typed[i.key] ?? '') : auto[n] ? formatPesos(auto[n]!) : ''}
                        onChange={(e) => setTyped({ ...(typed ?? Object.fromEntries(items.map((x, k) => [x.key, auto[k] ? formatPesos(auto[k]!) : '']))), [i.key]: e.target.value })} /></Field>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {typed && items.length > 0 && <Button onClick={() => setTyped(null)}>Apply oldest first</Button>}
          {open && open.unappliedCents > 0 && <p className="text-sm text-slate-600">{customer?.name} also has {formatPesos(open.unappliedCents)} of unapplied payments on file.</p>}
        </Panel>
        <Panel title="Where did the money go?">
          <TenderRows rows={tenders} onChange={setTenders} places={places} question="Where did the money go?" />
          <Field label="CR number (from the booklet)" required hint={original ? `CR ${original.input.crNumber} stays with the cancelled collection: write this payment on a new CR.` : undefined}>
            <input inputMode="numeric" className={`${inputClass} max-w-40`} value={crNumber} onChange={(e) => setCr(e.target.value)} />
          </Field>
          <PrintedDateField label="Date on the CR" value={printed.text} onChange={printed.setText} />
        </Panel>
        <Exception title="Customer withheld tax (2307)" active={!!cwt.amount.trim() && Number(cwt.amount.replaceAll(',', '')) !== 0 || !!cwt.vat.trim() && Number(cwt.vat.replaceAll(',', '')) !== 0 || !!cwt.atc || certificate !== 'pending'}>
          {mine && mine.value !== 'none' && grossCents > 0 && manualCwt === null && <p className="text-sm text-slate-600">Filled in from the customer's withholding profile; change it to match the 2307</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Amount withheld" hint="As written on the 2307">
              <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={cwt.amount} onChange={(e) => setCwt({ ...cwt, amount: e.target.value })} />
            </Field>
            <Field label="Tax code (ATC)">
              <select className={inputClass} value={cwt.atc} onChange={(e) => setCwt({ ...cwt, atc: e.target.value })}>
                <option value="" />
                <option value="WC158">WC158 goods 1%</option>
                <option value="WC160">WC160 services 2%</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="2307 certificate">
              <select className={inputClass} value={cwt.certificate} onChange={(e) => setCertificate(e.target.value)}>
                <option value="pending">Still to get</option>
                <option value="received">Received</option>
              </select>
            </Field>
            <Field label="VAT withheld" hint="Government buyers, 5%">
              <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={cwt.vat} onChange={(e) => setCwt({ ...cwt, vat: e.target.value })} />
            </Field>
          </div>
          <Button onClick={() => setCwt(emptyWithholding())}>Clear withholding</Button>
        </Exception>
        {Math.abs(difference) > 0 && Math.abs(difference) <= 100 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
            Put the {formatPesos(Math.abs(difference))} difference to cash short and over
          </label>
        )}
        <Field label="Note"><textarea rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Errors list={errors} show={touched} />
        <Panel title="So far">
          <Figures items={[
            ['Received (money and tax withheld)', received],
            ['Applied', applied],
            ...(difference > 0 && !settle ? [['Kept as deposit', difference] as [string, number]] : []),
            ...(difference < 0 && !settle ? [['Applied more than received', -difference, 'text-red-700'] as [string, number, string]] : []),
          ]} />
          {live && <p className="text-sm">{live.summary}</p>}
          {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
        </Panel>
        <SalesActions total={received} label="Received">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </SalesActions>
      </div>
      {confirm && <RecordDialog type={type} preview={confirm} original={original?.header} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
