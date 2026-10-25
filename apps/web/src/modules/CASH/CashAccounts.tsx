/**
 * Cash accounts (the owner's request, Oct 2026: "more modern, like the dashboard"): the money by kind across the top,
 * then a card for each cash place with its balance and its share of the money shown, its cash book and its settings.
 * Adding a place and its settings open in a dialog. A balance hidden from this user shows as Hidden and counts nowhere.
 * Under the cards, the recent transactions: the last 30 days of every cash book this user may open, newest first.
 */
import { useEffect, useState } from 'react';
import { api, type CashAccount, type CashBook, type Me } from '../../api.ts';
import { Paged } from '../../components/RowPages.tsx';
import { docPath } from '../../shell/menu.ts';
import { Button, Dialog, Field, Notice, CARD_TITLE, SURFACE, inputClass, peso, showDate, useAction } from '../../components/ui.tsx';
import { TickBar } from '../../components/charts.tsx';
import { Link } from '../../router.tsx';
import { Icon, type IconName } from '../DASH/Cards.tsx';
import { canShowBook } from './rules.ts';
import { useLiveReload } from '../../live.ts';

const kinds: { value: CashAccount['kind']; label: string; plural: string; icon: IconName }[] = [
  { value: 'cash', label: 'Cash box', plural: 'Cash boxes', icon: 'cash' },
  { value: 'bank', label: 'Bank', plural: 'Banks', icon: 'bank' },
  { value: 'ewallet', label: 'E-wallet', plural: 'E-wallets', icon: 'wallet' },
  { value: 'checks', label: 'Checks on hand', plural: 'Checks on hand', icon: 'cheque' },
];
const kindOf = (k: CashAccount['kind']) => kinds.find((x) => x.value === k) ?? kinds[0]!;

/** The money by kind across the top, like the home's headline figures: the total first, then each kind there is. */
function Totals({ places }: { places: CashAccount[] }) {
  const shown = places.filter((p) => p.balanceCents !== null);
  const sum = (list: CashAccount[]) => list.reduce((n, p) => n + (p.balanceCents ?? 0), 0);
  const total = sum(shown);
  const tiles = [
    { key: 'all', label: 'All the money shown', icon: 'money' as IconName, cents: total, note: `${shown.length} ${shown.length === 1 ? 'place' : 'places'}${shown.length < places.length ? `, ${places.length - shown.length} hidden` : ''}` },
    ...kinds.filter((k) => places.some((p) => p.kind === k.value)).map((k) => {
      const mine = shown.filter((p) => p.kind === k.value);
      return { key: k.value, label: k.plural, icon: k.icon, cents: sum(mine), note: `${mine.length} ${mine.length === 1 ? 'place' : 'places'}` };
    }),
  ].slice(0, 5);
  return (
    <section aria-label="Money by kind" className={`grid sm:grid-cols-2 ${tiles.length >= 5 ? 'lg:grid-cols-5' : tiles.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} ${SURFACE}`}>
      {tiles.map((t, i) => (
        <div key={t.key} className={`flex flex-col gap-2 p-4 ${i > 0 ? 'border-t border-slate-100 sm:border-t-0 lg:border-l' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
          <span className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600"><Icon name={t.icon} className="size-4" /></span>
            <span className="flex-1 text-sm text-slate-500">{t.label}</span>
          </span>
          <strong className={`block text-2xl font-semibold tabular-nums leading-tight ${t.cents < 0 ? 'text-red-600' : ''}`}>{peso(t.cents)}</strong>
          <span className="flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{t.note}</span>
            {t.key !== 'all' && total > 0 && <TickBar parts={[{ share: Math.max(0, t.cents) / total, tone: 'bg-slate-700' }]} ticks={20} height="h-5" label={`${Math.round((Math.max(0, t.cents) / total) * 100)}% of the money shown`} />}
          </span>
        </div>
      ))}
    </section>
  );
}

/** One cash place as a card: its kind, its balance and its share, its account number, and what can be done with it. */
function PlaceCard({ p, total, book, manage, onSettings }: { p: CashAccount; total: number; book: boolean; manage: boolean; onSettings: () => void }) {
  const kind = kindOf(p.kind);
  const share = p.balanceCents !== null && total > 0 ? Math.max(0, p.balanceCents) / total : null;
  return (
    <section aria-label={p.name} className={`flex min-w-0 flex-col gap-4 p-5 ${SURFACE}`}>
      <header className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon name={kind.icon} /></span>
        <div className="min-w-0 flex-1">
          <h2 className={`${CARD_TITLE} line-clamp-2`} title={p.name}>{p.name}</h2>
          <p className="text-xs text-slate-500">{kind.label} · Account {p.code}{p.accountNo ? ` · No. ${p.accountNo}` : ''}</p>
        </div>
        {p.encoderSeesBalance === false && <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title="Encoders do not see this balance">Owner only</span>}
      </header>
      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="block text-xs text-slate-500">Balance</span>
          {p.balanceCents === null
            ? <strong className="text-2xl font-semibold text-slate-400">Hidden</strong>
            : <strong className={`text-2xl font-semibold tabular-nums ${p.balanceCents < 0 ? 'text-red-600' : ''}`}>{peso(p.balanceCents)}</strong>}
        </div>
        {share !== null && <div className="text-right">
          <TickBar parts={[{ share, tone: 'bg-indigo-600' }]} ticks={16} height="h-5" label={`${Math.round(share * 100)}% of the money shown`} />
          <span className="text-xs tabular-nums text-slate-500">{Math.round(share * 100)}% of the money shown</span>
        </div>}
      </div>
      {(book && canShowBook(p)) || manage ? (
        <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {book && canShowBook(p) && <Link to={`/cash/book?place=${p.id}`} className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">Cash book →</Link>}
          <span className="flex-1" />
          {manage && <Button onClick={onSettings}>Settings</Button>}
        </footer>
      ) : null}
    </section>
  );
}

const DAYS = 30;
type Movement = CashBook['lines'][number] & { placeName: string; placeKind: CashAccount['kind'] };
/** A calendar day n days before another (both YYYY-MM-DD, built from their parts: no clock, house rule NR-7). */
const daysBefore = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d - n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/** Money in and out of the cash places this user may open, the last 30 days, newest first (the owner's request, Oct 2026). */
function RecentTransactions({ places }: { places: CashAccount[] }) {
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [error, setError] = useState('');
  const open = places.filter(canShowBook);
  const key = open.map((p) => `${p.id}:${p.balanceCents}`).join(',');
  useEffect(() => {
    let stale = false;
    void (async () => {
      try {
        const today = (await api.health()).serverTime.slice(0, 10); // the server's Manila date
        const books = await Promise.all(open.map((p) => api.cashBook(p.id, daysBefore(today, DAYS - 1), today)));
        const all = books.flatMap((b) => b.lines.map((l) => ({ ...l, placeName: b.place.name, placeKind: b.place.kind })));
        // Newest first: by date, then by journal number (recorded later, numbered later).
        all.sort((a, b) => b.date.localeCompare(a.date) || b.journalNumber.localeCompare(a.journalNumber));
        if (!stale) { setRows(all); setError(''); }
      } catch (e) { if (!stale) setError((e as Error).message); }
    })();
    return () => { stale = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a balance that moved reloads it
  if (open.length === 0) return null;
  return (
    <section aria-label="Recent transactions" className={`flex flex-col gap-4 p-5 ${SURFACE}`}>
      <header className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon name="clock" /></span>
        <h2 className={CARD_TITLE}>Recent transactions</h2>
        <span className="text-xs text-slate-500">Last {DAYS} days · newest first</span>
      </header>
      {error && <Notice>{error}</Notice>}
      {!rows && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-slate-500">No money came in or went out in the last {DAYS} days.</p>}
      {rows && rows.length > 0 && <Paged rows={rows}>{(page) => (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-3">Date</th><th className="pr-3">Cash place</th><th className="pr-3">Document</th><th className="pr-3">Details</th><th className="pr-3 text-right">Money in</th><th className="text-right">Money out</th></tr>
            </thead>
            <tbody>
              {page.map((l, i) => (
                <tr key={`${l.journalNumber}-${l.placeName}-${i}`} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-3">{showDate(l.date)}</td>
                  <td className="pr-3"><span className="inline-flex items-center gap-1.5"><Icon name={kindOf(l.placeKind).icon} className="size-4 text-slate-500" />{l.placeName}</span></td>
                  <td className="whitespace-nowrap pr-3">{l.documentId && l.docType
                    ? <Link to={docPath(l.docType, `/${l.documentId}`)} className="text-indigo-700 hover:underline">{l.documentNumber ?? l.journalNumber}</Link>
                    : (l.documentNumber ?? l.journalNumber)}</td>
                  <td className="max-w-md pr-3 text-slate-600">{/^[\d-]+$/.test(l.memo.trim()) ? `Ref. ${l.memo.trim()}` : l.memo}</td>
                  <td className="pr-3 text-right tabular-nums font-medium text-emerald-700">{l.inCents ? peso(l.inCents) : ''}</td>
                  <td className="text-right tabular-nums font-medium text-slate-900">{l.outCents ? peso(l.outCents) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Paged>}
    </section>
  );
}

export function CashAccounts({ me }: { me: Me }) {
  const manage = me.permissions.includes('cash.places.manage');
  const book = me.permissions.includes('cash.book.view');
  const [places, setPlaces] = useState<CashAccount[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<CashAccount | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CashAccount['kind']>('cash');
  const [accountNo, setAccountNo] = useState('');
  const [changeAccountNo, setChangeAccountNo] = useState(false);
  const [encoderSeesBalance, setEncoderSeesBalance] = useState(true);
  const action = useAction();
  const load = () => api.cashAccounts().then(setPlaces, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  useLiveReload(load);

  const startEdit = (p: CashAccount) => {
    setEditing(p);
    setAdding(false);
    setAccountNo(''); // the server may send a masked number; never submit that mask as a new number
    setChangeAccountNo(false);
    setEncoderSeesBalance(p.encoderSeesBalance ?? false);
  };
  const close = () => { setEditing(null); setAdding(false); };
  const save = async () => {
    if (editing) {
      await api.updateCashPlace(editing.id, editing.version!, {
        encoderSeesBalance,
        ...(changeAccountNo && (editing.kind === 'bank' || editing.kind === 'ewallet') ? { accountNo: accountNo.trim() || null } : {}),
      });
    } else {
      await api.addCashPlace({ name: name.trim(), kind, encoderSeesBalance, ...(kind === 'bank' || kind === 'ewallet' ? (accountNo.trim() ? { accountNo: accountNo.trim() } : {}) : {}) });
    }
    close();
    setName('');
    setAccountNo('');
    await load();
  };
  const formOpen = adding || !!editing;
  const numberKind = (editing?.kind ?? kind) === 'bank' || (editing?.kind ?? kind) === 'ewallet';
  const total = (places ?? []).reduce((n, p) => n + Math.max(0, p.balanceCents ?? 0), 0);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto">
        <h1 className="text-2xl font-semibold">Cash Accounts</h1>
        <p className="text-sm text-slate-600">Where the shop's money is kept: cash boxes, banks, e-wallets and checks not yet deposited.</p>
      </div>
      {manage && <Button tone="primary" onClick={() => { setAdding(true); setEditing(null); setName(''); setAccountNo(''); setKind('cash'); setEncoderSeesBalance(true); }}>+ Add place</Button>}
    </div>
    {error && <Notice>{error}</Notice>}
    {places && places.length > 0 && <Totals places={places} />}
    {places?.length === 0 && <p className={`p-5 text-sm text-slate-500 ${SURFACE}`}>No cash places yet.</p>}
    {places && places.length > 0 && (
      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        {places.map((p) => <PlaceCard key={p.id} p={p} total={total} book={book} manage={manage} onSettings={() => startEdit(p)} />)}
      </div>
    )}
    {book && places && places.length > 0 && <RecentTransactions places={places} />}
    {formOpen && <Dialog title={editing ? `Settings for ${editing.name}` : 'Add a cash place'} onClose={close}>
      <div className="space-y-3">
        {!editing && <>
          <Field label="Name" required><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Like Cash in bank – BPI" /></Field>
          <Field label="Kind" required>
            <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {kinds.map((k) => (
                <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => { setKind(k.value); setAccountNo(''); }}
                  className={`flex flex-col items-center gap-1 rounded-lg p-3 text-sm ring-1 ${kind === k.value ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-indigo-50'}`}>
                  <Icon name={k.icon} />{k.label}
                </button>
              ))}
            </div>
          </Field>
        </>}
        {numberKind && <>
          <p className="text-sm text-slate-600">{editing ? `Current account number: ${editing.accountNo ?? 'none'}` : 'Account number is optional.'}</p>
          {editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={changeAccountNo} onChange={(e) => { setChangeAccountNo(e.target.checked); setAccountNo(''); }} />Change account number</label>}
          {(!editing || changeAccountNo) && <Field label="Account number" hint="Leave blank to remove the number when changing it."><input className={inputClass} value={accountNo} onChange={(e) => setAccountNo(e.target.value)} /></Field>}
        </>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={encoderSeesBalance} onChange={(e) => setEncoderSeesBalance(e.target.checked)} />Encoders see the balance</label>
        {action.error && <Notice>{action.error}</Notice>}
        <div className="flex justify-end gap-2"><Button onClick={close}>Cancel</Button><Button tone="primary" disabled={action.busy || (!editing && name.trim().length < 3)} onClick={() => action.run(save)}>Save</Button></div>
      </div>
    </Dialog>}
  </div>;
}
