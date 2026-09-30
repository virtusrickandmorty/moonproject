/** Server-rendered, escaped print views. No journal entries are created here. */
import { formatPeso } from '@moonproject/shared';
import qrcode from 'qrcode-generator';
import { DOC_TITLES, type DocTitle } from '../../engine/documents/registry.ts';
import type { Db } from '../../platform/db/driver.ts';
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
export interface PrintHeader { id: string; number: string; business_date: string; doc_type: string; status: 'posted' | 'cancelled' }

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cell = (value: unknown) => `<td>${escape(value)}</td>`;
const money = (n: number) => formatPeso(n);
const lineTable = (headings: string[], rows: unknown[][]) => `<table><thead><tr>${headings.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
const field = (name: string, value: unknown) => value ? `<p><b>${escape(name)}:</b> ${escape(value)}</p>` : '';

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
export type ReportPrintTitle = 'Statement of Account' | 'Sizing Profile' | 'Fixed Asset Schedule';
export const REPORT_PRINT_TITLES: readonly ReportPrintTitle[] = ['Statement of Account', 'Sizing Profile', 'Fixed Asset Schedule'];
function content(db: Db, h: PrintHeader, doc: any, kind: PrintKind, joinBase?: string): { title: PrintTitle; subtitle: string; legend: boolean; body: string; twoUp: boolean } {
  if (h.doc_type === 'quo.quotation') return {
    title: 'Quotation', subtitle: '', legend: true, twoUp: false,
    body: field('Customer', doc.customerName) + field('Valid until', doc.validUntil) +
      lineTable(['Description', 'Qty', 'Unit', 'Unit price', 'Line discount', 'Amount'], doc.lines.map((l: any) =>
        [l.description, l.qty, l.unit, money(l.unitPriceCents), money(l.discountCents), money(l.lineTotalCents)])) +
      field('Subtotal', money(doc.lines.reduce((sum: number, l: any) => sum + l.lineTotalCents, 0))) +
      field('Document discount', `−${money(doc.documentDiscountCents)}`) + field('Total', money(doc.totalCents)) +
      field('Terms', doc.termsText) + field('Contact', doc.contact) + field('Notes', doc.notes),
  };
  if (h.doc_type === 'jo.job_order') {
    if (kind === 'job_ticket') return {
      title: 'Job Ticket', subtitle: 'Production copy', legend: false, twoUp: false,
      body: jobOrderQr(h.id, h.number, joinBase) + field('Customer', doc.customerName) + field('Due date', doc.dueDate) + field('Priority', doc.priority) +
        doc.lines.map((l: any) => `<section class="job-line"><h2>${escape(l.description)} · ${escape(l.qty)} pieces</h2>` +
          lineTable(['Wearer', 'Size', 'Jersey name', 'Jersey no.', 'Qty'], l.roster.map((r: any) => [r.wearerName, r.size ?? (r.sizeMode === 'measured' ? 'Measured' : ''), r.jerseyName, r.jerseyNumber, r.qty])) +
          `<h3>Route checklist</h3><ul>${jobTicketRoute(db, h.id, l.lineNo).map((s) => `<li>☐ ${escape(s.name)} — ${escape(s.status)}</li>`).join('')}</ul></section>`).join('') +
        field('Notes', doc.notes),
    };
    return {
      title: 'Job Order', subtitle: 'Customer copy', legend: true, twoUp: false,
      body: field('Customer', doc.customerName) + field('Due date', doc.dueDate) +
        lineTable(['Description', 'Qty', 'Unit price', 'Discount', 'Amount'], doc.lines.map((l: any) => [l.description, l.qty, money(l.unitPriceCents), money(l.discountCents), money(l.lineTotalCents)])) +
        field('Total', money(doc.totalCents)) + field('Required downpayment', money(doc.requiredDownpaymentCents)) +
        field('Payment terms', doc.paymentTerms) + field('Notes', doc.notes),
    };
  }
  if (h.doc_type === 'jo.release') return {
    title: 'Release Slip', subtitle: '', legend: true, twoUp: true,
    body: jobOrderQr(doc.jobOrderId, doc.jobOrderNumber, joinBase) + field('Job order', doc.jobOrderNumber) + field('Customer', doc.customerName) +
      lineTable(['Description', 'Qty'], doc.lines.map((l: any) => [l.description, l.qty])) +
      field('Claimed by', doc.claimedBy) + field('ID type seen', doc.idSeen) +
      field('Balance due at release', money(doc.balanceDueCents)) + field('Credit note', doc.creditNote) +
      field('Credit due date', doc.creditDueDate),
  };
  if (h.doc_type === 'pur.po') {
    const names = purchaseOrderNames(db, doc.supplierId, doc.lines.map((l: any) => l.supplyId));
    return {
      title: 'Purchase Order', subtitle: '', legend: true, twoUp: false,
      body: field('Supplier', names.supplierName) + field('Expected date', doc.expectedDate) +
        lineTable(['Supply', 'Qty', 'Unit', 'Unit cost', 'Amount'], doc.lines.map((l: any) => [names.supplies[l.supplyId]?.name ?? l.supplyId, l.qty, names.supplies[l.supplyId]?.unit ?? '', money(l.unitCostCents), money(l.lineTotalCents)])) +
        field('Total', money(doc.totalCents)),
    };
  }
  if (h.doc_type === 'col.collection') return {
    title: 'Collection Receipt', subtitle: kind === 'thermal' ? 'Customer copy' : '', legend: true, twoUp: kind !== 'thermal',
    body: field('Customer', doc.customerName) +
      lineTable(['Applied to', 'Amount'], [...doc.applications.map((x: any) => [x.jobOrderNumber, money(x.amountCents)]), ...doc.sales.map((x: any) => [x.invoiceNumber, money(x.amountCents)])]) +
      field('Amount received', money(doc.totalCents)) + field('CWT withheld', money(doc.cwtCents)) + field('VAT withheld', money(doc.vatWithheldCents)) + field('Unapplied', money(doc.unappliedCents)) + field('Notes', doc.note),
  };
  if (h.doc_type === 'col.credit_memo') return {
    title: 'Credit Memo', subtitle: '', legend: true, twoUp: false,
    body: field('Customer', doc.customerName) + field('Related document', doc.invoice?.invoiceNumber ?? doc.invoice?.number) +
      field('Kind', doc.kind) + field('Reason', doc.reason) + field('Net', money(doc.netCents)) + field('VAT', money(doc.vatCents)) + field('Total credit', money(doc.totalCents)),
  };
  if (h.doc_type === 'ap.payment') return {
    title: 'Payment Voucher', subtitle: '', legend: true, twoUp: true,
    body: field('Supplier', doc.supplierName) + lineTable(['Supplier bill', 'Supplier document', 'Amount'], doc.bills.map((x: any) => [x.billNumber, x.supplierInvoiceNo, money(x.amountCents)])) +
      lineTable(['Paid from', 'Reference', 'Amount'], doc.tenders.map((x: any) => [x.cashPlaceName, x.reference, money(x.amountCents)])) + field('Bank fee', money(doc.feeCents)) + field('Total paid', money(doc.totalCents)) + field('Notes', doc.note),
  };
  if (h.doc_type === 'exp.voucher') return {
    title: 'Expense Voucher', subtitle: '', legend: false, twoUp: false,
    body: field('Payee', doc.payee?.name) + field('Category', doc.categoryName) + field('Description', doc.description) +
      lineTable(['Paid from', 'Reference', 'Amount'], doc.tenders.map((x: any) => [x.cashPlaceName, x.reference, money(x.amountCents)])) +
      field('Gross', money(doc.totalCents)) + field('Input VAT', money(doc.inputVatCents)) + field('EWT', money(doc.ewtCents)) + field('Cash paid', money(doc.cashCents)),
  };
  if (h.doc_type === 'cash.transfer') return { title: 'Fund Transfer', subtitle: 'Fund transfer slip', legend: false, twoUp: false,
    body: field('From', doc.fromName) + field('To', doc.toName) + field('Amount sent', money(doc.amountSentCents)) + field('Amount received', money(doc.amountReceivedCents)) + field('Fee', money(doc.feeCents)) + field('Notes', doc.note) };
  if (h.doc_type === 'cash.count') return { title: 'Cash Count', subtitle: 'Cash count sheet', legend: false, twoUp: false,
    body: field('Cash account', doc.placeName) + lineTable(['Denomination', 'Quantity', 'Amount'], doc.lines.map((x: any) => [money(x.denominationCents), x.qty, money(x.amountCents)])) +
      field('Counted', money(doc.countedCents)) + field('Ledger', money(doc.ledgerCents)) + field('Difference', money(doc.differenceCents)) };
  if (h.doc_type === 'acc.jv') return { title: 'Journal Voucher', subtitle: '', legend: false, twoUp: false,
    body: field('Memo', doc.memo) + lineTable(['Account', 'Party', 'Debit', 'Credit', 'Memo'], doc.lines.map((x: any) => [`${x.accountCode} ${x.accountName}`, x.party ? `${x.party.type}: ${x.party.id}` : '', x.debitCents ? money(x.debitCents) : '', x.creditCents ? money(x.creditCents) : '', x.memo])) + field('Total', money(doc.totalCents)) };
  if (h.doc_type === 'pay.run') return { title: 'Payslip', subtitle: `${doc.periodStart} to ${doc.periodEnd}`, legend: false, twoUp: true,
    body: doc.employees.map((e: any) => `<section class="payslip">${field('Employee', `${e.code} · ${e.name}`)}${lineTable(['Earning / deduction', 'Amount'], e.lines.map((x: any) => [x.description, money(x.amountCents)]))}${field('Gross pay', money(e.grossCents))}${field('SSS', money(e.sssEeCents))}${field('PhilHealth', money(e.phicEeCents))}${field('Pag-IBIG', money(e.hdmfEeCents))}${field('Withholding tax', money(e.wtaxCents))}${field('Cash advance', money(e.caCents))}${field('Net pay', money(e.netCents))}</section>`).join('') };
  if (h.doc_type === 'ca.advance') return { title: 'Cash Advance Slip', subtitle: '', legend: false, twoUp: true,
    body: field('Employee', doc.employeeName) + field('Paid from', doc.cashPlaceName) + field('Amount', money(doc.amountCents)) + field('Payroll instalment', money(doc.installmentCents)) + field('Notes', doc.note) };
  if (h.doc_type === 'inv.count') return { title: 'Inventory Count Sheet', subtitle: doc.category, legend: false, twoUp: false,
    body: field('Count date', doc.countDate) + lineTable(['Supply', 'Unit', 'Quantity', 'Unit cost', 'Value'], doc.lines.map((x: any) => [x.name, x.unit, x.qty, money(x.unitCostCents), money(x.valueCents)])) + field('Counted value', money(doc.countedCents)) + field('Ledger value', money(doc.ledgerCents)) + field('Adjustment', money(doc.adjustmentCents)) };
  throw new Error(`Unsupported print type ${h.doc_type}`);
}

export function renderReportPrint(title: ReportPrintTitle, body: string, profile: Profile, businessDate: string,
  printedBy: string, printedAt: string, legend = false): string {
  if (!REPORT_PRINT_TITLES.includes(title)) throw new Error('Print title is not allowed');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#111;margin:0}header{text-align:center}.company{line-height:1.35}h1{font-size:18pt;margin:6mm 0 1mm}.legend{font-size:9pt;margin:2mm 0 4mm}.meta,footer{display:flex;justify-content:space-between;border-top:1px solid #777;padding-top:2mm}.meta{border-bottom:1px solid #777;border-top:0;padding-bottom:2mm;margin:3mm 0}table{width:100%;border-collapse:collapse;margin:3mm 0}th,td{border:1px solid #aaa;padding:1.5mm;text-align:left}th{background:#eee}td.money{text-align:right}footer{font-size:8pt;margin-top:4mm}@media screen{body{background:#ddd;padding:12mm}article{background:#fff;width:210mm;min-height:273mm;margin:auto;padding:12mm;box-shadow:0 2px 12px #777}}</style></head><body><article><header><div class="company"><strong>${escape(profile.registered_name)}</strong><br>TIN ${escape(profile.tin)}<br>${escape(profile.registered_address)}</div><h1>${escape(title.toUpperCase())}</h1>${legend ? '<p class="legend"><strong>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</strong></p>' : ''}</header><div class="meta"><span>Date <b>${escape(businessDate)}</b></span><span>Printed by <b>${escape(printedBy)}</b></span></div><main>${body}</main><footer><span>Printed by ${escape(printedBy)} at ${escape(printedAt)}</span></footer></article></body></html>`;
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
  const one = `<article class="copy">${testPrint ? '<div class="test-print">TEST PRINT, NOT A REAL DOCUMENT</div>' : ''}<header><div class="company"><strong>${escape(profile.registered_name)}</strong><br>TIN ${escape(profile.tin)}<br>${escape(profile.registered_address)}</div><h1>${escape(title)}</h1>${practice ? '<p class="practice">PRACTICE ONLY · NOT A REAL DOCUMENT</p>' : ''}${h.status === 'cancelled' ? '<p class="cancelled">CANCELLED</p>' : ''}${p.subtitle ? `<p class="subtitle">${escape(p.subtitle)}</p>` : ''}${p.legend ? '<p class="legend"><strong>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</strong></p>' : ''}</header>` +
    `<div class="meta"><span>Document no. <b>${escape(h.number)}</b></span><span>Business date <b>${escape(h.business_date)}</b></span></div>` +
    `<main>${p.body}</main><footer><span>Printed by ${escape(printedBy)} at ${escape(printedAt)}</span><span>${copyNumber > 1 ? `REPRINT no. ${copyNumber - 1}` : 'Original print'} · Copy ${copyNumber}</span></footer></article>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} ${escape(h.number)}</title><style>
    @page{size:${kind === 'thermal' ? '80mm auto' : 'A4'};margin:${kind === 'thermal' ? '4mm' : '12mm'}}*{box-sizing:border-box}body{font:11pt Arial,sans-serif;color:#111;margin:0}.sheet{min-height:${kind === 'thermal' ? 'auto' : '273mm'}
    .sheet.two-up{display:grid;grid-template-rows:1fr 1fr;gap:0}.copy{position:relative;padding:5mm 2mm;display:flex;flex-direction:column;break-inside:avoid}.test-print{position:absolute;z-index:5;top:45%;left:5%;width:90%;transform:rotate(-28deg);border:3px solid #b00;color:#b00;font-size:20pt;font-weight:900;letter-spacing:1mm;text-align:center;opacity:.32;padding:3mm;pointer-events:none}
    .two-up .copy{height:136mm}.two-up .copy:first-child{border-bottom:1px dashed #777}
    header{text-align:center}.company{line-height:1.35}h1{font-size:18pt;margin:6mm 0 1mm}.cancelled{font-size:18pt;font-weight:900;letter-spacing:2mm;color:#a00;border:2px solid #a00;margin:2mm auto;padding:1mm 3mm;width:max-content}.subtitle{margin:0 0 2mm}.practice{font-size:14pt;font-weight:900;letter-spacing:1mm;color:#a60;border:2px dashed #a60;margin:2mm auto;padding:1mm 3mm;width:max-content}.legend{font-size:9pt;margin:2mm 0 4mm;font-weight:bold}
    .meta{display:flex;justify-content:space-between;border-block:1px solid #777;padding:2mm 0;margin:2mm 0 4mm}main{flex:1}main p{margin:2mm 0}
    table{width:100%;border-collapse:collapse;margin:3mm 0}th,td{border:1px solid #aaa;padding:1.5mm;text-align:left}th{background:#eee}h2{font-size:12pt;margin:4mm 0 1mm}h3{font-size:10pt;margin:2mm 0}ul{margin:1mm 0 2mm;columns:2}li{list-style:none;margin:1mm 0}.job-qr{float:right;width:25mm;margin:0 0 3mm 5mm;text-align:center}.job-qr svg{display:block;width:25mm;height:25mm;shape-rendering:crispEdges}.job-qr figcaption{font-size:8pt;font-weight:bold;margin-top:1mm}
    footer{display:flex;justify-content:space-between;font-size:8pt;border-top:1px solid #777;padding-top:2mm;margin-top:3mm}
    @media screen{body{background:#ddd;padding:12mm}.sheet{background:white;width:210mm;margin:auto;padding:12mm;box-shadow:0 2px 12px #777}.two-up .copy{height:125mm}}
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
