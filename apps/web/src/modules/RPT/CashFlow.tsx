/**
 * Statement of cash flows (direct method, from the posted journals), in the dashboard's look (the owner's request, Oct
 * 2026): the period's headline figures, a waterfall from opening to closing cash through the three activities, the
 * biggest movements in and out, then the statement itself. Drawn as the home's charts (the owner's request, Oct 2026):
 * bars in pale rounded tracks, striped in the home's series colours (money in: our blue; money out: slate), the
 * balances plain light grey, dashed guides and light labels. Every figure is also written, so colour never stands alone.
 */
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../../api.ts';
import { Loading, Button, CARD_TITLE, Field, Notice, SURFACE, inputClass, peso } from '../../components/ui.tsx';
import { niceTop } from '../../components/charts.tsx';
import { Icon, type IconName } from '../DASH/Cards.tsx';
import { BookTitle, Tools, money, td, useReport, useToday } from './Books.tsx';
import './books.css';
import { addressValue, PendingPeriod } from './ReportParts.tsx';

type Result = { from: string; to: string; openingCashCents: number; netChangeCents: number; closingCashCents: number;
  balanceSheetCashCents: number; checkDifferenceCents: number; balanced: boolean;
  sections: { key: string; title: string; lines: { key: string; name: string; amountCents: number }[]; totalCents: number }[] };
const amount = (n: number) => n < 0 ? `(${peso(-n)})` : peso(n);
// The home's series colours (DASH Home Bars): each striped with its lighter tone.
const IN = { colour: '#1f3bb3', light: '#8c9ee2' };
const OUT = { colour: '#64748b', light: '#b6c0cd' };
const BALANCE = '#cbd5e1';
const stripes = (c: { colour: string; light: string }) => ({ backgroundImage: `repeating-linear-gradient(135deg, ${c.colour} 0 4px, ${c.light} 4px 7px)` });
const short = (cents: number) => {
  const a = Math.abs(cents) / 100;
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}m` : a >= 1_000 ? `${Math.round(a / 1_000).toLocaleString('en-PH')}k` : Math.round(a).toLocaleString('en-PH');
  return `${cents < 0 ? '−' : ''}₱${s}`;
};
const SECTION_ICON: Record<string, IconName> = { operating: 'sales', investing: 'floor', financing: 'bank' };

const Row = ({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) => <tr className={strong ? 'font-semibold' : ''}>
  <td className={td}>{label}</td><td className={`${money} ${strong ? 'border-t-2 border-slate-400' : ''}`}>{amount(cents)}</td></tr>;

/** The period's figures across the top, like the home's: opening cash, each activity's net, closing cash. */
function Figures({ data }: { data: Result }) {
  const tiles: { key: string; label: string; cents: number; icon: IconName; signed: boolean }[] = [
    { key: 'opening', label: 'Opening cash', cents: data.openingCashCents, icon: 'cash', signed: false },
    ...data.sections.map((s) => ({ key: s.key, label: s.title.replace(/ activities$/i, ''), cents: s.totalCents, icon: SECTION_ICON[s.key] ?? 'money', signed: true })),
    { key: 'closing', label: 'Closing cash', cents: data.closingCashCents, icon: 'cash', signed: false },
  ];
  return (
    <section aria-label="The period in figures" className={`grid sm:grid-cols-2 lg:grid-cols-5 ${SURFACE}`}>
      {tiles.map((t, i) => (
        <div key={t.key} className={`flex flex-col gap-2 p-4 ${i > 0 ? 'border-t border-slate-100 sm:border-t-0 lg:border-l' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
          <span className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600"><Icon name={t.icon} className="size-4" /></span>
            <span className="flex-1 text-sm text-slate-500">{t.label}</span>
          </span>
          <strong className="block text-2xl font-semibold tabular-nums leading-tight">{amount(t.cents)}</strong>
          {t.signed && t.cents !== 0 && <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="size-2.5 rounded-full" style={stripes(t.cents > 0 ? IN : OUT)} aria-hidden="true" />{t.cents > 0 ? 'Net cash in' : 'Net cash out'}
          </span>}
          {t.signed && t.cents === 0 && <span className="text-xs text-slate-500">No cash moved</span>}
        </div>
      ))}
    </section>
  );
}

type Step = { key: string; label: string; cents: number; total: boolean };

/**
 * The waterfall: opening cash, each activity raising or lowering it, closing cash. Floating bars from the running
 * balance; a dashed line carries the balance to the next bar; each bar says its amount; hovering one tells it in full.
 */
function Waterfall({ data }: { data: Result }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the width it is given, so its words stay readable on a phone as on a wide screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e!.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const steps: Step[] = [
    { key: 'opening', label: 'Opening cash', cents: data.openingCashCents, total: true },
    ...data.sections.map((s) => ({ key: s.key, label: s.title.replace(/ activities$/i, ''), cents: s.totalCents, total: false })),
    { key: 'closing', label: 'Closing cash', cents: data.closingCashCents, total: true },
  ];
  let run = 0;
  const bars = steps.map((s) => {
    const from = s.total ? 0 : run;
    const to = s.total ? s.cents : run + s.cents;
    run = s.total ? s.cents : to;
    return { ...s, from, to };
  });
  const values = bars.flatMap((b) => [b.from, b.to]);
  const top = niceTop(Math.max(0, ...values)) || 1;
  const bottom = Math.min(0, ...values) < 0 ? -niceTop(-Math.min(0, ...values)) : 0;
  const narrow = W < 520;
  const H = 300, left = narrow ? 48 : 64, right = 8, plotTop = 28, plotBottom = 252;
  const y = (v: number) => plotTop + ((top - v) / (top - bottom)) * (plotBottom - plotTop);
  const slot = (W - left - right) / bars.length;
  const barW = Math.min(88, slot * 0.56);
  const x = (i: number) => left + slot * i + (slot - barW) / 2;
  const guides = bottom < 0 ? [top, top / 2, bottom] : [top, top / 2];
  const fill = (b: (typeof bars)[number]) => (b.total || b.cents === 0 ? BALANCE : `url(#cash-hatch-${b.cents > 0 ? 'in' : 'out'})`);
  const mark = (b: (typeof bars)[number]) => (b.total || b.cents === 0 ? { background: BALANCE } : stripes(b.cents > 0 ? IN : OUT));
  const shown = hover === null ? null : bars[hover]!;
  const last = bars.length - 1;
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`Cash from ${amount(data.openingCashCents)} to ${amount(data.closingCashCents)}: ${bars.filter((b) => !b.total).map((b) => `${b.label} ${amount(b.cents)}`).join(', ')}`}>
        <defs>{([['in', IN], ['out', OUT]] as const).map(([k, c]) => <pattern key={k} id={`cash-hatch-${k}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={c.light} /><rect width="3.5" height="6" fill={c.colour} /></pattern>)}</defs>
        {/* A pale track behind each step, the closing one tinted, as the home's months. */}
        {bars.map((b, i) => <rect key={`track-${b.key}`} x={left + slot * i + (slot - barW - 12) / 2} y={plotTop - 8} width={barW + 12} height={plotBottom - plotTop + 8} rx={14}
          fill={i === last ? '#eef1fb' : '#f8fafc'} />)}
        <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
        {guides.map((g) => <line key={g} x1={left} x2={W - right} y1={y(g)} y2={y(g)} stroke="#e2e8f0" strokeDasharray="4 4" />)}
        {[...guides, 0].map((g) => <text key={`t${g}`} x={left - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{short(Math.round(g))}</text>)}
        {bars.map((b, i) => {
          const y1 = y(Math.max(b.from, b.to)), y2 = y(Math.min(b.from, b.to));
          const h = Math.max(3, y2 - y1);
          const next = bars[i + 1];
          const labelY = b.to >= b.from ? y1 - 8 : y2 + 16;
          return <g key={b.key}>
            {next && <line x1={x(i) + barW} x2={x(i + 1)} y1={y(b.to)} y2={y(b.to)} stroke="#cbd5e1" strokeDasharray="4 4" strokeWidth={1} />}
            <rect data-step={b.key} x={x(i)} y={y1} width={barW} height={h} rx={6} fill={fill(b)} opacity={hover === null || hover === i ? 1 : 0.45} />
            <text x={x(i) + barW / 2} y={labelY} textAnchor="middle" fontSize={narrow ? 11 : 12} fontWeight="600" fill="#0f172a">{b.total || b.cents === 0 ? short(b.cents) : `${b.cents > 0 ? '+' : ''}${short(b.cents)}`}</text>
            <text x={x(i) + barW / 2} y={plotBottom + 20} textAnchor="middle" fontSize="11" fill={i === last ? '#0f172a' : '#64748b'} fontWeight={i === last ? 600 : 400}>{narrow && b.total ? b.label.replace(' cash', '') : b.label}</text>
            {/* A hit area the whole column tall, bigger than the bar, for the pointer and the keyboard. */}
            <rect x={left + slot * i} y={plotTop - 20} width={slot} height={plotBottom - plotTop + 44} fill="transparent" tabIndex={0}
              aria-label={`${b.label}: ${amount(b.cents)}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          </g>;
        })}
      </svg>
      {shown && hover !== null && <div role="status" className="pointer-events-none absolute top-2 z-10 w-56 -translate-x-1/2 rounded-xl bg-white p-3 text-sm shadow-lg ring-1 ring-slate-200"
        style={{ left: `${Math.min(85, Math.max(15, ((left + slot * hover + slot / 2) / W) * 100))}%` }}>
        <p className="flex items-center gap-2 font-semibold"><span className="size-2.5 rounded-full" style={mark(shown)} />{shown.total ? shown.label : `Net from ${shown.label.toLowerCase()}`}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{amount(shown.cents)}</p>
        {!shown.total && <p className="text-xs text-slate-500">{shown.cents === 0 ? 'No cash moved here.' : `Cash ${shown.cents > 0 ? 'rose' : 'fell'} from ${amount(shown.from)} to ${amount(shown.to)}.`}</p>}
      </div>}
      <ul className="mt-1 flex flex-wrap justify-center gap-5 text-xs text-slate-600" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={stripes(IN)} />Money in</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={stripes(OUT)} />Money out</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: BALANCE }} />Cash balance</li>
      </ul>
    </div>
  );
}

/** The biggest single movements of the period, in and out, as bars from a middle line: in to the right, out to the left. */
function Movements({ data }: { data: Result }) {
  const lines = data.sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.title }))).filter((l) => l.amountCents !== 0)
    .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)).slice(0, 8);
  if (lines.length === 0) return <p className="text-sm text-slate-500">No cash came in or went out in this period.</p>;
  const most = Math.max(...lines.map((l) => Math.abs(l.amountCents)));
  return (
    <ul className="space-y-3">
      {lines.map((l) => {
        const share = Math.max(0.02, Math.abs(l.amountCents) / most) * 50;
        const into = l.amountCents > 0;
        return (
          <li key={`${l.section}-${l.key}`} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_auto] items-center gap-3 text-sm"
            title={`${l.name} (${l.section}): ${amount(l.amountCents)}`}>
            <span className="min-w-0"><span className="block leading-snug">{l.name}</span><span className="block text-xs text-slate-500">{l.section}</span></span>
            <span className="relative h-6 overflow-hidden rounded-full bg-slate-50">
              <span className="absolute inset-y-1 left-1/2 w-px border-l border-dashed border-slate-300" aria-hidden="true" />
              <span className="absolute inset-y-1 rounded-full" style={{ ...stripes(into ? IN : OUT), width: `${share}%`, ...(into ? { left: '50%' } : { right: '50%' }) }} />
            </span>
            <span className="text-right font-medium tabular-nums">{amount(l.amountCents)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function CashFlow({ me }: { me: Me }) {
  const today = useToday(); const [from, setFrom] = useState(() => addressValue('from')); const [to, setTo] = useState(() => addressValue('to')); const [applied, setApplied] = useState('');
  useEffect(() => { if (today && !applied) { if (!from) setFrom(`${today.slice(0, 7)}-01`); if (!to) setTo(today); } }, [today, from]);
  useEffect(() => { if (from && to && !applied) setApplied(new URLSearchParams({ from, to }).toString()); }, [from, to, applied]);
  const path = applied ? `cash-flow?${applied}` : null; const { data, error } = useReport<Result>(path);
  if (!me.permissions.includes('rpt.books.view')) return <Notice>Access denied.</Notice>;
  const card = `flex min-w-0 flex-col gap-4 p-5 ${SURFACE}`;
  return <article className="rpt-page space-y-4"><BookTitle title="Statement of cash flows" dates={data ? `${data.from} to ${data.to}` : ''} />
    <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 print:hidden"><Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Button tone="primary" disabled={!from || !to || from > to} onClick={() => setApplied(new URLSearchParams({ from, to }).toString())}>Show</Button>{path && <Tools path={path} />}</div>
    <PendingPeriod applied={applied} values={{ from, to }} />
    {error && <Notice>{error}</Notice>}{!data && !error && <Loading />}
    {data && <>
      <Figures data={data} />
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="From opening to closing cash" className={card}>
          <header className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon name="chart" /></span>
            <h2 className={CARD_TITLE}>From opening to closing cash</h2>
          </header>
          <Waterfall data={data} />
        </section>
        <section aria-label="Biggest movements" className={card}>
          <header className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon name="trend" /></span>
            <h2 className={CARD_TITLE}>Biggest movements</h2>
            <span className="text-xs text-slate-500">← out · in →</span>
          </header>
          <Movements data={data} />
        </section>
      </div>
      <section aria-label="The statement" className={card}>
        <header className="flex flex-wrap items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700"><Icon name="jobs" /></span>
          <h2 className={CARD_TITLE}>The statement</h2>
          <span className="text-xs text-slate-500">Direct method, from the posted journals</span>
        </header>
        <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>
          <Row label="Opening cash" cents={data.openingCashCents} strong />
          {data.sections.flatMap((section) => [<tr key={`${section.key}-head`}><td className={`${td} pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500`} colSpan={2}>{section.title}</td></tr>,
            ...section.lines.map((line) => <Row key={`${section.key}-${line.key}`} label={line.name} cents={line.amountCents} />),
            ...(section.lines.length === 0 ? [<tr key={`${section.key}-none`}><td className={`${td} text-slate-500`} colSpan={2}>No cash moved here.</td></tr>] : []),
            <Row key={`${section.key}-total`} label={`Net cash from ${section.title.toLowerCase()}`} cents={section.totalCents} strong />])}
          <Row label="Net change in cash" cents={data.netChangeCents} strong /><Row label="Closing cash" cents={data.closingCashCents} strong />
          <Row label="Cash accounts on balance sheet" cents={data.balanceSheetCashCents} /><Row label="Check difference" cents={data.checkDifferenceCents} />
        </tbody></table></div>
        {!data.balanced && <Notice>Closing cash does not equal the cash accounts on the balance sheet. Tell the accountant.</Notice>}
        {data.balanced && <p className="flex items-center gap-1.5 text-xs text-slate-600"><Icon name="check" className="size-4 text-emerald-600" />Closing cash equals the cash accounts on the balance sheet at {data.to}.</p>}
      </section>
    </>}
  </article>;
}
