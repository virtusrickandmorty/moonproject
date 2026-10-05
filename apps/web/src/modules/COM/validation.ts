/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
export const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const text = (max: number) => z.string().trim().max(max);
export const settingsInput = z.object({
  sendingOn: z.boolean(),
  host: text(253).regex(/^[A-Za-z0-9.-]*$/, 'The mail server name has letters, numbers, dots and dashes only.'),
  port: z.number().int().min(1).max(65535),
  user: text(254),
  senderName: text(100).refine((s) => !/[\r\n<>"]/.test(s), 'The sender name cannot have line breaks, quotes or < >.'),
  senderAddress: text(254).refine((s) => s === '' || EMAIL.test(s), 'That is not an email address.'),
  /** Write-only. Leave it out to keep the one already saved. */
  appPassword: z.string().min(1).max(200).optional(),
}).strict();

export const bulkStatementInput = z.object({ date: z.string(), customerIds: z.array(z.string().min(1).max(64)).max(500) }).strict();
