/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
export const MAX_CENTS = 100_000_000_00; // ₱100 million: a typo guard, not a business limit
const text = (max: number) => z.string().trim().min(1).max(max);

const lineInput = z
  .object({
    kind: z.enum(['service', 'ready_made', 'made_to_order']), // repair/alteration = service
    description: text(200),
    qty: z.number().int().min(1).max(10_000),
    unitPriceCents: z.number().int().min(0).max(MAX_CENTS), // VAT-inclusive
    discountCents: z.number().int().min(0).max(MAX_CENTS), // shown on the invoice
  })
  .strict();

export const saleInput = z
  .object({
    customerId: z.uuid(), // "Walk-in" is a customer record too
    // Typed from the booklet, never prefilled; checked against the ATP booklet register (TAX, D7).
    invoiceNumber: z.string().trim().regex(/^0*[1-9]\d{0,11}$/, 'Type the number printed on the invoice (digits only).'),
    lines: z.array(lineInput).min(1).max(30),
    note: text(500).optional(),
  })
  .strict();
