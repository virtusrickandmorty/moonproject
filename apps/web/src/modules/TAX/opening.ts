/**
 * The opening withholding form's rules (OBWT-, PLAN D8 "Cut-over" step 3): the customers' 2307s from before the
 * cut-over date not yet used on a return, one row per certificate, typed into input with plain errors; the quarters a
 * 2307 may cover (up to the cut-over date's); back to rows for an edit; and the register's words for a 2307 and whether
 * it may be marked received. Pure, so they are tested without a browser; the server checks everything again.
 */
import { formatPesos } from '@moonproject/shared';
import { cents } from '../COL/money.ts';
import { certificateWords } from './reports.ts';

export const ATCS = ['WC158', 'WC160', 'other'] as const;
export type Atc = (typeof ATCS)[number];
export const ATC_WORDS: Record<Atc, string> = { WC158: 'WC158 goods (1%)', WC160: 'WC160 services (2%)', other: 'Other ATC' };

/** One typed 2307; `quarter` is '2026-Q2'. */
export interface WithholdingRow { customerId: string; customerName: string; quarter: string; atc: Atc; cwt: string; vatWithheld: string; inHand: boolean }
export const emptyWithholdingRow = (): WithholdingRow => ({ customerId: '', customerName: '', quarter: '', atc: 'WC158', cwt: '', vatWithheld: '', inHand: false });

export interface WithholdingRowInput {
  customerId: string; year: number; quarter: 1 | 2 | 3 | 4; atc: Atc; cwtCents: number; vatWithheldCents: number; certificate: 'pending' | 'received';
}
export interface OpeningWithholdingInput { rows: WithholdingRowInput[]; note?: string }

const QUARTER = /^(\d{4})-Q([1-4])$/;
export const quarterWords = (q: string) => q.replace(QUARTER, 'Q$2 $1');

/** The quarters a 2307 may cover: the cut-over date's and the eleven before it, newest first. */
export function quarterChoices(cutover: string | null): { value: string; label: string }[] {
  if (!cutover) return [];
  let year = Number(cutover.slice(0, 4));
  let q = Math.ceil(Number(cutover.slice(5, 7)) / 3);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    out.push({ value: `${year}-Q${q}`, label: `Q${q} ${year}` });
    [year, q] = q === 1 ? [year - 1, 4] : [year, q - 1];
  }
  return out;
}

const isBlank = (r: WithholdingRow) => !r.customerId && !r.quarter && !r.cwt.trim() && !r.vatWithheld.trim();

/** Typed rows -> input, with plain errors. Blank rows are left out; each 2307 needs CWT, VAT withheld or both. */
export function withholdingInput(rows: WithholdingRow[], note: string): { input: OpeningWithholdingInput; errors: string[] } {
  const errors: string[] = [];
  const out: WithholdingRowInput[] = [];
  rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const n = `Row ${i + 1}`;
    const m = QUARTER.exec(r.quarter);
    const cwt = cents(r.cwt);
    const vat = cents(r.vatWithheld);
    if (!r.customerId) errors.push(`${n}: pick the customer.`);
    if (!m) errors.push(`${n}: pick the quarter the 2307 covers.`);
    if (cwt === undefined || cwt < 0) errors.push(`${n}: type the tax withheld (CWT) like 1,250.00`);
    if (vat === undefined || vat < 0) errors.push(`${n}: type the VAT withheld like 1,250.00`);
    if (cwt === 0 && vat === 0) errors.push(`${n}: type the tax withheld on the 2307 (CWT, VAT withheld or both).`);
    out.push({
      customerId: r.customerId, year: m ? Number(m[1]) : 0, quarter: (m ? Number(m[2]) : 1) as 1 | 2 | 3 | 4, atc: r.atc,
      cwtCents: Math.max(cwt ?? 0, 0), vatWithheldCents: Math.max(vat ?? 0, 0), certificate: r.inHand ? 'received' : 'pending',
    });
  });
  if (out.length === 0) errors.push('Enter at least one 2307.');
  return { input: { rows: out, ...(note.trim() ? { note: note.trim() } : {}) }, errors };
}

/** A recorded one -> typed rows, to prefill an edit; names come from the stored document. */
export const withholdingRows = (rows: WithholdingRowInput[], names: { customerName?: string }[] = []): WithholdingRow[] =>
  rows.map((r, i) => ({
    customerId: r.customerId, customerName: names[i]?.customerName ?? '', quarter: `${r.year}-Q${r.quarter}`, atc: r.atc,
    cwt: r.cwtCents ? formatPesos(r.cwtCents) : '', vatWithheld: r.vatWithheldCents ? formatPesos(r.vatWithheldCents) : '', inHand: r.certificate === 'received',
  }));

/** What the typed rows add up to; an unreadable amount counts as nothing. */
export function withholdingTotals(rows: WithholdingRow[]): { cwtCents: number; vatWithheldCents: number; pending: number } {
  const add = (text: string) => Math.max(cents(text) ?? 0, 0);
  const typed = rows.filter((r) => !isBlank(r));
  return {
    cwtCents: typed.reduce((s, r) => s + add(r.cwt), 0),
    vatWithheldCents: typed.reduce((s, r) => s + add(r.vatWithheld), 0),
    pending: typed.filter((r) => !r.inHand).length,
  };
}

/** A register row of the 2307s received, as far as these rules need it. */
export interface Received2307 {
  posting: 'original' | 'reversal'; documentId: string | null; documentStatus: 'posted' | 'cancelled' | null;
  certificate: 'pending' | 'received' | null; receivedOn: string | null; opening: boolean; period: string | null; lineNo: number;
}

/** The register's 2307 cell: in hand (and since when, if it came later) or pending; an opening's says so, with its quarter. */
export function certificateCell(r: Received2307): string {
  const status = r.certificate === 'received' && r.receivedOn ? `In hand since ${r.receivedOn}` : certificateWords(r.certificate);
  return r.opening && r.period ? `${status} · opening, ${quarterWords(r.period)}` : status;
}

/** A 2307 still to come on a document that stands: it may be marked received (the server checks again). */
export const canMarkReceived = (r: Received2307) => r.posting === 'original' && r.documentStatus === 'posted' && r.certificate === 'pending' && !!r.documentId;
