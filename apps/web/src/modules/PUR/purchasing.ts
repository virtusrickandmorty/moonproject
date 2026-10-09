/**
 * Rules of the supplier, supplies, purchase order and receiving screens: typed fields -> server input, the search
 * filter and what is still to receive. Pure, so they are tested without a browser. The server works out every total and
 * checks everything again (dates, active suppliers and supplies, over-receiving).
 */
import { formatPesos, isBusinessDate } from '@moonproject/shared';
import type { ContactBody, PoLineStatus, PoStatus, SupplierBody, SupplierRecord, SupplyBody, SupplyRecord, SupplyUnit } from '../../api.ts';
import { cents } from '../COL/money.ts';

export { EWT_WORDS, ewtLabel } from '../AP/payables.ts';

export const UNIT_WORDS: Record<SupplyUnit, string> = { yard: 'Yard', meter: 'Meter', kg: 'Kilogram', liter: 'Liter', roll: 'Roll', pc: 'Piece' };
export const CATEGORY_WORDS = { materials: 'Materials', ready_made: 'Ready-made merchandise' } as const;
const MAX_QTY = 1_000_000;

/** The supplier's fields as typed. `ewtClass` '' is no usual EWT. */
export interface SupplierForm {
  name: string; registeredName: string; tin: string; isVatRegistered: boolean; ewtClass: string; swornDeclarationUntil: string; paymentTermsDays: string; legacyId: string;
}
export const emptySupplierForm = (): SupplierForm => ({ name: '', registeredName: '', tin: '', isVatRegistered: false, ewtClass: '', swornDeclarationUntil: '', paymentTermsDays: '', legacyId: '' });

export const supplierToForm = (s: SupplierRecord): SupplierForm => ({
  name: s.name, registeredName: s.registered_name, tin: s.tin ?? '', isVatRegistered: s.is_vat_registered === 1, ewtClass: s.ewt_class ?? '',
  swornDeclarationUntil: s.sworn_declaration_until ?? '', paymentTermsDays: s.payment_terms_days === null ? '' : String(s.payment_terms_days), legacyId: s.legacy_id ?? '',
});

/** The BIR's TIN shape, as the server takes it: 000-000-000-000, with an optional 2-digit branch code. */
export const TIN_PATTERN = /^\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?$/;
/** The professional-fee classes ask for a sworn declaration (valid until a date) to use the lower rate. */
export const needsSwornDeclaration = (ewtClass: string) => ewtClass === 'prof_ind_5';

export function supplierToInput(f: SupplierForm): { input: SupplierBody; errors: string[] } {
  const errors: string[] = [];
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  if (!f.name.trim()) errors.push('Type the supplier’s name.');
  if (!f.registeredName.trim()) errors.push('Type the name the supplier is registered under (as on its receipts).');
  if (f.tin.trim() && !TIN_PATTERN.test(f.tin.trim())) errors.push('The TIN looks like 123-456-789-000 (with 2 more digits for a branch).');
  if (f.swornDeclarationUntil.trim() && !isBusinessDate(f.swornDeclarationUntil.trim())) errors.push('Pick a real date for the sworn declaration.');
  if (needsSwornDeclaration(f.ewtClass) && !f.swornDeclarationUntil.trim()) errors.push('The 5% professional rate needs the date the sworn declaration is valid until.');
  const terms = f.paymentTermsDays.trim();
  if (terms && !/^\d{1,4}$/.test(terms)) errors.push('Payment terms are a whole number of days, like 30.');
  return {
    errors,
    input: {
      name: f.name.trim(), registeredName: f.registeredName.trim(), tin: opt(f.tin), isVatRegistered: f.isVatRegistered, ewtClass: f.ewtClass || null,
      swornDeclarationUntil: opt(f.swornDeclarationUntil), paymentTermsDays: terms && /^\d{1,4}$/.test(terms) ? Number(terms) : null, legacyId: opt(f.legacyId),
    },
  };
}

/** Search a supplier by name, registered name or TIN (any part, any case). */
export function filterSuppliers(rows: SupplierRecord[], search: string): SupplierRecord[] {
  const q = search.trim().toLowerCase();
  return q ? rows.filter((r) => [r.name, r.registered_name, r.tin ?? ''].some((v) => v.toLowerCase().includes(q))) : rows;
}
export function filterSupplies(rows: SupplyRecord[], search: string): SupplyRecord[] {
  const q = search.trim().toLowerCase();
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
}

export interface ContactForm { name: string; role: string; phone: string; email: string }
export const emptyContactForm = (): ContactForm => ({ name: '', role: '', phone: '', email: '' });
export function contactToInput(f: ContactForm): { input: ContactBody; errors: string[] } {
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  const errors = f.name.trim() ? [] : ['Type the contact’s name.'];
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.push('That email address does not look right.');
  return { errors, input: { name: f.name.trim(), role: opt(f.role), phone: opt(f.phone), email: opt(f.email) } };
}

export interface SupplyForm { name: string; unit: SupplyUnit; category: 'materials' | 'ready_made' }
export const emptySupplyForm = (): SupplyForm => ({ name: '', unit: 'yard', category: 'materials' });
export const supplyToForm = (s: SupplyRecord): SupplyForm => ({ name: s.name, unit: s.unit, category: s.category });
export const supplyToInput = (f: SupplyForm): { input: SupplyBody; errors: string[] } => ({
  input: { name: f.name.trim(), unit: f.unit, category: f.category }, errors: f.name.trim() ? [] : ['Type the supply’s name.'],
});

/** A purchase order line as typed: the supply picked by name, whole units, and the cost of one unit in pesos. */
export interface PoRow { supplyId: string; qty: string; unitCost: string }
export const emptyPoRow = (): PoRow => ({ supplyId: '', qty: '', unitCost: '' });
const blank = (r: PoRow) => !r.supplyId && !r.qty.trim() && !r.unitCost.trim();

/** A row's total in centavos; undefined while the quantity or cost cannot be read. */
export function poRowTotal(r: PoRow): number | undefined {
  const qty = wholeQty(r.qty);
  const unit = cents(r.unitCost);
  return qty === undefined || unit === undefined ? undefined : qty * unit;
}

/** Whole units above zero, or undefined. */
export function wholeQty(text: string): number | undefined {
  const t = text.trim();
  if (!/^\d{1,7}$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 && n <= MAX_QTY ? n : undefined;
}

export function poToInput(supplierId: string, expectedDate: string, rows: PoRow[]): {
  input: { supplierId: string; expectedDate?: string; lines: { supplyId: string; qty: number; unitCostCents: number }[] }; errors: string[];
} {
  const errors: string[] = [];
  if (!supplierId) errors.push('Pick the supplier.');
  if (expectedDate.trim() && !isBusinessDate(expectedDate.trim())) errors.push('Pick a real expected date, or leave it empty.');
  const lines: { supplyId: string; qty: number; unitCostCents: number }[] = [];
  rows.forEach((r, i) => {
    if (blank(r)) return;
    const n = `Line ${i + 1}:`;
    const qty = wholeQty(r.qty);
    const unit = cents(r.unitCost);
    if (!r.supplyId) errors.push(`${n} pick the supply.`);
    if (qty === undefined) errors.push(`${n} type the quantity as a whole number, like 12.`);
    if (unit === undefined) errors.push(`${n} type the cost of one unit like 150.00 (or leave it empty for zero).`);
    if (r.supplyId && qty !== undefined && unit !== undefined) lines.push({ supplyId: r.supplyId, qty, unitCostCents: unit });
  });
  if (lines.length === 0 && errors.length === 0) errors.push('Add at least one supply to the order.');
  return { errors, input: { supplierId, ...(expectedDate.trim() ? { expectedDate: expectedDate.trim() } : {}), lines } };
}

/** The rows of a recorded order, for Edit. */
export const poRows = (lines: { supplyId: string; qty: number; unitCostCents: number }[]): PoRow[] =>
  lines.map((l) => ({ supplyId: l.supplyId, qty: String(l.qty), unitCost: formatPesos(l.unitCostCents) }));

/** A receiving line: one purchase order line with what is still to receive, and the quantity typed now. */
export interface RrRow { poLineNo: number; supplyName: string; unit: SupplyUnit; ordered: number; received: number; remaining: number; qty: string }

/**
 * The receiving rows of a purchase order. `previous` is the quantity of each line on the receiving report being
 * replaced (Edit): the report is cancelled when the replacement is recorded, so it no longer counts as received.
 */
export function rrRows(po: Pick<PoStatus, 'lines'>, previous: Record<number, number> = {}): RrRow[] {
  return po.lines.map((l: PoLineStatus) => {
    const received = Math.max(0, l.receivedQty - (previous[l.lineNo] ?? 0));
    return {
      poLineNo: l.lineNo, supplyName: l.supplyName, unit: l.unit, ordered: l.orderedQty, received, remaining: Math.max(0, l.orderedQty - received),
      qty: previous[l.lineNo] ? String(previous[l.lineNo]) : '',
    };
  });
}

/** Receive everything that is left on every line. */
export const receiveAllLeft = (rows: RrRow[]): RrRow[] => rows.map((r) => ({ ...r, qty: r.remaining > 0 ? String(r.remaining) : r.qty }));

/** How much more than ordered a typed quantity would make the line's total received (0 when within the order). */
export function overReceived(r: RrRow): number {
  const qty = wholeQty(r.qty);
  return qty === undefined ? 0 : Math.max(0, r.received + qty - r.ordered);
}

export function rrToInput(poDocumentId: string, rows: RrRow[]): { input: { poDocumentId: string; lines: { poLineNo: number; qty: number }[] }; errors: string[] } {
  const errors: string[] = [];
  const lines: { poLineNo: number; qty: number }[] = [];
  if (!poDocumentId) errors.push('Pick the purchase order the goods came for.');
  rows.forEach((r) => {
    if (!r.qty.trim()) return;
    const qty = wholeQty(r.qty);
    if (qty === undefined) errors.push(`${r.supplyName}: type the quantity received as a whole number, like 5.`);
    else lines.push({ poLineNo: r.poLineNo, qty });
  });
  if (poDocumentId && lines.length === 0 && errors.length === 0) errors.push('Type the quantity received on at least one line.');
  return { errors, input: { poDocumentId, lines } };
}

const UNIT_NOUNS: Record<SupplyUnit, [one: string, many: string]> = { yard: ['yard', 'yards'], meter: ['meter', 'meters'], kg: ['kg', 'kg'], liter: ['liter', 'liters'], roll: ['roll', 'rolls'], pc: ['piece', 'pieces'] };
/** "1 yard", "12 yards": a quantity with its unit. */
export const qtyWords = (qty: number, unit: SupplyUnit) => `${qty} ${UNIT_NOUNS[unit][qty === 1 ? 0 : 1]}`;
