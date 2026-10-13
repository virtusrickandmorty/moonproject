/** A wearer's size as shown: a set with its own lower size reads "Upper M · Lower L" (the owner's request, Oct 2026). */
export function sizeLabel(size: string | null | undefined, lowerSize?: string | null): string {
  if (!lowerSize) return size ?? '';
  return `Upper ${size ?? '?'} · Lower ${lowerSize}`;
}
