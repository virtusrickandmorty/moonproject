/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
export const szrSetInput = z.object({
  code: z.string().trim().min(1).max(100),
  garmentType: z.string().trim().min(1).max(100),
  sizesIncluded: z.string().trim().min(1).max(200),
}).strict();

export const szrLoanInput = z.object({
  setId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  expectedReturnDate: z.string().date(),
}).strict();

export const szrReturnInput = z.object({
  status: z.enum(['in shop', 'lost or damaged']),
  conditionOnReturn: z.string().trim().min(1).max(500),
}).strict();