/** What the TPL routes answer (server modules/TPL). */
export interface TplItem {
  id: string; programId: string; kind: 'made_to_order' | 'ready_made'; description: string; size: string; priceCents: number;
  reorderLevel: number; isActive: boolean; version: number; onHand: number;
}
export interface TplProgram {
  id: string; customerId: string; customerName: string; termsDays: number; creditLimitCents: number; note: string | null;
  isActive: boolean; version: number; createdAt: string;
}
export interface TplProgramRow extends TplProgram { items: number; onHand: number; belowReorder: number; openCents: number; overdueCents: number }
export interface TplRestock {
  id: string; number: string; dueDate: string; stage: string;
  lines: { lineNo: number; description: string; qty: number; inStock: number; ready: number; itemId: string | null }[];
}
export interface TplDeliveryRow {
  id: string; number: string; status: 'posted' | 'cancelled'; date: string; totalCents: number; invoiceNumber: string; dueDate: string;
  deliveredBy: string; pieces: number; invoiceId: string | null;
}
export interface TplProgramPage {
  program: TplProgram; items: TplItem[]; restocks: TplRestock[]; deliveries: TplDeliveryRow[];
  money: { openCents: number; overdueCents: number; overdue: { number: string; dueDate: string; openCents: number }[] };
}
export interface TplCardRow { kind: 'in' | 'count' | 'out' | 'back'; qty: number; reason: string | null; date: string; number: string | null; documentId: string | null; docType: string | null; byName: string; balance: number }
export interface Issue { field: string; code: string; level: 'error' | 'warning'; message: string }
export interface TplDeliveryPreview {
  totalCents: number; dueDate: string;
  delivery: { summary: string; issues: Issue[] };
  invoice: { summary: string; issues: Issue[] } | null;
}
export interface TplHome {
  restock: { programId: string; customerName: string; item: string; onHand: number; reorderLevel: number }[];
  due: { invoiceId: string; number: string; customerName: string; dueDate: string; programId: string; openCents: number; overdue: boolean }[];
}

export const itemLabel = (i: { description: string; size: string }) => (i.size ? `${i.description} (${i.size})` : i.description);
/** Pesos typed as "1,500.50" → centavos; undefined when it is not a number. */
export function toCents(text: string): number | undefined {
  const t = text.replaceAll(',', '').trim();
  if (t === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}
export const fromCents = (cents: number) => (cents / 100).toFixed(2);
