/**
 * Word-by-word search for the sales pickers (the owner's request, Oct 28, 2026): every typed word must be found somewhere
 * in the record, in any order, ignoring case ("academy mary" finds "St. Mary Academy"). A word of digits also finds a
 * phone typed with its leading 0 ("0917…" finds +63917…) and a TIN typed with dashes. A plain number ("12") puts the
 * record numbered 12 (JO-000012, REL-000012, CUS-000012) first.
 */

/** The typed words, each with the other ways it may be stored: [["mary"], ["0917", "917"], ["123-456", "123456"]]. */
export function searchWords(query: string): string[][] {
  return query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12).map((word) => {
    const ways = new Set([word]);
    const digits = word.replace(/\D/g, '');
    if (digits.length >= 3 && /^[\d\-().+/]+$/.test(word)) {
      ways.add(digits);
      if (digits.startsWith('0')) ways.add(digits.slice(1));
      if (digits.startsWith('63')) ways.add(digits.slice(2));
    }
    return [...ways];
  });
}

/** Whether every word is in the text (the record's searchable parts joined, any case). */
export function matchesWords(text: string, words: string[][]): boolean {
  const t = text.toLowerCase();
  return words.every((ways) => ways.some((w) => t.includes(w)));
}

/** Whether the query is the record's number: "12", "000012" or "jo-000012" for JO-000012. */
export function isNumberMatch(number: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (number.toLowerCase() === q) return true;
  const tail = /(\d+)$/.exec(number)?.[1];
  return /^\d+$/.test(q) && tail !== undefined && Number(tail) === Number(q);
}

/** The matches, the record numbered as typed first; otherwise in the order given. */
export function searchRecords<T>(rows: readonly T[], query: string, text: (row: T) => string, number: (row: T) => string[]): T[] {
  const words = searchWords(query);
  if (words.length === 0) return [...rows];
  const found = rows.filter((r) => matchesWords(text(r), words));
  const first = found.filter((r) => number(r).some((n) => isNumberMatch(n, query)));
  return first.length ? [...first, ...found.filter((r) => !first.includes(r))] : found;
}
