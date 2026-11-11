/**
 * Players fill in their own details for the coach (the owner's request, Nov 2026). On a team list the coach makes a link for
 * the players and sends it to each one; a player opens it (/l/<link>?p=<players' link>) and sends only their own row: the
 * name on the back, number, gender, sizes or measurements. The rows come into the coach's list as cards marked "Filled in by
 * the player"; the coach checks them, may change or remove them, and only the coach sends the whole list to the shop.
 */
import { useEffect, useState, type FormEvent } from 'react';
import type { OlkPerson } from '../../api.ts';
import {
  Card, Frame, GenderPick, KeepLink, Label, LinkIntro, Measurements, Pieces, blankPerson, box, personFrom, personOut, send,
  type LinkPage, type PersonForm,
} from './OrderLinkPage.tsx';

export interface TeamEntry { id: string; person: OlkPerson; sentAt: string; updatedAt: string; onList: boolean }
export interface TeamList { playerToken: string; coachName: string | null; entries: TeamEntry[] }

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* the link on screen still works */ } },
};
export const coachKeyOf = (token: string, query: string) => new URLSearchParams(query).get('c') ?? store.get(`olk-team:${token}`);
const playersUrl = (token: string, pt: string) => `${location.origin}/l/${token}?p=${pt}`;
const isBlank = (p: PersonForm) => !p.entry && !p.backName.trim() && !p.number.trim() && !p.name.trim();

/**
 * The coach's cards with the players' rows put in: a new row fills the first empty card (else a new card at the end); a row the
 * player changed since replaces its card. Rows already on the list the coach sent are left out (they are in the cards).
 */
export function mergeEntries(link: LinkPage, people: PersonForm[], entries: TeamEntry[]): PersonForm[] {
  const out = [...people];
  for (const e of entries) {
    const at = out.findIndex((p) => p.entry?.id === e.id);
    if (at >= 0) {
      if (e.updatedAt > out[at]!.entry!.at) out[at] = { ...personFrom({ ...e.person, row: out[at]!.row }, link.items), entry: { id: e.id, at: e.updatedAt } };
      continue;
    }
    if (e.onList) continue;
    const blank = out.findIndex(isBlank);
    const row = blank >= 0 ? out[blank]!.row : Math.max(0, ...out.map((p) => p.row)) + 1;
    const card = { ...personFrom({ ...e.person, row }, link.items), entry: { id: e.id, at: e.updatedAt } };
    if (blank >= 0) out[blank] = card; else out.push(card);
  }
  return out;
}

/** The coach's list of the players' rows, checked on opening and every 20 seconds while the page is in view. */
export function useTeamList(base: string, token: string, key: string, active: boolean) {
  const [list, setList] = useState<TeamList | null>(null);
  useEffect(() => {
    if (!key || !active) return;
    let stop = false;
    const load = () => void send<TeamList>('GET', `${base}/team/${encodeURIComponent(key)}`).then((l) => { if (!stop) setList(l); store.set(`olk-team:${token}`, key); }, () => undefined);
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [base, token, key, active]);
  return [list, setList] as const;
}

/** The coach's box: make the link for the players, send it, and see how many have sent their details. */
export function PlayersLinkCard({ base, token, coachKey, coachName, list, onStarted }: {
  base: string; token: string; coachKey: string; coachName: string; list: TeamList | null; onStarted: (key: string, list: TeamList) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState('');
  const start = async () => {
    setBusy(true); setProblem('');
    try {
      const r = await send<{ key: string; playerToken: string; coachName: string | null }>('POST', `${base}/team`, coachName.trim() ? { coachName: coachName.trim() } : {});
      store.set(`olk-team:${token}`, r.key);
      onStarted(r.key, { playerToken: r.playerToken, coachName: r.coachName, entries: [] });
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(false); }
  };
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what), () => undefined);
  const url = list ? playersUrl(token, list.playerToken) : '';
  const share = () => void (navigator.share ? navigator.share({ title: 'Your jersey details', text: 'Please fill in your name on the back, number and size here:', url }).catch(() => undefined) : copy('players', url));
  const waiting = list?.entries.filter((e) => !e.onList).length ?? 0;
  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5" aria-label="Let the players fill in their own details">
      <div>
        <h2 className="text-lg font-bold">Let the players fill in their own details</h2>
        <p className="text-sm text-slate-600">Send each player a link. They type their own name on the back, number and size. What they send comes into your list below, for you to check. Only you send the whole list to the shop.</p>
      </div>
      {!coachKey || !list ? (
        <button type="button" disabled={busy || (!!coachKey && !list)} onClick={() => void start()} className="w-full rounded-full bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
          {busy || (coachKey && !list) ? 'Getting the link…' : 'Make a link for the players'}
        </button>
      ) : <>
        <div className="space-y-2 rounded-2xl bg-indigo-50 p-4">
          <p className="text-sm font-semibold text-indigo-900">The link for the players</p>
          <div className="flex gap-2">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="The link for the players" className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-xs text-slate-700" />
            <button type="button" onClick={() => copy('players', url)} className="rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white">{copied === 'players' ? 'Copied' : 'Copy'}</button>
          </div>
          <button type="button" onClick={share} className="w-full rounded-full bg-white py-2.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 sm:hidden">Share to the players (Messenger, Viber…)</button>
        </div>
        <p className="text-sm"><b>{list.entries.length}</b> {list.entries.length === 1 ? 'player has' : 'players have'} sent their details{waiting > 0 && list.entries.length !== waiting ? `, ${waiting} new` : ''}. New ones come into your list by themselves.</p>
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer font-semibold text-indigo-700">Your own link to come back to this list</summary>
          <p className="mt-2">Keep it to yourself: it opens your list, with what the players sent.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={`${location.origin}/l/${token}?c=${coachKey}`} onFocus={(e) => e.target.select()} aria-label="Your own link" className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200" />
            <button type="button" onClick={() => copy('own', `${location.origin}/l/${token}?c=${coachKey}`)} className="rounded-lg bg-slate-800 px-3 text-sm font-semibold text-white">{copied === 'own' ? 'Copied' : 'Copy'}</button>
          </div>
        </details>
      </>}
      {problem && <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{problem}</p>}
    </section>
  );
}

/** What a player sees on their own row: sent, the coach's list, or taken off. */
interface Mine { id: string; key?: string; person: OlkPerson; onList: boolean; takenOff: boolean; coachName: string | null; updatedAt: string }

/** The player's page: the shop's note and design, then only their own details, sent to the coach. */
export function PlayerPage({ link, token, playerToken, query }: { link: LinkPage; token: string; playerToken: string; query: string }) {
  const base = `/api/olk/l/${encodeURIComponent(token)}/players/${encodeURIComponent(playerToken)}`;
  const keyStore = `olk-player:${playerToken}`;
  const [key, setKey] = useState(() => new URLSearchParams(query).get('k') ?? store.get(keyStore));
  const [coach, setCoach] = useState<string | null | undefined>(undefined);
  const [missing, setMissing] = useState('');
  const [me, setMe] = useState<PersonForm>(() => blankPerson(1, link.items));
  const [sent, setSent] = useState<Mine | null>(null);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Your details · Virtus Garments';
    (async () => {
      const inv = await send<{ coachName: string | null }>('GET', base);
      setCoach(inv.coachName);
      const own = key ? await send<Mine>('GET', `${base}/${encodeURIComponent(key)}`).catch(() => null) : null;
      if (own) { setSent(own); setMe(personFrom({ ...own.person, row: 1 }, link.items)); store.set(keyStore, key); } else if (key) setKey('');
    })().catch((e: Error & { status?: number }) => setMissing(e.status === 404 ? 'This link for the players does not work. Ask your coach to send it again.' : e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerToken]);

  const from = coach ? `your coach, ${coach}` : 'your coach';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const one = personOut(link, me, me.gender, 'Your details');
    if ('problem' in one) { setProblem(one.problem); return; }
    const { row: _row, ...body } = one.person;
    setProblem(''); setBusy(true);
    try {
      const r = editing && key ? await send<Mine>('PUT', `${base}/${encodeURIComponent(key)}`, body) : await send<Mine & { key: string }>('POST', base, body);
      if (r.key) { setKey(r.key); store.set(keyStore, r.key); }
      setSent(r); setEditing(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
  };

  if (missing) return <Frame title={link.title}><p role="alert" className="rounded-2xl bg-rose-50 p-5 text-rose-800">{missing}</p></Frame>;
  if (coach === undefined) return <Frame title={link.title}><p className="p-6 text-center text-slate-500">Loading…</p></Frame>;
  if (sent && !editing) {
    const p = sent.person;
    return (
      <Frame title={link.title}>
        <LinkIntro link={link} token={token} />
        <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-slate-900/5" aria-live="polite">
          <p className="text-2xl font-extrabold text-emerald-700">Sent to {from}!</p>
          <p className="text-slate-700">{sent.takenOff ? 'Your coach took your details off the list. If that is a mistake, talk to your coach.'
            : sent.onList ? 'Your coach has sent the team list to the shop with your details. To change them now, tell your coach.'
            : 'Your coach checks the team list and sends it to the shop.'}</p>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="font-bold uppercase">{[p.number && `#${p.number}`, p.backName].filter(Boolean).join(' ')}</p>
            <ul className="mt-1 text-sm text-slate-700">{p.pieces.map((pc) => <li key={pc.lineNo}>{link.items.find((it) => it.lineNo === pc.lineNo)?.name}: {pc.customFit ? 'Custom fit' : pc.lowerSize ? `Top ${pc.size} · Lower ${pc.lowerSize}` : pc.size ? `Size ${pc.size}` : 'Made to your measurements'}{pc.qty > 1 ? ` · ${pc.qty} pieces` : ''}</li>)}</ul>
          </div>
          {link.open && !sent.onList && !sent.takenOff && key && <>
            <KeepLink url={`${location.origin}/l/${token}?p=${playerToken}&k=${key}`} closesOn={link.closesOn} />
            <button type="button" className="w-full rounded-full bg-slate-100 py-3 font-semibold text-slate-800 hover:bg-slate-200" onClick={() => setEditing(true)}>Change my details</button>
          </>}
        </section>
      </Frame>
    );
  }
  if (!link.open) return <Frame title={link.title}><p className="rounded-2xl bg-amber-50 p-5 text-amber-900">This link is closed. Talk to your coach.</p></Frame>;
  const set = (c: Partial<PersonForm>) => setMe((p) => ({ ...p, ...c }));
  return (
    <Frame title={link.title} intro={`Hi! ${coach ? `Your coach, ${coach},` : 'Your coach'} asks for your details for the team list: the name on the back, your number and your size.`}>
      <LinkIntro link={link} token={token} />
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        <Card title="Your details">
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Label text="Name on the back"><input className={`${box} uppercase`} value={me.backName} onChange={(e) => set({ backName: e.target.value })} maxLength={40} /></Label>
            <Label text="Number"><input className={box} value={me.number} onChange={(e) => set({ number: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></Label>
          </div>
          <Label text="Full name (optional)"><input className={box} value={me.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} autoComplete="name" /></Label>
          <GenderPick value={me.gender} onChange={(gender) => set({ gender })} />
          <Pieces link={link} person={me} gender={me.gender} onChange={(pieces) => set({ pieces })} />
          <Measurements link={link} person={me} onChange={set} />
        </Card>
        {problem && <p role="alert" className="rounded-2xl bg-rose-50 px-5 py-4 font-semibold text-rose-800">{problem}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-slate-900 py-4 text-lg font-bold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:bg-slate-400">
          {busy ? 'Sending…' : editing ? 'Save my changes' : `Send to ${coach ? coach.split(' ')[0] : 'my coach'}`}
        </button>
        <p className="text-center text-sm text-slate-500">This goes to your coach, who sends the whole team list to the shop.</p>
      </form>
    </Frame>
  );
}
