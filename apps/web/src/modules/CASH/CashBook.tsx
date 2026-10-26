import { useEffect, useState, useRef } from 'react';
import { api, type CashAccount, type CashBook as Book, type Me } from '../../api.ts';
import { Button, Field, Notice, inputClass, peso, showDate } from '../../components/ui.tsx';
import { Card, FigureStrip, MONEY_IN, PageHead, TABLE_HEAD } from '../../components/Figures.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { bookRangeError, canShowBook } from './rules.ts';
import { useLiveReload } from '../../live.ts';
import { PRINT_ONLY, usePrintablePages } from '../../components/RowPages.tsx';

export function CashBook({ me }: { me: Me }) {
  const [places, setPlaces] = useState<CashAccount[]>([]);
  const [placeId, setPlaceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const { onPage, buttons } = usePrintablePages(book?.lines.length ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!me.permissions.includes('cash.book.view')) return;
    api.cashAccounts().then((all) => {
      const visible = all.filter(canShowBook);
      setPlaces(visible);
      const requested = new URLSearchParams(location.search).get('place');
      setPlaceId(visible.find((p) => String(p.id) === requested) ? requested! : String(visible[0]?.id ?? ''));
    }, (e: Error) => setError(e.message));
    api.health().then((h) => { const today = h.serverTime.slice(0, 10); setFrom(`${today.slice(0, 7)}-01`); setTo(today); }, (e: Error) => setError(e.message));
  }, [me]);
  // A book on screen shows what was recorded since, for the same place and dates.
  const shown = useRef(false);
  shown.current = book !== null;
  useLiveReload(() => api.cashBook(Number(placeId), from, to).then(setBook), () => shown.current && !!placeId);
  if (!me.permissions.includes('cash.book.view')) return <Notice>You cannot view the cash book.</Notice>;
  const rangeError = bookRangeError(from, to);
  const show = async () => {
    if (!placeId || rangeError) return;
    setBusy(true);
    setError('');
    setBook(null);
    try { setBook(await api.cashBook(Number(placeId), from, to)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const moneyIn = book?.lines.reduce((n, l) => n + l.inCents, 0) ?? 0;
  const moneyOut = book?.lines.reduce((n, l) => n + l.outCents, 0) ?? 0;
  return <div className="space-y-4">
    <PageHead title="Cash book" sub="Every peso in and out of one cash place, with its running balance." />
    {error && <Notice>{error}</Notice>}
    <div className="print:hidden"><Card title="Choose a cash place and dates" icon="calendar">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Cash place" required><select className={inputClass} value={placeId} onChange={(e) => { setPlaceId(e.target.value); setBook(null); }}><option value="">Pick one</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="From" required><input type="date" className={inputClass} value={from} onChange={(e) => { setFrom(e.target.value); setBook(null); }} /></Field>
        <Field label="To" required><input type="date" className={inputClass} value={to} onChange={(e) => { setTo(e.target.value); setBook(null); }} /></Field>
      </div>
      {rangeError && from && to && <Notice>{rangeError}</Notice>}
      {places.length === 0 && <Notice tone="info">No cash place balance is visible to you.</Notice>}
      <div><Button tone="primary" disabled={!placeId || !!rangeError || busy} onClick={show}>{busy ? 'Loading…' : 'Show cash book'}</Button></div>
    </Card></div>
    {book && <div className="print:hidden"><FigureStrip label="The period at a glance" figures={[
      { label: `Opening, ${showDate(book.from)}`, value: peso(book.openingCents), icon: 'wallet' },
      { label: 'Money in', value: <span className={MONEY_IN}>{peso(moneyIn)}</span>, icon: 'trend', note: `${book.lines.filter((l) => l.inCents).length} in` },
      { label: 'Money out', value: peso(moneyOut), icon: 'cash', note: `${book.lines.filter((l) => l.outCents).length} out` },
      { label: `Closing, ${showDate(book.to)}`, value: peso(book.closingCents), icon: 'money', warn: book.closingCents < 0, note: book.closingCents < 0 ? 'Below zero: check the entries' : undefined },
    ]} /></div>}
    {book && <Card title={`Cash book · ${book.place.name}`} icon="clock" note={`${showDate(book.from)} to ${showDate(book.to)}`} actions={<Button onClick={() => window.print()}>Print</Button>}>
      <p className="text-sm font-semibold">Opening balance <span className="tabular-nums">{peso(book.openingCents)}</span></p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className={TABLE_HEAD}><tr><th className="py-2 pr-3">Date</th><th className="pr-3">Document</th><th className="pr-3">Details</th><th className="pr-3 text-right">Money in</th><th className="pr-3 text-right">Money out</th><th className="text-right">Balance</th></tr></thead><tbody>
        {book.lines.map((line, i) => <tr key={`${line.journalNumber}-${i}`} className={`border-t border-slate-100 align-top ${onPage(i) ? '' : PRINT_ONLY}`}><td className="whitespace-nowrap py-2 pr-3">{showDate(line.date)}</td><td className="whitespace-nowrap pr-3">{line.documentId && line.docType ? <Link to={docPath(line.docType, `/${line.documentId}`)} className="text-indigo-700 hover:underline print:no-underline">{line.documentNumber ?? line.journalNumber}</Link> : line.journalNumber}</td><td className="max-w-md pr-3 text-slate-600">{line.memo}</td><td className={`pr-3 text-right font-medium tabular-nums ${MONEY_IN}`}>{line.inCents ? peso(line.inCents) : ''}</td><td className="pr-3 text-right font-medium tabular-nums">{line.outCents ? peso(line.outCents) : ''}</td><td className="text-right tabular-nums">{peso(line.balanceCents)}</td></tr>)}
      </tbody></table></div>
      {buttons}
      {book.lines.length === 0 && <p className="text-sm text-slate-500">No movements in this period.</p>}
      <p className="border-t border-slate-200 pt-2 text-right text-sm font-semibold">Closing balance <span className="tabular-nums">{peso(book.closingCents)}</span></p>
    </Card>}
  </div>;
}
