import { useEffect, useState } from 'react';
import { api, type CashAccount, type CashBook as Book, type Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { bookRangeError, canShowBook } from './rules.ts';

export function CashBook({ me }: { me: Me }) {
  const [places, setPlaces] = useState<CashAccount[]>([]);
  const [placeId, setPlaceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [book, setBook] = useState<Book | null>(null);
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
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Cash book</h1>
    {error && <Notice>{error}</Notice>}
    <div className="print:hidden"><Panel title="Choose a cash place and dates">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Cash place" required><select className={inputClass} value={placeId} onChange={(e) => { setPlaceId(e.target.value); setBook(null); }}><option value="">Pick one</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="From" required><input type="date" className={inputClass} value={from} onChange={(e) => { setFrom(e.target.value); setBook(null); }} /></Field>
        <Field label="To" required><input type="date" className={inputClass} value={to} onChange={(e) => { setTo(e.target.value); setBook(null); }} /></Field>
      </div>
      {rangeError && from && to && <Notice>{rangeError}</Notice>}
      {places.length === 0 && <Notice tone="info">No cash place balance is visible to you.</Notice>}
      <Button tone="primary" disabled={!placeId || !!rangeError || busy} onClick={show}>{busy ? 'Loading…' : 'Show cash book'}</Button>
    </Panel></div>
    {book && <section className="space-y-4 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0">
      <div className="flex items-center gap-3"><div><h2 className="text-xl font-semibold">Cash book · {book.place.name}</h2><p className="text-sm text-slate-600">{book.from} to {book.to}</p></div><span className="flex-1" /><Button className="print:hidden" onClick={() => window.print()}>Print</Button></div>
      <p className="font-semibold">Opening balance <span className="tabular-nums">{peso(book.openingCents)}</span></p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="py-2">Date</th><th>Document</th><th>Details</th><th className="text-right">Money in</th><th className="text-right">Money out</th><th className="text-right">Balance</th></tr></thead><tbody>
        {book.lines.map((line, i) => <tr key={`${line.journalNumber}-${i}`} className="border-t border-slate-100"><td className="py-2">{line.date}</td><td>{line.documentId && line.docType ? <Link to={docPath(line.docType, `/${line.documentId}`)} className="underline print:no-underline">{line.documentNumber ?? line.journalNumber}</Link> : line.journalNumber}</td><td>{line.memo}</td><td className="text-right tabular-nums">{line.inCents ? peso(line.inCents) : '—'}</td><td className="text-right tabular-nums">{line.outCents ? peso(line.outCents) : '—'}</td><td className="text-right tabular-nums">{peso(line.balanceCents)}</td></tr>)}
      </tbody></table></div>
      {book.lines.length === 0 && <p className="text-sm text-slate-500">No movements in this period.</p>}
      <p className="border-t border-slate-300 pt-2 text-right font-semibold">Closing balance <span className="tabular-nums">{peso(book.closingCents)}</span></p>
    </section>}
  </div>;
}
