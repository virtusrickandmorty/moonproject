import { describe, expect, it } from 'vitest';
import { quotationFrom, type EstimateDoc } from './estimate.ts';

const line = (o: object) => ({ lineNo: 1, itemId: 'i1', description: 'Team polo', qty: 30, unit: 'pc' as const, sheetVersionId: 1, tierFromQty: 12, marginBp: 3_500,
  unitCostCents: 30_337, suggestedCents: 47_000, priceCents: 47_000, commissionCents: 0, profitCents: 16_663, catalogCents: 45_000, lineTotalCents: 1_410_000, ...o });
const doc = (o: Partial<EstimateDoc> = {}): EstimateDoc => ({ prospectName: 'Made-up League', customerName: 'Made-up League', rulesId: 1, commissionBp: 0,
  lines: [line({}), line({ lineNo: 2, description: 'Coach polo', qty: 5, priceCents: 45_000, lineTotalCents: 225_000 })], totalCents: 1_635_000, costCents: 0, commissionTotalCents: 0, profitCents: 0, marginBp: 0, ...o });

describe('a quotation from an estimate', () => {
  it('takes the prospect and items; a price off the price list is a changed price, the estimate its reason', () => {
    const q = quotationFrom(doc({ notes: 'Deliver by Dec 5' }), 'EST-000007');
    expect(q).toMatchObject({ customerId: '', prospectName: 'Made-up League', notes: 'From cost estimate EST-000007. Deliver by Dec 5', validForDays: 15 });
    expect(q.lines).toEqual([
      { itemId: 'i1', description: 'Team polo', qty: 30, unit: 'pc', discountCents: 0, overrideUnitPriceCents: 47_000, overrideReason: 'From cost estimate EST-000007' },
      { itemId: 'i1', description: 'Coach polo', qty: 5, unit: 'pc', discountCents: 0 }, // the price list's price: nothing changed
    ]);
  });
});
