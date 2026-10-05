/**
 * The job order, release slip and invoice record forms (PLAN E4, D3): what staff type -> the server's input, and back for
 * an edit; the buttons on the job order's view; what the collection form starts with for a job order. Pure, so it is
 * tested without a browser; the server works out every figure and checks everything again.
 */
import { formatPesos } from '@moonproject/shared';
import type { BookletFigures, BookletShown, CatItem, DpInfo, JoDepositVat, JoStatus, WearerPick } from '../../api.ts';
import type { jobOrderPrefill } from '../QUO/quotation.ts';
import { cents } from '../COL/money.ts';
import type { Kind } from '../QS/lines.ts';
import type { Terms } from './opening.ts';

/* ---------- Job order ---------- */

/** One wearer on a line: a wearer of the customer (personId) or a one-off name typed in. */
export interface RosterEdit { personId: string; name: string; sizeMode: 'preset' | 'measured'; size: string; jerseyName: string; jerseyNumber: string; qty: string }
/** A line; `listCents` is the price list's tier price for the quantity (null when not from the price list). */
export interface JoLineRow { itemId: string; kind: Kind; description: string; qty: string; price: string; listCents: number | null; discount: string; roster: RosterEdit[] }
export interface JoValues {
  customer: { id: string; name: string } | null;
  contact: string; dueInDays: string; priority: 'normal' | 'rush'; paymentTerms: Terms | ''; notes: string; lines: JoLineRow[];
}
export interface RosterInput { personId?: string; name?: string; sizeMode: 'preset' | 'measured'; size?: string; jerseyName?: string; jerseyNumber?: string; qty: number }
export interface JoLineInput { kind: Kind; description: string; qty: number; unitPriceCents: number; discountCents: number; roster: RosterInput[] }
export interface JoInput { customerId: string; contact?: string; dueInDays: number; priority: 'normal' | 'rush'; paymentTerms: Terms; notes?: string; lines: JoLineInput[] }
/** What GET /api/docs/jo.job_order/:id keeps beside the input: the names shown for listed wearers. */
export interface JoDoc { customerName: string; lines: { roster: { wearerName: string }[] }[] }

export const emptyJoLine = (): JoLineRow => ({ itemId: '', kind: 'made_to_order', description: '', qty: '1', price: '', listCents: null, discount: '', roster: [] });
export const emptyJo = (): JoValues => ({ customer: null, contact: '', dueInDays: '15', priority: 'normal', paymentTerms: '', notes: '', lines: [emptyJoLine()] });
export const oneOff = (name = ''): RosterEdit => ({ personId: '', name, sizeMode: 'preset', size: '', jerseyName: '', jerseyNumber: '', qty: '1' });

/** A wearer of the customer on a roster row, with the size and jersey on file (a measured wearer's chart is linked by the server). */
export const fromWearer = (w: WearerPick): RosterEdit => ({
  personId: w.personId, name: w.wearerName, sizeMode: w.sizeMode, size: w.size ?? '', jerseyName: w.jerseyName ?? '', jerseyNumber: w.jerseyNumber ?? '', qty: '1',
});

/** The catalog item's class -> the kind of line (sales account and production). */
export const KIND_OF_CLASS: Record<CatItem['class'], Kind> = { made_to_order_garment: 'made_to_order', service: 'service', ready_made_item: 'ready_made' };

const pieceCount = (roster: RosterEdit[]) => roster.reduce((s, r) => s + (Number.isInteger(Number(r.qty)) && Number(r.qty) >= 1 && Number(r.qty) <= 1000 ? Number(r.qty) : 0), 0);
/** A line's quantity: its roster's pieces when it has a roster (the server wants them equal), else what was typed. */
export const lineQty = (l: JoLineRow) => (l.roster.length > 0 ? String(pieceCount(l.roster)) : l.qty);
/** The price was changed from the price list's tier price. */
export const priceChanged = (l: JoLineRow) => l.listCents !== null && cents(l.price) !== l.listCents;
const blankLine = (l: JoLineRow) => !l.itemId && !l.description.trim() && !l.price.trim() && !l.discount.trim() && l.roster.length === 0;
const optional = (key: string, text: string) => (text.trim() ? { [key]: text.trim() } : {});

/** Typed values -> input, the total so far, and what to fix first. Blank lines are left out. */
export function joInput(v: JoValues): { input: JoInput; totalCents: number; errors: string[] } {
  const errors: string[] = [];
  if (!v.customer) errors.push('Pick the customer.');
  const days = v.dueInDays.trim();
  if (!(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) errors.push('Due in: type the number of days, 1 to 365.');
  if (!v.paymentTerms) errors.push('Pick the payment terms.');
  const lines: JoLineInput[] = [];
  v.lines.forEach((l, i) => {
    if (blankLine(l)) return;
    const at = `Line ${i + 1}`;
    const before = errors.length;
    const qty = lineQty(l);
    const [price, discount] = [cents(l.price), cents(l.discount)];
    if (!l.description.trim()) errors.push(`${at}: pick an item from the price list or say what is made.`);
    if (!(Number.isInteger(Number(qty)) && Number(qty) >= 1 && Number(qty) <= 10_000)) errors.push(`${at}: the quantity must be a whole number like 1 or 20.`);
    if (price === undefined || discount === undefined || price < 0 || discount < 0) errors.push(`${at}: type amounts like 450.00`);
    const roster: RosterInput[] = [];
    l.roster.forEach((r, j) => {
      const who = r.name.trim() || `row ${j + 1}`;
      if (!r.personId && !r.name.trim()) errors.push(`${at}, row ${j + 1}: pick a wearer or type a name.`);
      if (!(Number.isInteger(Number(r.qty)) && Number(r.qty) >= 1 && Number(r.qty) <= 1000)) errors.push(`${at}, ${who}: the quantity must be a whole number like 1 or 2.`);
      if (r.sizeMode === 'preset' && !r.size.trim()) errors.push(`${at}, ${who}: pick a size.`);
      roster.push({
        ...(r.personId ? { personId: r.personId } : { name: r.name.trim() }),
        sizeMode: r.sizeMode,
        ...(r.sizeMode === 'preset' ? optional('size', r.size.toUpperCase()) : {}),
        ...optional('jerseyName', r.jerseyName.toUpperCase()),
        ...optional('jerseyNumber', r.jerseyNumber),
        qty: Number(r.qty),
      });
    });
    if (errors.length === before) lines.push({ kind: l.kind, description: l.description.trim(), qty: Number(qty), unitPriceCents: price!, discountCents: discount!, roster });
  });
  if (v.lines.every(blankLine)) errors.push('Add at least one line.');
  const input: JoInput = {
    customerId: v.customer?.id ?? '',
    ...optional('contact', v.contact),
    dueInDays: Number(days) || 15,
    priority: v.priority,
    paymentTerms: (v.paymentTerms || 'dp50') as Terms,
    ...optional('notes', v.notes),
    lines,
  };
  return { input, totalCents: lines.reduce((s, l) => s + l.qty * l.unitPriceCents - l.discountCents, 0), errors };
}

/** A recorded job order's input (and the names kept beside it) -> typed values, for its Edit. */
export function joValues(i: JoInput, doc?: JoDoc): JoValues {
  return {
    customer: { id: i.customerId, name: doc?.customerName ?? 'Customer on file' },
    contact: i.contact ?? '',
    dueInDays: String(i.dueInDays),
    priority: i.priority,
    paymentTerms: i.paymentTerms,
    notes: i.notes ?? '',
    lines: i.lines.map((l, n) => ({
      itemId: '',
      kind: l.kind,
      description: l.description,
      qty: String(l.qty),
      price: formatPesos(l.unitPriceCents),
      listCents: null,
      discount: l.discountCents ? formatPesos(l.discountCents) : '',
      roster: l.roster.map((r, j) => ({
        personId: r.personId ?? '',
        name: r.name ?? doc?.lines[n]?.roster[j]?.wearerName ?? '',
        sizeMode: r.sizeMode,
        size: r.size ?? '',
        jerseyName: r.jerseyName ?? '',
        jerseyNumber: r.jerseyNumber ?? '',
        qty: String(r.qty),
      })),
    })),
  };
}

/** What `jobOrderPrefill` (QUO) makes from a quotation: the customer, the lines as quoted and the quotation number in the notes. */
export type QuotationPrefill = NonNullable<ReturnType<typeof jobOrderPrefill>>;

/**
 * "Make a job order" (PLAN E3): the form's starting values from a quotation. The customer, the lines with quantities and
 * prices as quoted and the quotation number in the notes are filled; staff still choose the due days and the payment terms
 * and may change anything before recording. The price is the quoted one (no list tier price is looked up over it).
 */
export function valuesFromQuotation(p: QuotationPrefill, customerName: string): JoValues {
  return {
    ...emptyJo(),
    customer: { id: p.customerId, name: customerName },
    contact: p.contact ?? '',
    notes: p.notes,
    lines: p.lines.map((l) => ({
      ...emptyJoLine(), kind: l.kind, description: l.description, qty: String(l.qty), price: formatPesos(l.unitPriceCents), discount: l.discountCents ? formatPesos(l.discountCents) : '',
    })),
  };
}

/* ---------- Release slip ---------- */

export const ID_SEEN = [
  ['government_id', 'Government ID'],
  ['school_id', 'School ID'],
  ['company_id', 'Company ID'],
  ['other_id', 'Another ID'],
  ['none', 'No ID'],
] as const;
export type IdSeen = (typeof ID_SEEN)[number][0];

export interface ReleaseValues {
  jobOrderId: string;
  /** Pieces to release, by line number. */
  qtys: Record<number, string>;
  claimedBy: string; idSeen: IdSeen | ''; creditNote: string; creditDueInDays: string; overrideReason: string;
  invoiceNumber: string; invoiceToFollow: boolean; invoiceNote: string;
}
export const emptyRelease = (jobOrderId = ''): ReleaseValues => ({
  jobOrderId, qtys: {}, claimedBy: '', idSeen: '', creditNote: '', creditDueInDays: '', overrideReason: '', invoiceNumber: '', invoiceToFollow: false, invoiceNote: '',
});
/** Everything left on each line, ticked. */
export const allLeft = (lines: JoStatus['lines']): Record<number, string> => Object.fromEntries(lines.filter((l) => l.leftQty > 0).map((l) => [l.lineNo, String(l.leftQty)]));

export interface ReleaseInput { jobOrderId: string; lines: { lineNo: number; qty: number }[]; claimedBy: string; idSeen: IdSeen; creditNote?: string; creditDueInDays?: number; overrideReason?: string }

/**
 * Typed values -> the release, its invoice (null = invoice to follow), and what to fix first (`releaseErrors`: the release
 * itself, enough for its preview). Only what is left can be released.
 */
export function releaseInput(v: ReleaseValues, left: JoStatus['lines']): { release: ReleaseInput; invoice: { invoiceNumber: string; note?: string } | null; errors: string[]; releaseErrors: string[] } {
  const errors: string[] = [];
  if (!v.jobOrderId) errors.push('Pick the job order.');
  const lines: { lineNo: number; qty: number }[] = [];
  for (const l of left) {
    const typed = (v.qtys[l.lineNo] ?? '').trim();
    if (!typed || typed === '0') continue;
    if (!(Number.isInteger(Number(typed)) && Number(typed) >= 1 && Number(typed) <= 10_000)) errors.push(`Line ${l.lineNo}: type the pieces as a whole number.`);
    else if (Number(typed) > l.leftQty) errors.push(l.leftQty > 0 ? `Line ${l.lineNo}: only ${l.leftQty} of ${l.qty} pieces are left to release.` : `Line ${l.lineNo} is already fully released.`);
    else lines.push({ lineNo: l.lineNo, qty: Number(typed) });
  }
  if (v.jobOrderId && lines.length === 0 && errors.length === 0) errors.push('Tick the lines and pieces going out.');
  if (!v.claimedBy.trim()) errors.push('Type who claimed it.');
  if (!v.idSeen) errors.push('Pick the ID seen.');
  const days = v.creditDueInDays.trim();
  if (days && (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 365)) errors.push('Pay within: type the number of days, 1 to 365.');
  const releaseErrors = [...errors];
  if (!v.invoiceToFollow && !/^\d+$/.test(v.invoiceNumber.trim())) errors.push('Type the invoice number from the booklet (digits only), or tick "Invoice to follow".');
  const release: ReleaseInput = {
    jobOrderId: v.jobOrderId,
    lines,
    claimedBy: v.claimedBy.trim(),
    idSeen: (v.idSeen || 'none') as IdSeen,
    ...optional('creditNote', v.creditNote),
    ...(days && Number(days) >= 1 ? { creditDueInDays: Number(days) } : {}),
    ...optional('overrideReason', v.overrideReason),
  };
  const invoice = v.invoiceToFollow ? null : { invoiceNumber: v.invoiceNumber.trim(), ...optional('note', v.invoiceNote) };
  return { release, invoice, errors, releaseErrors };
}

/* ---------- Invoice record ---------- */

export function invoiceInput(v: { releaseId: string; invoiceNumber: string; note: string }): { input: { releaseId: string; invoiceNumber: string; note?: string }; errors: string[] } {
  const errors: string[] = [];
  if (!v.releaseId) errors.push('Pick the release by its number.');
  if (!/^\d+$/.test(v.invoiceNumber.trim())) errors.push('Type the invoice number from the booklet (digits only).');
  return { input: { releaseId: v.releaseId, invoiceNumber: v.invoiceNumber.trim(), ...optional('note', v.note) }, errors };
}

/* ---------- Downpayment invoice (mode C) ---------- */

/** What the downpayment invoice form fills from its preview: the invoice's own figures. */
export interface DpPreviewDoc { amountCents: number; vatableSalesCents: number; vatCents: number; depositAppliedCents: number; mode: 'A' | 'B' | 'C' }

export function dpInvoiceInput(v: { jobOrderId: string; invoiceNumber: string; amount: string; note: string }): { input: { jobOrderId: string; invoiceNumber: string; amountCents: number; note?: string }; errors: string[] } {
  const errors: string[] = [];
  if (!v.jobOrderId) errors.push('Pick the job order by its number or customer.');
  if (!/^\d+$/.test(v.invoiceNumber.trim())) errors.push('Type the invoice number from the booklet (digits only).');
  const amount = cents(v.amount);
  if (amount === undefined || amount <= 0) errors.push('Type the downpayment as an amount like 3,000.00');
  return { input: { jobOrderId: v.jobOrderId, invoiceNumber: v.invoiceNumber.trim(), amountCents: amount ?? 0, ...optional('note', v.note) }, errors };
}

/** The amount the form starts with: the downpayment asked less what is already invoiced, never more than the job order has left to invoice. */
export const dpStartCents = (i: Pick<DpInfo, 'requiredDownpaymentCents' | 'dpInvoicedCents' | 'notInvoicedCents'>) =>
  Math.max(0, Math.min(i.requiredDownpaymentCents - i.dpInvoicedCents, i.notInvoicedCents));

/** The money already held that the invoice applies, and what is left to collect (the invoice less that). */
export const dpSplit = (amountCents: number, depositAppliedCents: number) => ({ appliedCents: depositAppliedCents, leftToCollectCents: Math.max(0, amountCents - depositAppliedCents) });

/** "Write these on the booklet" for a downpayment invoice: the whole amount, VATable sales and VAT. */
export const dpBooklet = (d: DpPreviewDoc): BookletShown => ({ grossCents: d.amountCents, vatableSalesCents: d.vatableSalesCents, vatCents: d.vatCents });

/** The mode in words, as the job order view and the forms say it: "Mode C: invoice on downpayment". */
export const modeText = (d: Pick<JoDepositVat, 'mode' | 'words'>) => `Mode ${d.mode}: ${d.words}`;

/** An invoice record's own figures (its preview or stored document) as the booklet shows them: in mode C the sale less the downpayments invoiced. */
export function invoiceBooklet(d: { vatRateBp: number; listCents: number; discountCents: number; dpAppliedCents: number; depositVatMode: 'A' | 'B' | 'C'; depositVatCents: number;
  booklet: { grossCents: number; vatableSalesCents: number; vatCents: number } }): BookletFigures {
  return { vatRateBp: d.vatRateBp, listCents: d.listCents, discountCents: d.discountCents, ...d.booklet, downpaymentsInvoicedCents: d.dpAppliedCents, depositVatMode: d.depositVatMode, depositVatCents: d.depositVatCents };
}

/* ---------- From the job order's view ---------- */

export interface JoAction { label: string; to: string; primary?: boolean }
/** What the user may start from a job order's view (doc types they may create). */
export interface JoCan { collect: boolean; release: boolean; invoice: boolean; dpInvoice?: boolean }

/** Downpayments invoiced on the job order so far (recorded invoices only). */
export const dpInvoicedCents = (s: Pick<JoStatus, 'dpInvoices'>) => s.dpInvoices.filter((i) => i.status === 'posted').reduce((sum, i) => sum + i.amountCents, 0);

/** The buttons on a recorded job order's view, each opening its form already filled for this job order. */
export function joActions(s: JoStatus, can: JoCan): JoAction[] {
  if (s.jobOrder.status !== 'posted') return [];
  const id = encodeURIComponent(s.jobOrder.id);
  const m = s.money;
  const out: JoAction[] = [];
  if (can.collect && m.balanceDueCents > 0) {
    if (m.requiredDownpaymentCents > m.collectedCents) {
      // Mode C: the downpayment is invoiced on the booklet first; the collection form follows (until the downpayment is invoiced, then it opens directly).
      const invoiceFirst = !!can.dpInvoice && s.depositVat.mode === 'C' && dpInvoicedCents(s) < m.requiredDownpaymentCents;
      out.push({ label: 'Take the downpayment', to: invoiceFirst ? `/docs/jo.dp_invoice/new?jo=${id}` : `/docs/col.collection/new?jo=${id}&for=downpayment`, primary: true });
    }
    out.push({ label: 'Take a payment', to: `/docs/col.collection/new?jo=${id}` });
  }
  if (can.release && s.lines.some((l) => l.leftQty > 0)) out.push({ label: 'Release', to: `/docs/jo.release/new?jo=${id}` });
  if (can.invoice && s.awaitingInvoice.length > 0) {
    const one = s.awaitingInvoice.length === 1 ? `release=${encodeURIComponent(s.awaitingInvoice[0]!.id)}` : `jo=${id}`;
    out.push({ label: 'Record invoice', to: `/docs/jo.invoice_record/new?${one}` });
  }
  return out;
}

/** What the collection form starts with for a job order: its customer, and the downpayment still asked or the balance due. */
export function collectionPreset(s: JoStatus, forDownpayment: boolean): { customer: { id: string; name: string }; key: string; cents: number } {
  const m = s.money;
  const dp = Math.min(m.balanceDueCents, Math.max(0, m.requiredDownpaymentCents - m.collectedCents));
  return {
    customer: { id: s.jobOrder.customerId, name: s.jobOrder.customerName },
    key: `jo:${s.jobOrder.id}`,
    cents: Math.max(0, forDownpayment && dp > 0 ? dp : m.balanceDueCents),
  };
}
