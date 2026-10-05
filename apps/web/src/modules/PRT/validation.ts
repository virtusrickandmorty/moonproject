/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
export const profileInput = z.object({
  registeredName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().min(1).max(200),
  tin: z.string().trim().min(1).max(40),
  registeredAddress: z.string().trim().min(1).max(500),
  isVatRegistered: z.boolean(),
}).strict();
