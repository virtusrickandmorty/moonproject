/** Server-rendered, escaped print views. No journal entries are created here. */
import { formatPeso } from '@moonproject/shared';
import { DOC_TITLES, type DocTitle } from '../../engine/documents/registry.ts';
import type { Db } from '../../platform/db/driver.ts';
import { jobTicketRoute } from '../PRD/public.ts';
import { purchaseOrderNames } from '../PUR/public.ts';

export type PrintKind = 'document' | 'job_ticket';
export interface Profile {
  registered_name: string; trade_name: string; tin: string; registered_address: string;
  is_vat_registered: number; version: number;
}
export interface PrintHeader { id: string; number: string; business_date: string; doc_type: string; status: 'posted' | 'cancelled' }

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cell = (value: unknown) => `<td>${escape(value)}</td>`;
const money = (n: number) => formatPeso(n);
const lineTable = (headings: string[], rows: unknown[][]) => `<table><thead><tr>${headings.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
const field = (name: string, value: unknown) => value ? `<p><b>${escape(name)}:</b> ${escape(value)}</p>` : '';

function content(db: Db, h: PrintHeader, doc: any, kind: PrintKind): { title: DocTitle; subtitle: string; legend: boolean; body: string; twoUp: boolean } {
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
      body: field('Customer', doc.customerName) + field('Due date', doc.dueDate) + field('Priority', doc.priority) +
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
    body: field('Job order', doc.jobOrderNumber) + field('Customer', doc.customerName) +
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
  throw new Error(`Unsupported print type ${h.doc_type}`);
}

/** `practice`: printed in the practice shop (PLAN C8), so every copy says it is not a real document. */
export function renderPrint(db: Db, h: PrintHeader, doc: unknown, profile: Profile, kind: PrintKind,
  printedBy: string, printedAt: string, copyNumber: number, practice = false): string {
  const p = content(db, h, doc, kind);
  if (!DOC_TITLES.includes(p.title)) throw new Error('Print title is not allowed');
  const title = p.title.toUpperCase();
  const one = `<article class="copy"><header><div class="company"><strong>${escape(profile.registered_name)}</strong><br>TIN ${escape(profile.tin)}<br>${escape(profile.registered_address)}</div><h1>${escape(title)}</h1>${practice ? '<p class="practice">PRACTICE ONLY · NOT A REAL DOCUMENT</p>' : ''}${h.status === 'cancelled' ? '<p class="cancelled">CANCELLED</p>' : ''}${p.subtitle ? `<p class="subtitle">${escape(p.subtitle)}</p>` : ''}${p.legend ? '<p class="legend"><strong>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</strong></p>' : ''}</header>` +
    `<div class="meta"><span>Document no. <b>${escape(h.number)}</b></span><span>Business date <b>${escape(h.business_date)}</b></span></div>` +
    `<main>${p.body}</main><footer><span>Printed by ${escape(printedBy)} at ${escape(printedAt)}</span><span>${copyNumber > 1 ? `REPRINT no. ${copyNumber - 1}` : 'Original print'} · Copy ${copyNumber}</span></footer></article>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} ${escape(h.number)}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:11pt Arial,sans-serif;color:#111;margin:0}.sheet{min-height:273mm}
    .sheet.two-up{display:grid;grid-template-rows:1fr 1fr;gap:0}.copy{padding:5mm 2mm;display:flex;flex-direction:column;break-inside:avoid}
    .two-up .copy{height:136mm}.two-up .copy:first-child{border-bottom:1px dashed #777}
    header{text-align:center}.company{line-height:1.35}h1{font-size:18pt;margin:6mm 0 1mm}.cancelled{font-size:18pt;font-weight:900;letter-spacing:2mm;color:#a00;border:2px solid #a00;margin:2mm auto;padding:1mm 3mm;width:max-content}.subtitle{margin:0 0 2mm}.practice{font-size:14pt;font-weight:900;letter-spacing:1mm;color:#a60;border:2px dashed #a60;margin:2mm auto;padding:1mm 3mm;width:max-content}.legend{font-size:9pt;margin:2mm 0 4mm;font-weight:bold}
    .meta{display:flex;justify-content:space-between;border-block:1px solid #777;padding:2mm 0;margin:2mm 0 4mm}main{flex:1}main p{margin:2mm 0}
    table{width:100%;border-collapse:collapse;margin:3mm 0}th,td{border:1px solid #aaa;padding:1.5mm;text-align:left}th{background:#eee}h2{font-size:12pt;margin:4mm 0 1mm}h3{font-size:10pt;margin:2mm 0}ul{margin:1mm 0 2mm;columns:2}li{list-style:none;margin:1mm 0}
    footer{display:flex;justify-content:space-between;font-size:8pt;border-top:1px solid #777;padding-top:2mm;margin-top:3mm}
    @media screen{body{background:#ddd;padding:12mm}.sheet{background:white;width:210mm;margin:auto;padding:12mm;box-shadow:0 2px 12px #777}.two-up .copy{height:125mm}}
    @media print{.sheet{page-break-after:always}}
  </style></head><body><div class="sheet${p.twoUp ? ' two-up' : ''}">${p.twoUp ? one + one : one}</div></body></html>`;
}
