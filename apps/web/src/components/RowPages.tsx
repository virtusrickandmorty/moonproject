/**
 * A list already loaded, shown 20 rows a page with Previous and Next under it (the owner's request, Oct 2026), like the
 * employee list. A list that shrinks keeps its page in range.
 */
import { useState, type ReactNode } from 'react';
import { PageBar, choosePageRows, useRowsPerPage } from './ui.tsx';

export const ROWS_PER_PAGE = 20;

/** The rows of the page on show and the ERP's page bar; `per` fixes the size, else the person's rows-per-page choice. */
export function usePages<T>(rows: readonly T[] | null | undefined, per?: number): { shown: T[]; buttons: ReactNode } {
  const chosen = useRowsPerPage();
  const size = per ?? chosen;
  const [page, setPage] = useState(0);
  const count = rows?.length ?? 0;
  const pages = Math.max(1, Math.ceil(count / size));
  const at = Math.min(page, pages - 1);
  const shown = rows?.slice(at * size, (at + 1) * size) ?? [];
  // Shown once there is more than the smallest page, so the rows choice can be changed back.
  const buttons = count > (per ?? ROWS_PER_PAGE) ? (
    <PageBar first={at * size + 1} last={Math.min((at + 1) * size, count)} total={count} page={at + 1} pages={pages}
      hasPrevious={at > 0} hasNext={at + 1 < pages} onPrevious={() => setPage(at - 1)} onNext={() => setPage(at + 1)}
      {...(per === undefined ? { onRows: (r: number) => { choosePageRows(r); setPage(0); } } : {})} />
  ) : null;
  return { shown, buttons };
}

/**
 * A list paged where it is drawn (the owner's request, Oct 2026: every table of the ERP in pages): `children` draws the
 * rows of the page on show, the Previous and Next buttons go under it. A component, so it can sit inside any condition.
 */
export function Paged<T>({ rows, per, children }: { rows: readonly T[]; per?: number; children: (shown: T[]) => ReactNode }) {
  const { shown, buttons } = usePages(rows, per);
  return <>{children(shown)}{buttons}</>;
}

/**
 * Pages for a report's table, whose every row must still print: `onPage(i)` says whether row i shows on screen (the
 * others take PRINT_ONLY), and the buttons, which do not print. `count` 0 turns it off (a report the server pages).
 */
export function usePrintablePages(count: number, per = ROWS_PER_PAGE): { onPage: (i: number) => boolean; buttons: ReactNode } {
  const { shown, buttons } = usePages(Array.from({ length: count }, (_, i) => i), per);
  const showing = new Set(shown);
  return { onPage: (i) => count === 0 || showing.has(i), buttons: buttons && <div className="print:hidden">{buttons}</div> };
}
/** A report row off the page on screen: hidden there, printed with the rest. */
export const PRINT_ONLY = 'hidden print:table-row';

/** Newest first, by a date or a time as text (ISO, so it sorts as written); rows with none go last; ties keep their order. */
export const newestFirst = <T,>(rows: readonly T[], at: (row: T) => string | null | undefined): T[] =>
  [...rows].sort((a, b) => (at(b) ?? '').localeCompare(at(a) ?? ''));
