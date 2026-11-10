/**
 * The audit log in plain words (the owner's request, Nov 2026: "make the data in the audit log readable"). Each entry keeps
 * its codes and raw data for an auditor; this adds what happened, which record (a document's number, a person's or thing's
 * name, with a link where there is a page), and the details: changes as "before → after", amounts in pesos, dates as dates.
 * Nothing here writes, and an entry this does not know still reads sensibly from its code.
 */
import { formatPeso } from '@moonproject/shared';
import type { Db } from '../../platform/db/driver.ts';
import type { Registry } from '../../engine/documents/registry.ts';
import { customerRef } from '../CUS/public.ts';
import { employee } from '../EMP/public.ts';
import { catalogItemRef } from '../CAT/public.ts';

export interface Detail { label: string; value?: string; before?: string; after?: string }
export interface Readable { what: string; record: { label: string; href: string | null } | null; details: Detail[] }

/** What happened, by action code. Unknown codes fall back to the module's name and the code's last words. */
export const ACTIONS: Record<string, string> = {
  'auth.login': 'Signed in', 'auth.login_failed': 'Tried to sign in: wrong password', 'auth.logout': 'Signed out',
  'auth.password_changed': 'Changed their password', 'auth.step_up': 'Typed their password again for a protected step',
  'auth.step_up_failed': 'Wrong password at a protected step', 'setup.first_owner': 'Set up the first owner',
  'user.create': 'Added a user', 'user.reset_password': 'Reset a user\'s password', 'user.roles': 'Changed a user\'s roles',
  'role.permission': 'Changed what a role may do', 'practice.reset': 'Started the practice shop over',
  'document.post': 'Recorded', 'document.cancel': 'Cancelled', 'draft.create': 'Started a draft', 'draft.discard': 'Threw away a draft',
  'attachment.add': 'Attached a file', 'attachment.remove': 'Removed an attached file', 'audit.export': 'Downloaded the audit log',
  'acc.account.create': 'Added an account', 'acc.account.update': 'Changed an account', 'acc.account.activate': 'Turned an account back on',
  'acc.account.deactivate': 'Turned an account off', 'acc.golive.answer': 'Answered a go-live question', 'acc.monthend.signoff': 'Signed off the month',
  'acc.opening.close': 'Closed the opening balances', 'acc.opening.cutover': 'Set the cut-over date', 'acc.setting.add': 'Changed a setting',
  'aia.chat.read': 'Read a website chat', 'aia.settings': 'Changed the website chat helper',
  'alt.receive': 'Received an item brought back', 'alt.accept': 'Accepted an item brought back', 'alt.decline': 'Declined an item brought back',
  'alt.sewing_rate': 'Set the sewing rate of an item brought back',
  'bak.run': 'Made a backup', 'bak.usb': 'Copied the backups to a USB drive', 'bak.check': 'Checked a backup', 'bak.restore': 'Asked to restore a backup',
  'bak.restored': 'Restored a backup', 'bak.settings': 'Changed the backup settings',
  'cal.event.create': 'Added a calendar event', 'cal.event.move': 'Moved a calendar event', 'cal.event.cancel': 'Cancelled a calendar event',
  'cash.place.create': 'Added a cash or bank place', 'cash.place.settings': 'Changed a cash or bank place',
  'cat.item.create': 'Added a catalog item', 'cat.item.update': 'Changed a catalog item', 'cat.item.own_rates': 'Gave a catalog item its own sewing rates',
  'cat.price.create': 'Set a price', 'cat.price.override': 'Changed a price on a quotation',
  'col.checks.deposit': 'Deposited checks', 'col.checks.return': 'Recorded a returned check', 'col.pdc.add': 'Added a post-dated check',
  'col.pdc.void': 'Voided a post-dated check',
  'com.settings': 'Changed the email settings', 'com.test_email': 'Sent a test email', 'com.resend': 'Sent an email again',
  'com.statement_queued': 'Queued a statement email', 'com.payslip_queued': 'Queued a payslip email', 'com.not_queued': 'Did not queue an email',
  'cus.customer.create': 'Added a customer', 'cus.customer.update': 'Changed a customer', 'cus.customer.merge': 'Merged a duplicate customer',
  'cus.customer.deactivate': 'Turned a customer off', 'cus.update': 'Changed a customer', 'cus.contact.create': 'Added a customer contact',
  'cus.phone.create': 'Added a phone number', 'cus.group.create': 'Added a customer group', 'cus.group.update': 'Renamed a customer group',
  'cus.group.deactivate': 'Turned a customer group off', 'cus.person.create': 'Added a wearer', 'cus.person.update': 'Changed a wearer',
  'cus.person.deactivate': 'Turned a wearer off', 'cus.measure.revise': 'Changed measurements', 'cus.measure.deactivate': 'Turned measurements off',
  'cus.size.create': 'Added a size', 'cus.size.deactivate': 'Turned a size off',
  'emp.employee.create': 'Added an employee', 'emp.employee.update': 'Changed an employee', 'emp.employee.separate': 'Recorded an employee leaving',
  'emp.pay_profile.add': 'Changed an employee\'s pay', 'emp.payslip_email': 'Changed an employee\'s payslip email',
  'emp.payout_qr.save': 'Saved an employee\'s pay-out QR code', 'emp.payout_qr.remove': 'Removed an employee\'s pay-out QR code',
  'emp.floor_user': 'Gave an employee a floor sign-in', 'emp.biometric_link': 'Linked a fingerprint user', 'emp.attendance.save': 'Saved attendance',
  'emp.holiday.add': 'Added a holiday', 'emp.holiday.deactivate': 'Took off a holiday', 'emp.holiday.reactivate': 'Put back a holiday',
  'eq.person.create': 'Added a shareholder or officer', 'eq.person.update': 'Changed a shareholder or officer',
  'est.rules': 'Changed the costing rules', 'est.sheet.save': 'Saved a costing sheet',
  'fbk.link': 'Made a rating link', 'fbk.rated': 'The customer rated an order',
  'img.ai.settings': 'Changed the AI picture settings', 'img.ai.run': 'Made a picture with AI',
  'jo.stage': 'A job order moved to a new stage', 'jo.release.received': 'Recorded who received a release',
  'mig.upload': 'Uploaded an import file', 'mig.commit': 'Imported the checked rows', 'mig.clear_staging': 'Cleared an import',
  'mig.row.accept': 'Accepted an import row', 'mig.row.exclude': 'Left out an import row', 'mig.row.fix': 'Fixed an import row',
  'mig.row.merge': 'Merged an import row',
  'olk.link.create': 'Made an order link', 'olk.link.close': 'Closed an order link', 'olk.link.date': 'Changed an order link\'s closing date',
  'olk.answer.sent': 'The customer sent their sizes', 'olk.answer.changed': 'The customer changed their sizes',
  'olk.job_order.start': 'Started a job order from an order link', 'olk.payment.sent': 'The customer sent a payment',
  'olk.payment.accept': 'Accepted an order-link payment', 'olk.payment.not_received': 'Marked an order-link payment not received',
  'pay.gov_loan.register': 'Added a government loan', 'pay.gov_loan.update': 'Changed a government loan', 'pay.gov_loan.stop': 'Stopped a government loan',
  'pay.prior.add': 'Added pay from a previous employer', 'pay.prior.update': 'Changed pay from a previous employer',
  'prd.setup': 'Set up the production steps', 'prd.step': 'Updated a production step', 'prd.step_edit': 'Changed a production step',
  'prd.rework': 'Sent work back to be redone', 'prd.carry_over': 'Carried production over', 'prd.worker_steps': 'Changed what a worker does',
  'prd.floor_scan': 'A worker scanned finished work', 'prd.floor_scan_approve': 'Approved scanned work', 'prd.floor_scan_reject': 'Turned down scanned work',
  'prf.proof.sent': 'Sent a design for approval', 'prf.proof.approved': 'The customer approved the design',
  'prf.proof.changes': 'The customer asked for design changes',
  'prt.print': 'Printed', 'prt.book_print': 'Printed booklets', 'prt.company_profile_edit': 'Changed the company profile',
  'prt.loose_leaf_paper': 'Set up loose-leaf paper',
  'pur.supplier.create': 'Added a supplier', 'pur.supplier.edit': 'Changed a supplier', 'pur.supplier.deactivate': 'Turned a supplier off',
  'pur.supplier.contact.create': 'Added a supplier contact', 'pur.supplier.contact.deactivate': 'Turned a supplier contact off',
  'pur.supply.create': 'Added a supply', 'pur.supply.edit': 'Changed a supply', 'pur.supply.deactivate': 'Turned a supply off',
  'pur.supply.link': 'Linked a supply to a supplier', 'pur.supply.unlink': 'Unlinked a supply from a supplier',
  'pur.request.approved': 'Approved a purchase request', 'pur.request.rejected': 'Turned down a purchase request',
  'rate.add': 'Set a piece rate', 'rate.carry': 'Copied piece rates', 'rate.switch': 'Switched piece rates', 'rate.starters_off': 'Turned off the starting rates',
  'shp.product.create': 'Added a website product', 'shp.product.update': 'Changed a website product', 'shp.product.hide': 'Hid a website product',
  'shp.product.show': 'Showed a website product', 'shp.product.photo': 'Added a product photo', 'shp.product.photo_remove': 'Removed a product photo',
  'shp.category.create': 'Added a website category', 'shp.category.update': 'Changed a website category', 'shp.category.hide': 'Hid a website category',
  'shp.category.show': 'Showed a website category',
  'shp.order.placed': 'The customer placed a website order', 'shp.order.payment_sent': 'The customer sent a payment',
  'shp.order.cancelled_by_customer': 'The customer cancelled their website order', 'shp.order.confirmed': 'Confirmed a website order',
  'shp.order.rejected': 'Turned down a website order\'s payment', 'shp.order.note': 'Added a note to a website order',
  'shp.order.moved': 'Moved a website order', 'shp.order.cancelled': 'Cancelled a website order', 'shp.order.returned': 'Recorded a website order returned',
  'shp.payment.settings': 'Changed the online payment details', 'shp.review.added': 'The customer wrote a review',
  'shp.review.hidden': 'Hid a review', 'shp.review.shown': 'Showed a review', 'shp.season': 'Changed the website\'s season look',
  'shp.season.event.create': 'Added a season event', 'shp.season.event.update': 'Changed a season event',
  'shp.work.create': 'Added a work photo', 'shp.work.put_in': 'Put pieces into the shop', 'shp.work.give_back': 'Gave pieces back',
  'stat.employer_number_set': 'Set an employer number', 'stat.upload_download': 'Downloaded a government upload file',
  'sup.received': 'A website message came in', 'sup.note': 'Added a note to a website message',
  'szr.set.create': 'Added a sizer set', 'szr.set.edit': 'Changed a sizer set', 'szr.set.deactivate': 'Turned a sizer set off',
  'szr.set.recover': 'Put back a sizer set', 'szr.loan.create': 'Lent a sizer set', 'szr.loan.edit': 'Changed a sizer loan', 'szr.loan.return': 'A sizer set came back',
  'tax.2307.received': 'Received a 2307 form', 'tax.booklet.register': 'Registered a receipt booklet', 'tax.booklet.activate': 'Started using a receipt booklet',
  'tax.booklet.retire': 'Retired a receipt booklet', 'tax.filed_return.add': 'Recorded a filed tax return', 'tax.filed_return.void': 'Voided a filed tax return',
  'tax.income_tax_deduction.add': 'Chose the income tax deduction', 'tax.income_tax_settings.add': 'Changed the income tax settings',
  'tax.sale.class': 'Changed a sale\'s tax class',
  'tpl.program.create': 'Added a TPL program', 'tpl.program.change': 'Changed a TPL program', 'tpl.item.create': 'Added a TPL item',
  'tpl.item.change': 'Changed a TPL item', 'tpl.count': 'Counted TPL stock', 'tpl.put_in': 'Put pieces into TPL stock', 'tpl.restock': 'Restocked TPL',
  'tpl.delivery.received': 'Recorded who received a delivery',
};

/** The kind of record, by entity type; document types use their own titles. */
const KINDS: Record<string, string> = {
  user: 'User', role: 'Role', account: 'Account', audit_log: 'Audit log', practice: 'Practice shop', draft: 'Draft',
  cus_customer: 'Customer', cus_phone: 'Customer phone', cus_group: 'Customer group', cus_person: 'Wearer', cus_measure_chart: 'Measurements',
  'emp.employee': 'Employee', 'emp.holiday': 'Holiday', 'emp.attendance': 'Attendance',
  cat_item: 'Catalog item', cat_price: 'Price', quo_line: 'Quotation line',
  pur_suppliers: 'Supplier', 'pur.supplier': 'Supplier', pur_supplies: 'Supply', pur_supplier_contacts: 'Supplier contact',
  'shp.product': 'Website product', 'shp.category': 'Website category', 'shp.order': 'Website order', 'shp.payment': 'Online payment details',
  tpl_item: 'TPL item', tpl_program: 'TPL program', mig_rows: 'Import row', mig_uploads: 'Import file',
  'rate.piece_rate': 'Piece rate', 'rate.garment_type': 'Garment type', alt_return: 'Item brought back',
  'olk.link': 'Order link', 'olk.payment': 'Order-link payment', 'com.outbox': 'Email', 'prd.floor_claim': 'Scanned work',
  'acc.opening': 'Opening balances', 'acc.go_live_decision': 'Go-live question', aia_settings: 'Website chat helper', 'est.rules': 'Costing rules',
  'prt.company_profile': 'Company profile', bak_run: 'Backup', bak_usb: 'USB copy', 'img.ai_run': 'AI picture',
};

/** Field names in plain words; others are spelled out from the code ("payment_terms_days" → "Payment terms days"). */
const FIELDS: Record<string, string> = {
  totalCents: 'Amount', businessDate: 'Date', journalNumber: 'Journal', reversalJournal: 'Reversing journal', followUpJournal: 'Follow-up journal',
  typedOn: 'Typed on', replacesId: 'Replaces', reason: 'Reason', displayName: 'Name', display_name: 'Name', fullName: 'Full name',
  registeredName: 'Registered name', registered_name: 'Registered name', tin: 'TIN', isVatRegistered: 'VAT registered', is_vat_registered: 'VAT registered',
  is_active: 'Active', isActive: 'Active', unitPriceCents: 'Unit price', priceCents: 'Price', rateCents: 'Rate', minQty: 'From quantity',
  effectiveFrom: 'From', qty: 'Quantity', lineNo: 'Line', otMinutes: 'Overtime', ewt_class: 'Withholding class', payment_terms_days: 'Payment terms (days)',
  costCentre: 'Cost centre', hireDate: 'Hire date', separatedOn: 'Left on', fileName: 'File', contentType: 'File type', bytes: 'Size',
  permissionKey: 'Permission', granted: 'Allowed', username: 'Username', roles: 'Roles', stars: 'Stars', receivedBy: 'Received by', receivedOn: 'Received on',
  creditLimitCents: 'Credit limit', termsDays: 'Terms (days)', reorderLevel: 'Reorder level', counted: 'Counted', was: 'Was',
  last_purchase_cost_cents: 'Last cost', overheadBp: 'Overhead', commissionBp: 'Commission', marginBp: 'Margin', roundToCents: 'Round to',
  fromQty: 'From quantity', isMwe: 'Minimum wage earner', workweekDays: 'Days a week', payGroup: 'Pay group', payType: 'Pay type',
  garmentType: 'Garment type', stepCode: 'Step', costCents: 'Cost', ok: 'Worked', copied: 'Files copied', offsite: 'Copied off-site',
  people: 'People', answer: 'Answer', title: 'Title', note: 'Note', from: 'From', to: 'To', files: 'Files', customerName: 'Customer',
  cutoverDate: 'Cut-over date', stepIds: 'Steps', dailyRateCents: 'Daily rate', monthlyRateCents: 'Monthly rate', hourlyRateCents: 'Hourly rate',
};

/** Bookkeeping fields that say nothing to a reader: left out of the details (still in the raw data). */
const QUIET = new Set(['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt', 'version', 'created_by', 'updated_by', 'resolvedAt', 'resolvedBy',
  'legacy_id', 'legacyId', 'sha256', 'attachmentId', 'photoId', 'profileId', 'answerId', 'token', 'edit_hash', 'fields', 'changes', 'before', 'after',
  'fromVersion', 'toVersion', 'resultId', 'releaseId', 'seq']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** "2026-11-10" → "Nov 10, 2026". */
export function dayWords(d: string): string {
  const m = DAY.exec(d);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : d;
}
/** A Manila timestamp ("2026-11-10T16:12:23.986+08:00") → "Nov 10, 2026, 4:12 PM". */
export function whenWords(at: string): string {
  const m = STAMP.exec(at);
  if (!m) return at;
  const h = Number(m[4]);
  return `${dayWords(`${m[1]}-${m[2]}-${m[3]}`)}, ${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`;
}

const spelled = (code: string) => {
  const words = code.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim().toLowerCase()
    .replace(/\b(tin|vat|qr|sss|phic|hdmf|bir|tpl|ewt|id)\b/g, (w) => w.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const fieldName = (key: string) => FIELDS[key] ?? spelled(key.replace(/(_cents|Cents|_bp|Bp|_id|Id|_ms|Ms)$/, ''));
const kindOf = (registry: Registry, type: string) => registry.docType(type)?.title ?? KINDS[type] ?? spelled(type.replace(/^[a-z]+[._]/, ''));

/** Looks up names by id, once per page. */
export function nameBook(db: Db, registry: Registry) {
  const seen = new Map<string, { label: string; href: string | null } | null>();
  const doc = db.prepare('SELECT doc_type AS type, number FROM documents WHERE id = ?');
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').pluck();
  const remember = (key: string, find: () => { label: string; href: string | null } | null) => {
    if (!seen.has(key)) seen.set(key, find());
    return seen.get(key)!;
  };
  const permissions = new Map(registry.permissions().map((p) => [p.key, p.label]));
  const book = {
    permission: (key: string) => permissions.get(key) ?? key,
    document: (id: string) => remember(`d:${id}`, () => {
      const d = doc.get(id) as { type: string; number: string } | undefined;
      return d ? { label: `${kindOf(registry, d.type)} ${d.number}`, href: `/docs/${d.type}/${id}` } : null;
    }),
    user: (id: string) => remember(`u:${id}`, () => { const n = user.get(id) as string | undefined; return n ? { label: n, href: null } : null; }),
    customer: (id: string) => remember(`c:${id}`, () => { const c = customerRef(db, id); return c ? { label: c.display_name, href: null } : null; }),
    employee: (id: string) => remember(`e:${id}`, () => { const e = employee(db, id); return e ? { label: e.name, href: `/emp/employees/${id}` } : null; }),
    item: (id: string) => remember(`i:${id}`, () => { const i = catalogItemRef(db, id); return i ? { label: `${i.code} ${i.name}`, href: null } : null; }),
    /** An id field in an entry's data, by its name; null when it is not one this knows. */
    byField: (key: string, id: string) => {
      const k = key.replace(/(_id|Id)$/, '').toLowerCase();
      if (k === 'customer' || k === 'intocustomer') return book.customer(id);
      if (k === 'employee') return book.employee(id);
      if (k === 'item') return book.item(id);
      if (k === 'user' || k === 'resolvedby' || k === 'decidedby') return book.user(id);
      if (['joborder', 'document', 'replaces', 'from', 'sale', 'release'].includes(k)) return book.document(id);
      return book.document(id) ?? book.customer(id) ?? book.employee(id) ?? null;
    },
  };
  return book;
}
export type NameBook = ReturnType<typeof nameBook>;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function value(key: string, v: unknown, names: NameBook): string | null {
  const s = shown(key, v, names);
  return s !== null && s.length > 400 ? `${s.slice(0, 399)}…` : s;
}
function shown(key: string, v: unknown, names: NameBook): string | null {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    if (/(cents|Cents)$/.test(key)) return formatPeso(v);
    if (/(Bp|_bp)$/.test(key)) return `${v / 100}%`;
    if (/^(is_|is[A-Z])|Consent$|^granted$|^ok$/.test(key) && (v === 0 || v === 1)) return v ? 'Yes' : 'No';
    if (/[mM]inutes$/.test(key)) return `${v} min`;
    if (key === 'bytes') return v >= 1_048_576 ? `${(v / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1024))} KB`;
    return String(v);
  }
  if (typeof v === 'string') {
    if (ID.test(v)) return names.byField(key, v)?.label ?? null;
    if (key === 'permissionKey') return names.permission(v);
    if (DAY.test(v)) return dayWords(v);
    if (STAMP.test(v)) return whenWords(v);
    if (/^[a-z]+(_[a-z0-9]+)+$/.test(v) || /^[A-Z]+(_[A-Z0-9]+)+$/.test(v)) return v.replace(/_/g, ' ').toLowerCase();
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return 'none';
    if (key === 'rates' || key === 'fields') return v.map((x) => fieldName(String(x))).join(', ');
    if (v.every((x) => x === null || typeof x !== 'object')) return v.map((x) => value(key, x, names) ?? '').filter(Boolean).join(', ');
    const shown = v.slice(0, 5).map((x) => inline(x as Record<string, unknown>, names));
    return shown.join('; ') + (v.length > 5 ? `; and ${v.length - 5} more` : '');
  }
  return inline(v as Record<string, unknown>, names);
}

/** An object on one line: "Line: 1 · Rate: ₱50.00". */
function inline(o: Record<string, unknown>, names: NameBook): string {
  return Object.entries(o).filter(([k]) => !QUIET.has(k))
    .map(([k, x]) => { const s = value(k, x, names); return s === null ? null : `${fieldName(k)}: ${s}`; })
    .filter(Boolean).join(' · ');
}

const isPair = (x: unknown): x is { before: unknown; after: unknown } =>
  !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 2 && 'before' in x && 'after' in x;
const plainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function details(action: string, data: Record<string, unknown>, names: NameBook, recordLabel: string | null): Detail[] {
  const out: Detail[] = [];
  const isNew = /\.(create|add)$/.test(action);
  const change = (key: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;
    if (isNew && (before === null || before === undefined)) { const s = value(key, after, names); if (s !== null) out.push({ label: fieldName(key), value: s }); return; }
    out.push({ label: fieldName(key), before: value(key, before, names) ?? '—', after: value(key, after, names) ?? '—' });
  };
  // A whole record before and after: only the fields that changed (a new record: its fields).
  if ('after' in data && (plainObject(data.after) || plainObject(data.before))) {
    const before = plainObject(data.before) ? data.before : {};
    const after = plainObject(data.after) ? data.after : {};
    const fresh = !plainObject(data.before);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (QUIET.has(k)) continue;
      if (fresh) { const s = value(k, after[k], names); if (s !== null && s !== '—') out.push({ label: fieldName(k), value: s }); } else change(k, before[k], after[k]);
    }
  } else if ('after' in data && 'before' in data && !plainObject(data.after)) {
    change(action.endsWith('cutover') ? 'cutoverDate' : action === 'prd.worker_steps' ? 'stepIds' : 'value', data.before, data.after);
  }
  // Changes listed field by field ({ changes: { field: { before, after } } }), and settings changed one by one.
  if (plainObject(data.changes)) for (const [k, p] of Object.entries(data.changes)) if (isPair(p)) change(k, p.before, p.after);
  for (const [k, p] of Object.entries(data)) if (k !== 'changes' && isPair(p)) change(k, p.before, p.after);
  // A period, or a move from one stage to another.
  const period = typeof data.from === 'string' && typeof data.to === 'string' && DAY.test(data.from) && DAY.test(data.to);
  if (period) out.push({ label: 'Period', value: `${dayWords(data.from as string)} to ${dayWords(data.to as string)}` });
  else if (typeof data.from === 'string' && typeof data.to === 'string' && !ID.test(data.from)) {
    out.push({ label: action === 'jo.stage' ? 'Stage' : action === 'shp.order.moved' ? 'Status' : 'Changed', before: value('from', data.from, names) ?? '—', after: value('to', data.to, names) ?? '—' });
  }
  // Fields named but not shown (a person's details stay out of the log): which ones changed.
  if (Array.isArray(data.fields) && data.fields.length && !out.some((d) => d.before !== undefined)) {
    out.push({ label: action.endsWith('create') ? 'Filled in' : 'Fields changed', value: (data.fields as string[]).map(fieldName).join(', ') });
  }
  if (Array.isArray(data.changedFields)) out.push({ label: 'Fields changed', value: (data.changedFields as string[]).map(fieldName).join(', ') });
  // Everything else, as it is.
  for (const [k, v] of Object.entries(data)) {
    if (QUIET.has(k) || k === 'changedFields' || isPair(v)) continue;
    if ((k === 'from' || k === 'to') && typeof data.from === 'string' && typeof data.to === 'string' && !ID.test(data.from)) continue;
    if (k === 'number' && recordLabel?.includes(String(v))) continue;
    if (k === 'name' && recordLabel === v) continue;
    const s = value(k, v, names);
    if (s !== null && s !== '—') out.push({ label: fieldName(k), value: s });
  }
  return out;
}

function recordOf(registry: Registry, names: NameBook, type: string, id: string | null, data: Record<string, unknown>): Readable['record'] {
  const kind = kindOf(registry, type);
  if (id) {
    const d = names.document(id);
    if (d) return d;
  }
  const after = plainObject(data.after) ? data.after : {};
  if (typeof data.number === 'string') return { label: `${kind} ${data.number}`, href: null };
  if (id) {
    const known = type === 'user' ? names.user(id) : type === 'cus_customer' ? names.customer(id) : type === 'emp.employee' ? names.employee(id)
      : type === 'cat_item' ? names.item(id) : null;
    if (known) return { label: `${kind}: ${known.label}`, href: known.href };
  }
  const name = [data.name, after.name, after.displayName, after.display_name, data.title, data.description, after.description, data.garmentType, data.username]
    .find((x) => typeof x === 'string' && x.trim()) as string | undefined;
  if (name) {
    const href = id && (type === 'pur_suppliers' || type === 'pur.supplier') ? `/pur/suppliers/${id}` : id && type === 'tpl_program' ? `/tpl/${id}` : null;
    return { label: `${kind}: ${name}`, href };
  }
  if (type === 'tpl_program' && id) return { label: kind, href: `/tpl/${id}` };
  return { label: kind, href: null };
}

/** One entry in plain words. */
export function readable(registry: Registry, names: NameBook, e: { action: string; entityType: string; entityId: string | null; data: Record<string, unknown> }, moduleNames: Map<string, string>): Readable {
  const record = recordOf(registry, names, e.entityType, e.entityId, e.data);
  const known = ACTIONS[e.action];
  const [mod, ...rest] = e.action.split('.');
  const what = known ?? `${moduleNames.get((mod ?? '').toUpperCase()) ?? spelled(mod ?? '')}: ${spelled(rest.join(' ')).toLowerCase()}`;
  return { what, record, details: details(e.action, e.data, names, record?.label ?? null) };
}

/** Details on one line, for the CSV file. */
export function detailsLine(details: Detail[]): string {
  return details.map((d) => (d.before !== undefined ? `${d.label}: ${d.before} → ${d.after}` : `${d.label}: ${d.value}`)).join('; ');
}
