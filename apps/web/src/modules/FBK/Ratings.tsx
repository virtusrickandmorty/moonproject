/**
 * Customer ratings (the owner's request, Nov 2026): the screen that lists every rating of a period with the average, and the
 * panel on a released job order with its rating, or the link to ask for one on Messenger.
 */
import { useEffect, useState } from 'react';
import { api, type DocDetail } from '../../api.ts';
import { Button, Loading, Notice, Panel, inputClass, showDate } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { useLiveReload } from '../../live.ts';
import { Stars } from './RatingPage.tsx';

export interface FbkRating { stars: number; comment?: string; name?: string; at: string }
export interface FbkJobOrder { stage: string; token: string | null; rating: FbkRating | null }
export interface FbkList { from: string; to: string; asked: number; rated: number; average: number | null; rows: { jobOrderNumber: string; jobOrderId: string; customerName: string | null; stars: number; comment: string | null; name: string | null; at: string }[] }

export const ratingUrl = (token: string) => `${/(^|\.)virtusgarments\.com$/.test(location.hostname) ? location.origin : 'https://www.virtusgarments.com'}/r/${token}`;
const message = (number: string, url: string) => `Hi! Thank you for your order ${number}. Would you rate how we did, from 1 to 5 stars? It takes a few seconds: ${url}`;

/** On a job order's page: its rating, or (once released) the link to ask for one. */
export function RatingPanel({ d }: { d: DocDetail }) {
  const [permsState, setPerms] = useState<string[]>([]);
  const perms = permsState ?? []; // a page test may give the panel no state of its own
  const [r, setR] = useState<FbkJobOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const id = d.header.id;
  const load = () => api.fbkJobOrder(id).then(setR, (e: Error) => setError(e.message));
  useEffect(() => { void api.me().then((me) => setPerms(me?.permissions ?? []), () => setPerms([])); }, []);
  useEffect(() => { if (perms.includes('fbk.view')) void load(); }, [id, perms.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveReload(() => (perms.includes('fbk.view') ? load() : Promise.resolve()));
  if (!perms.includes('fbk.view') || !r || (!r.rating && !r.token && r.stage !== 'released')) return null;
  const url = r.token ? ratingUrl(r.token) : '';
  return <Panel title="Customer rating">
    {error && <Notice>{error}</Notice>}
    {r.rating ? <div className="space-y-1">
      <Stars value={r.rating.stars} size="text-2xl" />
      <p className="text-sm text-slate-600">{r.rating.name ? `${r.rating.name} · ` : ''}{showDate(r.rating.at.slice(0, 10))}</p>
      {r.rating.comment && <p className="text-sm">“{r.rating.comment}”</p>}
    </div> : r.token ? <div className="space-y-2">
      <p className="text-sm text-slate-600">Not rated yet. Customers who agreed to emails get this link the day after the order is fully released; you can also send it.</p>
      <div className="flex flex-wrap gap-2">
        <input readOnly value={url} className={`${inputClass} min-w-0 flex-1`} aria-label="The rating link" onFocus={(e) => e.target.select()} />
        <Button tone="primary" onClick={() => void navigator.clipboard?.writeText(message(d.header.number, url)).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy message'}</Button>
      </div>
    </div> : perms.includes('fbk.ask') && d.header.status === 'posted'
      ? <div className="space-y-2"><p className="text-sm text-slate-600">This order is released. Ask the customer to rate it on Messenger.</p>
          <Button onClick={() => void api.fbkLink(id).then(setR, (e: Error) => setError(e.message))}>Make the rating link</Button></div>
      : null}
  </Panel>;
}

/** Sales > Customer ratings: a month's ratings, newest first, with the average. */
export function RatingsScreen() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7));
  const [data, setData] = useState<FbkList | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    void api.fbkRatings(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`).then(setData, (e: Error) => setError(e.message));
  }, [month]);
  if (error) return <Notice>{error}</Notice>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-sm text-slate-600">After a job order is fully released, its customer is asked to rate it. A rating of 3 stars or less also shows in the bell: call the customer.</p>
      <input type="month" className={inputClass + ' w-auto'} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
    </div>
    {!data ? <Loading /> : <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Average</dt>
          <dd className="text-2xl font-bold">{data.average === null ? '–' : <>{data.average.toFixed(1)} <span className="text-amber-400">★</span></>}</dd></div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Ratings</dt><dd className="text-2xl font-bold">{data.rated}</dd></div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Asked</dt><dd className="text-2xl font-bold">{data.asked}</dd></div>
      </dl>
      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
        {data.rows.length === 0 ? <p className="text-sm text-slate-500">No ratings this month yet.</p> : data.rows.map((r, i) => (
          <div key={i} className="space-y-1 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p><Stars value={r.stars} size="text-lg" /> <Link to={`/docs/jo.job_order/${r.jobOrderId}`} className="font-semibold text-indigo-700">{r.jobOrderNumber}</Link> · {r.customerName ?? ''}</p>
              <p className="text-xs text-slate-500">{r.name ? `${r.name} · ` : ''}{showDate(r.at.slice(0, 10))}</p>
            </div>
            {r.comment && <p className="text-sm text-slate-700">“{r.comment}”</p>}
          </div>))}
      </div>
    </>}
  </div>;
}
