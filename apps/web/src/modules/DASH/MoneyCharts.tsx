/**
 * The money graphs of the home and of the Reports overview: sales, collections and expenses by month, cash at each month's
 * end, and what customers owe by age. Pointing at a month or a bar shows its details (the owner's request, Nov 2026); the
 * same details are read out on the keyboard and by a screen reader.
 */
import type { DashOwnerCharts } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { useTip, type Tip, type TipRow } from '../../components/charts.tsx';

type Month = DashOwnerCharts['months'][number];
type Bucket = DashOwnerCharts['receivables'][number];

export const shortPeso = (cents: number) => Math.abs(cents) < 100_000 ? peso(cents) : Math.abs(cents) >= 100_000_000 ? `₱${(cents / 100_000_000).toFixed(1)}m` : `₱${Math.round(cents / 100_000).toLocaleString()}k`;
export const monthLabel = (month: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
export const monthName = (month: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
export const signedScale = (values: number[], bottom: number, height: number) => {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return { min, max, y: (value: number) => bottom - (value - min) / (max - min || 1) * height };
};
/** A month still running: its figures are so far, up to `to`. */
const running = (row: Month) => Number(row.to.slice(8)) < new Date(Date.UTC(Number(row.month.slice(0, 4)), Number(row.month.slice(5, 7)), 0)).getUTCDate();

// `light`: the second colour of each series' stripes.
const FIELDS = [{ key: 'salesCents', label: 'Sales', colour: '#1f3bb3', light: '#8c9ee2' }, { key: 'collectionsCents', label: 'Collections', colour: '#64748b', light: '#b6c0cd' },
  { key: 'expensesCents', label: 'Expenses', colour: '#cbd5e1', light: '#eef2f6' }] as const;

/** A month's details: its three figures, where the expenses went, and what was left out as cancelled. */
export function monthTip(row: Month): Tip {
  const parts: TipRow[] = ([['Cost of sales', row.costOfSalesCents], ['Operating expenses', row.operatingCents], ['Income tax', row.incomeTaxCents]] as const)
    .filter(([, cents]) => cents !== 0).map(([label, cents]) => ({ label, value: peso(cents), sub: true }));
  const shown = row.cancelledExpenses.slice(0, 3).map((c) => `${c.number} ${peso(c.amountCents)}`).join(', ');
  const left = row.cancelledExpenses.length - 3;
  return {
    title: `${monthName(row.month)}${running(row) ? ' so far' : ''}`,
    rows: [
      { label: 'Sales', value: peso(row.salesCents), colour: FIELDS[0].colour },
      { label: 'Collections', value: peso(row.collectionsCents), colour: FIELDS[1].colour },
      { label: 'Expenses', value: peso(row.expensesCents), colour: FIELDS[2].colour }, ...parts,
      { label: 'Sales less expenses', value: peso(row.salesCents - row.expensesCents), strong: true },
    ],
    notes: [
      ...(row.biggestExpenses.length ? [`Biggest expenses: ${row.biggestExpenses.map((e) => `${e.name} ${peso(e.amountCents)}`).join(', ')}.`] : []),
      ...(shown ? [`Leaves out cancelled ${shown}${left > 0 ? ` and ${left} more` : ''}, so this month can differ from the Income statement.`] : []),
    ],
  };
}

/** Cash at a month's end, by place, and the change from the month before. */
export function cashTip(row: Month, before?: Month): Tip {
  return {
    title: running(row) ? `Cash on hand, ${monthName(row.month)} so far` : `Cash at the end of ${monthName(row.month)}`,
    rows: [
      ...row.cashPlaces.map((p) => ({ label: p.name, value: peso(p.balanceCents) })),
      { label: 'Total', value: peso(row.cashCents), strong: true },
      ...(before ? [{ label: 'Change from the month before', value: peso(row.cashCents - before.cashCents) }] : []),
    ],
  };
}

/** What customers owe at one age: how much of the whole, how many, and who owes the most. */
export function agingTip(row: Bucket, wholeCents: number): Tip {
  return {
    title: row.key === 'current' ? 'Not yet overdue' : `${row.label} days overdue`,
    rows: [
      { label: 'Owed', value: peso(row.amountCents), strong: true },
      ...(wholeCents > 0 ? [{ label: 'Of all that is owed', value: `${Math.round((row.amountCents / wholeCents) * 100)}%` }] : []),
      { label: 'Customers', value: row.customers.toLocaleString('en-PH') },
      ...row.biggest.map((c) => ({ label: c.name, value: peso(c.amountCents), sub: true })),
    ],
  };
}

export function Bars({ data }: { data: Month[] }) {
  const { active, mark, box } = useTip();
  const scale = signedScale(data.flatMap((row) => FIELDS.map((field) => row[field.key])), 190, 150);
  const zero = scale.y(0);
  const top = scale.y(scale.max);
  const last = data.length - 1;
  // As the home's other charts (the owner's reference picture): a pale track behind each month, this month's track
  // tinted, every bar striped in its series' colours, dashed guides and light labels.
  return <div>{box}<svg viewBox="0 0 720 245" role="group" aria-label="Sales, collections and expenses by month" className="h-auto min-w-[620px] print:min-w-0">
    <desc>Negative amounts, including reversals, appear below the labelled zero line.</desc>
    <defs>{FIELDS.map((field) => <pattern key={field.key} id={`month-hatch-${field.key}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill={field.light} /><rect width="3.5" height="6" fill={field.colour} /></pattern>)}</defs>
    <line x1="42" y1={zero} x2="710" y2={zero} stroke="#cbd5e1" />
    {scale.max > 0 && [top, (top + zero) / 2].map((y) => <line key={y} x1="42" y1={y} x2="710" y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />)}
    {data.map((row, index) => <g key={row.month}>
      <rect x={44 + index * 55} y="32" width="42" height="160" rx="12" fill={index === last ? '#eef1fb' : '#f8fafc'} stroke={active === row.month ? '#8c9ee2' : 'none'} strokeWidth="2" />
      {FIELDS.map((field, fieldIndex) => {
        const y = scale.y(row[field.key]);
        const striped = row[field.key] !== 0; // every month's bars striped, each in its own colour (the owner's choice)
        return <rect key={field.key} x={48 + index * 55 + fieldIndex * 12} y={Math.min(zero, y)} width="10" height={Math.abs(y - zero)} rx="3" fill={striped ? `url(#month-hatch-${field.key})` : field.colour} />;
      })}
      <text x={65 + index * 55} y="208" textAnchor="middle" fontSize="11" fill={index === last ? '#0f172a' : '#64748b'} fontWeight={index === last ? 600 : 400}>{monthLabel(row.month)}</text>
      {/* The whole month is the target, not its thin bars; one box for all three figures. */}
      <rect {...mark(row.month, monthTip(row))} x={38 + index * 55} y="24" width="55" height="192" fill="transparent" className="outline-none" /></g>)}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="194" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
    {FIELDS.map((field, index) => <g key={field.key}><circle cx={240 + index * 115} cy="230" r="5" fill={field.colour} />
      <text x={250 + index * 115} y="234" fontSize="12" fill="#475569">{field.label}</text></g>)}
  </svg></div>;
}

export function CashLine({ data }: { data: Month[] }) {
  const { active, mark, box } = useTip();
  const scale = signedScale(data.map((row) => row.cashCents), 170, 130);
  const zero = scale.y(0);
  const points = data.map((row, index) => `${48 + index * 59},${scale.y(row.cashCents)}`).join(' ');
  return <>{box}<svg viewBox="0 0 720 215" role="group" aria-label="Cash on hand at each month end" className="h-auto min-w-[620px] xl:min-w-[540px] print:min-w-0">
    <desc>Negative cash balances appear below the labelled zero line.</desc>
    <line x1="42" y1={zero} x2="710" y2={zero} stroke="#cbd5e1" />
    {scale.max > 0 && [scale.y(scale.max), (scale.y(scale.max) + zero) / 2].map((y) => <line key={y} x1="42" y1={y} x2="710" y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />)}
    <polyline points={points} fill="none" stroke="#1f3bb3" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    {data.map((row, index) => { const x = 48 + index * 59; const y = scale.y(row.cashCents); const on = active === row.month; return <g key={row.month}>
      {on && <line x1={x} y1="30" x2={x} y2="176" stroke="#8c9ee2" strokeWidth="1.5" />}
      <circle cx={x} cy={y} r={(index === data.length - 1 ? 6 : 4) + (on ? 2 : 0)} fill={index === data.length - 1 || on ? '#1f3bb3' : '#ffffff'} stroke="#1f3bb3" strokeWidth="2" />
      <text x={x} y="190" textAnchor="middle" fontSize="11" fill={index === data.length - 1 ? '#0f172a' : '#64748b'} fontWeight={index === data.length - 1 ? 600 : 400}>{monthLabel(row.month)}</text>
      <rect {...mark(row.month, cashTip(row, data[index - 1]))} x={x - 29.5} y="24" width="59" height="176" fill="transparent" className="outline-none" /></g>; })}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="174" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
  </svg></>;
}

export function AgingBars({ data }: { data: Bucket[] }) {
  const { active, mark, box } = useTip();
  const scale = signedScale(data.map((row) => row.amountCents), 170, 130);
  const zero = scale.y(0);
  const whole = data.reduce((n, row) => n + row.amountCents, 0);
  const largest = data.reduce((b, row) => (row.amountCents > b.amountCents ? row : b), data[0] ?? { key: '', amountCents: 0 });
  // A pale track behind each bar and the largest one striped in our blue (the owner's reference picture).
  return <>{box}<svg viewBox="0 0 520 220" role="group" aria-label="Receivables by age today" className="h-auto min-w-[450px] xl:min-w-[340px] print:min-w-0">
    <desc>Negative receivables appear below the labelled zero line.</desc>
    <defs><pattern id="aging-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#8c9ee2" /><rect width="4" height="7" fill="#1f3bb3" /></pattern></defs>
    <line x1="42" y1={zero} x2="510" y2={zero} stroke="#cbd5e1" />
    {data.map((row, index) => { const y = scale.y(row.amountCents); const best = row.amountCents > 0 && row === largest; return <g key={row.key}>
      <rect x={63 + index * 90} y="32" width="46" height="144" rx="12" fill="#f8fafc" stroke={active === row.key ? '#8c9ee2' : 'none'} strokeWidth="2" />
      <rect x={65 + index * 90} y={Math.min(zero, y)} width="42" height={Math.max(1, Math.abs(y - zero))} rx="10" fill={best ? 'url(#aging-hatch)' : '#cbd5e1'} />
      <text x={86 + index * 90} y="190" textAnchor="middle" fontSize="12" fill="#64748b">{row.label}</text>
      <rect {...mark(row.key, agingTip(row, whole))} x={41 + index * 90} y="24" width="90" height="176" fill="transparent" className="outline-none" /></g>; })}
    {scale.max > 0 && <text x="4" y="44" fontSize="11" fill="#94a3b8">{shortPeso(scale.max)}</text>}
    {scale.min < 0 && <text x="4" y="174" fontSize="11" fill="#94a3b8">{shortPeso(scale.min)}</text>}
    <text x="27" y={zero + 4} fontSize="11" fill="#94a3b8">₱0</text>
  </svg></>;
}
