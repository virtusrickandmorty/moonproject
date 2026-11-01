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
