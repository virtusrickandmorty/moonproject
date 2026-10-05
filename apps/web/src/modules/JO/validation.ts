/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
import { isBusinessDate } from '@moonproject/shared';
export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
export const PAYMENT_TERMS = ['dp50', 'full', 'cod', 'net7', 'net15', 'net30'] as const;
const text = (max: number) => z.string().trim().min(1).max(max);

const rosterRow = z
  .object({
    personId: z.uuid().optional(), // a wearer of this customer, or
    name: text(120).optional(), // a one-off name
    sizeMode: z.enum(['preset', 'measured']),
    size: text(20).optional(),
    jerseyName: text(40).optional(),
    jerseyNumber: text(10).optional(),
    qty: z.number().int().min(1).max(1000),
    notes: text(200).optional(),
  })
  .strict();

export const lineInput = z
  .object({
    kind: z.enum(['made_to_order', 'service', 'ready_made']),
    description: text(200),
    qty: z.number().int().min(1).max(10_000), // with the price cap, 50 lines stay a safe integer
    unitPriceCents: z.number().int().min(0).max(MAX_CENTS), // VAT-inclusive
    discountCents: z.number().int().min(0).max(MAX_CENTS),
    roster: z.array(rosterRow).max(1000),
  })
  .strict();

export const jobOrderInput = z
  .object({
    customerId: z.uuid(),
    contact: text(200).optional(),
    dueInDays: z.number().int().min(1).max(365).default(15), // the server turns this into the due date (NR-6)
    priority: z.enum(['normal', 'rush']),
    paymentTerms: z.enum(PAYMENT_TERMS),
    notes: text(1000).optional(),
    lines: z.array(lineInput).min(1).max(50),
  })
  .strict();
const date = z.string().refine(isBusinessDate, 'Use a date like 2026-09-28.').refine((d) => d >= '2000-01-01', 'Check the year.');

export const openingJobOrderInput = z
  .object({
    customerId: z.uuid(),
    oldNumber: text(40), // the job order number in the old records
    contact: text(200).optional(),
    dueDate: date, // as promised in the old records; it may already be past
    priority: z.enum(['normal', 'rush']),
    paymentTerms: z.enum(PAYMENT_TERMS),
    notes: text(1000).optional(),
    lines: z.array(lineInput).max(50), // the part not yet released; none when all of it went out
    depositsCents: z.number().int().min(0).max(MAX_CENTS), // paid on it and not yet applied to an invoice
    depositsMemo: text(200).optional(), // the old receipt numbers
    receivableCents: z.number().int().min(0).max(MAX_CENTS), // released and invoiced, not yet paid
    oldInvoices: text(200).optional(), // the old invoice numbers of the receivable
  })
  .strict();
export const releaseInput = z
  .object({
    jobOrderId: z.uuid(),
    lines: z.array(z.object({ lineNo: z.number().int().min(1).max(50), qty: z.number().int().min(1).max(10_000) }).strict()).min(1).max(50),
    claimedBy: text(120),
    idSeen: z.enum(['government_id', 'school_id', 'company_id', 'other_id', 'none']), // the type only; no ID number is stored
    creditNote: text(500).optional(), // needed when a balance is still due (E4 rule 3)
    creditDueInDays: z.number().int().min(1).max(365).optional(), // the server turns this into the credit due date (NR-6)
    overrideReason: z.string().trim().min(10).max(500).optional(), // owner: release before the job is ready (E4 rule 2)
  })
  .strict();
export const invoiceRecordInput = z
  .object({
    releaseId: z.uuid(),
    // Typed from the booklet, never prefilled; checked against the ATP booklet register (TAX, D7).
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const dpInvoiceInput = z
  .object({
    jobOrderId: z.uuid(),
    // Typed from the booklet, never prefilled; checked against the ATP booklet register (TAX, D7).
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
    amountCents: z.number().int().positive().max(MAX_CENTS), // the downpayment, VAT-inclusive
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
