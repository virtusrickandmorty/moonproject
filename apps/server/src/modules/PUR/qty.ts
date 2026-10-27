/**
 * Purchase quantities (the owner's request, Oct 27, 2026): up to two decimal places (12.5 yards, 2.75 kg), kept exact
 * as hundredths of a unit in the database (qty_hundredths), as the customers' measurements are. The API and the
 * documents speak plain numbers (12.5); everything that adds up quantities or prices them works in hundredths, so no
 * sum drifts, and a line's money is rounded once, half away from zero, to the centavo.
 */
import { z } from 'zod';
import { divRoundHalfAway } from '@moonproject/shared';

export const MAX_QTY = 1_000_000;
/** A quantity as hundredths of a unit: 12.5 → 1250. */
export const toHundredths = (qty: number): number => Math.round(qty * 100);
/** Hundredths back to a plain quantity: 1250 → 12.5. */
export const fromHundredths = (hundredths: number): number => hundredths / 100;
/** What a quantity costs at a unit cost, rounded once to the centavo. */
export const lineCents = (hundredths: number, unitCostCents: number): number => divRoundHalfAway(hundredths * unitCostCents, 100);
/** The same rounding in SQL, for sums the database adds up (positive amounts only). */
export const lineCentsSql = (hundredths: string, unitCost: string) => `((${hundredths} * ${unitCost} + 50) / 100)`;

/** A typed quantity: more than 0, at most 1,000,000, and at most two decimal places. */
export const qtySchema = z.number().positive().max(MAX_QTY)
  .refine((q) => Math.abs(q * 100 - Math.round(q * 100)) < 1e-6, 'Type the quantity with at most 2 decimal places, like 12.5.');
