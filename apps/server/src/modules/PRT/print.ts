/** Server-rendered, escaped print views. No journal entries are created here. */
import { readFileSync } from 'node:fs';
import { formatPeso } from '@moonproject/shared';
import qrcode from 'qrcode-generator';
import { DOC_TITLES, type DocTitle } from '../../engine/documents/registry.ts';
import type { Db } from '../../platform/db/driver.ts';
import { attachmentsDir, readStored } from '../../engine/attachments.ts';
import { jobTicketRoute } from '../PRD/public.ts';
import { purchaseOrderNames } from '../PUR/public.ts';

export type PrintKind = 'document' | 'job_ticket' | 'thermal';
export interface Profile {
  registered_name: string; trade_name: string; tin: string; registered_address: string;
  is_vat_registered: number; version: number;
}

export interface Certificate2307 {
  supplierName: string;
  tin: string | null;
  address: string | null;
  lines: { atc: string; months: { month: string; baseCents: number }[]; baseCents: number; ewtCents: number }[];
}
/** `prepared_by`: the display name of whoever recorded the document, for the "Prepared by" line. */
export interface PrintHeader { id: string; number: string; business_date: string; doc_type: string; status: 'posted' | 'cancelled'; prepared_by?: string | null }

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cell = (value: unknown) => `<td>${escape(value)}</td>`;
const money = (n: number) => formatPeso(n);
/** A cell that holds an amount or a count. A column after the first whose filled cells are all figures is right-aligned. */
const isFigure = (value: unknown) => typeof value === 'number' || /^[−-]?₱|^[−-]?\d[\d,.]*$/.test(String(value ?? '').trim());
const blank = (value: unknown) => value == null || value === '';
const figureColumns = (rows: unknown[][]) => new Set(rows[0]?.map((_, i) => i).filter((i) => i > 0 &&
  rows.some((r) => !blank(r[i])) && rows.every((r) => blank(r[i]) || isFigure(r[i]))));
const lineTable = (headings: string[], rows: unknown[][]) => {
  const figures = figureColumns(rows);
  return `<table><thead><tr>${headings.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length
    ? rows.map((r) => `<tr>${r.map((v, i) => figures.has(i) ? `<td class="fig">${escape(v)}</td>` : cell(v)).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${headings.length}">Nothing listed.</td></tr>`}</tbody></table>`;
};
const field = (name: string, value: unknown) => value ? `<p><b>${escape(name)}:</b> ${escape(value)}</p>` : '';
/** A titled block in the body, like "Items" on the quotation. */
const section = (title: string, html: string) => `<section class="block"><h2 class="section">${escape(title)}</h2>${html}</section>`;

/** The shop's logo, inlined so a printout never fetches an image. Missing file: the printout simply has no logo. */
let logoUri: string | null | undefined;
function logo(): string {
  if (logoUri === undefined) {
    try { logoUri = `data:image/png;base64,${readFileSync(new URL('./assets/logo.png', import.meta.url)).toString('base64')}`; } catch { logoUri = null; }
  }
  return logoUri ? `<img class="logo" src="${logoUri}" alt="">` : '';
}

/** An inline SVG around the matrix made by qrcode-generator; printing never fetches an image or calls the internet. */
export function jobOrderQr(jobOrderId: string, jobOrderNumber: string, joinBase?: string): string {
  const value = joinBase ? new URL(`/docs/jo.job_order/${encodeURIComponent(jobOrderId)}`, joinBase).href : jobOrderNumber;
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const modules = qr.getModuleCount(), quiet = 4, size = modules + quiet * 2;
  const path: string[] = [];
  for (let row = 0; row < modules; row++) for (let column = 0; column < modules; column++) {
    if (qr.isDark(row, column)) path.push(`M${column + quiet} ${row + quiet}h1v1h-1z`);
  }
  return `<figure class="job-qr"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Open job order ${escape(jobOrderNumber)}"><path fill="#fff" d="M0 0h${size}v${size}H0z"/><path fill="#000" d="${path.join('')}"/></svg><figcaption>${escape(jobOrderNumber)}</figcaption></figure>`;
}

type PrintTitle = DocTitle | 'Payment Voucher' | 'Payslip' | 'Cash Advance Slip' | 'Inventory Count Sheet' | 'Certificate of Creditable Tax Withheld at Source';
export type ReportPrintTitle = 'Statement of Account' | 'Sizing Profile' | 'Fixed Asset Schedule' | "Monthly Owners' Pack";
export const REPORT_PRINT_TITLES: readonly ReportPrintTitle[] = ['Statement of Account', 'Sizing Profile', 'Fixed Asset Schedule', "Monthly Owners' Pack"];

/** One printout's parts; renderPrint lays them out like the shop's quotation (party box, items, totals, signatures, terms). */
interface Content {
  title: PrintTitle; subtitle: string; legend: boolean; twoUp: boolean;
  party?: { label: string; name: unknown; lines?: unknown[] };
  aside?: string; // shown inside the details box, between the party and the status (the job order QR)
  status?: [string, unknown][];
  body: string;
  totals?: [label: string, value: string, grand?: boolean][];
  terms?: unknown;
  signatures?: [caption: string, name?: unknown][];
}
const totalsHtml = (rows: Content['totals']) => rows?.length
  ? `<div class="totals">${rows.map(([label, value, grand]) => `<p class="tot${grand ? ' grand' : ''}"><b>${escape(label)}:</b> ${escape(value)}</p>`).join('')}</div>` : '';
const signaturesHtml = (rows: Content['signatures']) => rows?.length
  ? `<div class="signatures">${rows.map(([caption, name]) => `<div class="sign"><span class="name">${escape(name ?? '')}</span><span class="caption">${escape(caption)}</span></div>`).join('')}</div>` : '';
const termsHtml = (terms: unknown) => terms ? `<section class="terms"><h3>Terms and Conditions</h3><p>${escape(terms)}</p></section>` : '';

/** How many of a job order's pictures its job ticket shows. */
export const TICKET_PICTURES = 6;
/**
 * The pictures attached to a document (a job order's design), inlined so the printout fetches nothing: the first few,
 * oldest first, without removed ones or files missing from the folder. Empty when there are none.
 */
export function attachedPictures(db: Db, documentId: string, max = TICKET_PICTURES): string {
  const rows = db.prepare(`SELECT file_name, content_type, sha256 FROM attachments WHERE document_id = ? AND removed_at IS NULL
    AND content_type IN ('image/jpeg', 'image/png', 'image/webp') ORDER BY added_at, id LIMIT ?`).all(documentId, max) as { file_name: string; content_type: string; sha256: string }[];
  const dir = rows.length ? attachmentsDir(db) : '';
  const figures = rows.flatMap((r) => {
    const data = readStored(dir, r.sha256);
    return data ? [`<figure style="margin:0;break-inside:avoid;text-align:center"><img src="data:${r.content_type};base64,${data.toString('base64')}" alt="${escape(r.file_name)}" style="max-width:100%;max-height:70mm;object-fit:contain;border:1px solid #ccc"><figcaption style="font-size:8pt;color:#555">${escape(r.file_name)}</figcaption></figure>`] : [];
  });
  return figures.length ? section('Design', `<div class="designs" style="display:grid;grid-template-columns:repeat(${Math.min(figures.length, 2)},1fr);gap:4mm">${figures.join('')}</div>`) : '';
}

function content(db: Db, h: PrintHeader, doc: any, kind: PrintKind, joinBase?: string): Content {
  const prepared = h.prepared_by ?? '';
  if (h.doc_type === 'quo.quotation') {
    const subtotal = doc.lines.reduce((sum: number, l: any) => sum + l.lineTotalCents, 0);
    return {
      title: 'Quotation', subtitle: '', legend: true, twoUp: false,
      party: { label: 'Bill to', name: doc.customerName, lines: [doc.contact] },
      status: [['Valid until', doc.validUntil]],
      body: section('Items', lineTable(['Description', 'Qty', 'Unit', 'Unit price', 'Line discount', 'Amount'], doc.lines.map((l: any) =>
        [l.description, l.qty, l.unit, money(l.unitPriceCents), money(l.discountCents), money(l.lineTotalCents)]))) + field('Notes', doc.notes),
      totals: [['Subtotal', money(subtotal)], ['Document discount', `−${money(doc.documentDiscountCents)}`], ['Total', money(doc.totalCents), true]],
      terms: doc.termsText,
      signatures: [['Prepared by', prepared], ['Confirmed by (customer)']],
    };
  }
  if (h.doc_type === 'jo.job_order') {
    if (kind === 'job_ticket') return {
      title: 'Job Ticket', subtitle: 'Production copy', legend: false, twoUp: false,
      party: { label: 'Customer', name: doc.customerName },
      status: [['Due date', doc.dueDate], ['Priority', doc.priority]],
      aside: jobOrderQr(h.id, h.number, joinBase),
      body: attachedPictures(db, h.id) +
        doc.lines.map((l: any) => `<section class="job-line"><h2 class="section">${escape(l.description)} · ${escape(l.qty)} pieces</h2>` +
          lineTable(['Wearer', 'Size', 'Jersey name', 'Jersey no.', 'Qty'], l.roster.map((r: any) => [r.wearerName, r.size ?? (r.sizeMode === 'measured' ? 'Measured' : ''), r.jerseyName, r.jerseyNumber, r.qty])) +
          `<h3>Route checklist</h3><ul>${jobTicketRoute(db, h.id, l.lineNo).map((s) => `<li>☐ ${escape(s.name)} — ${escape(s.status)}</li>`).join('')}</ul></section>`).join('') +
        field('Notes', doc.notes),
    };
    return {
      title: 'Job Order', subtitle: 'Customer copy', legend: true, twoUp: false,
      party: { label: 'Bill to', name: doc.customerName },
      status: [['Due date', doc.dueDate], ['Payment terms', doc.paymentTerms]],
      body: section('Items', lineTable(['Description', 'Qty', 'Unit price', 'Discount', 'Amount'], doc.lines.map((l: any) => [l.description, l.qty, money(l.unitPriceCents), money(l.discountCents), money(l.lineTotalCents)]))) +
        field('Notes', doc.notes),
      totals: [['Required downpayment', money(doc.requiredDownpaymentCents)], ['Total', money(doc.totalCents), true]],
      signatures: [['Prepared by', prepared], ['Conforme (customer)']],
    };
  }
  if (h.doc_type === 'jo.release') return {
    title: 'Release Slip', subtitle: '', legend: true, twoUp: true,
    party: { label: 'Customer', name: doc.customerName },
    status: [['Job order', doc.jobOrderNumber], ['ID type seen', doc.idSeen]],
    aside: jobOrderQr(doc.jobOrderId, doc.jobOrderNumber, joinBase),
    body: section('Items released', lineTable(['Description', 'Qty'], doc.lines.map((l: any) => [l.description, l.qty]))) +
      field('Credit note', doc.creditNote) + field('Credit due date', doc.creditDueDate),
    totals: [['Balance due at release', money(doc.balanceDueCents), true]],
    signatures: [['Released by', prepared], ['Received by', doc.claimedBy]],
  };
  if (h.doc_type === 'pur.po') {
    const names = purchaseOrderNames(db, doc.supplierId, doc.lines.map((l: any) => l.supplyId));
    return {
      title: 'Purchase Order', subtitle: '', legend: true, twoUp: false,
      party: { label: 'Supplier', name: names.supplierName },
      status: [['Expected date', doc.expectedDate]],
      body: section('Items', lineTable(['Supply', 'Qty', 'Unit', 'Unit cost', 'Amount'], doc.lines.map((l: any) => [names.supplies[l.supplyId]?.name ?? l.supplyId, l.qty, names.supplies[l.supplyId]?.unit ?? '', money(l.unitCostCents), money(l.lineTotalCents)]))),
      totals: [['Total', money(doc.totalCents), true]],
      signatures: [['Prepared by', prepared], ['Approved by'], ['Received by (supplier)']],
    };
  }
  if (h.doc_type === 'col.collection') return {
    title: 'Collection Receipt', subtitle: kind === 'thermal' ? 'Customer copy' : '', legend: true, twoUp: kind !== 'thermal',
    party: { label: 'Received from', name: doc.customerName },
    body: section('Applied to', lineTable(['Applied to', 'Amount'], [...doc.applications.map((x: any) => [x.jobOrderNumber, money(x.amountCents)]), ...doc.sales.map((x: any) => [x.invoiceNumber, money(x.amountCents)])])) + field('Notes', doc.note),
    totals: [['CWT withheld', money(doc.cwtCents)], ['VAT withheld', money(doc.vatWithheldCents)], ['Unapplied', money(doc.unappliedCents)], ['Amount received', money(doc.totalCents), true]],
    signatures: [['Received by', prepared]],
  };
  if (h.doc_type === 'col.credit_memo') return {
    title: 'Credit Memo', subtitle: '', legend: true, twoUp: false,
    party: { label: 'Customer', name: doc.customerName },
    status: [['Related document', doc.invoice?.invoiceNumber ?? doc.invoice?.number], ['Kind', doc.kind]],
    body: field('Reason', doc.reason),
    totals: [['Net', money(doc.netCents)], ['VAT', money(doc.vatCents)], ['Total credit', money(doc.totalCents), true]],
    signatures: [['Prepared by', prepared], ['Approved by'], ['Received by (customer)']],
  };
  if (h.doc_type === 'ap.payment') return {
    title: 'Payment Voucher', subtitle: '', legend: true, twoUp: true,
    party: { label: 'Pay to', name: doc.supplierName },
    body: section('Bills paid', lineTable(['Supplier bill', 'Supplier document', 'Amount'], doc.bills.map((x: any) => [x.billNumber, x.supplierInvoiceNo, money(x.amountCents)]))) +
      section('Paid from', lineTable(['Paid from', 'Reference', 'Amount'], doc.tenders.map((x: any) => [x.cashPlaceName, x.reference, money(x.amountCents)]))) + field('Notes', doc.note),
    totals: [['Bank fee', money(doc.feeCents)], ['Total paid', money(doc.totalCents), true]],
    signatures: [['Prepared by', prepared], ['Approved by'], ['Received by']],
  };
  if (h.doc_type === 'exp.voucher') return {
    title: 'Expense Voucher', subtitle: '', legend: false, twoUp: false,
    party: { label: 'Payee', name: doc.payee?.name },
    status: [['Category', doc.categoryName]],
    body: field('Description', doc.description) + section('Paid from', lineTable(['Paid from', 'Reference', 'Amount'], doc.tenders.map((x: any) => [x.cashPlaceName, x.reference, money(x.amountCents)]))),
    totals: [['Gross', money(doc.totalCents)], ['Input VAT', money(doc.inputVatCents)], ['EWT', money(doc.ewtCents)], ['Cash paid', money(doc.cashCents), true]],
    signatures: [['Prepared by', prepared], ['Approved by'], ['Received by']],
  };
  if (h.doc_type === 'cash.transfer') return { title: 'Fund Transfer', subtitle: 'Fund transfer slip', legend: false, twoUp: false,
    party: { label: 'From', name: doc.fromName, lines: [`To: ${doc.toName ?? ''}`] },
    body: field('Notes', doc.note),
    totals: [['Amount sent', money(doc.amountSentCents)], ['Fee', money(doc.feeCents)], ['Amount received', money(doc.amountReceivedCents), true]],
    signatures: [['Prepared by', prepared], ['Approved by']] };
  if (h.doc_type === 'cash.count') return { title: 'Cash Count', subtitle: 'Cash count sheet', legend: false, twoUp: false,
    party: { label: 'Cash account', name: doc.placeName },
    body: section('Count', lineTable(['Denomination', 'Quantity', 'Amount'], doc.lines.map((x: any) => [money(x.denominationCents), x.qty, money(x.amountCents)]))),
    totals: [['Ledger', money(doc.ledgerCents)], ['Difference', money(doc.differenceCents)], ['Counted', money(doc.countedCents), true]],
    signatures: [['Counted by', prepared], ['Checked by']] };
  if (h.doc_type === 'acc.jv') return { title: 'Journal Voucher', subtitle: '', legend: false, twoUp: false,
    body: field('Memo', doc.memo) + section('Entries', lineTable(['Account', 'Party', 'Debit', 'Credit', 'Memo'], doc.lines.map((x: any) => [`${x.accountCode} ${x.accountName}`, x.party ? `${x.party.type}: ${x.party.id}` : '', x.debitCents ? money(x.debitCents) : '', x.creditCents ? money(x.creditCents) : '', x.memo]))),
    totals: [['Total', money(doc.totalCents), true]],
    signatures: [['Prepared by', prepared], ['Approved by']] };
  if (h.doc_type === 'pay.run') return { title: 'Payslip', subtitle: `${doc.periodStart} to ${doc.periodEnd}`, legend: false, twoUp: true,
    body: doc.employees.map((e: any) => `<section class="payslip"><div class="party slim"><span class="label">Employee</span><strong>${escape(`${e.code} · ${e.name}`)}</strong></div><div class="pay-lines">${lineTable(['Earning / deduction', 'Amount'], e.lines.map((x: any) => [x.description, money(x.amountCents)]))}</div>` +
      totalsHtml([['Gross pay', money(e.grossCents)], ['SSS', money(e.sssEeCents)], ['PhilHealth', money(e.phicEeCents)], ['Pag-IBIG', money(e.hdmfEeCents)], ['Withholding tax', money(e.wtaxCents)], ['Cash advance', money(e.caCents)], ['Net pay', money(e.netCents), true]]) +
      signaturesHtml([['Received by', e.name]]) + '</section>').join('') };
  if (h.doc_type === 'ca.advance') return { title: 'Cash Advance Slip', subtitle: '', legend: false, twoUp: true,
    party: { label: 'Employee', name: doc.employeeName },
    status: [['Paid from', doc.cashPlaceName]],
    body: field('Notes', doc.note),
    totals: [['Payroll instalment', money(doc.installmentCents)], ['Amount', money(doc.amountCents), true]],
    signatures: [['Approved by', prepared], ['Received by', doc.employeeName]] };
  if (h.doc_type === 'inv.count') return { title: 'Inventory Count Sheet', subtitle: doc.category, legend: false, twoUp: false,
    status: [['Count date', doc.countDate]],
    body: section('Count', lineTable(['Supply', 'Unit', 'Quantity', 'Unit cost', 'Value'], doc.lines.map((x: any) => [x.name, x.unit, x.qty, money(x.unitCostCents), money(x.valueCents)]))),
    totals: [['Ledger value', money(doc.ledgerCents)], ['Adjustment', money(doc.adjustmentCents)], ['Counted value', money(doc.countedCents), true]],
    signatures: [['Counted by', prepared], ['Checked by']] };
  throw new Error(`Unsupported print type ${h.doc_type}`);
}

/** The company block at the top left of every printout: logo, trade name, registered name, address, TIN. */
function company(profile: Profile): string {
  const trade = profile.trade_name?.trim() || profile.registered_name;
  return `<div class="brand">${logo()}<div class="company"><strong class="trade">${escape(trade)}</strong>` +
    (trade !== profile.registered_name ? `<span>${escape(profile.registered_name)}</span>` : '') +
    `<span>${escape(profile.registered_address)}</span><span>TIN ${escape(profile.tin)}${profile.is_vat_registered ? ' · VAT registered' : ' · Non-VAT registered'}</span></div></div>`;
}

/** The look shared by every printout, after the shop's quotation template (teal accent, dark rule, boxed details). */
const ACCENT = '#00968a';
const BASE_CSS = `*{box-sizing:border-box}body{color:#2b2f33;margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;padding-bottom:4mm;border-bottom:1.2mm solid #2f3337}
  .brand{display:flex;align-items:center;gap:4mm;flex:1 1 auto;min-width:0}.logo{height:20mm;width:auto}.company{display:flex;flex-direction:column;line-height:1.45;font-size:9pt;color:#444}
  .company .trade{font-size:17pt;font-weight:800;color:#2c3e50;text-transform:uppercase;letter-spacing:.3mm;line-height:1.2;margin-bottom:1mm}
  .titlebox{text-align:right;flex:none;max-width:60%}h1{font-size:22pt;font-weight:800;color:${ACCENT};letter-spacing:.6mm;margin:0 0 2mm}
  .docmeta{border:1px solid #d6d6d6;padding:2mm 3mm;display:inline-grid;grid-template-columns:auto auto;gap:1mm 5mm;text-align:left;font-size:9pt}
  .docmeta span{color:#555}.docmeta b{text-align:right;color:#222}.docmeta b.no{color:${ACCENT};font-size:11pt;white-space:nowrap}
  .cancelled{font-size:16pt;font-weight:900;letter-spacing:2mm;color:#a00;border:2px solid #a00;margin:1mm 0 2mm auto;padding:.5mm 3mm;width:max-content}
  .practice{font-size:12pt;font-weight:900;letter-spacing:1mm;color:#a60;border:2px dashed #a60;margin:1mm 0 2mm auto;padding:.5mm 3mm;width:max-content}
  .subtitle{margin:0 0 2mm;font-size:9pt;color:#555;text-transform:uppercase;letter-spacing:.4mm}
  .legend{font-size:8.5pt;font-weight:bold;text-align:center;margin:2mm 0 0;letter-spacing:.2mm}
  .details{display:flex;justify-content:space-between;gap:6mm;border:1px solid #e1e1e1;padding:4mm 5mm;margin:5mm 0}
  .details .label,.party .label{display:block;font-size:8pt;font-weight:800;text-transform:uppercase;letter-spacing:.3mm;color:#333;margin-bottom:1.5mm}
  .details .name{display:block;font-size:13pt;font-weight:800;color:${ACCENT};text-transform:uppercase}.details .line{display:block;color:#555;font-size:9.5pt}
  .details .status{text-align:right;font-size:9.5pt}.details .status p{margin:.8mm 0}.details .status b{color:#222}
  .party.slim{border:1px solid #e1e1e1;padding:2mm 3mm;margin:2mm 0}
  main{flex:1}main p{margin:2mm 0}h2.section{font-size:11pt;color:${ACCENT};font-weight:700;margin:4mm 0 1.5mm;padding-bottom:1mm;border-bottom:2px solid #e6e6e6}
  table{width:100%;border-collapse:collapse;margin:2mm 0;font-size:9.5pt}th,td{border:1px solid #555;padding:1.6mm 2mm;text-align:left}
  th{background:#f0f0f0;font-size:8pt;text-transform:uppercase;letter-spacing:.2mm;text-align:center}td.empty{text-align:center;color:#777}
  td.fig{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .totals{margin:3mm 0 0 auto;width:85mm}.tot{display:flex;justify-content:space-between;gap:4mm;margin:0;padding:1.2mm 3mm;font-size:9.5pt;border-bottom:1px solid #eee}
  .tot.grand{position:relative;margin-top:1.5mm;padding:0 4mm 0 0;border:1px solid #333;font-size:12pt;font-weight:800;align-items:center;color:${ACCENT}}
  .tot.grand b{background:${ACCENT};color:#fff;padding:2.2mm 4mm;flex:1;text-transform:uppercase}
  .tot.grand::after{content:"";position:absolute;right:0;bottom:-1.2mm;width:45%;border-bottom:3px double #333}
  .signatures{display:flex;gap:10mm;margin-top:12mm;flex-wrap:wrap}.sign{width:55mm;text-align:center}
  .sign .name{display:block;min-height:6mm;font-weight:700;font-size:11pt;border-bottom:1.5px solid #333;padding-bottom:1mm}.sign .name::before{content:"\\200b"}.sign .caption{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:.3mm;margin-top:1.5mm;color:#444}
  .terms{border-top:2px solid #e6e6e6;margin-top:8mm;padding-top:3mm;font-size:8.5pt}.terms h3{font-size:10pt;color:#2c3e50;margin:0 0 1.5mm}.terms p{white-space:pre-line;margin:0;line-height:1.5}
  footer{display:flex;justify-content:space-between;font-size:7.5pt;color:#666;border-top:1px solid #ccc;padding-top:1.5mm;margin-top:5mm}
  h3{font-size:10pt;margin:2mm 0}ul{margin:1mm 0 2mm;columns:2}li{list-style:none;margin:1mm 0}
  .job-qr{margin:0;text-align:center}.details .job-qr{flex:none;align-self:center}.job-qr svg{display:block;width:25mm;height:25mm;shape-rendering:crispEdges}.job-qr figcaption{font-size:8pt;font-weight:bold;margin-top:1mm;white-space:nowrap}
  .test-print{position:absolute;z-index:5;top:45%;left:5%;width:90%;transform:rotate(-28deg);border:3px solid #b00;color:#b00;font-size:20pt;font-weight:900;letter-spacing:1mm;text-align:center;opacity:.32;padding:3mm;pointer-events:none}`;

export function renderReportPrint(title: ReportPrintTitle, body: string, profile: Profile, businessDate: string,
  printedBy: string, printedAt: string, legend = false): string {
  if (!REPORT_PRINT_TITLES.includes(title)) throw new Error('Print title is not allowed');
  const ownersPack = title === "Monthly Owners' Pack";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page{size:A4;margin:12mm${ownersPack ? ';@bottom-right{content:"Page " counter(page) " of " counter(pages)}' : ''}}${BASE_CSS}body{font:10pt "Segoe UI",Roboto,Arial,sans-serif}
    h1{font-size:16pt;white-space:nowrap}h2{font-size:12pt;color:${ACCENT}}.meta{display:flex;justify-content:space-between;border-bottom:1px solid #ccc;padding:2mm 0;margin:3mm 0 4mm;font-size:9pt}
    article{position:relative}.pack-section{break-before:page}.pack-section:first-child{break-before:auto}td.money{text-align:right}
    @media screen{body{background:#ddd;padding:12mm}article{background:#fff;width:210mm;min-height:273mm;margin:auto;padding:12mm;box-shadow:0 2px 12px #777}}</style></head>` +
    `<body><article><header class="top">${company(profile)}<div class="titlebox"><h1>${escape(title.toUpperCase())}</h1></div></header>` +
    `${legend ? '<p class="legend"><strong>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</strong></p>' : ''}` +
    `<div class="meta"><span>Date <b>${escape(businessDate)}</b></span><span>${ownersPack ? 'Prepared by' : 'Printed by'} <b>${escape(printedBy)}</b></span></div><main>${body}</main>` +
    `<footer><span>${ownersPack ? 'Prepared on' : `Printed by ${escape(printedBy)} at`} ${escape(printedAt)}</span></footer></article></body></html>`;
}

export const printField = field;
export const printLineTable = lineTable;
export const printMoney = money;

/** `practice`: printed in the practice shop (PLAN C8), so every copy says it is not a real document. */
export function renderPrint(db: Db, h: PrintHeader, doc: unknown, profile: Profile, kind: PrintKind,
  printedBy: string, printedAt: string, copyNumber: number, practice = false, testPrint = false, joinBase?: string): string {
  const p = content(db, h, doc, kind, joinBase);
  const catalogueTitles: readonly string[] = ['Payment Voucher', 'Payslip', 'Cash Advance Slip', 'Inventory Count Sheet', 'Certificate of Creditable Tax Withheld at Source'];
  if (!(DOC_TITLES as readonly string[]).includes(p.title) && !catalogueTitles.includes(p.title)) throw new Error('Print title is not allowed');
  const title = p.title.toUpperCase();
  const details = p.party || p.aside || p.status?.some(([, v]) => v)
    ? `<section class="details">${p.party ? `<div><span class="label">${escape(p.party.label)}</span><span class="name">${escape(p.party.name)}</span>${(p.party.lines ?? []).filter(Boolean).map((l) => `<span class="line">${escape(l)}</span>`).join('')}</div>` : '<div></div>'}${p.aside ?? ''}` +
      `<div class="status"><span class="label">Document status</span>${(p.status ?? []).filter(([, v]) => v).map(([k, v]) => `<p>${escape(k)}: <b>${escape(v)}</b></p>`).join('')}<p>Printed: <b>${escape(printedAt.slice(0, 10))}</b></p></div></section>`
    : '';
  const one = `<article class="copy">${testPrint ? '<div class="test-print">TEST PRINT, NOT A REAL DOCUMENT</div>' : ''}` +
    `<header class="top">${company(profile)}<div class="titlebox"><h1>${escape(title)}</h1>${h.status === 'cancelled' ? '<p class="cancelled">CANCELLED</p>' : ''}${practice ? '<p class="practice">PRACTICE ONLY · NOT A REAL DOCUMENT</p>' : ''}${p.subtitle ? `<p class="subtitle">${escape(p.subtitle)}</p>` : ''}` +
    `<div class="docmeta"><span>Document no.</span><b class="no">${escape(h.number)}</b><span>Date</span><b>${escape(h.business_date)}</b></div></div></header>` +
    `${p.legend ? '<p class="legend"><strong>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</strong></p>' : ''}${details}` +
    `<main>${p.body}${totalsHtml(p.totals)}</main>${signaturesHtml(p.signatures)}${termsHtml(p.terms)}` +
    `<footer><span>Printed by ${escape(printedBy)} at ${escape(printedAt)}</span><span>${copyNumber > 1 ? `REPRINT no. ${copyNumber - 1}` : 'Original print'} · Copy ${copyNumber}</span></footer></article>`;
  const thermal = kind === 'thermal';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} ${escape(h.number)}</title><style>
    @page{size:${thermal ? '80mm auto' : 'A4'};margin:${thermal ? '4mm' : '12mm'}}${BASE_CSS}body{font-size:${thermal ? '9pt' : '10.5pt'}}.sheet{min-height:${thermal ? 'auto' : '273mm'}}
    .sheet.two-up{display:grid;grid-template-rows:1fr 1fr;gap:0}.copy{position:relative;padding:3mm 1mm;display:flex;flex-direction:column;break-inside:avoid}
    .two-up .copy{height:136mm;overflow:hidden;font-size:9pt}.two-up .copy:first-child{border-bottom:1px dashed #777}
    .two-up .top{padding-bottom:1.5mm;border-bottom-width:.8mm;gap:4mm}.two-up .logo{height:11mm}.two-up .company{font-size:7.5pt;line-height:1.3}.two-up .company .trade{font-size:12pt;margin:0}
    .two-up h1{font-size:15pt;margin:0 0 1mm}.two-up .docmeta{font-size:8pt;padding:1mm 2mm;gap:.3mm 4mm}.two-up .docmeta b.no{font-size:9.5pt}.two-up .subtitle{margin:0 0 1mm;font-size:8pt}
    .two-up .legend{font-size:7.5pt;margin-top:1mm}.two-up .details{margin:2mm 0;padding:1.8mm 3mm;font-size:8.5pt}.two-up .details .name{font-size:10.5pt}.two-up .details .label,.two-up .party .label{font-size:7pt;margin-bottom:.6mm}
    .two-up .details .status p{margin:.2mm 0}.two-up .job-qr svg{width:17mm;height:17mm;margin:auto}.two-up .job-qr figcaption{font-size:6.5pt}
    .two-up h2.section{font-size:9pt;margin:1.5mm 0 .8mm;padding-bottom:.5mm}.two-up table{font-size:8pt;margin:1mm 0}.two-up th,.two-up td{padding:.8mm 1.5mm}.two-up th{font-size:7pt}
    .two-up .totals{width:55%;margin-top:1.5mm}.two-up .tot{padding:.6mm 2mm;font-size:8.5pt}.two-up .tot.grand{font-size:10pt;margin-top:1mm;padding:0 3mm 0 0}.two-up .tot.grand b{padding:1.2mm 3mm}
    .two-up .signatures{margin-top:4mm;gap:8mm}.two-up .sign .name{min-height:4mm;font-size:9pt}.two-up .sign .caption{font-size:7pt;margin-top:.6mm}.two-up footer{margin-top:2mm;padding-top:1mm;font-size:6.5pt}.two-up main p{margin:1mm 0}
    .two-up .payslip{display:grid;grid-template-columns:1fr 1fr;column-gap:5mm;align-items:start}.two-up .payslip .party{grid-column:1/-1;margin:1mm 0}.two-up .payslip .totals{width:100%;margin-top:1mm}.two-up .payslip .signatures{grid-column:1/-1;margin-top:3mm}
    ${thermal ? `.top{flex-direction:column;align-items:center;text-align:center}.brand{flex-direction:column}.logo{height:14mm}.company .trade{font-size:12pt}.titlebox{text-align:center;min-width:0}h1{font-size:14pt}.docmeta{font-size:8pt}
    .details{flex-direction:column;padding:2mm;gap:2mm}.details .status{text-align:left}.totals{width:100%}.tot.grand{font-size:10.5pt}.signatures{justify-content:center}footer{flex-direction:column;gap:.5mm}.sign{width:100%}table{font-size:8pt}` : ''}
    @media screen{body{background:#ddd;padding:12mm}.sheet{background:white;width:${thermal ? '80mm' : '210mm'};margin:auto;padding:${thermal ? '4mm' : '12mm'};box-shadow:0 2px 12px #777}.two-up .copy{height:125mm}}
    @media print{.sheet{page-break-after:always}}
  </style></head><body><div class="sheet${p.twoUp ? ' two-up' : ''}">${p.twoUp ? one + one : one}</div></body></html>`;
}

/** One BIR Form 2307-style A4 page per supplier; figures are passed straight from TAX's 2307-to-issue report. */
export function render2307(profile: Profile, year: number, quarter: number, certificates: Certificate2307[], testPrint = false, practice = false): string {
  const first = 3 * quarter - 2;
  const from = `${year}-${String(first).padStart(2, '0')}-01`;
  const to = `${year}-${String(first + 2).padStart(2, '0')}-${new Date(Date.UTC(year, first + 2, 0)).getUTCDate()}`;
  const months = [0, 1, 2].map((i) => new Date(Date.UTC(year, first - 1 + i, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }));
  const pages = certificates.map((c) => `<article class="certificate">${testPrint ? '<div class="test-print">TEST PRINT, NOT A REAL DOCUMENT</div>' : ''}
    <header><div class="form">BIR FORM NO. 2307</div><h1>CERTIFICATE OF CREDITABLE TAX WITHHELD AT SOURCE</h1><p>For the period ${from} to ${to}</p>${practice ? '<p class="practice">PRACTICE ONLY · NOT A REAL DOCUMENT</p>' : ''}</header>
    <h2>PART I — PAYEE INFORMATION</h2>
    <div class="party"><p><b>Registered name:</b> ${escape(c.supplierName)}</p><p><b>TIN:</b> ${escape(c.tin ?? '')}</p><p><b>Registered address:</b> ${escape(c.address ?? '')}</p></div>
    <h2>PART I — PAYOR INFORMATION</h2>
    <div class="party"><p><b>Registered name:</b> ${escape(profile.registered_name)}</p><p><b>TIN:</b> ${escape(profile.tin)}</p><p><b>Registered address:</b> ${escape(profile.registered_address)}</p></div>
    <h2>PART II — DETAILS OF MONTHLY INCOME PAYMENTS AND TAX WITHHELD</h2>
    ${lineTable(['ATC', ...months, 'Quarter total', 'Tax withheld'], c.lines.map((line) => [line.atc, ...line.months.map((m) => money(m.baseCents)), money(line.baseCents), money(line.ewtCents)]))}
    <div class="signatures"><p>Payor / Authorized representative<br><span></span><small>Signature over printed name</small></p><p>Payee / Authorized representative<br><span></span><small>Signature over printed name</small></p></div>
  </article>`).join('');
  const title = 'Certificate of Creditable Tax Withheld at Source';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · ${year} Q${quarter}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#111;margin:0}.certificate{position:relative;min-height:273mm;page-break-after:always;padding:2mm}.certificate:last-child{page-break-after:auto}.test-print{position:absolute;z-index:5;top:45%;left:5%;width:90%;transform:rotate(-28deg);border:3px solid #b00;color:#b00;font-size:20pt;font-weight:900;text-align:center;opacity:.32;padding:3mm}
    header{text-align:center}.form{font-weight:bold;text-align:right}h1{font-size:16pt;margin:4mm 0 1mm}h2{font-size:10pt;background:#ddd;border:1px solid #555;padding:1.5mm;margin:5mm 0 0}.practice{font-size:14pt;font-weight:900;letter-spacing:1mm;color:#a60;border:2px dashed #a60;margin:2mm auto;padding:1mm 3mm;width:max-content}.party{border:1px solid #777;border-top:0;padding:2mm}.party p{margin:1.5mm 0;min-height:5mm}
    table{width:100%;border-collapse:collapse;margin-top:2mm}th,td{border:1px solid #777;padding:2mm;text-align:right}th:first-child,td:first-child{text-align:left}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:20mm;margin-top:30mm;text-align:center}.signatures span{display:block;border-bottom:1px solid #111;height:14mm}.signatures small{display:block;margin-top:1mm}
    @media screen{body{background:#ddd;padding:12mm}.certificate{background:white;width:210mm;margin:0 auto 8mm;padding:12mm;box-shadow:0 2px 12px #777}}
  </style></head><body>${pages}</body></html>`;
}
