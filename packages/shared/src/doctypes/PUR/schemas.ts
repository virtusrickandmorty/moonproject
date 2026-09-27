import { z } from 'zod';

export const ewtClassSchema = z.enum([
  'none', 'rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2'
]);

export const purSupplierInput = z.object({
  name: z.string().min(1).max(200),
  registeredName: z.string().min(1).max(200),
  tin: z.string().max(50),
  isVatRegistered: z.boolean(),
  ewtClass: ewtClassSchema.nullable(),
  swornDeclarationUntil: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  bankDetails: z.string().nullable().optional(),
  contacts: z.string().nullable().optional(),
  legacyId: z.string().nullable().optional(),
}).strict();

export const purSupplyInput = z.object({
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(50),
  category: z.enum(['materials', 'ready_made']),
  lastPurchaseCostCents: z.number().int().min(0),
}).strict();
