/** A cost estimate as the server works it out (EST doctypes/estimate.ts). */
export interface EstimateLine {
  lineNo: number; itemId: string; description: string; qty: number; unit: 'pc' | 'set'; extraCostCents?: number; extraReason?: string; unitPriceCents?: number; priceReason?: string;
  sheetVersionId: number | null; tierFromQty: number; marginBp: number; unitCostCents: number; suggestedCents: number; priceCents: number;
  commissionCents: number; profitCents: number; catalogCents: number | null; lineTotalCents: number;
}
export interface EstimateDoc {
  customerId?: string; prospectName?: string; contact?: string; notes?: string; customerName: string; rulesId: number; commissionBp: number;
  lines: EstimateLine[]; totalCents: number; costCents: number; commissionTotalCents: number; profitCents: number; marginBp: number;
}

/**
 * The quotation form's values from a recorded estimate (QUO quotation.ts Form): the same customer or prospect and items;
 * a price that differs from the price list's goes in as a changed price with the estimate as its reason. The notes
 * name the estimate, so the quotation can be traced back to it.
 */
export function quotationFrom(doc: EstimateDoc, number: string) {
  const why = `From cost estimate ${number}`;
  return {
    customerId: doc.customerId ?? '', prospectName: doc.prospectName ?? '', contact: doc.contact ?? '', validForDays: 15, termsText: '',
    notes: [why, doc.notes].filter(Boolean).join('. '), documentDiscountCents: 0, discountReason: '',
    lines: doc.lines.map((l) => ({
      itemId: l.itemId, description: l.description, qty: l.qty, unit: l.unit, discountCents: 0,
      ...(l.priceCents !== l.catalogCents ? { overrideUnitPriceCents: l.priceCents, overrideReason: why } : {}),
    })),
  };
}
