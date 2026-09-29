/** The month-end checklist's wording and rules, its menu entry and its page. */
import { describe, expect, it } from 'vitest';
import type { MonthEndChecklist } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { lastMonthOf, monthChoices, monthName, noteError, signoffButton, signoffLine, summaryLine, tally } from './month-end.ts';

const signoff = (patch: Partial<NonNullable<MonthEndChecklist['signoff']>> = {}): NonNullable<MonthEndChecklist['signoff']> =>
  ({ id: 1, month: '2026-08', signedAt: '2026-09-28T10:05:00.000+08:00', signedBy: 'u1', signedByName: 'Made-up Accountant', note: 'Reviewed', items: [], ...patch });

describe('month-end checklist rules', () => {
  it('names months, defaults to last month and lists the months to pick, newest first', () => {
    expect(monthName('2026-08')).toBe('August 2026');
    expect(lastMonthOf('2026-09-28')).toBe('2026-08');
    expect(lastMonthOf('2026-01-05')).toBe('2025-12');
    expect(monthChoices('2026-02-10', 4)).toEqual([
      { value: '2026-02', label: 'February 2026' }, { value: '2026-01', label: 'January 2026' },
      { value: '2025-12', label: 'December 2025' }, { value: '2025-11', label: 'November 2025' },
    ]);
  });

  it('says what is left in words', () => {
    const items = [{ state: 'done' as const }, { state: 'not_done' as const }, { state: 'not_needed' as const }, { state: 'not_done' as const }];
    expect(tally(items)).toEqual({ done: 1, not_done: 2, not_needed: 1 });
    expect(summaryLine(items)).toBe('2 items are not done, 1 done, 1 not needed.');
    expect(summaryLine([{ state: 'not_done' }])).toBe('1 item is not done, 0 done, 0 not needed.');
    expect(summaryLine([{ state: 'done' }, { state: 'not_needed' }])).toBe('Every item is done or not needed (1 done, 1 not needed).');
  });

  it('wants a note of 5 to 500 characters, as the server does', () => {
    expect(noteError('   ok  ')).toMatch(/at least 5/);
    expect(noteError('Reviewed with the owner')).toBeNull();
    expect(noteError('x'.repeat(501))).toMatch(/under 500/);
  });

  it('shows who signed, whether it changed after, and what the button says', () => {
    expect(signoffLine({ signoff: null, changedAfterSignoff: null })).toBeNull();
    expect(signoffButton({ signoff: null, changedAfterSignoff: null })).toBe('Sign off the month');
    const quiet = { signoff: signoff(), changedAfterSignoff: { count: 0, documents: [] } };
    expect(signoffLine(quiet)).toEqual({ text: 'Signed off by Made-up Accountant on 2026-09-28 10:05.', changed: false });
    expect(signoffButton(quiet)).toBe('Sign off again');
    const changed = { signoff: signoff(), changedAfterSignoff: { count: 2, documents: [] } };
    expect(signoffLine(changed)?.changed).toBe(true);
    expect(signoffButton(changed)).toBe('Sign the month off again');
  });

  it('is in the Accounting & Tax menu for those who may see it, at /acc/month-end', () => {
    expect(PAGES['/acc/month-end']).toBeDefined();
    const tax = (perms: string[]) => buildMenu([], new Set(perms)).find((g) => g.group === 'Accounting & Tax')?.items.map((i) => i.label) ?? [];
    expect(tax(['acc.monthend.view'])).toContain('Month-end checklist');
    expect(tax([])).not.toContain('Month-end checklist');
  });
});
