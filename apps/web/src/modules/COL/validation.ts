/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
import { isBusinessDate } from '@moonproject/shared';
export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit

/** One cash place and the amount that went into it (or came out of it, for a refund). */
export const tenderInput = z
  .object({
    cashPlaceId: z.number().int().positive(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    reference: z.string().trim().min(1).max(80).optional(), // GCash or bank reference, or check number and bank
  })
  .strict();
export const checkDetails = z
  .object({
    number: z.string().trim().regex(/^[0-9A-Za-z-]{1,20}$/, 'Type the check number as printed on the check.'),
    bank: z.string().trim().min(2).max(60),
    date: z.string().refine(isBusinessDate, 'Type the date on the check, like 2026-09-30.'),
  })
  .strict();
export const collectionTenderInput = tenderInput.extend({ check: checkDetails.optional() }).strict();
const application = z.object({ jobOrderId: z.uuid(), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();
/** A quick sale paid (QS invoice record): what is still owed on it is its receivable, named by the sale (journal ref). */
const saleApplication = z.object({ saleId: z.uuid(), amountCents: z.number().int().positive().max(MAX_CENTS) }).strict();

export const collectionInput = z
  .object({
    customerId: z.uuid(),
    // Typed from the ATP CR booklet, never prefilled (ACC-03 booklet mode).
    crNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the CR (digits only).'),
    applications: z.array(application).max(50),
    sales: z.array(saleApplication).min(1).max(20).optional(),
    tenders: z.array(collectionTenderInput).min(1).max(10),
    withholding: z
      .object({
        cwtCents: z.number().int().positive().max(MAX_CENTS),
        atc: z.enum(['WC158', 'WC160', 'other']),
        certificate: z.enum(['pending', 'received']),
        vatWithheldCents: z.number().int().positive().max(MAX_CENTS).optional(), // government buyers, on the same 2307 (D4.6)
      })
      .strict()
      .optional(),
    settleSmallDifference: z.boolean().optional(), // a difference up to ₱1.00 goes to cash short and over (D4.9)
    note: z.string().trim().min(1).max(500).optional(),
    postDatedCheckId: z.uuid().optional(), // recorded from the post-dated checks list on the check's date (ACC-23)
  })
  .strict();
export const refundInput = z
  .object({
    customerId: z.uuid(),
    jobOrderId: z.uuid().optional(), // the JO whose deposit is paid back; left out = the customer's unapplied payments
    tenders: z.array(tenderInput).min(1).max(5), // where the money came from
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const depositTransferInput = z
  .object({
    customerId: z.uuid(),
    fromJobOrderId: z.uuid().optional(), // the JO whose deposits move; left out = the customer's unapplied payments
    toJobOrderId: z.uuid(),
    amountCents: z.number().int().positive().max(MAX_CENTS),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const cwtOnlyInput = z
  .object({
    invoiceId: z.uuid(),
    cwtCents: z.number().int().positive().max(MAX_CENTS),
    atc: z.enum(['WC158', 'WC160', 'other']),
    periodYear: z.number().int().min(2000).max(2999), // the quarter the 2307 covers
    periodQuarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const creditMemoInput = z
  .object({
    invoiceId: z.uuid(),
    kind: z.enum(['return', 'allowance']),
    amountCents: z.number().int().positive().max(MAX_CENTS), // VAT-inclusive, like the invoice
    formNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the credit memo form (digits only).').optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const forfeitInput = z
  .object({
    jobOrderId: z.uuid(),
    amountCents: z.number().int().positive().max(MAX_CENTS), // all of the deposit, or the part the terms keep
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const writeOffInput = z.object({ invoiceId: z.uuid(), reason: z.string().trim().min(10).max(500) }).strict();
export const pdcInput = z
  .object({
    customerId: z.uuid(),
    bank: checkDetails.shape.bank,
    checkNumber: checkDetails.shape.number,
    checkDate: checkDetails.shape.date,
    amountCents: z.number().int().positive().max(MAX_CENTS),
    jobOrderIds: z.array(z.uuid()).max(10),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export const voidInput = z.object({ reason: z.string().trim().min(10).max(300) }).strict();

export const depositBody = z
  .object({
    checks: z.array(z.object({ collectionId: z.uuid(), lineNo: z.number().int().positive() }).strict()).min(1).max(30),
    toCashPlaceId: z.number().int().positive(),
  })
  .strict();
export const returnBody = z
  .object({
    collectionId: z.uuid(),
    lineNo: z.number().int().positive(),
    chargeCents: z.number().int().positive().max(10_000_00).optional(), // the bank's charge for the returned check
    reason: z.string().trim().min(10).max(300), // what the bank wrote: "Drawn against insufficient funds"
    cancelCollection: z.boolean(),
  })
  .strict();
