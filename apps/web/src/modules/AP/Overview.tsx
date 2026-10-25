/**
 * Purchases and expenses at a glance (the owner's request, 25 Oct 2026), in the dashboard's look. A purchase goes
 * Order → Receive → Bill → Pay; each step shows what waits at it with the button for the next step, so a purchase is
 * never left half done: orders still to receive, goods received with no bill yet, bills to pay (overdue first). A thing
 * paid on the spot is an expense voucher instead. Below: what this month cost, on bills and on expense vouchers.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type DocTypeInfo, type PurchasesOverview } from '../../api.ts';
import { CARD_TITLE, Loading, Notice, SURFACE, peso, showDate } from '../../components/ui.tsx';
import { TickBar } from '../../components/charts.tsx';
import { Icon, type IconName } from '../DASH/Cards.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { useLiveReload } from '../../live.ts';

const button = 'inline-flex items-center rounded-md bg-white px-2.5 py-1.5 text-xs font-medium ring-1 ring-slate-300 hover:bg-slate-100';
const primary = 'inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700';
const BILLS = 'bg-[#1f3bb3]', VOUCHERS = 'bg-[#8c9ee2]';
const SHOWN = 6;

/** One step of a purchase: what waits at it, and its rows with the button for the next step. */
function Step({ n, title, icon, waiting, note, warn, children, more }: { n: number; title: string; icon: IconName; waiting: string; note: string; warn?: boolean; children?: ReactNode; more?: ReactNode }) {
  return (
    <section aria-label={title} className={`flex flex-col gap-3 p-4 ${SURFACE}`}>
      <div className="flex items-center gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${warn ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}><Icon name={icon} className="size-4" /></span>
        <h2 className={`flex-1 ${CARD_TITLE}`}><span className="text-slate-400">{n}.</span> {title}</h2>
      </div>
      <div>
        <strong className={`block text-2xl font-semibold tabular-nums leading-tight ${warn ? 'text-red-600' : ''}`}>{waiting}</strong>
        <span className="text-xs text-slate-500">{note}</span>
      </div>
      {children && <ul className="divide-y divide-slate-100 text-sm">{children}</ul>}
      {more}
    </section>
  );
}

function Row({ to, number, who, when, late, amount, action }: { to: string; number: string; who: string; when?: string; late?: boolean; amount: number; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 flex-1">
        <Link to={to} className="font-medium text-indigo-700 underline">{number}</Link> <span className="text-slate-600">{who}</span>
        {when && <span className={`block text-xs ${late ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{when}</span>}
      </span>
      <span className="tabular-nums">{peso(amount)}</span>
      {action}
    </li>
  );
}

const More = ({ count, to, words }: { count: number; to: string; words: string }) =>
  count > SHOWN ? <Link to={to} className="text-sm text-indigo-700 underline">{words} ({count})</Link> : null;

export function PurchasesOverviewPage() {
  const [o, setO] = useState<PurchasesOverview | null>(null);
  const [types, setTypes] = useState<DocTypeInfo[]>([]);
  const [error, setError] = useState('');
  const load = () => api.apOverview().then(setO, (e: Error) => setError(e.message));
  useEffect(() => { void load(); void api.docTypes().then(setTypes, () => undefined); }, []);
  useLiveReload(load);
  if (error) return <Notice>{error}</Notice>;
  if (!o) return <Loading />;
  const may = (key: string) => !!types.find((t) => t.key === key)?.canPost;

  const owed = o.toPay.reduce((n, b) => n + b.balanceCents, 0);
  const overdue = o.toPay.filter((b) => b.overdue);
  const overdueCents = overdue.reduce((n, b) => n + b.balanceCents, 0);
  const weekCents = o.toPay.filter((b) => b.dueThisWeek).reduce((n, b) => n + b.balanceCents, 0);
  const spentBills = o.spending.reduce((n, s) => n + s.billsCents, 0), spentVouchers = o.spending.reduce((n, s) => n + s.vouchersCents, 0);
  const late = o.toReceive.filter((r) => r.late).length;
  const top = Math.max(1, ...o.spending.map((s) => s.billsCents + s.vouchersCents));
  const monthName = new Date(`${o.month}-01T00:00:00+08:00`).toLocaleString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });

  const tiles: { label: string; value: string; icon: IconName; note: string; warn?: boolean }[] = [
    { label: 'Owed to suppliers', value: peso(owed), icon: 'money', note: `${o.toPay.length} ${o.toPay.length === 1 ? 'bill' : 'bills'} not fully paid` },
    { label: 'Overdue', value: peso(overdueCents), icon: 'alert', note: overdue.length ? `${overdue.length} past their due date` : 'Nothing past its due date', warn: overdue.length > 0 },
    { label: 'Due in the next 7 days', value: peso(weekCents), icon: 'calendar', note: 'Plan the money for these' },
    { label: 'Advances paid out', value: peso(o.advancesCents), icon: 'wallet', note: 'Waiting for their bills' },
    { label: `Spent in ${monthName.split(' ')[0]}`, value: peso(spentBills + spentVouchers), icon: 'chart', note: 'Bills and expenses, before VAT' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Purchases &amp; expenses</h1>
          <p className="text-sm text-slate-500">A purchase goes order → receive → bill → pay. Something paid on the spot is an expense voucher.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {may('pur.po') && <Link to={docPath('pur.po', '/new')} className={primary}>New purchase order</Link>}
          {may('exp.voucher') && <Link to={docPath('exp.voucher', '/new')} className={primary}>New expense</Link>}
          {may('ap.bill') && <Link to={docPath('ap.bill', '/new')} className={button}>Record a bill</Link>}
          {may('ap.payment') && <Link to={docPath('ap.payment', '/new')} className={button}>Pay bills</Link>}
        </div>
      </div>

      <section aria-label="Purchases at a glance" className={`grid sm:grid-cols-2 lg:grid-cols-5 ${SURFACE}`}>
        {tiles.map((t, i) => (
          <div key={t.label} className={`flex flex-col gap-2 p-4 ${i > 0 ? 'border-t border-slate-100 sm:border-t-0 lg:border-l' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
            <span className="flex items-center gap-2">
              <span className={`grid size-8 place-items-center rounded-full ${t.warn ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}><Icon name={t.icon} className="size-4" /></span>
              <span className="flex-1 text-sm text-slate-500">{t.label}</span>
            </span>
            <strong className={`block text-2xl font-semibold tabular-nums leading-tight ${t.warn ? 'text-red-600' : ''}`}>{t.value}</strong>
            <span className="text-xs text-slate-500">{t.note}</span>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Step n={1} title="Receive what was ordered" icon="inbox" waiting={String(o.toReceive.length)} warn={late > 0}
          note={o.toReceive.length === 0 ? 'Every order is received in full' : late ? `${late} past the expected date` : 'Orders not all received yet'}
          more={<More count={o.toReceive.length} to={docPath('pur.po', '')} words="All purchase orders" />}>
          {o.toReceive.slice(0, SHOWN).map((r) => (
            <Row key={r.id} to={docPath('pur.po', `/${r.id}`)} number={r.number} who={r.supplierName} amount={r.remainingCents} late={r.late}
              when={r.expectedDate ? `${r.late ? 'Was expected' : 'Expected'} ${showDate(r.expectedDate)}` : `Ordered ${showDate(r.date)}`}
              action={may('pur.rr') ? <Link to={`${docPath('pur.rr', '/new')}?po=${r.id}`} className={button}>Receive</Link> : undefined} />
          ))}
        </Step>
        <Step n={2} title="Record the supplier’s bill" icon="draft" waiting={String(o.toBill.length)}
          note={o.toBill.length === 0 ? 'Every delivery has its bill' : 'Deliveries received with no bill yet'}
          more={<More count={o.toBill.length} to={docPath('pur.rr', '')} words="All receiving reports" />}>
          {o.toBill.slice(0, SHOWN).map((r) => (
            <Row key={r.id} to={docPath('pur.rr', `/${r.id}`)} number={r.number} who={r.supplierName} amount={r.receivedCents} when={`Received ${showDate(r.date)} on ${r.poNumber}`}
              action={may('ap.bill') ? <Link to={docPath('ap.bill', `/new?rr=${r.id}`)} className={button}>Record bill</Link> : undefined} />
          ))}
        </Step>
        <Step n={3} title="Pay the bills" icon="cash" waiting={peso(owed)} warn={overdue.length > 0}
          note={o.toPay.length === 0 ? 'Every bill is paid' : 'Soonest due first'}
          more={<More count={o.toPay.length} to="/ap/suppliers" words="Payables by supplier" />}>
          {o.toPay.slice(0, SHOWN).map((b) => (
            <Row key={b.id} to={docPath(b.docType, `/${b.id}`)} number={b.number} who={b.supplierName} amount={b.balanceCents} late={b.overdue}
              when={`${b.overdue ? 'Overdue since' : 'Due'} ${showDate(b.dueDate)}`}
              action={may('ap.payment') ? <Link to={docPath('ap.payment', `/new?supplier=${b.supplierId}&bill=${b.id}`)} className={button}>Pay</Link> : undefined} />
          ))}
        </Step>
      </div>

      <section aria-label={`Costs in ${monthName}`} className={`space-y-3 p-4 ${SURFACE}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={CARD_TITLE}>Costs in {monthName}</h2>
          <span className="flex gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${BILLS}`} />Supplier bills {peso(spentBills)}</span>
            <span className="flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${VOUCHERS}`} />Expense vouchers {peso(spentVouchers)}</span>
          </span>
        </div>
        {o.spending.length === 0 ? <p className="text-sm text-slate-500">Nothing recorded this month yet.</p> : (
          <ul className="space-y-2">
            {o.spending.map((s) => (
              <li key={s.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
                <span className="truncate" title={s.name}>{s.name}</span>
                <TickBar stretch ticks={48} height="h-5" label={`${s.name}: bills ${peso(s.billsCents)}, expense vouchers ${peso(s.vouchersCents)}`}
                  parts={[{ share: s.billsCents / top, tone: BILLS }, { share: s.vouchersCents / top, tone: VOUCHERS }]} />
                <span className="tabular-nums">{peso(s.billsCents + s.vouchersCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">Amounts before VAT, as they go to each account. <Link to={docPath('exp.voucher', '')} className="underline">Expense vouchers</Link> · <Link to={docPath('ap.bill', '')} className="underline">Supplier bills</Link></p>
      </section>
    </div>
  );
}
