/**
 * /l/<link>: the page an order link opens (the owner's request, Nov 2026), without signing in. A team list: the coach gives
 * their details and every player (name on the back, number, gender, a size or measurements per item). A group order: each
 * member gives their own details and pieces. Measurements follow the shop's measuring guide; an item that needs the same
 * measurement reuses the person's value, which may be changed for that item alone. Sent answers can be changed with their
 * own link until the link closes. Only that key is kept in this browser, never the answer itself (NR-11).
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { OlkAnswer, OlkGender, OlkGuide, OlkItem, OlkKind, OlkPerson } from '../../api.ts';
import { SHOP_CONTACT } from '../../shop/products.ts';

interface LinkPage { kind: OlkKind; title: string; closesOn: string; open: boolean; payOwn: boolean; items: OlkItem[]; sizes: { label: string; category: 'adult' | 'kids' }[]; guide: OlkGuide[] }
interface PersonForm {
  row: number; name: string; backName: string; number: string; gender: OlkGender | ''; measureAtShop: boolean;
  pieces: Record<number, { qty: string; size: string }>; measures: Record<string, string>; own: Record<string, string>; // own: `${lineNo}:${field}` for one item
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

const blankPerson = (row: number, items: OlkItem[], gender: OlkGender | '' = ''): PersonForm => ({
  row, name: '', backName: '', number: '', gender, measureAtShop: false, measures: {}, own: {},
  pieces: Object.fromEntries(items.map((it) => [it.lineNo, { qty: '1', size: '' }])),
});
const personFrom = (p: OlkPerson, items: OlkItem[]): PersonForm => ({
  row: p.row, name: p.name ?? '', backName: p.backName ?? '', number: p.number ?? '', gender: p.gender, measureAtShop: p.measureAtShop,
  pieces: Object.fromEntries(items.map((it) => { const pc = p.pieces.find((x) => x.lineNo === it.lineNo); return [it.lineNo, { qty: pc ? String(pc.qty) : '0', size: pc?.size ?? '' }]; })),
  measures: Object.fromEntries(Object.entries(p.measures).map(([k, v]) => [k, String(v)])),
  own: Object.fromEntries(p.itemMeasures.map((m) => [`${m.lineNo}:${m.field}`, String(m.value)])),
});

/** The measurements this person's made-to-measure pieces need, in the guide's order. */
function fieldsFor(p: PersonForm, items: OlkItem[], guide: OlkGuide[]): OlkGuide[] {
  const need = new Set(items.filter((it) => it.sizing === 'measure' && Number(p.pieces[it.lineNo]?.qty) > 0).flatMap((it) => it.fields));
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
      pieces.push({ lineNo: it.lineNo, qty, ...(it.sizing === 'size' ? { size: pc.size } : {}) });
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
  const [sent, setSent] = useState<OlkAnswer | null>(null); // just sent or changed: the thank-you
  const [editing, setEditing] = useState(false); // filled from an answer sent before
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/olk/l/${encodeURIComponent(token)}`;

  useEffect(() => {
    document.title = 'Order details · Virtus Garments';
    (async () => {
      const l = await send<LinkPage>('GET', base);
      setLink(l);
      const own = key ? await send<OlkAnswer>('GET', `${base}/answers/${encodeURIComponent(key)}`).catch(() => null) : null;
      if (own) {
        setDetails({ name: own.name, gender: own.gender, mobile: own.mobile, email: own.email, address: own.address });
        setPeople(own.people.map((p) => personFrom(p, l.items)));
        setEditing(true);
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
    if ('problem' in a) return setProblem(a.problem);
    setProblem(''); setBusy(true);
    try {
      const saved = editing && key
        ? await send<OlkAnswer>('PUT', `${base}/answers/${encodeURIComponent(key)}`, a.body)
        : await send<OlkAnswer & { key: string }>('POST', `${base}/answers`, a.body);
      if ('key' in saved && typeof saved.key === 'string') { setKey(saved.key); keepKey(token, saved.key); }
      setSent(saved); setEditing(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  if (missing) return <Frame><p role="alert" className="rounded-2xl bg-rose-50 p-5 text-rose-800">{missing}</p></Frame>;
  if (!link) return <Frame><p className="p-6 text-center text-slate-500">Loading…</p></Frame>;
  const team = link.kind === 'team';
  const setPerson = (row: number, change: Partial<PersonForm>) => setPeople((ps) => ps.map((p) => (p.row === row ? { ...p, ...change } : p)));

  if (sent) return (
    <Frame title={link.title}>
      <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5" aria-live="polite">
        <p className="text-2xl font-extrabold text-emerald-700">Thank you, {sent.name.split(' ')[0]}!</p>
        <p className="text-slate-700">{sent.changes ? 'Your changes are saved.' : 'We have your order details.'} The shop will check them and get in touch at {sent.mobile} or {sent.email}.</p>
        <Summary link={link} answer={sent} />
        {link.open && personal && <KeepLink url={personal} closesOn={link.closesOn} />}
        {link.open && <button type="button" className="w-full rounded-full bg-slate-100 py-3 font-semibold text-slate-800 hover:bg-slate-200" onClick={() => setSent(null)}>Change my answer</button>}
      </section>
    </Frame>
  );

  if (!link.open) return (
    <Frame title={link.title}>
      <p className="rounded-2xl bg-amber-50 p-5 text-amber-900">This link closed on {day(link.closesOn)}. To add or change anything, call or text the shop at {SHOP_CONTACT.phone}.</p>
    </Frame>
  );

  return (
    <Frame title={link.title} intro={`${team ? 'Give your details, then each player: the name on the back, the number and the size of each piece.' : 'Give your details and the pieces you want, with your size or measurements.'} Open until ${day(link.closesOn)}.`}>
      {editing && personal && <p className="rounded-2xl bg-indigo-50 p-4 text-sm text-indigo-900">You are changing the answer you sent. Save to keep the changes.</p>}
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        <Card title={team ? 'Your details (the coach or the one in charge)' : 'Your details'}>
          <Label text="Full name"><input className={box} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} autoComplete="name" maxLength={120} required /></Label>
          <GenderPick value={details.gender} onChange={(gender) => setDetails({ ...details, gender })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Mobile number"><input className={box} value={details.mobile} onChange={(e) => setDetails({ ...details, mobile: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" maxLength={20} required /></Label>
            <Label text="Email"><input className={box} type="email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} autoComplete="email" maxLength={200} required /></Label>
          </div>
          <Label text="Address"><textarea className={box} rows={2} value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} autoComplete="street-address" maxLength={300} required /></Label>
        </Card>

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

        {problem && <p role="alert" className="rounded-2xl bg-rose-50 px-5 py-4 font-semibold text-rose-800">{problem}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-slate-900 py-4 text-lg font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">
          {busy ? 'Sending…' : editing ? 'Save my changes' : 'Send my order details'}
        </button>
        <p className="text-center text-sm text-slate-500">No payment is taken on this page. The shop reviews your details first.</p>
      </form>
    </Frame>
  );
}

function Frame({ title, intro, children }: { title?: string; intro?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 px-4 pb-8 pt-6 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-emerald-300">Virtus Garments · Order details</p>
          {title && <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{title}</h1>}
          {intro && <p className="mt-2 text-sm text-white/75">{intro}</p>}
        </div>
      </header>
      <main className="mx-auto -mt-4 max-w-2xl space-y-4 px-4 pb-12">{children}</main>
      <footer className="pb-8 text-center text-xs text-slate-500">Questions? Call or text {SHOP_CONTACT.phone} · {SHOP_CONTACT.email}</footer>
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
              <p className="text-xs text-slate-500">{it.sizing === 'size' ? `Standard size${cut ? `, ${cut} cut` : ''}` : 'Made to your measurements'}</p>
            </div>
            <label className="w-20"><span className="text-xs text-slate-500">How many</span>
              <input className={box} inputMode="numeric" value={pc.qty} onChange={(e) => set({ qty: e.target.value.replace(/\D/g, '').slice(0, 3) })} aria-label={`How many ${it.name}`} /></label>
            {it.sizing === 'size' && (
              <label className="w-32"><span className="text-xs text-slate-500">Size</span>
                <select className={box} value={pc.size} onChange={(e) => set({ size: e.target.value })} disabled={pc.qty === '0' || !pc.qty} aria-label={`Size of ${it.name}`}>
                  <option value="">Pick…</option>
                  {(['adult', 'kids'] as const).map((c) => link.sizes.some((s) => s.category === c) && (
                    <optgroup key={c} label={c === 'adult' ? 'Adult' : 'Kids'}>{link.sizes.filter((s) => s.category === c).map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}</optgroup>
                  ))}
                </select></label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The person's measurements, each once; under each made-to-measure item, the same values, which may differ for that item. */
function Measurements({ link, person, onChange }: { link: LinkPage; person: PersonForm; onChange: (c: Partial<PersonForm>) => void }) {
  const fields = fieldsFor(person, link.items, link.guide);
  const items = link.items.filter((it) => it.sizing === 'measure' && Number(person.pieces[it.lineNo]?.qty) > 0);
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

function Summary({ link, answer }: { link: LinkPage; answer: OlkAnswer }) {
  const name = (lineNo: number) => link.items.find((it) => it.lineNo === lineNo)?.name ?? `Item ${lineNo}`;
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl bg-slate-50 px-4 text-sm">
      {answer.people.map((p) => (
        <li key={p.row} className="py-3">
          {link.kind === 'team' && <p className="font-semibold">{p.number ? `#${p.number} ` : ''}{p.backName}</p>}
          <p className="text-slate-600">{p.pieces.map((pc) => `${pc.qty} × ${name(pc.lineNo)}${pc.size ? ` (${pc.size})` : ''}`).join(', ')}{p.measureAtShop ? ' · to measure at the shop' : ''}</p>
        </li>
      ))}
    </ul>
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
