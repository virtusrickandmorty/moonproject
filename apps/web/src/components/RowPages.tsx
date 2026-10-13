/**
 * A list already loaded, shown 20 rows a page with Previous and Next under it (the owner's request, Oct 2026), like the
 * employee list. A list that shrinks keeps its page in range.
 */
import { useState, type ReactNode } from 'react';
import { Button } from './ui.tsx';

export const ROWS_PER_PAGE = 20;

export function usePages<T>(rows: readonly T[] | null | undefined, per = ROWS_PER_PAGE): { shown: T[]; buttons: ReactNode } {
  const [page, setPage] = useState(0);
  const count = rows?.length ?? 0;
  const pages = Math.max(1, Math.ceil(count / per));
  const at = Math.min(page, pages - 1);
  const shown = rows?.slice(at * per, (at + 1) * per) ?? [];
  const buttons = count > per ? (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-2 text-sm">
      <Button disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</Button>
      <span>{at * per + 1} to {Math.min((at + 1) * per, count)} of {count} · page {at + 1} of {pages}</span>
      <Button disabled={at + 1 >= pages} onClick={() => setPage(at + 1)}>Next</Button>
    </div>
  ) : null;
  return { shown, buttons };
}
