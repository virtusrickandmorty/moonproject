/**
 * The description says it is a set (the owner's request, Oct 2026: a safety net when the price list item it matches is
 * sold by the piece): the word "set" or "sets" on its own, any case ("… Polydex 200gsm SET"), not inside another word.
 */
export const saysSet = (description: string) => /(^|[^a-z0-9])sets?([^a-z0-9]|$)/i.test(description);

/** A wearer's size as shown: a set with its own lower size reads "Upper M · Lower L" (the owner's request, Oct 2026). */
export function sizeLabel(size: string | null | undefined, lowerSize?: string | null): string {
  if (!lowerSize) return size ?? '';
  return `Upper ${size ?? '?'} · Lower ${lowerSize}`;
}
