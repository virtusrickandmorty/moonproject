/**
 * Which paper a typed CR or invoice (SI) number is from (the owner's request, Nov 2026): a BIR booklet (digits only,
 * checked against the ATP booklet register) or the shop's own internal booklet (letters and digits). The money is recorded
 * the same either way; only the number's checks differ. An internal number is used once among internal ones of its kind.
 */
export const PAPERS = ['bir', 'internal'] as const;
export type Paper = (typeof PAPERS)[number];

/** A BIR booklet number: digits only ("0125" and "125" are the same paper). */
export const BIR_NUMBER = /^0*[1-9]\d{0,11}$/;
/** An internal booklet number: letters and digits, with spaces, dashes, dots or slashes between (A-0125, SI 125), up to 20. */
export const INTERNAL_NUMBER = /^[A-Za-z0-9](?:[A-Za-z0-9 ./-]{0,18}[A-Za-z0-9])?$/;

/** What is wrong with a typed number for its paper, in words; null when it is fine. */
export function paperNumberProblem(paper: Paper, typed: string, what: 'CR' | 'invoice'): string | null {
  const t = typed.trim();
  if (paper === 'internal') {
    return INTERNAL_NUMBER.test(t) ? null : `Type the number printed on the internal ${what === 'CR' ? 'receipt' : 'invoice'}: letters and digits, up to 20.`;
  }
  return BIR_NUMBER.test(t) ? null
    : `Type the number printed on the BIR ${what === 'CR' ? 'CR' : 'invoice'} (digits only). A number with letters is from the internal booklet: pick Internal.`;
}

/** How a number reads in words: "CR 125" / "invoice no. 125", or "internal receipt A-125" / "internal invoice A-125". */
export function paperWords(paper: Paper | undefined, n: string, what: 'CR' | 'invoice'): string {
  if (paper === 'internal') return `internal ${what === 'CR' ? 'receipt' : 'invoice'} ${n}`;
  return what === 'CR' ? `CR ${n}` : `invoice no. ${n}`;
}

/** The key an internal number is compared by: the same letters and digits, whatever the case or spaces around. */
export const internalKey = (n: string) => n.trim().toUpperCase();
