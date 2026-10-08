/**
 * Job order form (PLAN E4, A2): the customer (picked or added here), lines from the price list with the tier price for the
 * quantity, the wearers on each line (pull a group, pick wearers with their size on file, a one-off name, or paste from
 * Excel), due date, payment terms and notes. The total, downpayment asked and balance due come from the server's preview.
 * Save draft (no number) or Record. Also the Edit of a recorded job order (cancel and reissue, NR-4).
 */
import { useEffect, useRef, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CatItem, type CustomerWearers, type DocTypeInfo, type Me, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, showDate } from '../../components/ui.tsx';
import { SalesActions, Exception } from './entry.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { CustomerPicker, Errors, Figures, useLive, type Picked } from '../COL/parts.tsx';
import { KINDS } from '../QS/lines.ts';
import { jobOrderPrefill, type QuotationDoc } from '../QUO/quotation.ts';
import { itemClasses } from '../QUO/QuotationView.tsx';
import { CustomerEditor } from '../CUS/Customers.tsx';
import { masterRequest } from '../CUS/http.ts';
import { ItemSearch } from './parts.tsx';
import { TERMS } from './opening.ts';
import { parseRosterPaste } from './roster.ts';
import {
  KIND_OF_CLASS, emptyJo, emptyJoLine, fromWearer, joInput, joValues, lineQty, oneOff, priceChanged,
  valuesFromQuotation, type JoDoc, type JoInput, type JoLineRow, type JoValues, type RosterEdit,
} from './forms.ts';

const money = `${inputClass} text-right tabular-nums`;
const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
const MEASURED = '__measured';

/** A plus beside two people: add a new customer. */
function AddPeopleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 6.5a3 3 0 0 1 0 5.6" /><path d="M20 4v6M17 7h6" />
    </svg>
  );
}

/**
 * The New customer button beside the customer box: the Customers screen's own form (every detail of a customer) in a
 * dialog over the job order; once saved, the new customer is picked here.
 */
function NewCustomerButton({ me, onAdded }: { me: Me; onAdded: (c: Picked, lookalike: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="New customer" title="Add a new customer" onClick={() => setOpen(true)}
        className="inline-flex size-10 shrink-0 items-center justify-center gap-0.5 rounded-md bg-indigo-600 text-white shadow-sm hover:bg-indigo-700">
        <AddPeopleIcon />
      </button>
      {open && (
        <CustomerEditor me={me} row="new" onClose={() => setOpen(false)} onSaved={async (id, warnings) => {
          const saved = await masterRequest<{ display_name: string }>(me, `/api/cus/customers/${encodeURIComponent(id)}`);
          setOpen(false);
          onAdded({ id, name: saved.display_name }, warnings.length > 0);
        }} />
      )}
    </>
  );
}

function RosterGrid(p: { line: JoLineRow; n: number; people: CustomerWearers | null; sizes: string[]; onChange: (roster: RosterEdit[]) => void }) {
  const [paste, setPaste] = useState<string | null>(null);
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const rows = p.line.roster;
  const on = new Set(rows.map((r) => r.personId).filter(Boolean));
  const wearers = p.people?.wearers ?? [];
  const set = (j: number, patch: Partial<RosterEdit>) => p.onChange(rows.map((r, k) => (k === j ? { ...r, ...patch } : r)));
  const pull = (groupId: string) => p.onChange([...rows, ...wearers.filter((w) => w.groupId === groupId && !on.has(w.personId)).map(fromWearer)]);
  const addPasted = () => {
    const out = parseRosterPaste(paste ?? '', wearers);
    setPasteErrors(out.errors);
    if (out.errors.length > 0) return;
    p.onChange([...rows, ...out.rows.map((g) => ({ personId: g.personId ?? '', name: g.wearerName, sizeMode: g.sizeMode, size: g.size ?? (g.personId ? wearers.find((w) => w.personId === g.personId)?.size ?? '' : ''), jerseyName: g.jerseyName ?? '', jerseyNumber: g.jerseyNumber ?? '', qty: String(g.qty) }))]);
    setPaste(null);
  };
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <table className="block w-full text-sm lg:table">
          <thead className="hidden text-left text-slate-500 lg:table-header-group"><tr><th>Wearer</th><th className="w-28">Size</th><th>Jersey name</th><th className="w-20">No.</th><th className="w-16">Qty</th><th /></tr></thead>
          <tbody className="grid gap-2 lg:table-row-group">
            {rows.map((r, j) => (
              <tr key={j} className="grid gap-2 rounded border p-2 sm:grid-cols-2 lg:table-row lg:border-0 lg:p-0">
                <td className="py-1 pr-1"><span className="block text-xs text-slate-600 lg:hidden">Wearer</span>
                  {r.personId ? <span>{r.name}</span> : <input aria-label={`Line ${p.n} wearer ${j + 1} name`} placeholder="One-off name" className={inputClass} value={r.name} onChange={(e) => set(j, { name: e.target.value })} />}
                </td>
                <td className="py-1 pr-1"><span className="block text-xs text-slate-600 lg:hidden">Size</span>
                  <select aria-label={`Line ${p.n} wearer ${j + 1} size`} className={inputClass} value={r.sizeMode === 'measured' ? MEASURED : r.size}
                    onChange={(e) => set(j, e.target.value === MEASURED ? { sizeMode: 'measured', size: '' } : { sizeMode: 'preset', size: e.target.value })}>
                    <option value="" />
                    {r.personId && <option value={MEASURED}>Measured</option>}
                    {[...new Set([...p.sizes, ...(r.size ? [r.size] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="py-1 pr-1"><span className="block text-xs text-slate-600 lg:hidden">Jersey name</span><input aria-label={`Line ${p.n} wearer ${j + 1} jersey name`} className={`${inputClass} uppercase`} value={r.jerseyName} onChange={(e) => set(j, { jerseyName: e.target.value })} /></td>
                <td className="py-1 pr-1"><span className="block text-xs text-slate-600 lg:hidden">No.</span><input aria-label={`Line ${p.n} wearer ${j + 1} jersey number`} className={inputClass} value={r.jerseyNumber} onChange={(e) => set(j, { jerseyNumber: e.target.value })} /></td>
                <td className="py-1 pr-1"><span className="block text-xs text-slate-600 lg:hidden">Qty</span><input aria-label={`Line ${p.n} wearer ${j + 1} qty`} inputMode="numeric" className={money} value={r.qty} onChange={(e) => set(j, { qty: e.target.value })} /></td>
                <td className="py-1"><Button onClick={() => p.onChange(rows.filter((_, k) => k !== j))} title="Take off the list">✕</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-2">
        {(p.people?.groups.length ?? 0) > 0 && (
          <select aria-label={`Line ${p.n} pull a group`} className={`${inputClass} w-auto`} value="" onChange={(e) => e.target.value && pull(e.target.value)}>
            <option value="">Pull a whole group…</option>
            {p.people!.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {wearers.some((w) => !on.has(w.personId)) && (
          <select aria-label={`Line ${p.n} add a wearer`} className={`${inputClass} w-auto`} value="" onChange={(e) => {
            const w = wearers.find((x) => x.personId === e.target.value);
            if (w) p.onChange([...rows, fromWearer(w)]);
          }}>
            <option value="">Add a wearer…</option>
            {wearers.filter((w) => !on.has(w.personId)).map((w) => <option key={w.personId} value={w.personId}>{w.wearerName}{w.sizeMode === 'measured' ? ' (measured)' : w.size ? ` (${w.size})` : ''}</option>)}
          </select>
        )}
        <Button onClick={() => p.onChange([...rows, oneOff()])}>+ One-off name</Button>
        <Button onClick={() => setPaste(paste === null ? '' : null)}>Paste from Excel</Button>
      </div>
      {paste !== null && (
        <div className="space-y-2">
          <Field label="Pasted rows"><textarea aria-label={`Line ${p.n} pasted rows`} rows={4} className={inputClass} placeholder="Name, size, jersey name, jersey number, qty (one person per row)" value={paste} onChange={(e) => setPaste(e.target.value)} /></Field>
          {pasteErrors.map((e) => <Notice key={e}>{e}</Notice>)}
          <Button onClick={addPasted}>Add these</Button>
        </div>
      )}
    </div>
  );
}

/** `inDialog`: shown over the job order list (New): no page heading, Close instead of Back, and it says when something typed is unsaved. */
export function JobOrderForm({ type, mode, me, inDialog }: { type: DocTypeInfo; mode: FormMode; me?: Me; inDialog?: { close: () => void; setDirty: (dirty: boolean) => void; show?: (id: string) => void } }) {
  const [v, setV] = useState<JoValues>(emptyJo);
  const [people, setPeople] = useState<CustomerWearers | null>(null);
  const [sizes, setSizes] = useState<string[]>(SIZES);
  const [noPrice, setNoPrice] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [saved, setSaved] = useState('');
  const clean = useRef(JSON.stringify(v)); // the form as last opened or saved as a draft
  const latest = useRef(v);
  latest.current = v;
  const last = useRef(''); // the customer the rosters' wearers belong to: another customer's pick clears them
  if (v.customer) last.current = v.customer.id;
  const r = useRecord(type, mode, (d) => setV(joValues(d.input as unknown as JoInput, d.doc as unknown as JoDoc)), () => (draft ? api.discardDraft(draft.id) : Promise.resolve()), inDialog?.show);

  useEffect(() => {
    api.cusSizes().then((s) => { const active = s.filter((x) => x.is_active === 1).map((x) => x.label); if (active.length > 0) setSizes(active); }, () => undefined);
    if (mode.kind === 'new' && mode.draftId)
      api.drafts(type.key).then((ds) => {
        const d = ds.find((x) => x.id === mode.draftId);
        if (!d) return r.fail(new Error('That draft was already recorded or discarded.'));
        setDraft({ id: d.id, version: d.version });
        const opened = { ...emptyJo(), ...(d.payload.form as JoValues) };
        clean.current = JSON.stringify(opened);
        setV(opened);
      }, r.fail);
  }, [type.key, mode.kind === 'new' ? mode.draftId : '']);
  /** "Make a job order" on a quotation (?fromQuotation=<id>): its customer, lines, quantities and prices, and its number in the notes; everything can still be changed. */
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('fromQuotation');
    if (mode.kind !== 'new' || mode.draftId || !id) return;
    api.get('quo.quotation', id).then(async (d) => {
      const number = d.header.number;
      if (d.header.status !== 'posted') throw new Error(`${number} is cancelled, so no job order is made from it.`);
      const lines = (d.input.lines ?? []) as { itemId: string }[];
      const prefill = jobOrderPrefill(d, await itemClasses(lines.map((l) => l.itemId)));
      if (!prefill) throw new Error(`${number} is for a prospect. A job order needs a customer: add them under Customers, then edit the quotation to pick that customer.`);
      setV(valuesFromQuotation(prefill, (d.doc as unknown as QuotationDoc).customerName));
      setSaved(`Filled from quotation ${number}: the customer, lines, quantities and prices as quoted. Change anything you need, pick the payment terms and due days, then record.`);
    }, r.fail);
  }, []);
  useEffect(() => {
    setPeople(null);
    if (v.customer) api.joWearers(v.customer.id).then(setPeople, r.fail);
  }, [v.customer?.id]);

  const set = (patch: Partial<JoValues>) => setV((old) => ({ ...old, ...patch }));
  const setLine = (i: number, patch: Partial<JoLineRow>) => setV((old) => ({ ...old, lines: old.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  /** The price list's tier price for the line's quantity; a price typed by hand stays. A late answer for an older quantity is dropped. */
  const lookup = (i: number, itemId: string, qty: string) => {
    if (!itemId || !/^[1-9]\d*$/.test(qty)) return;
    api.catPrice(itemId, Number(qty)).then(
      (p) => {
        setNoPrice((old) => ({ ...old, [i]: '' }));
        setV((old) => ({
          ...old,
          lines: old.lines.map((l, j) => {
            if (j !== i || l.itemId !== itemId || lineQty(l) !== qty) return l;
            const byHand = l.listCents !== null ? priceChanged(l) : !!l.price.trim();
            return { ...l, listCents: p.unitPriceCents, ...(byHand ? {} : { price: formatPesos(p.unitPriceCents) }) };
          }),
        }));
      },
      () => {
        setNoPrice((old) => ({ ...old, [i]: `The price list has no price for ${qty} of this item: type the price.` }));
        setLine(i, { listCents: null });
      },
    );
  };
  const pick = (i: number, it: CatItem) => {
    const qty = lineQty(latest.current.lines[i]!);
    setLine(i, { itemId: it.id, kind: KIND_OF_CLASS[it.class], description: it.name, price: '', listCents: null });
    lookup(i, it.id, qty);
  };
  const setQty = (i: number, qty: string) => {
    setLine(i, { qty });
    lookup(i, latest.current.lines[i]!.itemId, qty);
  };
  const setRoster = (i: number, roster: RosterEdit[]) => {
    const line = { ...latest.current.lines[i]!, roster };
    setLine(i, { roster });
    lookup(i, line.itemId, lineQty(line));
  };

  const typed = joInput(v);
  const live = useLive<Preview | null>(JSON.stringify(typed.input), typed.errors.length === 0, () => r.preview(typed.input));
  const doc = live?.doc as { totalCents: number; requiredDownpaymentCents: number; dueDate: string } | undefined;
  const record = () => r.ask(typed.input, typed.errors);
  const saveDraft = () =>
    (draft ? api.saveDraft(draft.id, draft.version, { form: v }) : api.createDraft(type.key, { form: v })).then(
      (d) => (setDraft(d), (clean.current = JSON.stringify(v)), inDialog?.setDirty(false), setSaved('Draft saved. It has no number and records nothing until you press Record.')),
      r.fail,
    );

  const setDirty = inDialog?.setDirty;
  useEffect(() => { setDirty?.(JSON.stringify(v) !== clean.current); }, [v, setDirty]);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="space-y-4">
        {!inDialog && <h1 className="text-2xl font-semibold">{r.title('New job order')}</h1>}
        {r.top}
        {saved && <Notice tone="success">{saved}</Notice>}
        <Panel title="Customer">
          {/* The customer on one line, with New customer beside it; the contact person beside that on a wide screen. */}
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <CustomerPicker value={v.customer} onChange={(c) => set({ customer: c, lines: !c || c.id === last.current ? v.lines : v.lines.map((l) => ({ ...l, roster: [] })) })}
              beside={!v.customer && me?.permissions.includes('cus.manage') && <NewCustomerButton me={me} onAdded={(c, lookalike) => (set({ customer: c }),
                setSaved(lookalike ? `Added ${c.name}. Another customer has a similar name: check the customer list later in case it is the same one.` : `Added ${c.name} as a new customer.`))} />} />
            <Field label="Contact person">
              <input className={inputClass} value={v.contact} onChange={(e) => set({ contact: e.target.value })} />
            </Field>
          </div>
        </Panel>
        <Panel title="What is made">
          {v.lines.map((l, i) => (
            <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <span className="font-medium">Line {i + 1}</span>
                <span className="flex-1" />
                <Button onClick={() => set({ lines: v.lines.length > 1 ? v.lines.filter((_, j) => j !== i) : [emptyJoLine()] })} title="Remove this line">✕</Button>
              </div>
              <ItemSearch n={i + 1} onPick={(it) => pick(i, it)} />
              <div role="radiogroup" aria-label={`Kind of line ${i + 1}`} className="flex flex-wrap gap-2">
                {KINDS.map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={l.kind === k} onClick={() => setLine(i, { kind: k })}
                    className={`rounded-full px-3 py-1 text-sm ring-1 ${l.kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_6rem]">
                <Field label="Description"><input aria-label={`Line ${i + 1} description`} placeholder="What, e.g. Team jersey set" className={inputClass} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
                <Field label="Pieces"><input aria-label={`Line ${i + 1} pieces`} inputMode="numeric" className={money} value={lineQty(l)} readOnly={l.roster.length > 0}
                  title={l.roster.length > 0 ? 'Follows the wearers listed below' : undefined} onChange={(e) => setQty(i, e.target.value)} /></Field>
              </div>
              <Exception title="Change the usual price" active={l.listCents === null || priceChanged(l)}>
                <div className="max-w-xs"><Field label="Price each"><input aria-label={`Line ${i + 1} price each`} inputMode="decimal" placeholder="Price each" className={money} value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></Field></div>
              </Exception>
              <Exception title="Add a line discount" active={!!l.discount.trim() && Number(l.discount.replaceAll(',', '')) !== 0}>
                <div className="max-w-xs"><Field label="Discount"><input aria-label={`Line ${i + 1} discount`} inputMode="decimal" placeholder="Discount" className={money} value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} /></Field></div>
              </Exception>
              {l.listCents !== null && <p className="text-xs text-slate-500">Price list for {lineQty(l)}: {formatPesos(l.listCents)} each{priceChanged(l) ? ' (changed by hand)' : ''}.</p>}
              {noPrice[i] && <p className="text-xs text-amber-700">{noPrice[i]}</p>}
              <details open={l.roster.length > 0}>
                <summary className="cursor-pointer text-sm text-indigo-700">Wearers{l.roster.length > 0 ? ` (${l.roster.length})` : ''}</summary>
                {v.customer ? <RosterGrid line={l} n={i + 1} people={people} sizes={sizes} onChange={(roster) => setRoster(i, roster)} /> : <p className="text-sm text-slate-500">Pick the customer first.</p>}
              </details>
            </div>
          ))}
          {v.lines.length < 50 && <Button onClick={() => set({ lines: [...v.lines, emptyJoLine()] })}>+ Add a line</Button>}
        </Panel>
        <Panel title="Terms">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Due in (days)" required hint={doc ? `Due ${showDate(doc.dueDate)}` : 'Counted from today'}>
              <input inputMode="numeric" className={money} value={v.dueInDays} onChange={(e) => set({ dueInDays: e.target.value })} />
            </Field>
            <Field label="Payment terms" required>
              <select className={inputClass} value={v.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value as JoValues['paymentTerms'] })}>
                <option value="" />
                {TERMS.map(([key, words]) => <option key={key} value={key}>{words}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} value={v.priority} onChange={(e) => set({ priority: e.target.value as JoValues['priority'] })}>
                <option value="normal">Normal</option>
                <option value="rush">Rush</option>
              </select>
            </Field>
          </div>
          <Field label="Notes"><textarea rows={2} className={inputClass} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </Panel>
        <Errors list={typed.errors} show={r.touched} />
        <Panel title="So far">
          <Figures items={[
            ['Total', doc?.totalCents ?? typed.totalCents, 'text-lg font-semibold'],
            ...(doc ? [['Downpayment asked', doc.requiredDownpaymentCents] as [string, number], ['Balance due', doc.totalCents, 'font-semibold'] as [string, number, string]] : []),
          ]} />
          {!live && <p className="text-sm text-slate-500">Fill in the customer, terms and lines to see the downpayment asked.</p>}
          {live && <p className="text-sm">{live.summary}</p>}
          {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
        </Panel>
        <SalesActions total={doc?.totalCents ?? typed.totalCents} label="Total">
          <Button tone="primary" disabled={!type.canPost} onClick={record} title="Ctrl+Enter">Record</Button>
          {mode.kind === 'new' && <Button onClick={() => void saveDraft()}>Save draft</Button>}
          {inDialog ? <Button onClick={inDialog.close}>Close</Button> : <Button onClick={() => history.back()}>Back</Button>}
        </SalesActions>
      </div>
      {r.dialog}
    </form>
  );
}
