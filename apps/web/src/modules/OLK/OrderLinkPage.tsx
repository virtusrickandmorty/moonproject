/**
 * /l/<link>: the page an order link opens (the owner's request, Nov 2026), without signing in. A team list: the coach gives
 * their details and every player (name on the back, number, gender, a size or measurements per item; an item in sizes may
 * also offer "Custom fit", the person's own measurements instead of a size). A group order: each
 * member gives their own details and pieces. Measurements follow the shop's measuring guide; an item that needs the same
 * measurement reuses the person's value, which may be changed for that item alone. Sent answers can be changed with their
 * own link until the link closes. Only that key is kept in this browser, never the answer itself (NR-11).
 * A group link where each member pays their own share shows the prices, the member's share, and the shop's QR code to pay
 * it and send the reference and a screenshot; the page then shows whether the shop received it.
 * Once the shop makes the job order from an answer, the person's own link shows its status, with their wearers and sizes.
 * While the form is filled in, a summary floats beside it (the owner's request, Nov 2026): a panel on the right on a computer,
 * a bar at the bottom of a phone that opens the whole summary. It counts the players, each item's pieces by size, the sizes
 * still to pick, and a member's own share. A team's coach may list the players in Excel instead (TeamSheet.tsx).
 * A set (top and lower) may be one size on top and another below; the shop's note and pictures of the design show at the
 * top (the owner's request, Nov 2026).
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { formatPeso } from '@moonproject/shared';
import type { CustomerOrder, OlkAnswer, OlkGender, OlkGuide, OlkItem, OlkKind, OlkPayHow, OlkPayment, OlkPerson, OlkShare } from '../../api.ts';
import { SHOP_CONTACT } from '../../shop/products.ts';
import { base64, prepare } from '../../shop/Support.tsx';
import { OrderStatus, pcs, sizeWords } from '../../shop/OrderStatus.tsx';
import { TeamSheet } from './TeamSheet.tsx';

export interface LinkPage {
  kind: OlkKind; title: string; closesOn: string; closedOn?: string; open: boolean; payOwn: boolean; items: OlkItem[]; sizes: { label: string; category: 'adult' | 'kids' }[]; guide: OlkGuide[];
  prices?: { lineNo: number; tiers: { fromQty: number; unitPriceCents: number }[] }[]; pay?: OlkPayHow | null; // each pays their own share
  note?: string; pictures?: string[]; // the shop's note and the design pictures' ids
}
type Mine = OlkAnswer & { share?: OlkShare; payments?: OlkPayment[]; orders?: CustomerOrder[] };
/** The price each for this many: the largest tier reached; null when the item has no price on the list. */
export function priceFor(tiers: { fromQty: number; unitPriceCents: number }[] | undefined, qty: number): number | null {
  const t = (tiers ?? []).filter((x) => x.fromQty <= Math.max(1, qty)).at(-1);
  return t ? t.unitPriceCents : null;
}
export interface PersonForm {
  row: number; name: string; backName: string; number: string; gender: OlkGender | ''; measureAtShop: boolean;
  // lower: a set's lower size when it differs from the top ('' is the same as the top)
  pieces: Record<number, { qty: string; size: string; lower?: string }>; measures: Record<string, string>; own: Record<string, string>; // own: `${lineNo}:${field}` for one item
}
interface Details { name: string; gender: OlkGender | ''; mobile: string; email: string; address: string }

const box = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
const day = (d: string) => new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'long', day: 'numeric' });
const keyStore = (token: string) => `olk:${token}`;
const readKey = (token: string) => { try { return localStorage.getItem(keyStore(token)) ?? ''; } catch { return ''; } };
const keepKey = (token: string, key: string) => { try { localStorage.setItem(keyStore(token), key); } catch { /* the link on screen still works */ } };

/** "32", "32.5", "32 1/2", "32½" → inches to two decimals; null when it is not a measurement. */
export function inchesOf(text: string): number | null {
  const t = text.trim().replace(/["”]|in(ch(es)?)?$/i, '').trim().replace('½', ' 1/2').replace('¼', ' 1/4').replace('¾', ' 3/4');
  const m = /^(\d{1,3})(?:\.(\d+)|\s+(\d)\/(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : m[3] ? Number(m[3]) / Number(m[4]) : 0);
  return n > 0 && n <= 300 && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** The size list's choice for a custom fit: the person's own measurements instead of a size. */
export const CUSTOM = '*custom';
/** Whether this person's piece of this item is made to their measurements: a made-to-measure item, or a custom fit. */
export const measuredPiece = (it: OlkItem, p: PersonForm) => Number(p.pieces[it.lineNo]?.qty) > 0 && (it.sizing === 'measure' || (!!it.customFit && p.pieces[it.lineNo]?.size === CUSTOM));

const blankPerson = (row: number, items: OlkItem[], gender: OlkGender | '' = ''): PersonForm => ({
  row, name: '', backName: '', number: '', gender, measureAtShop: false, measures: {}, own: {},
  pieces: Object.fromEntries(items.map((it) => [it.lineNo, { qty: '1', size: '' }])),
});
const personFrom = (p: OlkPerson, items: OlkItem[]): PersonForm => ({
  row: p.row, name: p.name ?? '', backName: p.backName ?? '', number: p.number ?? '', gender: p.gender, measureAtShop: p.measureAtShop,
  pieces: Object.fromEntries(items.map((it) => { const pc = p.pieces.find((x) => x.lineNo === it.lineNo); return [it.lineNo, { qty: pc ? String(pc.qty) : '0', size: pc?.customFit ? CUSTOM : pc?.size ?? '', lower: pc?.lowerSize ?? '' }]; })),
  measures: Object.fromEntries(Object.entries(p.measures).map(([k, v]) => [k, String(v)])),
  own: Object.fromEntries(p.itemMeasures.map((m) => [`${m.lineNo}:${m.field}`, String(m.value)])),
});

/** The measurements this person's made-to-measure and custom-fit pieces need, in the guide's order. */
function fieldsFor(p: PersonForm, items: OlkItem[], guide: OlkGuide[]): OlkGuide[] {
  const need = new Set(items.filter((it) => measuredPiece(it, p)).flatMap((it) => it.fields));
  return guide.filter((g) => need.has(g.key));
}

/** The answer the server takes, or the first thing to fix. */
function toAnswer(link: LinkPage, d: Details, people: PersonForm[]): { body: unknown } | { problem: string } {
  if (d.name.trim().length < 2) return { problem: 'Type your full name.' };
  if (!d.gender) return { problem: 'Pick female or male for yourself.' };
  if (d.mobile.replace(/\D/g, '').length < 10) return { problem: 'Type your mobile number, like 0917 123 4567.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return { problem: 'Type your email address.' };
  if (d.address.trim().length < 5) return { problem: 'Type your address.' };
  const out = [];
  for (const p of people) {
    const who = link.kind === 'team' ? `Player ${p.row}${p.backName.trim() ? ` (${p.backName.trim().toUpperCase()})` : ''}` : 'Your order';
    if (link.kind === 'team' && !p.backName.trim()) return { problem: `${who}: type the name on the back.` };
    if (link.kind === 'team' && p.number.trim() && !/^\d{1,3}$/.test(p.number.trim())) return { problem: `${who}: the number has up to 3 digits.` };
    const gender = link.kind === 'group' ? d.gender : p.gender;
    if (!gender) return { problem: `${who}: pick female or male.` };
    const pieces = [];
    for (const it of link.items) {
      const pc = p.pieces[it.lineNo] ?? { qty: '0', size: '' };
      const qty = Number(pc.qty);
      if (!pc.qty.trim() || qty === 0) continue;
      if (!Number.isInteger(qty) || qty < 0 || qty > 100) return { problem: `${who}: type how many ${it.name} (0 to 100).` };
      if (it.sizing === 'size' && !pc.size) return { problem: `${who}: pick the size for ${it.name}.` };
      const custom = it.sizing === 'size' && !!it.customFit && pc.size === CUSTOM;
      const lower = it.isSet && !custom && pc.lower && pc.lower !== pc.size ? { lowerSize: pc.lower } : {};
      pieces.push({ lineNo: it.lineNo, qty, ...(custom ? { customFit: true } : it.sizing === 'size' ? { size: pc.size, ...lower } : {}) });
    }
    if (!pieces.length) return { problem: `${who}: at least one piece.` };
    const measures: Record<string, number> = {};
    const itemMeasures: { lineNo: number; field: string; value: number }[] = [];
    if (!p.measureAtShop) {
      for (const g of fieldsFor(p, link.items, link.guide)) {
        const raw = p.measures[g.key] ?? '';
        if (!raw.trim()) continue; // the server names every one still missing
        const n = inchesOf(raw);
        if (n === null) return { problem: `${who}: "${raw}" for ${g.label.toLowerCase()} is not a measurement in inches, like 32 or 32.5.` };
        measures[g.key] = n;
      }
      for (const [k, raw] of Object.entries(p.own)) {
        const [lineNo, field] = k.split(':') as [string, string];
        if (!raw.trim() || !pieces.some((pc) => pc.lineNo === Number(lineNo))) continue;
        const n = inchesOf(raw);
        if (n === null) return { problem: `${who}: "${raw}" is not a measurement in inches, like 32 or 32.5.` };
        itemMeasures.push({ lineNo: Number(lineNo), field, value: n });
      }
    }
    out.push({
      row: p.row, gender, measureAtShop: p.measureAtShop, pieces, measures, itemMeasures,
      ...(p.name.trim() ? { name: p.name.trim() } : {}), ...(p.backName.trim() ? { backName: p.backName.trim() } : {}), ...(p.number.trim() ? { number: p.number.trim() } : {}),
    });
  }
  if (!out.length) return { problem: 'Add at least one player.' };
  return { body: { name: d.name.trim(), gender: d.gender, mobile: d.mobile.trim(), email: d.email.trim(), address: d.address.trim(), people: out } };
}

async function send<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch { throw new Error('Cannot reach us right now. Check your connection and try again.'); }
  const data = await res.json().catch(() => null) as (T & { message?: string; code?: string }) | null;
  if (!res.ok) throw Object.assign(new Error(data?.message ?? 'That did not go through. Please try again.'), { status: res.status });
  return data as T;
}

export function OrderLinkPage({ token, query }: { token: string; query: string }) {
  const [link, setLink] = useState<LinkPage | null>(null);
  const [missing, setMissing] = useState('');
  const [key, setKey] = useState(() => new URLSearchParams(query).get('k') ?? readKey(token));
  const [details, setDetails] = useState<Details>({ name: '', gender: '', mobile: '', email: '', address: '' });
  const [people, setPeople] = useState<PersonForm[]>([]);
  const [sent, setSent] = useState<Mine | null>(null); // the answer sent: its summary (and payment) instead of the form
  const [fresh, setFresh] = useState(false); // sent or changed just now
  const [editing, setEditing] = useState(false); // filled from an answer sent before
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/olk/l/${encodeURIComponent(token)}`;
  const [sheet, setSheet] = useState(false); // the phone's summary, opened from its bar

  useEffect(() => {
    document.title = 'Order details · Virtus Garments';
    (async () => {
      const l = await send<LinkPage>('GET', base);
      setLink(l);
      const own = key ? await send<Mine>('GET', `${base}/answers/${encodeURIComponent(key)}`).catch((e: Error & { status?: number }) => { if (e.status === 404) return null; throw e; }) : null;
      if (own) {
        setDetails({ name: own.name, gender: own.gender, mobile: own.mobile, email: own.email, address: own.address });
        setPeople(own.people.map((p) => personFrom(p, l.items)));
        setEditing(true);
        setSent(own);
        keepKey(token, key);
      } else {
        if (key) setKey('');
        setPeople(l.kind === 'group' ? [blankPerson(0, l.items)] : [1, 2, 3].map((r) => blankPerson(r, l.items)));
      }
    })().catch((e: Error & { status?: number }) => setMissing(e.status === 404 ? 'This order link does not exist. Check that the whole link was copied, or ask the shop for it again.' : e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const personal = key ? `${location.origin}/l/${token}?k=${key}` : '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!link) return;
    const a = toAnswer(link, details, people);
    setSheet(false);
    if ('problem' in a) { setProblem(a.problem); requestAnimationFrame(() => document.getElementById('olk-problem')?.scrollIntoView({ behavior: 'smooth', block: 'center' })); return; }
    setProblem(''); setBusy(true);
    try {
      const saved = editing && key
        ? await send<Mine>('PUT', `${base}/answers/${encodeURIComponent(key)}`, a.body)
        : await send<Mine & { key: string }>('POST', `${base}/answers`, a.body);
      if ('key' in saved && typeof saved.key === 'string') { setKey(saved.key); keepKey(token, saved.key); }
      setSent(saved); setFresh(true); setEditing(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  if (missing) return <Frame><p role="alert" className="rounded-2xl bg-rose-50 p-5 text-rose-800">{missing}</p></Frame>;
  if (!link) return <Frame><p className="p-6 text-center text-slate-500">Loading…</p></Frame>;
  const team = link.kind === 'team';
  const setPerson = (row: number, change: Partial<PersonForm>) => setPeople((ps) => ps.map((p) => (p.row === row ? { ...p, ...change } : p)));

  // Once the shop has made the job order, its status says it all: what was sent folds away, and changes go through the shop.
  const ordered = !fresh && !!sent?.orders?.length;
  if (sent) return (
    <Frame title={link.title}>
      {ordered && sent.orders!.map((o) => <OrderStatus key={o.number} order={o} />)}
      {!ordered && <LinkIntro link={link} token={token} />}
      {!link.open && !ordered && <p className="rounded-2xl bg-indigo-50 p-5 text-indigo-900">The shop is making your job order from these details. Open this link again to see where your order is.</p>}
      <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5" aria-live="polite">
        {fresh ? <>
          <p className="text-2xl font-extrabold text-emerald-700">Thank you, {sent.name.split(' ')[0]}!</p>
          <p className="text-slate-700">{sent.changes ? 'Your changes are saved.' : 'We have your order details.'} The shop will check them and get in touch at {sent.mobile} or {sent.email}.</p>
        </> : !ordered && <p className="text-xl font-extrabold">What you sent</p>}
        {ordered
          ? <details className="group"><summary className="cursor-pointer list-none font-semibold text-indigo-700"><span className="group-open:hidden">See what you sent</span><span className="hidden group-open:inline">Hide what you sent</span></summary>
              <div className="mt-3"><Summary link={link} answer={sent} /></div></details>
          : <Summary link={link} answer={sent} />}
        {link.open && !ordered && personal && <KeepLink url={personal} closesOn={link.closesOn} />}
        {link.open && !ordered && <button type="button" className="w-full rounded-full bg-slate-100 py-3 font-semibold text-slate-800 hover:bg-slate-200" onClick={() => { setSent(null); setFresh(false); }}>Change my answer</button>}
        {(ordered || !link.open) && <p className="text-sm text-slate-600">{ordered ? 'The shop has made your job order.' : `This link closed on ${day(link.closedOn ?? link.closesOn)}.`} To change anything, call or text the shop at <b className="whitespace-nowrap">{SHOP_CONTACT.phone}</b>.</p>}
      </section>
      {link.payOwn && sent.share && <PayCard pay={link.pay ?? null} share={sent.share} payments={sent.payments ?? []} url={`${base}/answers/${encodeURIComponent(key)}/payment`} onSent={setSent} />}
    </Frame>
  );

  if (!link.open) return (
    <Frame title={link.title}>
      <p className="rounded-2xl bg-amber-50 p-5 text-amber-900">This link closed on {day(link.closedOn ?? link.closesOn)}. To add or change anything, call or text the shop at {SHOP_CONTACT.phone}.</p>
    </Frame>
  );

  const sendLabel = busy ? 'Sending…' : editing ? 'Save my changes' : 'Send my order details';
  const tally = tallyOf(link, people);
  return (
    <Frame title={link.title} intro={`${team ? 'Give your details, then each player: the name on the back, the number and the size of each piece.' : 'Give your details and the pieces you want, with your size or measurements.'} Open until ${day(link.closesOn)}.`}
      aside={<div className="sticky top-4 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5"><SoFar link={link} tally={tally} /></div>}>
      <LinkIntro link={link} token={token} />
      {editing && personal && <p className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-900">You are changing the answer you sent. Save to keep the changes.</p>}
      <form id="olk-form" onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        <Card title={team ? 'Your details (the coach or the one in charge)' : 'Your details'}>
          <Label text="Full name"><input className={box} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} autoComplete="name" maxLength={120} required /></Label>
          <GenderPick value={details.gender} onChange={(gender) => setDetails({ ...details, gender })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Mobile number"><input className={box} value={details.mobile} onChange={(e) => setDetails({ ...details, mobile: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" maxLength={20} required /></Label>
            <Label text="Email"><input className={box} type="email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} autoComplete="email" maxLength={200} required /></Label>
          </div>
          <Label text="Address"><textarea className={box} rows={2} value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} autoComplete="street-address" maxLength={300} required /></Label>
        </Card>

        {team && <TeamSheet link={link} people={people} custom={CUSTOM} blank={(row) => blankPerson(row, link.items)} onLoad={setPeople} />}

        {people.map((p) => (
          <Card key={p.row} title={team ? `Player ${p.row}` : 'Your order'}
            action={team && people.length > 1 ? <button type="button" className="text-sm font-semibold text-rose-700" onClick={() => setPeople((ps) => ps.filter((x) => x.row !== p.row))}>Remove</button> : undefined}>
            {team && <>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Label text="Name on the back"><input className={`${box} uppercase`} value={p.backName} onChange={(e) => setPerson(p.row, { backName: e.target.value })} maxLength={40} /></Label>
                <Label text="Number"><input className={box} value={p.number} onChange={(e) => setPerson(p.row, { number: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></Label>
              </div>
              <Label text="Full name (optional)"><input className={box} value={p.name} onChange={(e) => setPerson(p.row, { name: e.target.value })} maxLength={120} /></Label>
              <GenderPick value={p.gender} onChange={(gender) => setPerson(p.row, { gender })} />
            </>}
            <Pieces link={link} person={p} gender={team ? p.gender : details.gender} onChange={(pieces) => setPerson(p.row, { pieces })} />
            <Measurements link={link} person={p} onChange={(change) => setPerson(p.row, change)} />
          </Card>
        ))}
        {team && people.length < 500 && (
          <button type="button" className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 font-semibold text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
            onClick={() => setPeople((ps) => [...ps, blankPerson(Math.max(0, ...ps.map((x) => x.row)) + 1, link.items, ps.at(-1)?.gender ?? '')])}>+ Add a player</button>
        )}

        {link.payOwn && <ShareSoFar link={link} person={people[0]} />}
        {problem && <p id="olk-problem" role="alert" className="scroll-mt-4 rounded-2xl bg-rose-50 px-5 py-4 font-semibold text-rose-800">{problem}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-slate-900 py-4 text-lg font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">
          {sendLabel}
        </button>
        <p className="text-center text-sm text-slate-500">{link.payOwn ? 'You pay your share after sending your details.' : 'No payment is taken on this page. The shop reviews your details first.'}</p>
      </form>
      {/* The phone's floating summary: the totals in a bar at the bottom; tapped, the whole summary opens above it. */}
      <div className="lg:hidden">
        {sheet && <button type="button" aria-label="Close the summary" className="fixed inset-0 z-30 bg-slate-900/40" onClick={() => setSheet(false)} />}
        <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl bg-white shadow-[0_-8px_30px_rgb(15_23_42/0.15)] ring-1 ring-slate-900/10 pb-[env(safe-area-inset-bottom)]">
          {sheet && <div id="olk-sheet" className="max-h-[65vh] overflow-y-auto px-5 pt-5"><SoFar link={link} tally={tally} /></div>}
          <div className="flex items-center gap-3 px-4 py-3">
            <button type="button" aria-expanded={sheet} aria-controls="olk-sheet" onClick={() => setSheet((s) => !s)} className="min-w-0 flex-1 text-left">
              <span className="block truncate font-bold">{tally.headline}</span>
              <span className={`block truncate text-sm ${!sheet && tally.unpicked > 0 ? 'font-semibold text-amber-800' : 'text-indigo-700'}`}>{sheet ? 'Hide the summary ▾'
                : tally.unpicked > 0 ? `${tally.unpicked === 1 ? '1 piece needs its size' : `${tally.unpicked} pieces need their size`} · See ▴`
                : `${tally.share !== undefined ? `${tally.share === null ? 'Your share: from the shop' : `Your share ${formatPeso(tally.share)}`} · ` : ''}See the summary ▴`}</span>
            </button>
            <button type="submit" form="olk-form" disabled={busy} className="shrink-0 rounded-full bg-slate-900 px-5 py-3 font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">{busy ? 'Sending…' : editing ? 'Save' : 'Send'}</button>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** What the form holds so far: each item's pieces by size, the sizes still to pick, the players, and a member's share. */
export interface Tally {
  people: number; pieces: number; unpicked: number; headline: string;
  items: { lineNo: number; name: string; qty: number; sizes: [string, number][] }[];
  /** A member who pays their own share: the amount, null when an item has no price on the list; undefined otherwise. */
  share?: number | null;
}
export function tallyOf(link: LinkPage, people: PersonForm[]): Tally {
  const team = link.kind === 'team';
  const order = new Map(link.sizes.map((s, i) => [s.label, i]));
  let unpicked = 0;
  const items = link.items.map((it) => {
    const by = new Map<string, number>();
    let qty = 0;
    for (const p of people) {
      const pc = p.pieces[it.lineNo];
      const n = Number(pc?.qty) || 0;
      if (n <= 0) continue;
      qty += n;
      const label = it.sizing === 'measure' ? 'Made to measurements' : pc!.size === CUSTOM ? 'Custom fit'
        : pc!.size ? (it.isSet && pc!.lower && pc!.lower !== pc!.size ? `${pc!.size} top, ${pc!.lower} lower` : pc!.size) : '';
      if (!label) unpicked += n;
      by.set(label || 'Size not picked yet', (by.get(label || 'Size not picked yet') ?? 0) + n);
    }
    const rank = (s: string) => order.get(s) ?? (s === 'Custom fit' ? 1000 : s === 'Made to measurements' ? 1001 : 1002);
    return { lineNo: it.lineNo, name: it.name, qty, sizes: [...by].sort((a, b) => rank(a[0]) - rank(b[0])) };
  });
  const pieces = items.reduce((n, it) => n + it.qty, 0);
  const withPieces = people.filter((p) => link.items.some((it) => (Number(p.pieces[it.lineNo]?.qty) || 0) > 0)).length;
  const headline = team ? `${withPieces} ${withPieces === 1 ? 'player' : 'players'} · ${pcs(pieces)}` : pcs(pieces);
  return { people: withPieces, pieces, unpicked, headline, items, ...(link.payOwn ? { share: shareOf(link, people[0]) } : {}) };
}

/** The floating summary's content: the same on the computer's side panel and the phone's sheet. */
function SoFar({ link, tally }: { link: LinkPage; tally: Tally }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div>
        <p className="text-sm font-semibold text-slate-500">Your order so far</p>
        <p className="text-2xl font-extrabold">{tally.headline}</p>
      </div>
      <ul className="space-y-3">
        {tally.items.map((it) => (
          <li key={it.lineNo} className="rounded-2xl bg-slate-50 p-3">
            <p className="flex items-baseline justify-between gap-3"><span className="font-semibold">{it.name}</span><span className="shrink-0 text-sm tabular-nums text-slate-600">{pcs(it.qty)}</span></p>
            {it.sizes.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">
              {it.sizes.map(([size, n]) => (
                <li key={size} className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${size === 'Size not picked yet' ? 'bg-amber-100 text-amber-900' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
                  {size} <span className="tabular-nums">×{n}</span>
                </li>
              ))}
            </ul>}
          </li>
        ))}
      </ul>
      {tally.unpicked > 0 && <p className="text-sm font-semibold text-amber-800">{tally.unpicked === 1 ? '1 piece still needs its size.' : `${tally.unpicked} pieces still need their size.`}</p>}
      {tally.share !== undefined && (
        <p className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3"><span className="font-semibold">Your share</span>
          <span className="text-xl font-extrabold tabular-nums">{tally.share === null ? 'The shop will tell you' : formatPeso(tally.share)}</span></p>
      )}
      {link.kind === 'team' && <p className="text-xs text-slate-500">Players with no pieces are not counted.</p>}
    </div>
  );
}

/** `aside`: the floating summary, beside the form on a wide screen (the phone has its own bar). */
function Frame({ title, intro, aside, children }: { title?: string; intro?: string; aside?: ReactNode; children: ReactNode }) {
  const width = aside ? 'max-w-2xl lg:max-w-5xl' : 'max-w-2xl';
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 px-4 pb-8 pt-6 text-white">
        <div className={`mx-auto ${width}`}>
          <p className="text-sm font-semibold tracking-wide text-emerald-300">Virtus Garments · Order details</p>
          {title && <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{title}</h1>}
          {intro && <p className="mt-2 text-sm text-white/75">{intro}</p>}
        </div>
      </header>
      {aside
        ? <div className={`mx-auto -mt-4 ${width} px-4 pb-32 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:pb-12`}>
            <main className="min-w-0 space-y-4">{children}</main>
            <aside className="hidden self-stretch lg:block" aria-label="Your order so far">{aside}</aside>
          </div>
        : <main className="mx-auto -mt-4 max-w-2xl space-y-4 px-4 pb-12">{children}</main>}
      <footer className={`text-center text-xs text-slate-500 ${aside ? 'pb-32 lg:pb-8' : 'pb-8'}`}>Questions? Call or text {SHOP_CONTACT.phone} · {SHOP_CONTACT.email}</footer>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

const Label = ({ text, children }: { text: string; children: ReactNode }) => <label className="block space-y-1"><span className="text-sm font-semibold text-slate-700">{text}</span>{children}</label>;

function GenderPick({ value, onChange }: { value: OlkGender | ''; onChange: (g: OlkGender) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-slate-700">Gender <span className="font-normal text-slate-500">(for the cut: women's or men's)</span></legend>
      <div className="grid grid-cols-2 gap-2">
        {(['female', 'male'] as const).map((g) => (
          <button key={g} type="button" aria-pressed={value === g} onClick={() => onChange(g)}
            className={`rounded-xl py-2.5 font-semibold ring-1 ${value === g ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:ring-indigo-400'}`}>{g === 'female' ? 'Female' : 'Male'}</button>
        ))}
      </div>
    </fieldset>
  );
}

function Pieces({ link, person, gender, onChange }: { link: LinkPage; person: PersonForm; gender: OlkGender | ''; onChange: (pieces: PersonForm['pieces']) => void }) {
  const cut = gender === 'female' ? "women's" : gender === 'male' ? "men's" : '';
  return (
    <div className="divide-y divide-slate-100 rounded-2xl bg-slate-50 px-4">
      {link.items.map((it) => {
        const pc = person.pieces[it.lineNo] ?? { qty: '0', size: '' };
        const set = (c: Partial<typeof pc>) => onChange({ ...person.pieces, [it.lineNo]: { ...pc, ...c } });
        return (
          <div key={it.lineNo} className="flex flex-wrap items-end gap-3 py-3">
            <div className="min-w-0 flex-1 basis-40">
              <p className="font-semibold">{it.name}</p>
              <p className="text-xs text-slate-500">{it.sizing === 'size' && pc.size !== CUSTOM ? `Standard size${cut ? `, ${cut} cut` : ''}${it.customFit ? ', or a custom fit' : ''}${it.isSet ? '. The top and the lower part may be different sizes.' : ''}`
                : pc.size === CUSTOM ? 'Custom fit: made to your measurements below' : 'Made to your measurements'}</p>
              {link.prices && ((each) => <p className="text-sm font-semibold text-slate-700">{each === null ? 'Price from the shop' : `${formatPeso(each)} each`}</p>)(priceFor(link.prices.find((x) => x.lineNo === it.lineNo)?.tiers, Number(pc.qty) || 1))}
            </div>
            <label className="w-20"><span className="text-xs text-slate-500">How many</span>
              <input className={box} inputMode="numeric" value={pc.qty} onChange={(e) => set({ qty: e.target.value.replace(/\D/g, '').slice(0, 3) })} aria-label={`How many ${it.name}`} /></label>
            {it.sizing === 'size' && (
              <label className={it.isSet && pc.size !== CUSTOM ? (it.customFit ? 'w-[calc(50%-0.375rem)] sm:w-60' : 'w-[calc(50%-0.375rem)] sm:w-36') : it.customFit ? 'w-full sm:w-60' : 'w-32'}><span className="text-xs text-slate-500">{it.isSet && pc.size !== CUSTOM ? 'Top size' : 'Size'}</span>
                <select className={box} value={pc.size} onChange={(e) => set({ size: e.target.value })} disabled={pc.qty === '0' || !pc.qty} aria-label={it.isSet ? `Top size of ${it.name}` : `Size of ${it.name}`}>
                  <option value="">Pick…</option>
                  {sizeOptions(link)}
                  {it.customFit && <option value={CUSTOM}>Custom fit (my measurements)</option>}
                </select></label>
            )}
            {/* A set: the lower part may be another size (the owner's request, Nov 2026); the same as the top unless picked. */}
            {it.sizing === 'size' && it.isSet && pc.size !== CUSTOM && (
              <label className="w-[calc(50%-0.375rem)] sm:w-48"><span className="text-xs text-slate-500">Lower size</span>
                <select className={box} value={pc.lower ?? ''} onChange={(e) => set({ lower: e.target.value })} disabled={pc.qty === '0' || !pc.qty} aria-label={`Lower size of ${it.name}`}>
                  <option value="">{pc.size ? `Same as the top (${pc.size})` : 'Same as the top'}</option>
                  {sizeOptions(link)}
                </select></label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The shop's sizes, adult then kids. */
const sizeOptions = (link: LinkPage) => (['adult', 'kids'] as const).map((c) => link.sizes.some((s) => s.category === c) && (
  <optgroup key={c} label={c === 'adult' ? 'Adult' : 'Kids'}>{link.sizes.filter((s) => s.category === c).map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}</optgroup>
));

/** A set's sizes in words: "Top L · Lower M" when they differ. */
export const setSizeWords = (size: string | undefined, lower: string | undefined, qty: number) =>
  lower && size && lower !== size ? [`Top ${size} · Lower ${lower}`, qty > 1 ? pcs(qty) : ''].filter(Boolean).join(' · ') : null;

/**
 * The shop's note and the pictures of the design, at the top of the link (the owner's request, Nov 2026). A picture opens
 * full size on a tap.
 */
function LinkIntro({ link, token }: { link: LinkPage; token: string }) {
  const [big, setBig] = useState<string | null>(null);
  const pics = link.pictures ?? [];
  if (!link.note && !pics.length) return null;
  const src = (id: string) => `/api/olk/l/${encodeURIComponent(token)}/pictures/${encodeURIComponent(id)}`;
  return (
    <section className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5" aria-label="From the shop">
      {link.note && <div className="rounded-2xl bg-amber-50 p-4 text-amber-950 ring-1 ring-amber-200">
        <p className="text-sm font-semibold text-amber-800">A note from the shop</p>
        <p className="mt-1 whitespace-pre-line">{link.note}</p>
      </div>}
      {pics.length > 0 && <div>
        <p className="mb-2 text-sm font-semibold text-slate-600">{pics.length === 1 ? 'The design' : 'The design (tap a picture to see it bigger)'}</p>
        <ul className={`grid gap-3 ${pics.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {pics.map((id, i) => (
            <li key={id}><button type="button" className="block w-full overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200" onClick={() => setBig(id)} aria-label={`See design picture ${i + 1} bigger`}>
              <img src={src(id)} alt={`Design picture ${i + 1}`} loading="lazy" className={`w-full object-contain ${pics.length === 1 ? 'max-h-[28rem]' : 'aspect-square'}`} />
            </button></li>
          ))}
        </ul>
      </div>}
      {big && (
        <div role="dialog" aria-modal="true" aria-label="Design picture" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4" onClick={() => setBig(null)}>
          <img src={src(big)} alt="Design picture" className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white px-4 py-2 font-bold text-slate-900" onClick={() => setBig(null)}>Close</button>
        </div>
      )}
    </section>
  );
}

/** The person's measurements, each once; under each made-to-measure item, the same values, which may differ for that item. */
function Measurements({ link, person, onChange }: { link: LinkPage; person: PersonForm; onChange: (c: Partial<PersonForm>) => void }) {
  const fields = fieldsFor(person, link.items, link.guide);
  const items = link.items.filter((it) => measuredPiece(it, person));
  const [openItems, setOpenItems] = useState<number[]>(() => [...new Set(Object.keys(person.own).map((k) => Number(k.split(':')[0])))]);
  const [help, setHelp] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(link.guide.map((g) => [g.key, g])), [link.guide]);
  if (!fields.length) return null;
  const bad = (v: string | undefined) => !!v?.trim() && inchesOf(v) === null;
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
        <input type="checkbox" className="mt-0.5 size-5" checked={person.measureAtShop} onChange={(e) => onChange({ measureAtShop: e.target.checked })} />
        <span><b>Measure me at the shop.</b> Tick this if you cannot measure now; visit the shop before the order is made.</span>
      </label>
      {!person.measureAtShop && <>
        <div>
          <p className="font-semibold">Measurements, in inches</p>
          <p className="text-sm text-slate-500">Measure over light clothing, tape snug but not tight. Tap ? for how to take each one.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fields.map((g) => (
            <div key={g.key}>
              <div className="flex items-center justify-between gap-1">
                <label htmlFor={`m-${person.row}-${g.key}`} className="text-sm font-semibold text-slate-700">{g.label}</label>
                <button type="button" className="size-6 rounded-full bg-slate-100 text-xs font-bold text-slate-600" aria-label={`How to measure ${g.label.toLowerCase()}`} aria-expanded={help === g.key} onClick={() => setHelp(help === g.key ? null : g.key)}>?</button>
              </div>
              <input id={`m-${person.row}-${g.key}`} className={`${box} ${bad(person.measures[g.key]) ? 'border-rose-500' : ''}`} inputMode="decimal" placeholder="in"
                value={person.measures[g.key] ?? ''} onChange={(e) => onChange({ measures: { ...person.measures, [g.key]: e.target.value } })} />
              {help === g.key && <p className="mt-1 rounded-lg bg-indigo-50 p-2 text-xs text-indigo-900">{g.how}</p>}
            </div>
          ))}
        </div>
        {items.map((it) => {
          const shown = openItems.includes(it.lineNo);
          const ownOf = (f: string) => person.own[`${it.lineNo}:${f}`];
          const differs = it.fields.filter((f) => ownOf(f) !== undefined && ownOf(f)!.trim() !== '' && inchesOf(ownOf(f)!) !== inchesOf(person.measures[f] ?? ''));
          const reset = () => {
            onChange({ own: Object.fromEntries(Object.entries(person.own).filter(([k]) => !k.startsWith(`${it.lineNo}:`))) });
            setOpenItems(openItems.filter((n) => n !== it.lineNo));
          };
          return (
            <div key={it.lineNo} className="rounded-2xl ring-1 ring-slate-200">
              <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm" aria-expanded={shown}
                onClick={() => setOpenItems(shown ? openItems.filter((n) => n !== it.lineNo) : [...openItems, it.lineNo])}>
                <span><b>{it.name}</b> uses these measurements{differs.length ? <span className="text-indigo-700"> · {differs.length} different for this item</span> : ''}</span>
                <span className="shrink-0 font-semibold text-indigo-700">{shown ? 'Done' : 'Change for this item'}</span>
              </button>
              {shown && (
                <div className="space-y-2 border-t border-slate-100 p-3">
                  <p className="text-xs text-slate-500">Change a value only if this item should be longer, shorter, wider or narrower than your measurement.</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {it.fields.map((f) => {
                      const v = ownOf(f) ?? person.measures[f] ?? '';
                      const changed = differs.includes(f);
                      return (
                        <label key={f} className="block">
                          <span className={`text-sm font-semibold ${changed ? 'text-indigo-700' : 'text-slate-700'}`}>{byKey.get(f)?.label}{changed ? ' ✎' : ''}</span>
                          <input className={`${box} ${changed ? 'border-indigo-400 bg-indigo-50' : ''} ${bad(ownOf(f)) ? 'border-rose-500' : ''}`} inputMode="decimal" placeholder="in" value={v}
                            onChange={(e) => onChange({ own: { ...person.own, [`${it.lineNo}:${f}`]: e.target.value } })} aria-label={`${byKey.get(f)?.label} for ${it.name}`} />
                        </label>
                      );
                    })}
                  </div>
                  {differs.length > 0 && <button type="button" className="text-sm font-semibold text-slate-600 underline" onClick={reset}>Use my measurements again</button>}
                </div>
              )}
            </div>
          );
        })}
      </>}
    </div>
  );
}

/**
 * What the person sent, easy to read on a phone (the owner's request, Nov 2026): for a team, how many players and pieces,
 * then each player with their number, name on the back and full name; each piece on its own row with its size on the right.
 */
function Summary({ link, answer }: { link: LinkPage; answer: OlkAnswer }) {
  const name = (lineNo: number) => link.items.find((it) => it.lineNo === lineNo)?.name ?? `Item ${lineNo}`;
  const team = link.kind === 'team';
  const total = answer.people.reduce((s, p) => s + p.pieces.reduce((n, pc) => n + pc.qty, 0), 0);
  return (
    <div className="space-y-2">
      {team && <p className="text-sm text-slate-600">{answer.people.length} {answer.people.length === 1 ? 'player' : 'players'} · {pcs(total)}</p>}
      <ul className="space-y-2">
        {answer.people.map((p) => {
          const back = [p.number && `#${p.number}`, p.backName].filter(Boolean).join(' ');
          const full = p.name && p.name.trim().toUpperCase() !== (p.backName ?? '').trim().toUpperCase() ? p.name : '';
          return (
            <li key={p.row} className="rounded-2xl bg-slate-50 px-4 py-3">
              {team && <p className="mb-1"><b className="uppercase">{back || `Player ${p.row}`}</b>{full && <span className="text-sm text-slate-500"> · {full}</span>}</p>}
              <ul className="divide-y divide-slate-200/70">
                {p.pieces.map((pc) => (
                  <li key={pc.lineNo} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">{name(pc.lineNo)}</span>
                    <span className="shrink-0 rounded-full bg-white px-3 py-0.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">{setSizeWords(pc.size, pc.lowerSize, pc.qty) ?? sizeWords(pc.size, !!pc.customFit, pc.qty)}</span>
                  </li>
                ))}
              </ul>
              {p.measureAtShop && <p className="mt-1 text-sm text-amber-800">To be measured at the shop</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KeepLink({ url, closesOn }: { url: string; closesOn: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-900">
      <p><b>Keep this link</b> to change your answer until {day(closesOn)}. It is yours alone: do not share it.</p>
      <div className="flex gap-2">
        <input readOnly value={url} className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-xs text-slate-700" aria-label="Your own link" onFocus={(e) => e.target.select()} />
        <button type="button" className="rounded-lg bg-indigo-600 px-3 font-semibold text-white"
          onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

/** A member's share of what they filled in: the amount, null when an item has no price on the list, 0 with no pieces yet. */
function shareOf(link: LinkPage, person: PersonForm | undefined): number | null {
  if (!person) return 0;
  const lines = link.items.map((it) => ({ qty: Number(person.pieces[it.lineNo]?.qty) || 0, each: priceFor(link.prices?.find((x) => x.lineNo === it.lineNo)?.tiers, Number(person.pieces[it.lineNo]?.qty) || 1) })).filter((l) => l.qty > 0);
  return lines.every((l) => l.each !== null) ? lines.reduce((s, l) => s + l.qty * l.each!, 0) : null;
}

/** The member's share as they fill in the form (the server works it out again when they send it). */
function ShareSoFar({ link, person }: { link: LinkPage; person: PersonForm | undefined }) {
  const share = shareOf(link, person);
  if (share === 0) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-900/5">
      <span className="font-semibold">Your share</span>
      <span className="text-2xl font-extrabold tabular-nums">{share === null ? 'The shop will tell you' : formatPeso(share)}</span>
    </div>
  );
}

const PAY_STATUS: Record<OlkPayment['status'], [string, string]> = {
  sent: ['Being checked by the shop', 'bg-amber-50 text-amber-900'],
  accepted: ['Received', 'bg-emerald-50 text-emerald-800'],
  not_received: ['Not found by the shop', 'bg-rose-50 text-rose-800'],
};

/** "1,500.00", "₱1500" → centavos; null when it is not an amount. */
export function centsOf(text: string): number | null {
  const typed = text.replace(/[₱\s]/g, '');
  if (typed.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(typed)) return null; // 1500,50 is a slip for 1500.50
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(typed.replace(/,/g, ''));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}

/** The member's share, their payments so far, and the shop's QR code to pay the rest and send the reference and screenshot. */
function PayCard({ pay, share, payments, url, onSent }: { pay: OlkPayHow | null; share: OlkShare; payments: OlkPayment[]; url: string; onSent: (a: Mine) => void }) {
  const counted = payments.filter((p) => p.status !== 'not_received').reduce((s, p) => s + p.amountCents, 0);
  const left = share.totalCents === null ? null : Math.max(0, share.totalCents - counted);
  const waiting = payments.some((p) => p.status === 'sent');
  const [amount, setAmount] = useState(left ? (left / 100).toFixed(2) : '');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<{ name: string; blob: Blob; url: string } | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (f: File) => { setProblem(''); try { setProof(await prepare(f)); } catch (e) { setProblem((e as Error).message); } };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = centsOf(amount);
    if (cents === null || cents < 100) return setProblem('Type the amount you paid, like 1500.00.');
    if (reference.trim().length < 4) return setProblem('Type the reference number from your payment receipt.');
    if (!proof) return setProblem('Add the screenshot of your payment.');
    setBusy(true); setProblem('');
    try {
      onSent(await send<Mine>('POST', url, { amountCents: cents, reference: reference.trim(), proof: { name: proof.name, data: await base64(proof.blob) } }));
      setReference(''); setProof(null);
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5">
      <h2 className="text-lg font-bold">Your payment</h2>
      <ul className="space-y-1 text-sm">
        {share.lines.map((l) => <li key={l.lineNo} className="flex justify-between gap-3"><span>{l.qty} × {l.name}</span><span className="tabular-nums">{l.unitCents === null ? 'price from the shop' : formatPeso(l.qty * l.unitCents)}</span></li>)}
        <li className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-base font-bold"><span>Your share</span><span className="tabular-nums">{share.totalCents === null ? 'The shop will tell you' : formatPeso(share.totalCents)}</span></li>
      </ul>
      {payments.length > 0 && (
        <ul className="space-y-2">{payments.map((p) => (
          <li key={p.sentAt} className={`rounded-2xl px-4 py-3 text-sm ${PAY_STATUS[p.status][1]}`}>
            <b>{formatPeso(p.amountCents)}</b> · ref. {p.reference} · {PAY_STATUS[p.status][0]}{p.reason ? `: ${p.reason}` : ''}
          </li>
        ))}</ul>
      )}
      {share.totalCents === null ? <p className="text-sm text-slate-600">The shop will message you the price and how to pay.</p>
        : waiting ? <p className="text-sm text-slate-600">The shop checks payments within a day. This page shows when it is received.</p>
        : left === 0 ? <p className="font-semibold text-emerald-700">Your share is paid in full. Thank you!</p>
        : !pay ? <p className="text-sm text-slate-600">The shop will message you how to pay {formatPeso(left!)}.</p>
        : (
          <div className="grid gap-5 sm:grid-cols-[14rem_1fr]">
            <div className="text-center">
              <img src={pay.qrUrl} alt={`QR code to pay ${pay.accountName}`} className="mx-auto w-full max-w-[14rem] rounded-xl ring-1 ring-slate-200" />
              <p className="mt-2 text-sm font-bold">{pay.accountName}</p>
              <p className="text-xs text-slate-500">{pay.bankName}{pay.accountHint ? ` · ${pay.accountHint}` : ''}</p>
            </div>
            <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
              <p className="text-sm text-slate-600">Left to pay <b className="text-lg text-slate-900">{formatPeso(left!)}</b></p>
              {pay.instructions && <p className="text-xs text-slate-500">{pay.instructions}</p>}
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700"><li>Scan the QR with your bank or e-wallet app.</li><li>Pay your share (or part of it).</li><li>Type the amount and reference number, and add a screenshot.</li></ol>
              <Label text="Amount you paid (₱)"><input className={box} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Label>
              <Label text="Reference number"><input className={box} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From your payment receipt" /></Label>
              <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 px-4 py-5 text-center hover:border-slate-400">
                {proof ? <img src={proof.url} alt="Your payment screenshot" className="max-h-48 rounded-lg" /> : <><span className="text-sm font-bold">Add the screenshot</span><span className="text-xs text-slate-500">JPEG, PNG or WebP</span></>}
                <input type="file" accept="image/*" className="sr-only" aria-label="Screenshot of your payment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
              </label>
              {problem && <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{problem}</p>}
              <button type="submit" disabled={busy} className="w-full rounded-full bg-indigo-600 py-3.5 font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">{busy ? 'Sending…' : 'I have paid: send my payment'}</button>
            </form>
          </div>
        )}
    </section>
  );
}
