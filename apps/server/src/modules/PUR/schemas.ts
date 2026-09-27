import { z } from 'zod';

export const purSupplierInput = z.object({
  name: z.string().trim().min(1).max(200),
  registeredName: z.string().trim().min(1).max(200),
  tin: z.string().trim().regex(/^(\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?)?$/).nullable().optional(),
  isVatRegistered: z.boolean(),
  ewtClass: z.enum(['none', 'rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2']).nullable().optional(),
  swornDeclarationUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), // Using simple regex as requested
  paymentTermsDays: z.number().int().min(0).nullable().optional(),
  legacyId: z.string().trim().nullable().optional(),
}).strict();

export const purSupplierContactInput = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim()
    .transform((val) => {
      // Normalize local and international format
      let norm = val.replace(/\D/g, ''); // Remove all non-digits
      if (norm.startsWith('09') && norm.length === 11) {
        return '+63' + norm.substring(1);
      }
      if (norm.startsWith('639') && norm.length === 12) {
        return '+' + norm;
      }
      if (val.startsWith('+') && norm.startsWith('639') && norm.length === 12) {
        return '+' + norm;
      }
      return val; // If not matching, return original to let regex fail
    })
    .refine((val) => /^\+63\d{10}$/.test(val) || val === "", { message: "Invalid Philippine mobile number format" })
    .nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  isActive: z.boolean().default(true),
}).strict();

export const purSupplyInput = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.enum(['yard', 'meter', 'kg', 'roll', 'pc']),
  category: z.enum(['materials', 'ready_made']),
}).strict();
