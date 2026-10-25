/** Every table in pages (the owner's request, Oct 2026): newest first, 20 a page, a report's rows all printed. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Paged, newestFirst } from './RowPages.tsx';

it('puts the newest first, by a date or a time; rows with none go last; ties keep their order', () => {
  const rows = [{ id: 'a', at: '2026-10-01' }, { id: 'b', at: '2026-10-24T09:00' }, { id: 'c', at: null }, { id: 'd', at: '2026-10-24T09:00' }];
  expect(newestFirst(rows, (r) => r.at).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']); // the list itself is left as it was
});

it('draws the first 20 rows with the page buttons under them; a short list has no buttons', () => {
  const rows = Array.from({ length: 45 }, (_, i) => `Row ${i + 1}`);
  const draw = (list: string[]) => createElement(Paged<string>, { rows: list, children: (shown: string[]) => shown.map((r) => createElement('p', { key: r }, r)) });
  const markup = renderToStaticMarkup(draw(rows));
  expect(markup).toContain('Row 20');
  expect(markup).not.toContain('Row 21');
  expect(markup).toContain('1–20 of 45 · Page 1 of 3');
  expect(markup).toContain('Rows per page');
  expect(renderToStaticMarkup(draw(rows.slice(0, 5)))).not.toContain('Previous');
});
