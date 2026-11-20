/**
 * Which paper a typed CR or invoice (SI) number is from (the owner's request, Nov 2026): a BIR booklet (digits only,
 * checked against the ATP booklet register) or the shop's own internal booklet. The money is recorded the same either way;
 * only the number's checks differ. An internal number is used once among internal ones of its kind.
 *   Internal numbers carry their booklet's letters (the owner's request, Nov 2026): IN- on an internal invoice, PR- on an
 *   internal (provisional) receipt. The box starts with them and takes digits only, so IN-509 and PR-1 are what is kept.
 */
export const PAPERS = ['bir', 'internal'] as const;
export type Paper = (typeof PAPERS)[number];

/** A BIR booklet number: digits only ("0125" and "125" are the same paper). */
export const BIR_NUMBER = /^0*[1-9]\d{0,11}$/;
/** The letters an internal number starts with: IN- on an invoice, PR- on a receipt. */
export const INTERNAL_PREFIX = { invoice: 'IN-', CR: 'PR-' } as const;
/** An internal number as kept: its letters, then the number without leading zeros (IN-509, PR-1). */
export const INTERNAL_NUMBER = { invoice: /^IN-[1-9]\d{0,11}$/, CR: /^PR-[1-9]\d{0,11}$/ } as const;

/**
 * What an internal number's box holds after a key press or a paste: its letters, then the digits typed (leading zeros
 * dropped, up to 12). The letters cannot be typed over; whatever else is typed in is left out.
 */
export function internalTyping(what: 'CR' | 'invoice', raw: string): string {
  const digits = raw.toUpperCase().replace(/^\s*(IN|PR)-?/, '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 12);
  return `${INTERNAL_PREFIX[what]}${digits}`;
}

/** What a booklet number's box holds after a key press: a BIR one as typed, an internal one with its letters kept. */
export const bookletTyping = (paper: Paper | undefined, what: 'CR' | 'invoice', raw: string) => (paper === 'internal' ? internalTyping(what, raw) : raw);

/** The box after picking a booklet: the digits kept, with the internal letters added or taken off. */
export function switchBooklet(paper: Paper, what: 'CR' | 'invoice', current: string): string {
  return paper === 'internal' ? internalTyping(what, current) : current.toUpperCase().replace(/^\s*(IN|PR)-?/, '').replace(/\D/g, '');
}

/** What is wrong with a typed number for its paper, in words; null when it is fine. */
export function paperNumberProblem(paper: Paper, typed: string, what: 'CR' | 'invoice'): string | null {
  const t = typed.trim();
  if (paper === 'internal') {
    return INTERNAL_NUMBER[what].test(t) ? null
      : `Type the number printed on the internal ${what === 'CR' ? 'receipt' : 'invoice'} (digits only): it is kept as ${INTERNAL_PREFIX[what]} and the number, like ${INTERNAL_PREFIX[what]}125.`;
  }
  return BIR_NUMBER.test(t) ? null
    : `Type the number printed on the BIR ${what === 'CR' ? 'CR' : 'invoice'} (digits only). A number with letters is from the internal booklet: pick Internal.`;
}

/** How a number reads in words: "CR 125" / "invoice no. 125", or "internal receipt PR-125" / "internal invoice IN-125". */
export function paperWords(paper: Paper | undefined, n: string, what: 'CR' | 'invoice'): string {
  if (paper === 'internal') return `internal ${what === 'CR' ? 'receipt' : 'invoice'} ${n}`;
  return what === 'CR' ? `CR ${n}` : `invoice no. ${n}`;
}

/** The key an internal number is compared by: the same letters and digits, whatever the case or spaces around. */
export const internalKey = (n: string) => n.trim().toUpperCase();
