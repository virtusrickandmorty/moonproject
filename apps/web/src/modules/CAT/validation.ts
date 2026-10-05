/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
const itemFields = {
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().trim().min(1).max(200),
  class: z.enum(['made_to_order_garment', 'service', 'ready_made_item']),
  garmentType: z.string().trim().min(1).max(100).nullable(),
  unit: z.enum(['pc', 'set']),
  setComponents: z.number().int().min(1).max(100),
};
export const itemInput = z.object(itemFields).strict().superRefine((v, ctx) => {
  if ((v.class === 'made_to_order_garment') !== (v.garmentType !== null)) {
    ctx.addIssue({ code: 'custom', path: ['garmentType'], message: 'Garment type is required only for made-to-order garments.' });
  }
  if (v.unit === 'pc' && v.setComponents !== 1) {
    ctx.addIssue({ code: 'custom', path: ['setComponents'], message: 'A piece has one production component.' });
  }
});
export const itemUpdate = z.object(itemFields).partial().strict();
export const priceInput = z.object({
  effectiveFrom: z.iso.date(),
  minQty: z.number().int().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
export const discountPolicyInput = z.object({ thresholdBasisPoints: z.number().int().min(0).max(10000) }).strict();
