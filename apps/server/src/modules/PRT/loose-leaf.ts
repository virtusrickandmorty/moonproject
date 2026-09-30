/**
 * Loose-leaf layout of a book of accounts (PLAN G, ACC-04): fixed-height numbered leaves with the company's details,
 * the column headings, running totals ("Brought forward" / "Carried forward") and, on the last leaf, the period's totals
 * and a signature block. Pure: figures come in, HTML comes out. This posts nothing.
 */
import { formatPesos } from '@moonproject/shared';
import type { Profile } from './print.ts';

export type Paper = 'a4' | 'long';
export const PAPERS: Record<Paper, { label: string; css: string; widthMm: number; heightMm: number; rowsMm: number }> = {
  a4: { label: 'A4 portrait', css: 'A4', widthMm: 210, heightMm: 297, rowsMm: 189 },
  long: { label: 'Long bond paper (8.5 × 13 in)', css: '8.5in 13in', widthMm: 215.9, heightMm: 330.2, rowsMm: 222 },
};
const MARGIN_MM = 10;
/** One line of 10 pt text, and a row's padding and border, in millimetres. */
const LINE_MM = 4.3;
const ROW_PAD_MM = 1.7;
/** Room kept on the last leaf of a book for the period's totals and the signature block. */
const LAST_LEAF_MM = 36;

/** A cell that is `null` is blank. `sum` columns are added up; a `balance` column shows the running balance. */
export interface LeafRow { lines: string[]; amounts: (number | null)[]; bold?: boolean }
export interface LeafSection { heading?: string; /** Balance the section starts from (ledger accounts). */ opening?: number; groups: LeafRow[][] }
export interface LeafBook {
  key: string; title: string; descHeading: string; amountHeadings: string[]; kinds: ('sum' | 'balance')[];
  /** Name of each amount column in the totals the API returns. */
  keys: string[]; sections: LeafSection[];
}
export interface LeafPage {
  number: number; heading?: string; rows: LeafRow[]; broughtForward: (number | null)[] | null; carriedForward: (number | null)[];
  /** Last leaf of its section: the row after the figures is a total, not "Carried forward". */
  sectionEnd: boolean; last: boolean;
}
export interface Layout { pages: LeafPage[]; totals: (number | null)[]; amountMm: number[]; descChars: number }

/** Width of a piece of 10 pt Arial text, on the safe side: digits 1.96 mm, separators 0.98 mm, everything else 2.2 mm. */
const textMm = (text: string) => [...text].reduce((n, c) => n + (/\d/.test(c) ? 1.96 : /[.,\s]/.test(c) ? 0.98 : 2.2), 0);
const CELL_MM = 2.4;
const rowMm = (row: LeafRow, chars: number) => row.lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / chars)), 0) * LINE_MM + ROW_PAD_MM;

export function layoutBook(book: LeafBook, paper: Paper, startPage = 1): Layout {
  const cap = PAPERS[paper].rowsMm;
  const width = book.kinds.length;
  // Each amount column is as wide as the biggest figure it can show (a running total is at most the sum of the figures).
  const all = book.sections.flatMap((s) => s.groups.flat());
  const sumBound = book.kinds.reduce((n, k, i) => n + (k === 'sum' ? all.reduce((m, r) => m + Math.abs(r.amounts[i] ?? 0), 0) : 0), 0);
  const amountMm = book.kinds.map((k, i) => Math.max(16, textMm(formatPesos(k === 'sum' ? all.reduce((m, r) => m + Math.abs(r.amounts[i] ?? 0), 0)
    : sumBound + all.reduce((m, r) => Math.max(m, Math.abs(r.amounts[i] ?? 0)), 0)) + (k === 'balance' ? ' Dr' : '')) + CELL_MM));
  const descMm = PAPERS[paper].widthMm - 2 * MARGIN_MM - amountMm.reduce((a, b) => a + b, 0);
  const descChars = Math.max(8, Math.floor((descMm - CELL_MM) / 2.2));
  const pages: LeafPage[] = [];
  const totals: number[] = Array(width).fill(0);
  const sections = book.sections.length ? book.sections : [{ groups: [] } as LeafSection];
  sections.forEach((section, sectionNo) => {
    const chunks: LeafRow[][] = [[]]; let used = 0;
    const place = (row: LeafRow) => {
      const h = rowMm(row, descChars);
      if (used > 0 && used + h > cap) { chunks.push([]); used = 0; }
      chunks.at(-1)!.push(row); used += h;
    };
    for (const group of section.groups) {
      const h = group.reduce((n, r) => n + rowMm(r, descChars), 0);
      if (used > 0 && used + h > cap && h <= cap) { chunks.push([]); used = 0; }
      group.forEach(place);
    }
    if (sectionNo === sections.length - 1) {
      // The last leaf of the book also carries the period's totals and the signatures.
      const last = chunks.at(-1)!; const moved: LeafRow[] = [];
      while (last.length > 1 && used + LAST_LEAF_MM > cap) { const row = last.pop()!; moved.unshift(row); used -= rowMm(row, descChars); }
      if (moved.length || used + LAST_LEAF_MM > cap) chunks.push(moved);
    }
    const sums: number[] = Array(width).fill(0); let balance = section.opening ?? 0;
    chunks.forEach((rows, at) => {
      const before = at === 0 ? null : book.kinds.map((k, i) => (k === 'sum' ? sums[i]! : balance));
      for (const row of rows) row.amounts.forEach((v, i) => {
        if (v === null) return;
        if (book.kinds[i] === 'sum') sums[i]! += v; else balance = v;
      });
      const after = book.kinds.map((k, i) => (k === 'sum' ? sums[i]! : balance));
      pages.push({ number: startPage + pages.length, heading: section.heading, rows, broughtForward: before, carriedForward: after,
        sectionEnd: at === chunks.length - 1, last: false });
    });
    book.kinds.forEach((k, i) => { if (k === 'sum') totals[i]! += sums[i]!; });
  });
  pages.at(-1)!.last = true;
  return { pages, amountMm, descChars, totals: totals.map((t, i) => (book.kinds[i] === 'sum' ? t : null)) };
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cents = (n: number | null, balance = false) => n === null ? ''
  : balance ? (n === 0 ? formatPesos(0) : `${formatPesos(Math.abs(n))} ${n < 0 ? 'Cr' : 'Dr'}`) : formatPesos(n);

export interface LeafContext {
  profile: Profile; from: string; to: string; paper: Paper; printedBy: string; printedAt: string;
  testPrint?: boolean; practice?: boolean; year: number;
}

export function renderLooseLeaf(book: LeafBook, layout: Layout, ctx: LeafContext): string {
  const { widthMm, heightMm, css } = PAPERS[ctx.paper];
  const usable = heightMm - 2 * MARGIN_MM - 1;
  const heads = `<th class="desc">${escape(book.descHeading)}</th>${book.amountHeadings.map((h) => `<th class="num">${escape(h)}</th>`).join('')}`;
  const numbers = (values: (number | null)[], bold = true) => values.map((v, i) => `<td class="num${bold ? ' b' : ''}">${cents(v, book.kinds[i] === 'balance')}</td>`).join('');
  const rows = (page: LeafPage) => {
    const forward = (label: string, values: (number | null)[]) => `<tr class="carry"><td class="desc b">${label}</td>${numbers(values)}</tr>`;
    const body = page.rows.map((r) => `<tr><td class="desc${r.bold ? ' b' : ''}">${r.lines.map(escape).join('<br>')}</td>${book.kinds.map((k, i) => `<td class="num${r.bold ? ' b' : ''}">${cents(r.amounts[i] ?? null, k === 'balance')}</td>`).join('')}</tr>`).join('');
    const empty = page.rows.length === 0 ? `<tr><td class="desc" colspan="${book.kinds.length + 1}">No entries in this period.</td></tr>` : '';
    const end = page.last ? forward(page.sectionEnd && book.sections.length > 1 ? 'Total for this account' : 'Total for the period', page.carriedForward)
      : page.sectionEnd ? forward('Total for this account', page.carriedForward) : forward('Carried forward', page.carriedForward);
    const grand = page.last && book.sections.length > 1 ? forward('Total for the period, all accounts', layout.totals) : '';
    return `${page.broughtForward ? forward('Brought forward', page.broughtForward) : ''}${body}${empty}${end}${grand}`;
  };
  const signature = `<div class="sign">${['Prepared by', 'Checked by', 'Approved by'].map((who) => `<p><span></span>${who}<br><small>Signature over printed name and date</small></p>`).join('')}</div>`;
  const leaves = layout.pages.map((page) => `<section class="leaf${page.last ? ' last' : ''}">${ctx.testPrint ? '<div class="test-print">TEST PRINT, NOT A REAL DOCUMENT</div>' : ''}
    <header><div class="company"><strong>${escape(ctx.profile.registered_name)}</strong><br>TIN ${escape(ctx.profile.tin)}<br>${escape(ctx.profile.registered_address)}</div>
    <h1>${escape(book.title.toUpperCase())}</h1>${ctx.practice ? '<p class="practice">PRACTICE ONLY · NOT A REAL DOCUMENT</p>' : ''}
    <div class="meta"><span>Period <b>${escape(ctx.from)}</b> to <b>${escape(ctx.to)}</b></span><span class="pageno">Page ${page.number}</span></div>
    ${page.heading ? `<p class="account">${escape(page.heading)}</p>` : ''}</header>
    <table><colgroup><col>${layout.amountMm.map((w) => `<col style="width:${w.toFixed(1)}mm">`).join('')}</colgroup><thead><tr>${heads}</tr></thead><tbody>${rows(page)}</tbody></table>
    ${page.last ? signature : ''}
    <footer><span>Printed by ${escape(ctx.printedBy)} at ${escape(ctx.printedAt)}</span><span>${escape(book.title)} · ${ctx.year} · Page ${page.number}</span></footer></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(book.title)} · ${escape(ctx.from)} to ${escape(ctx.to)}</title><style>
    @page{size:${css};margin:${MARGIN_MM}mm}*{box-sizing:border-box}body{font:10pt/${LINE_MM}mm Arial,sans-serif;color:#111;margin:0}
    .leaf{position:relative;height:${usable}mm;display:flex;flex-direction:column;page-break-after:always;break-after:page}.leaf.last{page-break-after:auto;break-after:auto}
    header{text-align:center}.company{line-height:${LINE_MM}mm}h1{font-size:14pt;margin:2mm 0 1mm}.meta{display:flex;justify-content:space-between;border-top:1px solid #777;border-bottom:1px solid #777;padding:1mm 0;margin:1mm 0}.pageno{font-weight:bold}.account{margin:1mm 0;font-weight:bold;text-align:left}
    .practice{font-weight:900;color:#a60;border:2px dashed #a60;margin:1mm auto;padding:0 3mm;width:max-content}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10pt}th,td{border:1px solid #999;padding:${ROW_PAD_MM / 2}mm 1mm;vertical-align:top;overflow-wrap:anywhere}th{background:#eee;font-weight:bold}
    col.desc,th.desc,td.desc{text-align:left}.num{text-align:right;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums}.b{font-weight:bold}tr.carry td{background:#f6f6f6}
    .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm;margin-top:8mm;text-align:center}.sign span{display:block;border-bottom:1px solid #111;height:10mm}.sign small{font-size:8pt}
    footer{margin-top:auto;display:flex;justify-content:space-between;font-size:8pt;border-top:1px solid #777;padding-top:1mm}
    .test-print{position:absolute;z-index:5;top:45%;left:5%;width:90%;transform:rotate(-28deg);border:3px solid #b00;color:#b00;font-size:20pt;font-weight:900;text-align:center;opacity:.32;padding:3mm;pointer-events:none}
    @media screen{body{background:#ddd;padding:10mm}.leaf{background:#fff;width:${widthMm}mm;height:${heightMm}mm;padding:${MARGIN_MM}mm;margin:0 auto 8mm;box-shadow:0 2px 12px #777}}
  </style></head><body>${leaves}</body></html>`;
}
