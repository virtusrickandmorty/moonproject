/**
 * Sales › Order links (the owner's request, Nov 2026): a private link to send a customer before any job order exists, for
 * a team list (one person fills in every player) or a group order (each member fills in their own pieces), each item in
 * standard sizes or made to measure. Staff copy the link, watch the answers come in with the totals by size and what to
 * check, and close it or give it a new closing date. Making the job orders from it is the next step.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatPesos, manilaDate } from '@moonproject/shared';
import { api, type Me, type OlkGuide, type OlkJobOrder, type OlkLinkDetail, type OlkLinkInput, type OlkLinkRow, type OlkPayment, type OlkShare } from '../../api.ts';
import { navigate, useLocation } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { emptyJo, emptyJoLine, oneOff, type JoValues } from '../JO/forms.ts';
import { Button, Dialog, Field, Loading, Notice, Panel, ReasonDialog, inputClass, manilaTime, peso, showDate, useAction } from '../../components/ui.tsx';

/** The address customers open: the website's, so the link works from anywhere (not the shop's own network address). */
export const linkUrl = (token: string) => `${/(^|\.)virtusgarments\.com$/.test(location.hostname) ? location.origin : 'https://www.virtusgarments.com'}/l/${token}`;
const inDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const KIND = { team: 'Team list', group: 'Group order' } as const;
const JO = 'jo.job_order';

/** The job order form's values from a job order started from answers: price list prices, wearers, sizes and notes. */
export function joValuesFrom(p: OlkJobOrder): JoValues {
  return {
    ...emptyJo(), customer: p.customer, contact: p.contact, notes: p.notes,
    lines: p.lines.map((l) => ({
      ...emptyJoLine(), itemId: l.itemId, kind: l.kind, description: l.description, isSet: l.isSet, qty: String(l.qty),
      price: l.listCents === null ? '' : formatPesos(l.listCents), listCents: l.listCents,
      roster: l.roster.map((r) => ({ ...oneOff(r.name), personId: r.personId ?? '', sizeMode: r.sizeMode, size: r.size ?? '', lowerSize: r.lowerSize ?? '',
        jerseyName: r.jerseyName ?? '', jerseyNumber: r.jerseyNumber ?? '', qty: String(r.qty), ...(r.notes ? { notes: r.notes } : {}) })),
    })),
  };
}

export function OrderLinks({ me }: { me: Me }) {
  const [rows, setRows] = useState<OlkLinkRow[] | null>(null);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState<string | null>(new URLSearchParams(useLocation().split('?')[1] ?? '').get('open')); // from the bell's custom fit alert
  const load = useCallback(() => void api.olkLinks().then((r) => (setRows(r), setError('')), (e: Error) => setError(e.message)), []);
  useEffect(load, [load]);
  const manage = me.permissions.includes('olk.manage');
  if (error) return <Notice>{error}</Notice>;
  if (!rows) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Order links</h1>
        {manage && <Button tone="primary" onClick={() => setMaking(true)}>New order link</Button>}
      </div>
      <p className="text-sm text-slate-600">A private link for a customer to fill in their order: a team's players with names, numbers and sizes, or each member of a group with their own pieces and measurements. Check what comes in here before making the job order.</p>
      <Panel title="Links">
        {rows.length === 0 ? <p className="text-sm text-slate-600">No order links yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-1">Order</th><th>Kind</th><th>Closes</th><th className="text-right">Answers</th><th className="text-right">People</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-1.5"><button type="button" className="font-medium text-indigo-700 hover:underline" onClick={() => setOpen(r.id)}>{r.title}</button></td>
                    <td>{KIND[r.kind]}</td>
                    <td>{showDate(r.closesOn)}</td>
                    <td className="text-right tabular-nums">{r.answers}</td>
                    <td className="text-right tabular-nums">{r.people}</td>
                    <td>{r.open ? <span className="text-emerald-700">Open</span> : <span className="text-slate-500">{r.closedEarly ? 'Closed early' : 'Closed'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {making && <Dialog title="New order link" wide onClose={() => setMaking(false)}><NewLink onMade={(d) => { setMaking(false); load(); setOpen(d.id); }} /></Dialog>}
      {open && <Dialog title="Order link" wide onClose={() => { setOpen(null); load(); }}><LinkDetail id={open} manage={manage} /></Dialog>}
    </div>
  );
}

interface ItemDraft { itemId: string; name: string; sizing: 'size' | 'measure'; customFit: boolean; fields: string[] }

function NewLink({ onMade }: { onMade: (d: OlkLinkDetail) => void }) {
  const today = manilaDate(new Date());
  const [kind, setKind] = useState<'team' | 'group'>('team');
  const [title, setTitle] = useState('');
  const [closesOn, setClosesOn] = useState(inDays(today, 14));
  const [payOwn, setPayOwn] = useState(false);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [guide, setGuide] = useState<OlkGuide[]>([]);
  const [presets, setPresets] = useState<Record<'top' | 'bottom', string[]>>({ top: [], bottom: [] });
  const [q, setQ] = useState(''); const [found, setFound] = useState<{ id: string; code: string; name: string }[]>([]);
  const { busy, error, run } = useAction();

  useEffect(() => void api.olkPickers().then((p) => (setGuide(p.guide), setPresets(p.presets)), () => undefined), []);
  useEffect(() => {
    const t = setTimeout(() => void (q.trim() ? api.olkPickers(q.trim()).then((p) => setFound(p.items), () => undefined) : setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const setItem = (i: number, c: Partial<ItemDraft>) => setItems(items.map((it, j) => (j === i ? { ...it, ...c } : it)));
  const body = (): OlkLinkInput => ({ kind, title: title.trim(), closesOn, payOwn: kind === 'group' && payOwn, ...(customer ? { customerId: customer.id } : {}),
    items: items.map((it) => {
      const customFit = it.sizing === 'size' && it.customFit;
      return { itemId: it.itemId, sizing: it.sizing, customFit, fields: it.sizing === 'measure' || customFit ? it.fields : [] };
    }) });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => onMade(await api.olkCreate(body()))); }}>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Kind</legend>
        {(['team', 'group'] as const).map((k) => (
          <label key={k} className={`flex cursor-pointer gap-2 rounded-lg p-3 text-sm ring-1 ${kind === k ? 'bg-indigo-50 ring-indigo-400' : 'ring-slate-200'}`}>
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            <span><b>{KIND[k]}</b><br /><span className="text-slate-600">{k === 'team' ? 'One person (the coach) gives every player: name on the back, number, gender, size.' : 'Each member opens the link and gives their own details, pieces and size or measurements.'}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="What the order is" required hint="The customer sees this at the top of the page."><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={kind === 'team' ? 'Made-up League jerseys' : 'Made-up Clinic uniforms'} /></Field>
        <Field label="Open until" required><input type="date" className={inputClass} value={closesOn} min={today} onChange={(e) => setClosesOn(e.target.value)} /></Field>
      </div>
      <Field label="Customer (optional)" hint="Leave empty when they are new: their details from the link are used.">
        <CustomerSearch value={customer} onChange={setCustomer} />
      </Field>
      {kind === 'group' && (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={payOwn} onChange={(e) => setPayOwn(e.target.checked)} />
          <span><b>Each member pays their own share.</b> <span className="text-slate-600">Kept with the link now; showing each member's price and taking their payment is the next step being added.</span></span></label>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Items <span className="text-red-600">*</span></p>
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <b className="flex-1">{it.name}</b>
              <select className={`${inputClass} w-auto`} value={it.sizing} onChange={(e) => setItem(i, { sizing: e.target.value as ItemDraft['sizing'] })} aria-label={`Sizing for ${it.name}`}>
                <option value="size">Standard sizes</option><option value="measure">Made to measure</option>
              </select>
              <button type="button" className="text-xs text-rose-700 underline" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>
            </div>
            {it.sizing === 'size' && (
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={it.customFit} onChange={(e) => setItem(i, { customFit: e.target.checked })} />
                <span><b>Allow custom fit.</b> <span className="text-slate-600">A person may pick "Custom fit" instead of a size and give their own measurements (or be measured at the shop). You get an alert in the bell.</span></span></label>
            )}
            {(it.sizing === 'measure' || it.customFit) && (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="text-slate-500">{it.sizing === 'measure' ? 'Measurements it needs:' : 'Measurements a custom fit needs:'}</span>
                  <button type="button" className="text-indigo-700 underline" onClick={() => setItem(i, { fields: [...new Set([...it.fields, ...presets.top])] })}>+ top set</button>
                  <button type="button" className="text-indigo-700 underline" onClick={() => setItem(i, { fields: [...new Set([...it.fields, ...presets.bottom])] })}>+ pants set</button>
                  {it.fields.length > 0 && <button type="button" className="text-slate-600 underline" onClick={() => setItem(i, { fields: [] })}>clear</button>}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-3">
                  {guide.map((g) => (
                    <label key={g.key} className="flex items-center gap-1.5" title={g.how}>
                      <input type="checkbox" checked={it.fields.includes(g.key)} onChange={(e) => setItem(i, { fields: e.target.checked ? [...it.fields, g.key] : it.fields.filter((f) => f !== g.key) })} />{g.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {items.length < 20 && <>
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an item from the price list: search by name or code" />
          {found.length > 0 && <ul className="max-h-48 overflow-auto rounded-md ring-1 ring-slate-200">{found.map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => { setItems([...items, { itemId: c.id, name: c.name, sizing: 'size', customFit: false, fields: [] }]); setQ(''); }}>{c.name} <span className="text-xs text-slate-500">{c.code}</span></button></li>
          ))}</ul>}
        </>}
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="flex justify-end"><Button tone="primary" type="submit" disabled={busy || !title.trim() || items.length === 0}>{busy ? 'Making…' : 'Make the link'}</Button></div>
    </form>
  );
}

function CustomerSearch({ value, onChange }: { value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => void (q.trim() ? api.olkPickers(q.trim()).then((p) => setFound(p.customers), () => undefined) : setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return <div className="flex items-center gap-2"><span className="font-medium">{value.name}</span><button type="button" className="text-xs text-indigo-700 underline" onClick={() => onChange(null)}>Change</button></div>;
  return <>
    <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" aria-label="Search customers" />
    {found.length > 0 && <ul className="mt-1 max-h-40 overflow-auto rounded-md ring-1 ring-slate-200">{found.map((c) => <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-indigo-50" onClick={() => { onChange(c); setQ(''); }}>{c.name}</button></li>)}</ul>}
  </>;
}

function LinkDetail({ id, manage }: { id: string; manage: boolean }) {
  const [d, setD] = useState<OlkLinkDetail | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[] | null>(null); // one job order for these answers (group)
  const [groupCustomer, setGroupCustomer] = useState<{ id: string; name: string } | null>(null);
  const act = useAction();
  /** Starts the job order and opens the job order form on it, to check and record. */
  const start = (responseIds: string[], together: boolean, customerId?: string) => void act.run(async () => {
    const p = await api.olkJobOrder(id, { responseIds, together, ...(customerId ? { customerId } : {}) });
    const draft = await api.createDraft(JO, { form: joValuesFrom(p) });
    navigate(`${docPath(JO, '/new')}?draft=${draft.id}`);
  });
  const reload = () => void api.olkLink(id).then(setD, (e: Error) => setError(e.message));
  useEffect(reload, [id]);
  if (error) return <Notice>{error}</Notice>;
  if (!d) return <Loading />;
  const url = linkUrl(d.token);
  const item = (lineNo: number) => d.items.find((it) => it.lineNo === lineNo);
  const label = (f: string) => d.guide.find((g) => g.key === f)?.label.toLowerCase() ?? f;
  const today = manilaDate(new Date());
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{KIND[d.kind]}{d.customer ? ` · ${d.customer.name}` : ''}{d.payOwn ? ' · each member pays their own share' : ''}</p>
        <p className="text-xl font-semibold">{d.title}</p>
        <p className="text-sm">{d.open ? <>Open until <b>{showDate(d.closesOn)}</b></> : <span className="text-slate-600">{d.closedEarly ? 'Closed early' : `Closed on ${showDate(d.closesOn)}`}</span>}</p>
      </div>
      <div className="flex gap-2">
        <input readOnly value={url} className={`${inputClass} min-w-0 flex-1`} aria-label="The link to send" onFocus={(e) => e.target.select()} />
        <Button tone="primary" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy link'}</Button>
      </div>
      <p className="text-xs text-slate-500">Anyone with this link can fill it in, so send it only to the customer.</p>
      {manage && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={d.open ? 'Open until' : 'Open again until'}><input type="date" className={inputClass} min={today} value={newDate || d.closesOn} onChange={(e) => setNewDate(e.target.value)} /></Field>
          <Button disabled={act.busy || !newDate || newDate === d.closesOn && d.open} onClick={() => void act.run(async () => { setD(await api.olkClosesOn(d.id, newDate)); setNewDate(''); })}>Save date</Button>
          {d.open && <Button tone="danger" disabled={act.busy} onClick={() => void act.run(async () => setD(await api.olkClose(d.id)))}>Close now</Button>}
        </div>
      )}
      {act.error && <Notice>{act.error}</Notice>}

      <Panel title="Totals">
        <table className="w-full text-sm">
          <tbody>{d.totals.map((t) => (
            <tr key={t.lineNo} className="border-t border-slate-100 first:border-0">
              <td className="py-1.5 font-medium">{t.name}</td>
              <td>{t.sizes.map((s) => <span key={s.size} className="mr-3 inline-block">{s.size}: <b>{s.qty}</b></span>)}</td>
              <td className="text-right font-semibold tabular-nums">{t.qty}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>

      {manage && d.kind === 'group' && d.responses.length > 0 && (ticked === null
        ? <div className="flex flex-wrap items-center gap-2">
            <Button tone="primary" onClick={() => { const fresh = d.responses.filter((r) => r.made.length === 0).map((r) => r.id); setTicked(fresh.length ? fresh : d.responses.map((r) => r.id)); setGroupCustomer(d.customer); }}>One job order for the group</Button>
            <span className="text-sm text-slate-600">or a member's own job order from their answer below.</span>
          </div>
        : <div className="space-y-3 rounded-lg bg-indigo-50/60 p-3 ring-1 ring-indigo-200">
            <p className="text-sm font-medium">One job order for the ticked answers</p>
            <Field label="Customer" hint="The group's customer: the job order is billed to them."><CustomerSearch value={groupCustomer} onChange={setGroupCustomer} /></Field>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">{d.responses.map((r) => (
              <li key={r.id}><label className="flex items-center gap-2"><input type="checkbox" checked={ticked.includes(r.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, r.id] : ticked.filter((x) => x !== r.id))} />
                {r.name}{r.made.length > 0 && <span className="text-xs text-slate-500">(job order started before)</span>}</label></li>
            ))}</ul>
            <div className="flex gap-2">
              <Button tone="primary" disabled={act.busy || ticked.length === 0 || !groupCustomer} onClick={() => start(ticked, true, groupCustomer?.id)}>{act.busy ? 'Starting…' : `Start the job order (${ticked.length})`}</Button>
              <Button onClick={() => setTicked(null)}>Cancel</Button>
            </div>
          </div>)}

      <Panel title={`Answers (${d.responses.length})`}>
        {d.responses.length === 0 ? <p className="text-sm text-slate-600">Nobody has filled it in yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {d.responses.map((r) => (
              <li key={r.id} className="py-2">
                <button type="button" className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left" aria-expanded={shown === r.id} onClick={() => setShown(shown === r.id ? null : r.id)}>
                  <span><b className="text-indigo-700">{r.name}</b> <span className="text-sm text-slate-500">{d.kind === 'team' ? `${r.people.length} players` : r.people[0]?.pieces.map((pc) => `${pc.qty} × ${item(pc.lineNo)?.name}${pc.size ? ` (${pc.size})` : pc.customFit ? ' (custom fit)' : ''}`).join(', ')}</span></span>
                  <span className="text-xs text-slate-500">{manilaTime(r.updatedAt)}{r.changes ? ` · changed ${r.changes}×` : ''}</span>
                </button>
                {r.checks.map((c) => <p key={c} className="text-sm text-amber-700">⚠ {c}</p>)}
                {r.made.map((m) => <p key={m.at} className="text-xs text-emerald-700">Job order started {manilaTime(m.at)} by {m.by} for {m.customer}{m.together && d.kind === 'group' ? ', with the group' : ''}</p>)}
                {(r.share || r.payments.length > 0) && <Payments share={r.share} payments={r.payments} manage={manage} onChanged={reload} />}
                {manage && <div className="mt-1"><Button disabled={act.busy} onClick={() => start([r.id], d.kind === 'team')}>
                  {d.kind === 'team' ? (r.made.length ? 'Make the job order again' : 'Make the job order') : (r.made.length ? 'Own job order again' : 'Own job order')}</Button></div>}
                {shown === r.id && (
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="text-slate-600">{r.gender === 'female' ? 'Female' : 'Male'} · {r.mobile} · {r.email}<br />{r.address}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead><tr className="text-left text-xs text-slate-500">{d.kind === 'team' && <><th>#</th><th>Back name</th><th>Name</th></>}<th>Gender</th><th>Pieces</th><th>Measurements (in)</th></tr></thead>
                        <tbody>{r.people.map((p) => (
                          <tr key={p.row} className="border-t border-slate-100 align-top">
                            {d.kind === 'team' && <><td className="py-1">{p.number}</td><td className="font-medium">{p.backName}</td><td>{p.name}</td></>}
                            <td className="py-1">{p.gender === 'female' ? 'F' : 'M'}</td>
                            <td>{p.pieces.map((pc) => <div key={pc.lineNo}>{pc.qty} × {item(pc.lineNo)?.name}{pc.size ? ` (${pc.size})` : pc.customFit ? <b className="text-indigo-700"> (custom fit)</b> : ''}</div>)}</td>
                            <td>{p.measureAtShop ? <span className="text-amber-700">Measure at the shop</span> : <>
                              {Object.entries(p.measures).map(([f, v]) => <span key={f} className="mr-2 inline-block">{label(f)} {v}</span>)}
                              {p.itemMeasures.map((m) => <div key={`${m.lineNo}${m.field}`} className="text-indigo-700">{item(m.lineNo)?.name}: {label(m.field)} {m.value}</div>)}
                            </>}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const PAID: Record<OlkPayment['status'], string> = { sent: 'To check', accepted: 'Received', not_received: 'Not received' };
const paidWords = (p: OlkPayment) => (p.status === 'accepted' && !p.recorded ? 'Accepted: collection not recorded yet' : PAID[p.status]);

/**
 * A member's share and payments (each pays their own share). A payment to check: its picture, then Received (pick the
 * member's recorded job order; the collection form opens filled in, to record) or Not received (the member sees why).
 */
function Payments({ share, payments, manage, onChanged }: { share?: OlkShare; payments: OlkPayment[]; manage: boolean; onChanged: () => void }) {
  const [picture, setPicture] = useState<string | null>(null);
  const [taking, setTaking] = useState<OlkPayment | null>(null);
  const [refusing, setRefusing] = useState<OlkPayment | null>(null);
  const paid = payments.filter((p) => p.status === 'accepted' && p.recorded).reduce((s, p) => s + p.amountCents, 0);
  return (
    <div className="mt-1 space-y-1 rounded-lg bg-slate-50 p-2 text-sm">
      {share && <p>Share <b>{share.totalCents === null ? 'not priced (an item has no price on the list)' : peso(share.totalCents)}</b>{paid > 0 && <> · received {peso(paid)}</>}</p>}
      {payments.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2">
          <span className={p.status === 'sent' ? 'font-semibold text-amber-800' : p.status === 'accepted' ? 'text-emerald-700' : 'text-slate-500 line-through'}>{peso(p.amountCents)} · ref. {p.reference}</span>
          <span className="text-xs text-slate-500">{manilaTime(p.sentAt)} · {paidWords(p)}{p.reason ? `: ${p.reason}` : ''}</span>
          <button type="button" className="text-xs text-indigo-700 underline" onClick={() => setPicture(p.id!)}>Picture</button>
          {manage && p.status === 'accepted' && !p.recorded && <Button className="!px-2 !py-1 text-xs" tone="primary" onClick={() => setTaking(p)}>Record the collection</Button>}
          {manage && p.status === 'sent' && <>
            <Button className="!px-2 !py-1 text-xs" tone="primary" onClick={() => setTaking(p)}>Received</Button>
            <Button className="!px-2 !py-1 text-xs" onClick={() => setRefusing(p)}>Not received</Button>
          </>}
        </div>
      ))}
      {picture && <Dialog title="Picture of the payment" onClose={() => setPicture(null)}><img src={`/api/olk/payments/${encodeURIComponent(picture)}/picture`} alt="The payment the member sent" className="mx-auto max-h-[70vh] rounded-lg" /></Dialog>}
      {taking && <Dialog title="Payment received" onClose={() => setTaking(null)}><TakePayment payment={taking} /></Dialog>}
      {refusing && <ReasonDialog title="Payment not received" explain="The member sees this reason on their page and can send the payment again." confirmLabel="Not received"
        onConfirm={async (reason) => { await api.olkPayNotReceived(refusing.id!, reason); setRefusing(null); onChanged(); }} onClose={() => setRefusing(null)} />}
    </div>
  );
}

/** Picks the member's recorded job order and opens the collection form for it, with the amount and the reference. */
function TakePayment({ payment }: { payment: OlkPayment }) {
  const [orders, setOrders] = useState<{ id: string; number: string; customerName: string; totalCents: number; dueDate: string }[] | null>(null);
  const act = useAction();
  useEffect(() => void act.run(async () => setOrders(await api.olkPayJobOrders(payment.id!))), [payment.id]);
  const take = (jobOrderId: string) => void act.run(async () => {
    const r = await api.olkPayAccept(payment.id!, jobOrderId);
    navigate(`${docPath('col.collection', '/new')}?${new URLSearchParams({ jo: r.jobOrderId, amount: String(r.amountCents), note: r.note })}`);
  });
  return (
    <div className="space-y-3">
      <p className="text-sm">{peso(payment.amountCents)}, reference {payment.reference}. Check that it is in the shop's account, then pick the job order it pays for.</p>
      {orders === null ? <Loading /> : orders.length === 0
        ? <Notice tone="warning">No recorded job order for this member yet. Make their job order first (Own job order), record it, then come back to this payment.</Notice>
        : <ul className="divide-y divide-slate-100">{orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <span><b>{o.number}</b> · {o.customerName} · {peso(o.totalCents)} · due {showDate(o.dueDate)}</span>
              <Button tone="primary" disabled={act.busy} onClick={() => take(o.id)}>Collect on this</Button>
            </li>
          ))}</ul>}
      {act.error && <Notice>{act.error}</Notice>}
    </div>
  );
}
