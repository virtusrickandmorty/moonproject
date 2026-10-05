/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
const MAX_UNIT_CENTS = 100_000_00;
const MAX_TOTAL_CENTS = 100_000_000_00;
const text = (max: number) => z.string().trim().min(1).max(max);

const lineInput = z.object({
  itemId: z.uuid(),
  description: text(200),
  qty: z.number().int().min(1).max(10_000),
  unit: z.enum(['pc', 'set']),
  overrideUnitPriceCents: z.number().int().min(0).max(MAX_UNIT_CENTS).optional(),
  overrideReason: text(500).optional(),
  discountCents: z.number().int().min(0).max(MAX_TOTAL_CENTS).default(0),
  discountReason: text(500).optional(),
}).strict();

export const quotationInput = z.object({
  customerId: z.uuid().optional(),
  prospectName: text(200).optional(),
  contact: text(200).optional(),
  validForDays: z.number().int().min(1).max(365).default(15),
  termsText: text(2000).optional(),
  notes: text(2000).optional(),
  lines: z.array(lineInput).min(1).max(50),
  documentDiscountCents: z.number().int().min(0).max(MAX_TOTAL_CENTS).default(0),
  discountReason: text(500).optional(),
}).strict().refine((v) => Boolean(v.customerId) !== Boolean(v.prospectName), {
  path: ['customerId'], message: 'Pick a customer or enter a prospect name, but not both.',
});
