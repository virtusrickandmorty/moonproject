import { z } from 'zod';

export const purSupplierInput = z.object({
  name: z.string().trim().min(1).max(200),
  registeredName: z.string().trim().min(1).max(200),
  tin: z.string().trim().regex(/^(\d{3}-\d{3}-\d{3}-\d{3}(\d{2})?)?$/).nullable().optional(),
  isVatRegistered: z.boolean(),
  ewtClass: z.enum(['none', 'rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2']).nullable().optional(),
  swornDeclarationUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).nullable().optional(),
  legacyId: z.string().trim().nullable().optional(),
}).strict();

export const purSupplierContactInput = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().regex(/^\+63\d{10}$/).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  isActive: z.boolean().default(true),
}).strict();

export const purSupplyInput = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.enum(['yard', 'meter', 'kg', 'roll', 'pc']),
  category: z.enum(['materials', 'ready_made']),
  lastPurchaseCostCents: z.number().int().min(0).optional(),
}).strict();
