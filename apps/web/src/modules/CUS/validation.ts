/** Browser checks copied from this module's server schemas; parsing never changes the request body. */
import { z } from 'zod';
const optionalText = z.string().trim().min(1).max(500).nullable().optional();
const email = z.email().max(254).nullable().optional();
const phone = z.string().trim().min(7).max(25);

export const customerInput = z.object({
  kind: z.enum(['person', 'organization']),
  displayName: z.string().trim().min(1).max(200),
  registeredName: optionalText,
  tin: z.string().trim().max(30).nullable().optional(),
  isVatRegistered: z.boolean().optional(),
  withholdingProfile: z.enum(['none', 'twa_goods', 'twa_services', 'government', 'platform']).optional(),
  billingAddress: optionalText,
  email,
  emailConsent: z.boolean().optional(),
  creditTermsDays: z.number().int().min(0).max(365).optional(),
  parentCustomerId: z.uuid().nullable().optional(),
  notes: optionalText,
}).strict();
export const customerUpdate = customerInput.partial().strict();
export const mergeInput = z.object({
  intoCustomerId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
}).strict();

export const contactInput = z.object({
  name: z.string().trim().min(1).max(200),
  role: optionalText,
  phone: phone.nullable().optional(),
  email,
}).strict();
export const phoneInput = z.object({ phone, label: optionalText }).strict();
export const groupInput = z.object({ name: z.string().trim().min(1).max(200) }).strict();
export const personInput = z.object({
  fullName: z.string().trim().min(1).max(200),
  groupId: z.uuid().nullable().optional(),
  nickname: optionalText,
  defaultJerseyName: optionalText,
  defaultJerseyNumber: optionalText,
  gender: optionalText,
  birthday: z.iso.date().nullable().optional(),
}).strict();
export const personUpdate = personInput.partial().strict();
export const sizeInput = z.object({ label: z.string().trim().min(1).max(30), category: z.enum(['adult', 'kids']) }).strict();

export const measurements = [
  'shoulder', 'chest', 'upperWaist', 'collar', 'bustPoint', 'figurePoint',
  'bustDistance', 'armHole', 'sleeveHole', 'sleeveLength', 'upperLength',
  'lowerWaist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lowerLength',
] as const;
export const chartInput = z.object({
  sizeMode: z.enum(['preset', 'measured']),
  upperSize: z.string().max(36).nullable().optional(),
  lowerSize: z.string().max(36).nullable().optional(),
  unit: z.enum(['inch', 'cm']).optional(),
  values: z.object(Object.fromEntries(measurements.map((m) => [m, z.number().finite().positive().max(300).nullable().optional()])) as Record<(typeof measurements)[number], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>).strict(),
  remarks: optionalText,
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();
