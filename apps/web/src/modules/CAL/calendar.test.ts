import { describe, expect, it } from 'vitest';
import { itemsOfKind, monthCells, monthRange, shiftMonth } from './calendar.ts';
import type { CalItem } from '../../api.ts';

describe('calendar screen date and filter logic', () => {
  it('builds a Monday-first month and includes leap day', () => {
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    const cells = monthCells(2028, 2);
    expect(cells.slice(0, 3)).toEqual([null, '2028-02-01', '2028-02-02']);
    expect(cells).toContain('2028-02-29');
    expect(cells.length % 7).toBe(0);
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('filters by one kind without changing the original list', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', kind: 'event', title: 'Fitting', href: '/cal' },
      { id: 'b', date: '2026-10-01', kind: 'holiday', title: 'Holiday', href: '/emp/holidays' },
    ] as CalItem[];
    expect(itemsOfKind(rows, 'event')).toEqual([rows[0]]);
    expect(itemsOfKind(rows, 'all')).toEqual(rows);
    expect(rows).toHaveLength(2);
  });
});
