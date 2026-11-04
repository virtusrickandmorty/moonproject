/** The month-end review of orders still not collected (the owner's rule, Nov 2026). Made-up dates only. */
import { describe, expect, it } from 'vitest';
import { monthEndReviewOf } from '../home.ts';

describe('the month under review on a date', () => {
  it('is the month on its last day, leap years included', () => {
    expect(monthEndReviewOf('2026-11-30')).toBe('2026-11');
    expect(monthEndReviewOf('2028-02-29')).toBe('2028-02');
    expect(monthEndReviewOf('2026-02-28')).toBe('2026-02');
  });

  it('stays for the first week of the next month, so a closed day does not miss it', () => {
    expect(monthEndReviewOf('2026-12-01')).toBe('2026-11');
    expect(monthEndReviewOf('2026-12-07')).toBe('2026-11');
    expect(monthEndReviewOf('2027-01-03')).toBe('2026-12');
  });

  it('is nothing on the days between', () => {
    expect(monthEndReviewOf('2026-11-08')).toBeNull();
    expect(monthEndReviewOf('2026-11-29')).toBeNull();
  });
});
